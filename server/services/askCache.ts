/**
 * Ask My Journal — Secure Server-Only Cache Service (Milestone 10.5)
 * 
 * Production Security Rules:
 * 1. Server-Only Execution: All operations execute exclusively via Admin SDK on behalf of verifiedUid.
 * 2. Absolute User Isolation: Cache path is strictly /users/${verifiedUid}/ask_cache/${cacheKey}.
 * 3. Zero Client Trust: cacheKey, retrievalFingerprint, and state are strictly computed server-side.
 * 4. Authoritative Current Retrieval: M10.2 runs first. Cache is ONLY checked against current M10.2 result.
 * 5. Deterministic Invalidation: retrievalFingerprint incorporates all current candidates and facts.
 *    Any journal edit, addition, or deletion naturally produces a different fingerprint -> cache miss.
 * 6. Evidence Grounding Check: On cache hit, every cached evidenceId MUST exist in the current M10.2 verifiedMap.
 *    If any evidence is missing or deleted, the hit is treated as a cache miss.
 * 7. Data Minimization: The cache stores only synthesis fields and evidence IDs, NEVER raw journal excerpts.
 *    Citations are reconstituted dynamically from the current verifiedMap.
 * 8. Fail-Safe Operations: Cache read/write errors are logged safely and never fail the user's Ask request.
 * 9. Privacy-First Logging: Zero raw questions, answers, or journal prose are ever logged.
 */

import crypto from 'crypto';
import { getDb, Timestamp, assertValidUid, assertValidId } from '../lib/firestore';
import { redactSecrets } from '../lib/config';
import type {
  AskRetrievalResult,
  AskRetrievalMode,
  AskAnswerType,
  AskMyJournalResponse,
  AskCandidateEvidence,
  AskEvidenceReference,
} from '../types';

// ============================================================================
// Cache Configuration & Version Constants
// ============================================================================

export const CURRENT_ASK_CACHE_SCHEMA_VERSION = 1;
export const CURRENT_ASK_SYNTHESIS_VERSION = 1;
export const CURRENT_ASK_RETRIEVAL_FINGERPRINT_VERSION = 1;

/**
 * Secondary TTL safety boundary: 30 minutes.
 * Primary freshness is guaranteed deterministically by retrievalFingerprint.
 */
export const ASK_CACHE_TTL_MS = 30 * 60 * 1000;

/**
 * Maximum cache documents allowed per user to prevent unbounded storage growth.
 */
export const MAX_USER_CACHE_ENTRIES = 50;

// In-memory request coalescing map to protect against concurrent stampedes per instance
export const inFlightAskRequests = new Map<string, Promise<AskMyJournalResponse>>();

// ============================================================================
// Types
// ============================================================================

export interface AskCacheSynthesisData {
  answerType: AskAnswerType;
  answer: string;
  evidenceIds: string[];
  keyTakeaways: string[];
  suggestedJournalQuestions: string[];
  modelMetadata?: {
    modelUsed?: string;
    fallbackUsed?: boolean;
    attemptsCount?: number;
    latencyMs?: number;
  };
}

export interface AskCacheDocument {
  cacheKey: string;
  userId: string;
  schemaVersion: number;
  synthesisVersion: number;
  normalizedQuery: string;
  retrievalMode: AskRetrievalMode;
  retrievalFingerprint: string;
  createdAt: FirebaseFirestore.Timestamp;
  expiresAt: FirebaseFirestore.Timestamp;
  response: AskCacheSynthesisData;
}

export type AskCacheValidationResult =
  | { valid: true; cachedData: AskCacheDocument }
  | { valid: false; reason: string };

// ============================================================================
// Normalization & Fingerprinting Utilities
// ============================================================================

/**
 * Canonicalizes a user query for deterministic cache lookup.
 * Trims, lowercases, and collapses redundant whitespace.
 */
