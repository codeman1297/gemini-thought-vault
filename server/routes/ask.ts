/**
 * Ask My Journal API Route (Milestone 10.4)
 * 
 * Production Security Rules:
 * 1. Authentication Root: Protected by requireAuth; identity derived strictly from req.user.uid.
 * 2. Absolute User Isolation: UID is never accepted from body, query, or headers.
 * 3. Schema Enforcement: Request body validated strictly by M10.1 validateAskQuery.
 * 4. Rate Limiting: 10 requests per minute per authenticated user per running application instance.
 *    forceRefresh CANNOT bypass rate limiting or validation.
 * 5. Deterministic Orchestration:
 *    verified UID -> M10.2 retrieval -> verified evidence -> M10.3 synthesis -> validated citations -> safe API response.
 * 6. Coverage Preservation: retrievalCoverage (FULL_HISTORY_SEARCH / PARTIAL_HISTORY_SEARCH) is strictly preserved.
 * 7. Invariant Preservation: Qualified timeline answers from M10.3 are returned unaltered.
 * 8. Fail-Closed Error Handling: Uncaught exceptions return sanitized 500 with zero stack traces or secret leaks.
 * 9. Privacy-First Logging: Zero raw journal content or user questions logged.
 */

import { Router, type Response, type NextFunction } from 'express';
import { requireAuth } from '../middleware/auth';
import { validateAskQuery } from '../types';
import { retrieveAskJournalCandidates } from '../services/askRetrieval';
import { synthesizeAskJournal } from '../services/askSynthesis';
import { redactSecrets } from '../lib/config';
import {
  canonicalizeAskCacheQuery,
  computeAskRetrievalFingerprint,
  deriveAskCacheKey,
  getAskCacheEntry,
  validateAskCacheEntry,
  saveAskCacheEntry,
  buildCachedResponse,
  withInFlightCoalescing,
  type AskCacheStorageOverride,
} from '../services/askCache';
import type {
  AuthenticatedRequest,
  AskMyJournalResponse,
  AskRetrievalResult,
  AskSynthesisResult,
} from '../types';

import { BoundedRateLimiter } from '../lib/rateLimit';

// Bounded in-memory sliding window rate-limiter: max 10 requests per minute per authenticated user per instance
export const askLimiter = new BoundedRateLimiter({
  name: 'ask-journal',
  maxRequests: 10,
  windowMs: 60 * 1000,
  maxKeys: 5000,
});

/**
 * Checks in-memory sliding window rate limit for an authenticated UID.
 * Note: Rate limiting is enforced per authenticated user within each running application instance.
 */
export function checkAskRateLimit(uid: string): boolean {
  return askLimiter.check(uid);
}

/**
 * Helper to reset rate limits (primarily used by test suites)
 */
export function resetAskRateLimits(): void {
  askLimiter.reset();
}

/**
 * Express middleware for Ask My Journal rate limiting
 */
export function askRateLimiter(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  const uid = req.user?.uid;
  if (!uid) {
    res.status(401).json({
      error: 'Unauthorized: Missing user authentication context.',
      code: 'UNAUTHORIZED',
    });
    return;
  }

  if (!checkAskRateLimit(uid)) {
    res.status(429).json({
      error: 'Rate limit exceeded. You may make up to 10 Ask My Journal requests per minute.',
      code: 'RATE_LIMIT_EXCEEDED',
    });
    return;
  }

  next();
}

export interface AskHandlerOptions {
  retrievalOverride?: (uid: string, query: string) => Promise<AskRetrievalResult>;
  synthesisOverride?: (query: string, result: AskRetrievalResult) => Promise<AskSynthesisResult>;
  cacheOverride?: AskCacheStorageOverride;
}

/**
 * Core handler for POST /api/journal/ask.
 * Orchestrates M10.1 validation -> M10.2 current retrieval -> M10.5 cache check -> M10.3 synthesis -> structured response.
 */
