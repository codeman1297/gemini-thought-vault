/**
 * Personal Journal Insights API Route (Milestone 10.6)
 * 
 * Production Security Rules:
 * 1. Authentication Root: Protected by requireAuth; identity derived strictly from req.user.uid.
 * 2. Absolute User Isolation: UID is never accepted from query parameters, body, or headers.
 * 3. Rate Limiting: 4 requests per minute per authenticated user per running instance.
 *    forceRefresh CANNOT bypass rate limiting.
 * 4. Deterministic Orchestration:
 *    verified UID -> deterministic aggregation -> fingerprint & cache lookup -> grounded synthesis -> validated citations -> safe API response.
 * 5. Coverage & Invariant Preservation: FULL_HISTORY_SEARCH vs PARTIAL_HISTORY_SEARCH and factual disclosures are strictly preserved.
 * 6. Fail-Closed Error Handling: Uncaught exceptions return sanitized 500 with zero stack traces or secret leaks.
 * 7. Privacy-First Logging: Zero raw journal content or user prompt text logged.
 */

import { Router, type Response, type NextFunction } from 'express';
import { requireAuth } from '../middleware/auth';
import { aggregatePersonalJournalInsights } from '../services/insightAggregator';
import { synthesizePersonalInsights } from '../services/insightSynthesis';
import {
  getCachedPersonalInsights,
  setCachedPersonalInsights,
  computeInsightAggregationFingerprint,
  deriveInsightCacheKey,
  withInFlightInsightCoalescing,
} from '../services/insightCache';
import { redactSecrets } from '../lib/config';
import type { AuthenticatedRequest, PersonalInsightsResponse } from '../types';

import { BoundedRateLimiter } from '../lib/rateLimit';

// Bounded in-memory sliding window rate-limiter: max 4 requests per minute per authenticated user per instance
export const insightLimiter = new BoundedRateLimiter({
  name: 'insights',
  maxRequests: 4,
  windowMs: 60 * 1000,
  maxKeys: 5000,
});

export function checkInsightRateLimit(uid: string): boolean {
  return insightLimiter.check(uid);
}

export function resetInsightRateLimits(): void {
  insightLimiter.reset();
}

/**
 * GET /api/journal/insights
 * 
 * Authenticated endpoint for longitudinal personal journal intelligence.
 */
export interface InsightRouteOptions {
  aggregatorOverride?: (uid: string) => Promise<any>;
  synthesisOverride?: (aggregation: any) => Promise<PersonalInsightsResponse>;
  dbOverride?: any;
}

export async function handleGetInsights(
  req: AuthenticatedRequest,
  res: Response,
  options?: InsightRouteOptions
): Promise<void> {
  const startTime = Date.now();
  const verifiedUid = req.user?.uid;

  if (!verifiedUid) {
    res.status(401).json({
      error: 'Unauthorized: Valid authentication token required.',
    });
    return;
  }

  // 1. Enforce rate limiting
  if (!checkInsightRateLimit(verifiedUid)) {
    res.status(429).setHeader('Retry-After', '60').json({
      error: 'Too Many Requests: Personal Insights rate limit exceeded (maximum 4 requests per minute).',
    });
    return;
  }

  const forceRefresh = req.query.forceRefresh === 'true';

  try {
    // 2. Perform deterministic mathematical aggregation
    const aggregation = options?.aggregatorOverride
      ? await options.aggregatorOverride(verifiedUid)
      : await aggregatePersonalJournalInsights(verifiedUid, { dbOverride: options?.dbOverride });

    // 3. Fast-path: If user has insufficient history (< 3 entries), return immediately (0 Gemini calls)
    if (!aggregation.hasSufficientHistory) {
      const response = options?.synthesisOverride
        ? await options.synthesisOverride(aggregation)
        : await synthesizePersonalInsights(aggregation);
      res.status(200).json(response);
      return;
    }

    // 4. Cache check (unless forceRefresh is requested)
    if (!forceRefresh) {
      const cached = await getCachedPersonalInsights(verifiedUid, aggregation, { dbOverride: options?.dbOverride });
      if (cached) {
        res.status(200).json(cached);
        return;
      }
    }

    // 5. Coalesce in-flight requests and perform fresh grounded Gemini synthesis
    const aggregationFingerprint = computeInsightAggregationFingerprint(aggregation);
    const cacheKey = deriveInsightCacheKey(verifiedUid, aggregationFingerprint);

    const synthesizedResponse = await withInFlightInsightCoalescing(
      verifiedUid,
      cacheKey,
      async () => {
        const fresh = options?.synthesisOverride
          ? await options.synthesisOverride(aggregation)
          : await synthesizePersonalInsights(aggregation);

        // Persist to cache if synthesis was successful
        if (fresh.status === 'ready') {
          await setCachedPersonalInsights(verifiedUid, aggregation, fresh, { dbOverride: options?.dbOverride });
        }
        return fresh;
      }
    );

    const durationMs = Date.now() - startTime;
    console.info(
      `[INSIGHTS SUCCESS] uid_prefix=${verifiedUid.slice(0, 6)}... threads=${aggregation.coverage.threadsScanned} interactions=${aggregation.coverage.interactionsScanned} duration_ms=${durationMs} status=${synthesizedResponse.status}`
    );

    res.status(200).json(synthesizedResponse);
  } catch (err: unknown) {
    const durationMs = Date.now() - startTime;
    const rawError = err instanceof Error ? err.message : String(err);
    const sanitizedError = redactSecrets(rawError);

    console.error(
      `[INSIGHTS ERROR] uid_prefix=${verifiedUid.slice(0, 6)}... duration_ms=${durationMs} error=${sanitizedError}`
    );

    if (sanitizedError.includes('AI service temporarily unavailable')) {
      res.status(503).json({
        error: 'AI service temporarily unavailable. Please try again in a few moments.',
      });
      return;
    }

    res.status(500).json({
      error: 'Failed to generate personal journal insights. Please try again later.',
    });
  }
}

export function createInsightsRouter(options?: InsightRouteOptions): Router {
  const router = Router();

  // Handle both mounting directly or mounting under /api/journal/insights
  router.get('/', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    return handleGetInsights(req, res, options);
  });

  router.get('/insights', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    return handleGetInsights(req, res, options);
  });

  return router;
}

export const insightsRouter = createInsightsRouter();
export default insightsRouter;

