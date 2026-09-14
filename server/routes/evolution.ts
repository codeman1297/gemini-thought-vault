/**
 * Thought Evolution API Routes (Milestone 9)
 * 
 * Production Security Rules:
 * 1. Protected by verifyFirebaseToken; identity derived strictly from req.user.uid.
 * 2. Distributed Transactional Lock: Multi-instance safe lock under /users/${uid}/evolution/lock.
 * 3. Lock acquisition returns HTTP 409 if analysis is currently in progress.
 * 4. Fencing token: verifyLockOwnership prevents stale commits from overwriting newer locks.
 * 5. Ownership-safe release: releaseEvolutionLock only releases if the lockId matches.
 * 6. Global 25-interaction ceiling: Never sends more than 25 interactions total to Gemini.
 * 7. Insufficient history (<2 entries) creates zero Gemini calls and omits modelMetadata.
 * 8. Canonical hashing: Returns cached results without Gemini invocations if contentHash is unchanged.
 * 9. Privacy-first: Zero raw journal text stored in evolution documents; on-demand evidence dereferencing.
 */

import { Router, type Response } from 'express';
import { verifyFirebaseToken } from '../middleware/auth';
import { acquireEvolutionLock, releaseEvolutionLock, EvolutionLockConflictError } from '../services/evolutionLock';
import { collectBoundedHistory, computeDeterministicMetrics, computeCanonicalContentHash } from '../services/evolutionAggregator';
import { synthesizeThoughtEvolution } from '../services/evolutionEngine';
import { getLatestEvolution, saveEvolutionDocument, getSupportingInteractionEvidence } from '../services/evolutionStore';
import { redactSecrets } from '../lib/config';
import type { AuthenticatedRequest, ThoughtEvolutionDocument } from '../types';

import { BoundedRateLimiter } from '../lib/rateLimit';

const router = Router();

// Bounded in-memory generation rate-limiter: max 4 generations per minute
export const evolutionRateLimiter = new BoundedRateLimiter({
  name: 'evolution-generation',
  maxRequests: 4,
  windowMs: 60 * 1000,
  maxKeys: 5000,
});

export function checkGenerationRateLimit(uid: string): boolean {
  return evolutionRateLimiter.check(uid);
}

export function resetEvolutionRateLimits(): void {
  evolutionRateLimiter.reset();
}

/**
 * GET /api/journal/evolution
 * Retrieves the user's latest computed Thought Evolution report.
 */
router.get('/', verifyFirebaseToken, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const uid = req.user?.uid;
  if (!uid) {
    res.status(401).json({ error: 'UNAUTHORIZED', message: 'Authentication required.' });
    return;
  }

  try {
    const report = await getLatestEvolution(uid);
    if (!report) {
      // Check bounded history to see if user has insufficient history
      const { candidates } = await collectBoundedHistory(uid);
      if (candidates.length < 2) {
        const metrics = computeDeterministicMetrics(candidates, 0);
        const hash = computeCanonicalContentHash(candidates);
        const insufficientDoc: ThoughtEvolutionDocument = {
          id: 'latest',
          userId: uid,
          status: 'insufficient_history',
          generatedAt: new Date().toISOString(),
          metrics,
          contentHash: hash,
          message: 'Thought Evolution requires at least 2 journal reflections to discover patterns and evolving thoughts.',
        };
        await saveEvolutionDocument(uid, insufficientDoc);
        res.json({ success: true, evolution: insufficientDoc });
        return;
      }

      res.json({ success: true, evolution: null, message: 'No Thought Evolution report generated yet.' });
      return;
    }

    res.json({ success: true, evolution: report });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : 'Failed to retrieve Thought Evolution report.';
    console.error(`[EVOLUTION ERROR] Retrieval failed for user ${uid.slice(0, 6)}...: ${redactSecrets(errMsg)}`);
    res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to retrieve Thought Evolution report.' });
  }
});

/**
 * POST /api/journal/evolution/generate
 * Triggers a fresh Thought Evolution analysis.
 * Uses atomic distributed locking, strict 25-interaction bounding, and canonical hash validation.
 */