export async function handleAskJournal(
  req: AuthenticatedRequest,
  res: Response,
  options?: AskHandlerOptions
): Promise<void> {
  const user = req.user;
  if (!user || !user.uid) {
    res.status(401).json({
      error: 'Unauthorized: Missing user authentication context.',
      code: 'UNAUTHORIZED',
    });
    return;
  }

  const verifiedUid = user.uid;

  // 1. Validate request body against M10.1 schema (max 300 chars, trimmed, string)
  const validation = validateAskQuery(req.body);
  if (validation.success === false) {
    res.status(400).json({
      error: validation.error,
      code: 'INVALID_QUERY',
    });
    return;
  }

  const { query, forceRefresh } = validation.data;

  try {
    // 2. M10.2 Deterministic Retrieval & Historical Ranking (authoritative current journal state)
    const retrievalFn = options?.retrievalOverride || retrieveAskJournalCandidates;
    const retrievalResult = await retrievalFn(verifiedUid, query);

    // Compute deterministic retrieval fingerprint & cache key
    const normalizedQuery = canonicalizeAskCacheQuery(query);
    const retrievalMode = retrievalResult.deterministicFacts.retrievalMode;
    const retrievalFingerprint = computeAskRetrievalFingerprint(retrievalResult, normalizedQuery);
    const cacheKey = deriveAskCacheKey(verifiedUid, normalizedQuery, retrievalMode, retrievalFingerprint);

    // 3. Cache lookup (skipped if forceRefresh is explicitly true)
    if (!forceRefresh) {
      const cachedDoc = await getAskCacheEntry(verifiedUid, cacheKey, options?.cacheOverride);
      if (cachedDoc) {
        const cacheValidation = validateAskCacheEntry(
          cachedDoc,
          verifiedUid,
          cacheKey,
          retrievalFingerprint,
          normalizedQuery,
          retrievalMode,
          retrievalResult.verifiedMap
        );

        if (cacheValidation.valid === false) {
          console.info(`[ASK CACHE] STALE/INVALID reason=${cacheValidation.reason} mode=${retrievalMode}`);
        } else {
          console.info(`[ASK CACHE] HIT mode=${retrievalMode}`);
          const cachedResponse = buildCachedResponse(
            cacheValidation.cachedData,
            query,
            retrievalResult
          );
          res.status(200).json(cachedResponse);
          return;
        }
      } else {
        console.info(`[ASK CACHE] MISS mode=${retrievalMode}`);
      }
    }

    // 4. M10.3 Gemini Synthesis with Fallback, Citation Grounding, and In-Flight Coalescing
    const synthesisFn = options?.synthesisOverride || synthesizeAskJournal;
    const coalesceKey = `${verifiedUid}::${cacheKey}`;

    const executeSynthesis = async (): Promise<AskMyJournalResponse> => {
      const synthesisResult = await synthesisFn(query, retrievalResult);

      // Persist to cache only upon complete, validated synthesis
      await saveAskCacheEntry(
        verifiedUid,
        cacheKey,
        {
          normalizedQuery,
          retrievalMode,
          retrievalFingerprint,
          response: {
            answerType: synthesisResult.output.answerType,
            answer: synthesisResult.output.answer,
            evidenceIds: synthesisResult.output.evidenceIds,
            keyTakeaways: synthesisResult.output.keyTakeaways,
            suggestedJournalQuestions: synthesisResult.output.suggestedJournalQuestions,
            modelMetadata: synthesisResult.modelMetadata,
          },
        },
        options?.cacheOverride
      );

      return {
        query,
        answerType: synthesisResult.output.answerType,
        answer: synthesisResult.output.answer,
        deterministicFacts: retrievalResult.deterministicFacts,
        citations: synthesisResult.citations,
        keyTakeaways: synthesisResult.output.keyTakeaways,
        suggestedJournalQuestions: synthesisResult.output.suggestedJournalQuestions,
        modelMetadata: synthesisResult.modelMetadata,
        cached: false,
      };
    };

    const responsePayload = await withInFlightCoalescing(coalesceKey, executeSynthesis);
    res.status(200).json(responsePayload);
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown synthesis or retrieval error';
    // Privacy-first logging: never log raw query or journal text
    console.error(`[ASK ERROR] User: ${verifiedUid.slice(0, 8)}... | Error: ${redactSecrets(errorMsg)}`);

    res.status(500).json({
      error: 'An error occurred while analyzing your journal. Please try again.',
      code: 'ASK_PROCESSING_FAILED',
    });
  }
}

/**
 * Factory for creating an Ask Router with optional dependency injection (used for offline testing).
 */
export function createAskRouter(options?: AskHandlerOptions): Router {
  const router = Router();

  // POST / (when mounted at /api/journal/ask) or POST /ask (when mounted at /api/journal)
  router.post('/', requireAuth, askRateLimiter, (req: AuthenticatedRequest, res: Response) => {
    return handleAskJournal(req, res, options);
  });

  router.post('/ask', requireAuth, askRateLimiter, (req: AuthenticatedRequest, res: Response) => {
    return handleAskJournal(req, res, options);
  });

  return router;
}

const askRouter = createAskRouter();
export default askRouter;
