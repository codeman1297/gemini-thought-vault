/**
 * Milestone 10.6: Server-Only Insight Cache Service
 * 
 * Production Security Rules:
 * 1. Server-Only Execution: All operations execute exclusively via Admin SDK on behalf of verifiedUid.
 * 2. Absolute User Isolation: Cache path is strictly /users/${verifiedUid}/insight_cache/${cacheKey}.
 * 3. Client Denial: firestore.rules enforces `allow read, write: if false;` on insight_cache.
 * 4. Authoritative Current Aggregation: Live deterministic aggregation runs first.
 *    Cache is ONLY checked against the current aggregation fingerprint.
 * 5. Deterministic Invalidation: The aggregation fingerprint is a SHA-256 hash of the canonical
 *    deterministic aggregation facts, theme trajectories, goals, and candidate IDs.
 *    Any journal addition, edit, or deletion changes the fingerprint -> automatic cache miss.
 * 6. Evidence Grounding Check: On cache hit, every cited evidence ID MUST exist in current verifiedMap.
 *    If any cited interaction was deleted, cache hit is rejected as a MISS.
 * 7. Data Minimization: The cache never stores raw journal excerpts or Gemini prompts.
 * 8. Secondary Safety TTL: 30 minutes. Max 10 cache entries per user (FIFO pruned).
 * 9. Fail-Safe: Cache read/write failures log safely and fail open to fresh computation.
 * 10. In-Flight Coalescing: In-memory per-instance stampede prevention.
 */

import crypto from 'crypto';
import { getDb, Timestamp, assertValidUid, assertValidId } from '../lib/firestore';
import { redactSecrets } from '../lib/config';
import type {
  InsightDeterministicAggregation,
  PersonalInsightsResponse,
} from '../types';

export const CURRENT_INSIGHT_CACHE_SCHEMA_VERSION = 1;
export const CURRENT_INSIGHT_ALGORITHM_VERSION = 1;
export const CURRENT_INSIGHT_SYNTHESIS_VERSION = 1;
export const INSIGHT_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
export const MAX_USER_INSIGHT_CACHE_ENTRIES = 10;

// In-memory per-instance in-flight request coalescing
export const inFlightInsightRequests = new Map<string, Promise<PersonalInsightsResponse>>();

export interface InsightCacheDocument {
  cacheKey: string;
  userId: string;
  schemaVersion: number;
  algorithmVersion: number;
  synthesisVersion: number;
  aggregationFingerprint: string;
  createdAt: FirebaseFirestore.Timestamp;
  expiresAt: FirebaseFirestore.Timestamp;
  response: PersonalInsightsResponse;
}

export type InsightCacheValidationResult =
  | { valid: true; cachedData: InsightCacheDocument }
  | { valid: false; reason: string };

/**
 * Computes a deterministic SHA-256 fingerprint from the canonical M10.6 deterministic aggregation.
 * Incorporates coverage facts, date range, sorted theme trajectories, recurring patterns,
 * repeated action items, repeated open questions, and selected candidate IDs.
 * Raw journal content is strictly excluded.
 */
export function computeInsightAggregationFingerprint(
  aggregation: InsightDeterministicAggregation
): string {
  const sortedTrajectories = aggregation.themeTrajectories.map(t => ({
    th: t.theme,
    tr: t.trajectory,
    ef: t.earlierFrequency,
    rf: t.recentFrequency,
    tf: t.totalFrequency,
    st: t.supportTier,
    ev: [...t.evidenceIds].sort(),
  })).sort((a, b) => a.th.localeCompare(b.th));

  const sortedPatterns = aggregation.recurringPatterns.map(p => ({
    n: p.name,
    f: p.frequency,
    tc: p.distinctThreadCount,
    st: p.supportTier,
    ev: [...p.evidenceIds].sort(),
  })).sort((a, b) => a.n.localeCompare(b.n));

  const sortedGoals = aggregation.repeatedActionItems.map(g => ({
    t: g.text,
    f: g.frequency,
    tc: g.distinctThreadCount,
    st: g.supportTier,
    ev: [...g.evidenceIds].sort(),
  })).sort((a, b) => a.t.localeCompare(b.t));

  const sortedQuestions = aggregation.repeatedOpenQuestions.map(q => ({
    t: q.text,
    f: q.frequency,
    tc: q.distinctThreadCount,
    st: q.supportTier,
    ev: [...q.evidenceIds].sort(),
  })).sort((a, b) => a.t.localeCompare(b.t));

  const sortedEvidence = aggregation.selectedEvidence.map(e => ({
    id: e.interactionId,
    tid: e.threadId,
    d: e.date,
    th: [...e.themes].sort(),
  })).sort((a, b) => a.id.localeCompare(b.id));

  const canonicalPayload = {
    v: CURRENT_INSIGHT_ALGORITHM_VERSION,
    coverage: {
      totTh: aggregation.coverage.totalThreadsInVault,
      scTh: aggregation.coverage.threadsScanned,
      totInt: aggregation.coverage.totalInteractionsInVault,
      scInt: aggregation.coverage.interactionsScanned,
      cov: aggregation.coverage.retrievalCoverage,
      earliest: aggregation.coverage.earliestAnalyzedDate,
      latest: aggregation.coverage.latestAnalyzedDate,
    },
    trajectories: sortedTrajectories,
    patterns: sortedPatterns,
    goals: sortedGoals,
    questions: sortedQuestions,
    evidence: sortedEvidence,
    sufficient: aggregation.hasSufficientHistory,
  };

  return crypto
    .createHash('sha256')
    .update(JSON.stringify(canonicalPayload))
    .digest('hex');
}