router.post('/generate', verifyFirebaseToken, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const uid = req.user?.uid;
  if (!uid) {
    res.status(401).json({ error: 'UNAUTHORIZED', message: 'Authentication required.' });
    return;
  }

  if (!checkGenerationRateLimit(uid)) {
    res.status(429).json({
      error: 'RATE_LIMIT_EXCEEDED',
      message: 'You have triggered Thought Evolution too frequently. Please wait a moment before generating again.',
    });
    return;
  }

  const forceRefresh = req.body && typeof req.body === 'object' && req.body.forceRefresh === true;

  let lockId: string | null = null;
  try {
    // 1. Acquire distributed transactional lock
    lockId = await acquireEvolutionLock(uid);
  } catch (err: unknown) {
    if (err instanceof EvolutionLockConflictError) {
      res.status(409).json({
        error: 'ANALYSIS_IN_PROGRESS',
        message: err.message,
      });
      return;
    }
    const errMsg = err instanceof Error ? err.message : 'Lock acquisition failed.';
    console.error(`[LOCK ERROR] User ${uid.slice(0, 6)}...: ${redactSecrets(errMsg)}`);
    res.status(500).json({ error: 'LOCK_FAILURE', message: 'Unable to start Thought Evolution analysis.' });
    return;
  }

  try {
    // 2. Collect bounded history (max 5 per thread, max 25 total)
    const { candidates, totalActiveThreads } = await collectBoundedHistory(uid);

    // 3. Insufficient history check (< 2 entries)
    if (candidates.length < 2) {
      const metrics = computeDeterministicMetrics(candidates, totalActiveThreads);
      const hash = computeCanonicalContentHash(candidates);
      const insufficientDoc: ThoughtEvolutionDocument = {
        id: 'latest',
        userId: uid,
        status: 'insufficient_history',
        generatedAt: new Date().toISOString(),
        metrics,
        contentHash: hash,
        message: 'Thought Evolution requires at least 2 journal reflections to discover patterns and evolving thoughts.',
      };

      await saveEvolutionDocument(uid, insufficientDoc, lockId);
      res.json({ success: true, evolution: insufficientDoc, cached: false });
      return;
    }

    // 4. Calculate deterministic metrics and canonical content hash
    const metrics = computeDeterministicMetrics(candidates, totalActiveThreads);
    const contentHash = computeCanonicalContentHash(candidates);

    // 5. Cache hit check (if !forceRefresh and hash matches)
    if (!forceRefresh) {
      const cached = await getLatestEvolution(uid);
      if (cached && cached.status === 'ready' && cached.contentHash === contentHash && cached.insights) {
        res.json({ success: true, evolution: cached, cached: true });
        return;
      }
    }

    // 6. Synthesize Thought Evolution via Gemini 4-tier fallback gateway
    const { insights, modelUsed, fallbackUsed, attemptsCount, latencyMs } = 
      await synthesizeThoughtEvolution(candidates, metrics);

    // 7. Assemble authoritative ThoughtEvolutionDocument
    const newDoc: ThoughtEvolutionDocument = {
      id: 'latest',
      userId: uid,
      status: 'ready',
      generatedAt: new Date().toISOString(),
      metrics,
      insights,
      modelMetadata: {
        modelUsed,
        fallbackUsed,
        attemptsCount,
        latencyMs,
      },
      contentHash,
    };

    // 8. Persist with pre-commit lock ownership fencing check
    const committed = await saveEvolutionDocument(uid, newDoc, lockId);
    if (!committed) {
      res.status(409).json({
        error: 'STALE_LOCK_ABORT',
        message: 'The analysis took longer than expected and was superseded by another request. Please refresh.',
      });
      return;
    }

    res.json({ success: true, evolution: newDoc, cached: false });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : 'Unknown generation failure.';
    console.error(`[EVOLUTION SYNTHESIS ERROR] User ${uid.slice(0, 6)}...: ${redactSecrets(errMsg)}`);
    res.status(503).json({
      error: 'AI_SERVICE_UNAVAILABLE',
      message: 'Thought Evolution synthesis is temporarily unavailable. Your journal entries remain secure.',
    });
  } finally {
    // 9. Ownership-safe lock release in all completion/error paths
    if (lockId) {
      await releaseEvolutionLock(uid, lockId);
    }
  }
});

/**
 * GET /api/journal/evolution/evidence/:threadId/:interactionId
 * On-demand dereferencing of supporting thoughts from current authorized Firestore data.
 * If the thought has been deleted, returns a graceful unavailable message.
 */
router.get('/evidence/:threadId/:interactionId', verifyFirebaseToken, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const uid = req.user?.uid;
  if (!uid) {
    res.status(401).json({ error: 'UNAUTHORIZED', message: 'Authentication required.' });
    return;
  }

  const { threadId, interactionId } = req.params;
  if (!threadId || !interactionId) {
    res.status(400).json({ error: 'BAD_REQUEST', message: 'threadId and interactionId are required.' });
    return;
  }

  try {
    const evidence = await getSupportingInteractionEvidence(uid, threadId, interactionId);
    res.json({ success: true, evidence });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : 'Failed to dereference evidence.';
    console.error(`[EVIDENCE ERROR] User ${uid.slice(0, 6)}...: ${redactSecrets(errMsg)}`);
    res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to retrieve supporting evidence.' });
  }
});

export default router;