export function canonicalizeAskCacheQuery(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Computes a deterministic SHA-256 fingerprint of the CURRENT M10.2 retrieval result.
 * Incorporates candidate identifiers, timestamps, deterministic scores, and ranking facts.
 * Raw journal content is strictly excluded to preserve privacy.
 */
export function computeAskRetrievalFingerprint(
  retrievalResult: AskRetrievalResult,
  normalizedQuery: string
): string {
  const sortedCandidates = retrievalResult.candidates.map(c => ({
    id: c.interactionId,
    tid: c.threadId,
    d: c.date,
    s: Number(c.score.toFixed(4)),
    t: [...c.themes].sort(),
  }));

  const canonicalPayload = {
    v: CURRENT_ASK_RETRIEVAL_FINGERPRINT_VERSION,
    q: normalizedQuery,
    mode: retrievalResult.deterministicFacts.retrievalMode,
    cov: retrievalResult.deterministicFacts.retrievalCoverage,
    facts: {
      threads: retrievalResult.deterministicFacts.totalThreadsSearched,
      scanned: retrievalResult.deterministicFacts.totalInteractionsScanned,
      matched: retrievalResult.deterministicFacts.matchingEntriesFound,
      dr: retrievalResult.deterministicFacts.dateRange,
      th: [...retrievalResult.deterministicFacts.matchedThemes].sort(),
    },
    candidates: sortedCandidates,
  };

  return crypto
    .createHash('sha256')
    .update(JSON.stringify(canonicalPayload))
    .digest('hex');
}

/**
 * Derives a cryptographically secure, collision-resistant cache key.
 * Anchored to the verifiedUid, normalized query, retrieval mode, and retrieval fingerprint.
 */
export function deriveAskCacheKey(
  verifiedUid: string,
  normalizedQuery: string,
  retrievalMode: string,
  retrievalFingerprint: string,
  schemaVersion: number = CURRENT_ASK_CACHE_SCHEMA_VERSION,
  synthesisVersion: number = CURRENT_ASK_SYNTHESIS_VERSION
): string {
  const preimage = [
    'ask-cache-v1',
    verifiedUid,
    normalizedQuery,
    retrievalMode,
    retrievalFingerprint,
    schemaVersion,
    synthesisVersion,
  ].join('::');

  return crypto.createHash('sha256').update(preimage).digest('hex');
}

// ============================================================================
// Cache Validation Logic
// ============================================================================

const VALID_ANSWER_TYPES: ReadonlySet<string> = new Set<AskAnswerType>([
  'grounded_answer',
  'insufficient_evidence',
  'no_relevant_entries',
  'out_of_scope',
]);

/**
 * Validates a raw cached Firestore document against current runtime and retrieval state.
 * Enforces all 16 security and grounding checks.
 */
export function validateAskCacheEntry(
  cachedDoc: unknown,
  verifiedUid: string,
  expectedCacheKey: string,
  currentFingerprint: string,
  normalizedQuery: string,
  currentRetrievalMode: string,
  currentVerifiedMap: Map<string, AskCandidateEvidence>
): AskCacheValidationResult {
  if (!cachedDoc || typeof cachedDoc !== 'object') {
    return { valid: false, reason: 'MISSING_OR_MALFORMED_DOCUMENT' };
  }

  const doc = cachedDoc as Record<string, unknown>;

  // 1. Identity & Key Verification
  if (doc.cacheKey !== expectedCacheKey) {
    return { valid: false, reason: 'CACHE_KEY_MISMATCH' };
  }
  if (doc.userId !== verifiedUid) {
    return { valid: false, reason: 'USER_ID_MISMATCH' };
  }

  // 2. Version Verification
  if (doc.schemaVersion !== CURRENT_ASK_CACHE_SCHEMA_VERSION) {
    return { valid: false, reason: 'SCHEMA_VERSION_MISMATCH' };
  }
  if (doc.synthesisVersion !== CURRENT_ASK_SYNTHESIS_VERSION) {
    return { valid: false, reason: 'SYNTHESIS_VERSION_MISMATCH' };
  }

  // 3. Deterministic Retrieval State Verification
  if (doc.retrievalFingerprint !== currentFingerprint) {
    return { valid: false, reason: 'RETRIEVAL_FINGERPRINT_STALE' };
  }
  if (doc.normalizedQuery !== normalizedQuery) {
    return { valid: false, reason: 'NORMALIZED_QUERY_MISMATCH' };
  }
  if (doc.retrievalMode !== currentRetrievalMode) {
    return { valid: false, reason: 'RETRIEVAL_MODE_MISMATCH' };
  }

  // 4. TTL & Expiry Verification
  const expiresAt = doc.expiresAt as { toMillis?: () => number };
  if (!expiresAt || typeof expiresAt.toMillis !== 'function') {
    return { valid: false, reason: 'INVALID_EXPIRES_AT' };
  }
  if (expiresAt.toMillis() <= Date.now()) {
    return { valid: false, reason: 'CACHE_EXPIRED' };
  }

  // 5. Structure & Synthesis Validation
  if (!doc.response || typeof doc.response !== 'object') {
    return { valid: false, reason: 'INVALID_RESPONSE_OBJECT' };
  }
  const resp = doc.response as Record<string, unknown>;

  if (typeof resp.answerType !== 'string' || !VALID_ANSWER_TYPES.has(resp.answerType)) {
    return { valid: false, reason: 'INVALID_ANSWER_TYPE' };
  }
  if (typeof resp.answer !== 'string' || resp.answer.trim().length === 0 || resp.answer.length > 600) {
    return { valid: false, reason: 'INVALID_ANSWER_LENGTH' };
  }
  if (!Array.isArray(resp.evidenceIds) || resp.evidenceIds.length > 10) {
    return { valid: false, reason: 'INVALID_EVIDENCE_IDS' };
  }
  if (!Array.isArray(resp.keyTakeaways) || resp.keyTakeaways.length > 3) {
    return { valid: false, reason: 'INVALID_KEY_TAKEAWAYS' };
  }
  if (!Array.isArray(resp.suggestedJournalQuestions) || resp.suggestedJournalQuestions.length > 2) {
    return { valid: false, reason: 'INVALID_SUGGESTED_QUESTIONS' };
  }

  // 6. Authoritative Evidence Liveness & Grounding Check
  const evidenceIds = resp.evidenceIds as string[];
  for (const evidenceId of evidenceIds) {
    if (!currentVerifiedMap.has(evidenceId)) {
      // Evidence was deleted, modified, or no longer selected by M10.2 -> treat as MISS
      return { valid: false, reason: 'EVIDENCE_STALE_OR_ABSENT' };
    }
  }

  // If grounded_answer, must have at least one valid evidence reference
  if (resp.answerType === 'grounded_answer' && evidenceIds.length === 0) {
    return { valid: false, reason: 'EMPTY_GROUNDED_EVIDENCE' };
  }

  return {
    valid: true,
    cachedData: doc as unknown as AskCacheDocument,
  };
}

/**
 * Reconstitutes full AskMyJournalResponse citations dynamically from the current verifiedMap.
 * Guarantees zero raw journal excerpts were persisted in the cache, while maintaining full freshness.
 */
export function buildCachedResponse(
  cachedDoc: AskCacheDocument,
  originalQuery: string,
  retrievalResult: AskRetrievalResult
): AskMyJournalResponse {
  const citations: AskEvidenceReference[] = [];
  for (const id of cachedDoc.response.evidenceIds) {
    const candidate = retrievalResult.verifiedMap.get(id);
    if (candidate) {
      citations.push({
        interactionId: candidate.interactionId,
        threadId: candidate.threadId,
        threadTitle: candidate.threadTitle,
        date: candidate.date,
        excerpt: candidate.userPromptSnippet.slice(0, 200),
      });
    }
  }

  return {
    query: originalQuery,
    answerType: cachedDoc.response.answerType,
    answer: cachedDoc.response.answer,
    deterministicFacts: retrievalResult.deterministicFacts,
    citations,
    keyTakeaways: cachedDoc.response.keyTakeaways,
    suggestedJournalQuestions: cachedDoc.response.suggestedJournalQuestions,
    modelMetadata: cachedDoc.response.modelMetadata
      ? {
          modelUsed: cachedDoc.response.modelMetadata.modelUsed || 'cached',
          fallbackUsed: Boolean(cachedDoc.response.modelMetadata.fallbackUsed),
          attemptsCount: cachedDoc.response.modelMetadata.attemptsCount || 1,
          latencyMs: cachedDoc.response.modelMetadata.latencyMs || 0,
        }
      : undefined,
    cached: true,
  };
}

// ============================================================================
// Firestore Data Access (Admin SDK)
// ============================================================================

export interface AskCacheStorageOverride {
  get?: (uid: string, key: string) => Promise<unknown | null>;
  set?: (uid: string, key: string, payload: unknown) => Promise<void>;
  count?: (uid: string) => Promise<number>;
}

/**
 * Retrieves a cached Ask My Journal entry from Firestore.
 * Fails safely on network or SDK glitches by returning null (fail-open to synthesis).
 */
export async function getAskCacheEntry(
  verifiedUid: string,
  cacheKey: string,
  override?: AskCacheStorageOverride
): Promise<unknown | null> {
  assertValidUid(verifiedUid);
  assertValidId(cacheKey, 'cacheKey');
  try {
    if (override?.get) {
      return await override.get(verifiedUid, cacheKey);
    }

    const db = getDb();
    const docRef = db
      .collection('users')
      .doc(verifiedUid)
      .collection('ask_cache')
      .doc(cacheKey);

    const snapshot = await docRef.get();
    if (!snapshot.exists) {
      return null;
    }
    return snapshot.data();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown Firestore read error';
    console.warn(`[ASK CACHE READ ERROR] User: ${verifiedUid.slice(0, 8)}... | ${redactSecrets(msg)}`);
    return null;
  }
}

/**
 * Persists a validated Ask My Journal synthesis to Firestore.
 * Fails safely on errors without throwing to caller.
 */
export async function saveAskCacheEntry(
  verifiedUid: string,
  cacheKey: string,
  data: {
    normalizedQuery: string;
    retrievalMode: AskRetrievalMode;
    retrievalFingerprint: string;
    response: AskCacheSynthesisData;
  },
  override?: AskCacheStorageOverride
): Promise<void> {
  assertValidUid(verifiedUid);
  assertValidId(cacheKey, 'cacheKey');
  const now = Date.now();
  const docPayload = {
    cacheKey,
    userId: verifiedUid,
    schemaVersion: CURRENT_ASK_CACHE_SCHEMA_VERSION,
    synthesisVersion: CURRENT_ASK_SYNTHESIS_VERSION,
    normalizedQuery: data.normalizedQuery,
    retrievalMode: data.retrievalMode,
    retrievalFingerprint: data.retrievalFingerprint,
    createdAt: Timestamp.now(),
    expiresAt: Timestamp.fromMillis(now + ASK_CACHE_TTL_MS),
    response: {
      answerType: data.response.answerType,
      answer: data.response.answer,
      evidenceIds: data.response.evidenceIds,
      keyTakeaways: data.response.keyTakeaways,
      suggestedJournalQuestions: data.response.suggestedJournalQuestions,
      ...(data.response.modelMetadata ? { modelMetadata: data.response.modelMetadata } : {}),
    },
  };

  try {
    if (override?.set) {
      await override.set(verifiedUid, cacheKey, docPayload);
      return;
    }

    const db = getDb();
    const docRef = db
      .collection('users')
      .doc(verifiedUid)
      .collection('ask_cache')
      .doc(cacheKey);

    await docRef.set(docPayload);

    // Asynchronously prune excessive cache entries if needed
    pruneUserCacheEntries(verifiedUid, override).catch(() => {
      // Non-blocking background pruning
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown Firestore write error';
    console.warn(`[ASK CACHE WRITE ERROR] User: ${verifiedUid.slice(0, 8)}... | ${redactSecrets(msg)}`);
  }
}

/**
 * Bounded pruning to keep user cache entries within MAX_USER_CACHE_ENTRIES.
 */
async function pruneUserCacheEntries(
  verifiedUid: string,
  override?: AskCacheStorageOverride
): Promise<void> {
  if (override) return;

  try {
    const db = getDb();
    const cacheColl = db.collection('users').doc(verifiedUid).collection('ask_cache');
    const snapshot = await cacheColl.orderBy('createdAt', 'asc').get();

    if (snapshot.size > MAX_USER_CACHE_ENTRIES) {
      const excessCount = snapshot.size - MAX_USER_CACHE_ENTRIES;
      const batch = db.batch();
      for (let i = 0; i < excessCount && i < 10; i++) {
        batch.delete(snapshot.docs[i].ref);
      }
      await batch.commit();
    }
  } catch {
    // Non-blocking pruning failure
  }
}

// ============================================================================
// Concurrency & Stampede Coalescing (Per-Instance)
// ============================================================================

export const MAX_IN_FLIGHT_COALESCING = 500;

/**
 * Coalesces identical concurrent in-flight Ask My Journal requests on the same Cloud Run instance.
 * Bounded by MAX_IN_FLIGHT_COALESCING to prevent memory bloat under pathologically concurrent keys.
 */
export async function withInFlightCoalescing(
  coalesceKey: string,
  fn: () => Promise<AskMyJournalResponse>
): Promise<AskMyJournalResponse> {
  const existing = inFlightAskRequests.get(coalesceKey);
  if (existing) {
    return existing;
  }

  // If in-flight map is at maximum capacity, execute directly without coalescing
  if (inFlightAskRequests.size >= MAX_IN_FLIGHT_COALESCING) {
    return fn();
  }

  const promise = fn().finally(() => {
    inFlightAskRequests.delete(coalesceKey);
  });

  inFlightAskRequests.set(coalesceKey, promise);
  return promise;
}

/**
 * Clears in-flight requests (used in tests).
 */
export function resetInFlightAskRequests(): void {
  inFlightAskRequests.clear();
}