/**
 * Derives a collision-resistant cache key anchored to the verified UID and aggregation fingerprint.
 */
export function deriveInsightCacheKey(
  verifiedUid: string,
  aggregationFingerprint: string,
  schemaVersion: number = CURRENT_INSIGHT_CACHE_SCHEMA_VERSION,
  algorithmVersion: number = CURRENT_INSIGHT_ALGORITHM_VERSION,
  synthesisVersion: number = CURRENT_INSIGHT_SYNTHESIS_VERSION
): string {
  const preimage = [
    'insight-cache-v1',
    verifiedUid,
    aggregationFingerprint,
    schemaVersion,
    algorithmVersion,
    synthesisVersion,
  ].join('::');

  return crypto.createHash('sha256').update(preimage).digest('hex');
}

/**
 * Validates a cached Firestore document against current runtime state and live verifiedMap.
 */
export function validateInsightCacheEntry(
  cachedDoc: unknown,
  verifiedUid: string,
  expectedFingerprint: string,
  aggregation: InsightDeterministicAggregation
): InsightCacheValidationResult {
  if (!cachedDoc || typeof cachedDoc !== 'object') {
    return { valid: false, reason: 'CACHE_DOC_MALFORMED' };
  }

  const doc = cachedDoc as Partial<InsightCacheDocument>;

  if (doc.userId !== verifiedUid) {
    return { valid: false, reason: 'USER_ID_MISMATCH' };
  }
  if (doc.schemaVersion !== CURRENT_INSIGHT_CACHE_SCHEMA_VERSION) {
    return { valid: false, reason: 'SCHEMA_VERSION_MISMATCH' };
  }
  if (doc.algorithmVersion !== CURRENT_INSIGHT_ALGORITHM_VERSION) {
    return { valid: false, reason: 'ALGORITHM_VERSION_MISMATCH' };
  }
  if (doc.synthesisVersion !== CURRENT_INSIGHT_SYNTHESIS_VERSION) {
    return { valid: false, reason: 'SYNTHESIS_VERSION_MISMATCH' };
  }
  if (doc.aggregationFingerprint !== expectedFingerprint) {
    return { valid: false, reason: 'FINGERPRINT_MISMATCH' };
  }

  // Verify TTL expiration
  if (doc.expiresAt && doc.expiresAt instanceof Timestamp) {
    if (Date.now() > doc.expiresAt.toDate().getTime()) {
      return { valid: false, reason: 'TTL_EXPIRED' };
    }
  } else {
    return { valid: false, reason: 'INVALID_EXPIRY_TIMESTAMP' };
  }

  if (!doc.response || typeof doc.response !== 'object' || doc.response.status !== 'ready') {
    return { valid: false, reason: 'RESPONSE_PAYLOAD_INVALID' };
  }

  // Stale-data protection: Verify that EVERY cited evidence ID in the cached response exists in the current live verifiedMap
  const verifiedMap = aggregation.verifiedMap;
  if (Array.isArray(doc.response.citations)) {
    for (const citation of doc.response.citations) {
      if (!citation || typeof citation.interactionId !== 'string' || !verifiedMap.has(citation.interactionId)) {
        return { valid: false, reason: 'CITED_EVIDENCE_STALE_OR_DELETED' };
      }
    }
  }

  return { valid: true, cachedData: doc as InsightCacheDocument };
}

/**
 * Attempts to retrieve a valid cached insight response from Firestore.
 */
export async function getCachedPersonalInsights(
  verifiedUid: string,
  aggregation: InsightDeterministicAggregation,
  options?: { dbOverride?: any }
): Promise<PersonalInsightsResponse | null> {
  assertValidUid(verifiedUid);
  const aggregationFingerprint = computeInsightAggregationFingerprint(aggregation);
  const cacheKey = deriveInsightCacheKey(verifiedUid, aggregationFingerprint);
  assertValidId(cacheKey, 'cacheKey');
  const db = options?.dbOverride || getDb();

  try {
    const docRef = db.doc(`users/${verifiedUid}/insight_cache/${cacheKey}`);
    const snapshot = await docRef.get();

    if (!snapshot.exists) {
      return null;
    }

    const validation = validateInsightCacheEntry(
      snapshot.data(),
      verifiedUid,
      aggregationFingerprint,
      aggregation
    );

    if (!validation.valid) {
      return null;
    }

    // Return cached response marked as cached: true
    return {
      ...validation.cachedData.response,
      cached: true,
    };
  } catch (err) {
    console.warn(`[INSIGHT CACHE WARN] Cache read failed (failing open): ${redactSecrets(String(err))}`);
    return null;
  }
}

/**
 * Persists a validated insight response to the user's Firestore cache namespace.
 */
export async function setCachedPersonalInsights(
  verifiedUid: string,
  aggregation: InsightDeterministicAggregation,
  response: PersonalInsightsResponse,
  options?: { dbOverride?: any }
): Promise<void> {
  assertValidUid(verifiedUid);
  if (response.status !== 'ready') {
    return; // Do not cache insufficient history
  }

  const aggregationFingerprint = computeInsightAggregationFingerprint(aggregation);
  const cacheKey = deriveInsightCacheKey(verifiedUid, aggregationFingerprint);
  assertValidId(cacheKey, 'cacheKey');
  const db = options?.dbOverride || getDb();

  try {
    const docRef = db.doc(`users/${verifiedUid}/insight_cache/${cacheKey}`);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + INSIGHT_CACHE_TTL_MS);

    // Minimize stored data: Zero raw journal text, only clean response
    const cacheDoc: InsightCacheDocument = {
      cacheKey,
      userId: verifiedUid,
      schemaVersion: CURRENT_INSIGHT_CACHE_SCHEMA_VERSION,
      algorithmVersion: CURRENT_INSIGHT_ALGORITHM_VERSION,
      synthesisVersion: CURRENT_INSIGHT_SYNTHESIS_VERSION,
      aggregationFingerprint,
      createdAt: Timestamp.fromDate(now),
      expiresAt: Timestamp.fromDate(expiresAt),
      response: {
        ...response,
        cached: true,
      },
    };

    await docRef.set(cacheDoc);

    // Asynchronously prune excess cache entries
    pruneOldInsightCacheEntries(verifiedUid, db).catch(err => {
      console.warn(`[INSIGHT CACHE PRUNE WARN] Pruning failed: ${redactSecrets(String(err))}`);
    });
  } catch (err) {
    console.warn(`[INSIGHT CACHE WARN] Cache write failed (failing open): ${redactSecrets(String(err))}`);
  }
}

/**
 * Prunes older insight cache documents exceeding MAX_USER_INSIGHT_CACHE_ENTRIES.
 */
async function pruneOldInsightCacheEntries(verifiedUid: string, db: any): Promise<void> {
  const collRef = db.collection(`users/${verifiedUid}/insight_cache`);
  const snapshot = await collRef.orderBy('createdAt', 'desc').get();

  if (snapshot.docs.length <= MAX_USER_INSIGHT_CACHE_ENTRIES) {
    return;
  }

  const excess = snapshot.docs.slice(MAX_USER_INSIGHT_CACHE_ENTRIES);
  const batch = db.batch();
  for (const doc of excess) {
    batch.delete(doc.ref);
  }
  await batch.commit();
}

export const MAX_IN_FLIGHT_INSIGHT_COALESCING = 500;

/**
 * Executes a function with in-flight coalescing per Cloud Run instance to avoid
 * simultaneous duplicate synthesis requests for the same user and state.
 * Bounded by MAX_IN_FLIGHT_INSIGHT_COALESCING.
 */
export async function withInFlightInsightCoalescing(
  verifiedUid: string,
  cacheKey: string,
  fn: () => Promise<PersonalInsightsResponse>
): Promise<PersonalInsightsResponse> {
  const coalescingKey = `${verifiedUid}::${cacheKey}`;
  const existing = inFlightInsightRequests.get(coalescingKey);

  if (existing) {
    return existing;
  }

  // If in-flight map is at maximum capacity, execute directly without coalescing
  if (inFlightInsightRequests.size >= MAX_IN_FLIGHT_INSIGHT_COALESCING) {
    return fn();
  }

  const promise = fn().finally(() => {
    inFlightInsightRequests.delete(coalescingKey);
  });

  inFlightInsightRequests.set(coalescingKey, promise);
  return promise;
}

export function resetInFlightInsightRequests(): void {
  inFlightInsightRequests.clear();
}
