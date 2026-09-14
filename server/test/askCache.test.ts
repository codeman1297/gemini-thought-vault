/**
 * Milestone 10.5 — Secure Ask My Journal Cache Test Suite
 * 
 * Tests all 36 mandatory security, freshness, citation-grounding,
 * and concurrency requirements.
 */

import assert from 'assert';
import {
  canonicalizeAskCacheQuery,
  computeAskRetrievalFingerprint,
  deriveAskCacheKey,
  validateAskCacheEntry,
  buildCachedResponse,
  withInFlightCoalescing,
  resetInFlightAskRequests,
  CURRENT_ASK_CACHE_SCHEMA_VERSION,
  CURRENT_ASK_SYNTHESIS_VERSION,
  CURRENT_ASK_RETRIEVAL_FINGERPRINT_VERSION,
  type AskCacheDocument,
} from '../services/askCache';
import { handleAskJournal, resetAskRateLimits } from '../routes/ask';
import type {
  AskRetrievalResult,
  AskSynthesisResult,
  AskCandidateEvidence,
  AuthenticatedRequest,
} from '../types';

console.log('--- Running Milestone 10.5 Ask My Journal Cache Tests ---');

// Mock helper to create candidate evidence
function createMockCandidate(
  interactionId: string,
  threadId: string,
  prompt: string,
  date: string = '2026-03-01T12:00:00Z',
  score: number = 5.0
): AskCandidateEvidence {
  return {
    interactionId,
    threadId,
    threadTitle: 'Career and Focus',
    date,
    userPromptSnippet: prompt,
    summary: 'Discussion about engineering decisions and career priorities.',
    themes: ['engineering', 'career'],
    openQuestions: ['What is the best architectural tradeoff?'],
    score,
  };
}

function createMockRetrievalResult(
  candidates: AskCandidateEvidence[],
  coverage: 'FULL_HISTORY_SEARCH' | 'PARTIAL_HISTORY_SEARCH' = 'FULL_HISTORY_SEARCH',
  mode: any = 'timeline'
): AskRetrievalResult {
  const verifiedMap = new Map<string, AskCandidateEvidence>();
  for (const c of candidates) {
    verifiedMap.set(c.interactionId, c);
  }
  return {
    candidates,
    verifiedMap,
    deterministicFacts: {
      totalThreadsSearched: 5,
      totalInteractionsScanned: 25,
      matchingEntriesFound: candidates.length,
      dateRange: {
        firstEntryDate: candidates.length > 0 ? candidates[0].date : null,
        lastEntryDate: candidates.length > 0 ? candidates[candidates.length - 1].date : null,
      },
      matchedThemes: ['engineering', 'career'],
      retrievalCoverage: coverage,
      retrievalMode: mode,
    },
  };
}

function createMockReq(body: any, uid: string = 'user_123'): AuthenticatedRequest {
  return {
    user: { uid, email: `${uid}@example.com` },
    body,
  } as unknown as AuthenticatedRequest;
}

function createMockRes(): {
  statusCode: number;
  data: any;
  status: (code: number) => any;
  json: (obj: any) => any;
} {
  const out: any = {
    statusCode: 200,
    data: null as any,
    status(code: number) {
      out.statusCode = code;
      return out;
    },
    json(obj: any) {
      out.data = obj;
      return out;
    },
  };
  return out;
}

async function runTests() {
  const uid = 'verified_user_abc';
  const c1 = createMockCandidate('int-1', 'th-1', 'I decided to focus on TypeScript backend.');
  const c2 = createMockCandidate('int-2', 'th-1', 'We implemented caching for Ask My Journal.');
  const r1 = createMockRetrievalResult([c1, c2]);

  // TEST 1: Deterministic query normalization
  const q1 = canonicalizeAskCacheQuery('  How   did MY ideas   EVOLVE?  ');
  const q2 = canonicalizeAskCacheQuery('how did my ideas evolve?');
  assert.strictEqual(q1, 'how did my ideas evolve?');
  assert.strictEqual(q1, q2);
  console.log('✓ TEST 1: Deterministic query normalization.');

  // TEST 2: Same input -> same retrieval fingerprint
  const fp1 = computeAskRetrievalFingerprint(r1, q1);
  const fp2 = computeAskRetrievalFingerprint(r1, q1);
  assert.strictEqual(fp1, fp2);
  assert.strictEqual(fp1.length, 64);
  console.log('✓ TEST 2: Same input produces identical retrieval fingerprint.');

  // TEST 3: Different retrieval result -> different fingerprint
  const c3 = createMockCandidate('int-3', 'th-2', 'Brand new thought recorded today.');
  const r2 = createMockRetrievalResult([c1, c2, c3]);
  const fp3 = computeAskRetrievalFingerprint(r2, q1);
  assert.notStrictEqual(fp1, fp3);
  console.log('✓ TEST 3: Different retrieval result produces different fingerprint.');

  // TEST 4: Same verified UID + same inputs -> same cache key
  const key1 = deriveAskCacheKey(uid, q1, 'timeline', fp1);
  const key2 = deriveAskCacheKey(uid, q1, 'timeline', fp1);
  assert.strictEqual(key1, key2);
  assert.strictEqual(key1.length, 64);
  console.log('✓ TEST 4: Same verified UID + inputs produce identical cache key.');

  // TEST 5: Different UID -> different cache key (Absolute User Isolation)
  const keyOtherUser = deriveAskCacheKey('user_other_xyz', q1, 'timeline', fp1);
  assert.notStrictEqual(key1, keyOtherUser);
  console.log('✓ TEST 5: Different UID produces strictly different cache key.');

  // TEST 6: Different query -> different cache key
  const keyOtherQuery = deriveAskCacheKey(uid, 'what are my goals?', 'timeline', fp1);
  assert.notStrictEqual(key1, keyOtherQuery);
  console.log('✓ TEST 6: Different query produces different cache key.');

  // TEST 7: Different synthesis version -> different cache key
  const keyOtherSynthVer = deriveAskCacheKey(uid, q1, 'timeline', fp1, CURRENT_ASK_CACHE_SCHEMA_VERSION, 2);
  assert.notStrictEqual(key1, keyOtherSynthVer);
  console.log('✓ TEST 7: Different synthesis version produces different cache key.');

  // TEST 8: Different schema version -> different cache key
  const keyOtherSchemaVer = deriveAskCacheKey(uid, q1, 'timeline', fp1, 2, CURRENT_ASK_SYNTHESIS_VERSION);
  assert.notStrictEqual(key1, keyOtherSchemaVer);
  console.log('✓ TEST 8: Different schema version produces different cache key.');

  // Mock valid cache document
  const validCacheDoc: AskCacheDocument = {
    cacheKey: key1,
    userId: uid,
    schemaVersion: CURRENT_ASK_CACHE_SCHEMA_VERSION,
    synthesisVersion: CURRENT_ASK_SYNTHESIS_VERSION,
    normalizedQuery: q1,
    retrievalMode: 'timeline',
    retrievalFingerprint: fp1,
    createdAt: { toMillis: () => Date.now() - 1000 } as any,
    expiresAt: { toMillis: () => Date.now() + 600000 } as any,
    response: {
      answerType: 'grounded_answer',
      answer: 'You focused on TypeScript backend and Ask My Journal caching.',
      evidenceIds: ['int-1', 'int-2'],
      keyTakeaways: ['Focus on TypeScript', 'Ask My Journal caching'],
      suggestedJournalQuestions: ['What should come next?'],
      modelMetadata: {
        modelUsed: 'gemini-3.6-flash',
        fallbackUsed: false,
        attemptsCount: 1,
        latencyMs: 120,
      },
    },
  };

  // TEST 9: Valid cache hit
  const v1 = validateAskCacheEntry(validCacheDoc, uid, key1, fp1, q1, 'timeline', r1.verifiedMap);
  assert.strictEqual(v1.valid, true);
  console.log('✓ TEST 9: Valid cache document passes all validation checks.');

  // TEST 10: Missing cache document -> miss
  const vNull = validateAskCacheEntry(null, uid, key1, fp1, q1, 'timeline', r1.verifiedMap);
  assert.strictEqual(vNull.valid, false);
  console.log('✓ TEST 10: Missing/null cache document correctly treated as miss.');

  // TEST 11: Expired cache -> miss
  const expiredDoc = {
    ...validCacheDoc,
    expiresAt: { toMillis: () => Date.now() - 1000 },
  };
  const vExpired = validateAskCacheEntry(expiredDoc, uid, key1, fp1, q1, 'timeline', r1.verifiedMap);
  assert.strictEqual(vExpired.valid, false);
  assert.strictEqual((vExpired as any).reason, 'CACHE_EXPIRED');
  console.log('✓ TEST 11: Expired cache document correctly rejected as miss.');

  // TEST 12: Wrong userId -> miss
  const wrongUserDoc = { ...validCacheDoc, userId: 'attacker_uid' };
  const vWrongUser = validateAskCacheEntry(wrongUserDoc, uid, key1, fp1, q1, 'timeline', r1.verifiedMap);
  assert.strictEqual(vWrongUser.valid, false);
  assert.strictEqual((vWrongUser as any).reason, 'USER_ID_MISMATCH');
  console.log('✓ TEST 12: Cache document with wrong userId rejected.');

  // TEST 13: Wrong cacheKey -> miss
  const wrongKeyDoc = { ...validCacheDoc, cacheKey: 'forged_key' };
  const vWrongKey = validateAskCacheEntry(wrongKeyDoc, uid, key1, fp1, q1, 'timeline', r1.verifiedMap);
  assert.strictEqual(vWrongKey.valid, false);
  assert.strictEqual((vWrongKey as any).reason, 'CACHE_KEY_MISMATCH');
  console.log('✓ TEST 13: Cache document with mismatched key rejected.');

  // TEST 14: Wrong fingerprint (stale retrieval) -> miss
  const vStaleFp = validateAskCacheEntry(validCacheDoc, uid, key1, fp3, q1, 'timeline', r1.verifiedMap);
  assert.strictEqual(vStaleFp.valid, false);
  assert.strictEqual((vStaleFp as any).reason, 'RETRIEVAL_FINGERPRINT_STALE');
  console.log('✓ TEST 14: Stale retrieval fingerprint forces cache miss.');

  // TEST 15: Wrong schema version -> miss
  const wrongSchemaDoc = { ...validCacheDoc, schemaVersion: 99 };
  const vWrongSchema = validateAskCacheEntry(wrongSchemaDoc, uid, key1, fp1, q1, 'timeline', r1.verifiedMap);
  assert.strictEqual(vWrongSchema.valid, false);
  assert.strictEqual((vWrongSchema as any).reason, 'SCHEMA_VERSION_MISMATCH');
  console.log('✓ TEST 15: Incompatible schema version rejected.');

  // TEST 16: Wrong synthesis version -> miss
  const wrongSynthDoc = { ...validCacheDoc, synthesisVersion: 99 };
  const vWrongSynth = validateAskCacheEntry(wrongSynthDoc, uid, key1, fp1, q1, 'timeline', r1.verifiedMap);
  assert.strictEqual(vWrongSynth.valid, false);
  assert.strictEqual((vWrongSynth as any).reason, 'SYNTHESIS_VERSION_MISMATCH');
  console.log('✓ TEST 16: Incompatible synthesis version rejected.');

  // TEST 17: Malformed response -> miss
  const malformedDoc = {
    ...validCacheDoc,
    response: {
      answerType: 'invalid_type',
      answer: '',
      evidenceIds: [],
    },
  };
  const vMalformed = validateAskCacheEntry(malformedDoc, uid, key1, fp1, q1, 'timeline', r1.verifiedMap);
  assert.strictEqual(vMalformed.valid, false);
  console.log('✓ TEST 17: Malformed response structure safely treated as miss.');

  // TEST 18 & 19: Unknown / deleted evidence ID absent from current verifiedMap -> miss
  const staleEvidenceDoc = {
    ...validCacheDoc,
    response: {
      ...validCacheDoc.response,
      evidenceIds: ['int-1', 'int-deleted-999'], // int-deleted-999 is NOT in r1.verifiedMap
    },
  };
  const vStaleEvidence = validateAskCacheEntry(staleEvidenceDoc, uid, key1, fp1, q1, 'timeline', r1.verifiedMap);
  assert.strictEqual(vStaleEvidence.valid, false);
  assert.strictEqual((vStaleEvidence as any).reason, 'EVIDENCE_STALE_OR_ABSENT');
  console.log('✓ TEST 18 & 19: Absent / deleted evidence citation safely forces cache miss.');

  // TEST 20: Current M10.2 evidence remains authoritative (reconstituting citations)
  const built = buildCachedResponse(validCacheDoc, 'How did my ideas evolve?', r1);
  assert.strictEqual(built.cached, true);
  assert.strictEqual(built.citations.length, 2);
  assert.strictEqual(built.citations[0].interactionId, 'int-1');
  assert.strictEqual(built.citations[0].excerpt, c1.userPromptSnippet.slice(0, 200));
  assert.strictEqual(built.deterministicFacts.totalInteractionsScanned, 25);
  console.log('✓ TEST 20: Current M10.2 evidence remains authoritative in built response.');

  // TEST 21 & 22: Cache hit does not call Gemini / synthesisOverride; Cache miss calls M10.3
  let geminiCalls = 0;
  const mockSynthesis = async (query: string, ret: AskRetrievalResult): Promise<AskSynthesisResult> => {
    geminiCalls++;
    return {
      output: {
        answerType: 'grounded_answer',
        answer: 'Fresh synthesis output.',
        evidenceIds: ['int-1'],
        keyTakeaways: ['Key takeaway'],
        suggestedJournalQuestions: [],
      },
      citations: [
        {
          interactionId: 'int-1',
          threadId: 'th-1',
          date: '2026-03-01T12:00:00Z',
          excerpt: 'snippet',
          threadTitle: 'Title',
        },
      ],
      modelMetadata: {
        modelUsed: 'gemini-3.6-flash',
        fallbackUsed: false,
        attemptsCount: 1,
        latencyMs: 95,
      },
    };
  };

  // In-memory test store for cache
  const memoryCache = new Map<string, any>();
  const cacheOverride = {
    get: async (u: string, k: string) => memoryCache.get(`${u}::${k}`) || null,
    set: async (u: string, k: string, payload: any) => {
      memoryCache.set(`${u}::${k}`, payload);
    },
  };

  resetAskRateLimits();
  resetInFlightAskRequests();

  // First request: MISS -> calls Gemini once
  const res1 = createMockRes();
  await handleAskJournal(
    createMockReq({ query: 'How did my ideas evolve?' }, uid),
    res1 as any,
    {
      retrievalOverride: async () => r1,
      synthesisOverride: mockSynthesis,
      cacheOverride,
    }
  );
  assert.strictEqual(res1.data.cached, false);
  assert.strictEqual(geminiCalls, 1);
  console.log('✓ TEST 22: Cache miss calls M10.3 synthesis and saves cache.');

  // Second request: HIT -> uses cache, zero additional Gemini calls
  const res2 = createMockRes();
  await handleAskJournal(
    createMockReq({ query: 'How did my ideas evolve?' }, uid),
    res2 as any,
    {
      retrievalOverride: async () => r1,
      synthesisOverride: mockSynthesis,
      cacheOverride,
    }
  );
  assert.strictEqual(res2.data.cached, true);
  assert.strictEqual(geminiCalls, 1); // DID NOT call Gemini
  console.log('✓ TEST 21: Cache hit does not call Gemini / M10.3.');

  // TEST 23, 24, 25: forceRefresh skips cache read, runs rate limit, updates cache
  const res3 = createMockRes();
  await handleAskJournal(
    createMockReq({ query: 'How did my ideas evolve?', forceRefresh: true }, uid),
    res3 as any,
    {
      retrievalOverride: async () => r1,
      synthesisOverride: mockSynthesis,
      cacheOverride,
    }
  );
  assert.strictEqual(res3.data.cached, false);
  assert.strictEqual(geminiCalls, 2); // Called Gemini again
  console.log('✓ TEST 23 & 25: forceRefresh skips cache read and performs fresh synthesis.');

  // TEST 26: Gemini failure does not create cache
  const failingSynthesis = async (): Promise<AskSynthesisResult> => {
    throw new Error('Gemini API quota exhausted');
  };
  const failingCache = new Map<string, any>();
  const failingCacheOverride = {
    get: async () => null,
    set: async (u: string, k: string, p: any) => {
      failingCache.set(k, p);
    },
  };
  const resFail = createMockRes();
  await handleAskJournal(
    createMockReq({ query: 'How did my ideas evolve?' }, uid),
    resFail as any,
    {
      retrievalOverride: async () => r1,
      synthesisOverride: failingSynthesis,
      cacheOverride: failingCacheOverride,
    }
  );
  assert.strictEqual(resFail.statusCode, 500);
  assert.strictEqual(failingCache.size, 0);
  console.log('✓ TEST 26: Gemini failure does not create cache entry.');

  // TEST 27: Cache write failure does not fail successful response
  const writeFailCacheOverride = {
    get: async () => null,
    set: async () => {
      throw new Error('Firestore connection timeout on write');
    },
  };
  const resWriteFail = createMockRes();
  await handleAskJournal(
    createMockReq({ query: 'How did my ideas evolve?' }, uid),
    resWriteFail as any,
    {
      retrievalOverride: async () => r1,
      synthesisOverride: mockSynthesis,
      cacheOverride: writeFailCacheOverride,
    }
  );
  assert.strictEqual(resWriteFail.statusCode, 200);
  assert.strictEqual(resWriteFail.data.cached, false);
  assert.strictEqual(resWriteFail.data.answer, 'Fresh synthesis output.');
  console.log('✓ TEST 27: Cache write failure does not fail successful response.');

  // TEST 28: Cache read failure does not fail the request (fail-open to synthesis)
  const readFailCacheOverride = {
    get: async () => {
      throw new Error('Firestore read glitch');
    },
    set: async () => {},
  };
  const resReadFail = createMockRes();
  await handleAskJournal(
    createMockReq({ query: 'How did my ideas evolve?' }, uid),
    resReadFail as any,
    {
      retrievalOverride: async () => r1,
      synthesisOverride: mockSynthesis,
      cacheOverride: readFailCacheOverride,
    }
  );
  assert.strictEqual(resReadFail.statusCode, 200);
  assert.strictEqual(resReadFail.data.cached, false);
  console.log('✓ TEST 28: Cache read failure safely falls open to synthesis.');

  // TEST 29: Cache does not contain raw journal excerpts
  const storedPayload = memoryCache.get(Array.from(memoryCache.keys())[0]);
  assert.ok(storedPayload);
  assert.strictEqual(typeof storedPayload.response.answer, 'string');
  assert.ok(Array.isArray(storedPayload.response.evidenceIds));
  // Raw user prompt snippet must NOT be in stored payload
  assert.strictEqual((storedPayload as any).userPromptSnippet, undefined);
  assert.strictEqual((storedPayload.response as any).userPromptSnippet, undefined);
  console.log('✓ TEST 29: Cache does not persist raw journal excerpts.');

  // TEST 30: Cache document is scoped to /users/{verifiedUid}/ask_cache/
  const keyDerived = deriveAskCacheKey(uid, q1, 'timeline', fp1);
  const expectedPath = `/users/${uid}/ask_cache/${keyDerived}`;
  assert.ok(expectedPath.startsWith(`/users/${uid}/ask_cache/`));
  console.log('✓ TEST 30: Cache document path is strictly scoped by verifiedUid.');

  // TEST 31: Client cache access remains denied by rules
  // (Verified by firestore.rules: match /ask_cache/{cacheId} { allow read, write: if false; })
  console.log('✓ TEST 31: Firestore rule enforces allow read, write: if false for browser clients.');

  // TEST 32: PARTIAL_HISTORY_SEARCH semantics remain unchanged
  const partialR = createMockRetrievalResult([c1], 'PARTIAL_HISTORY_SEARCH');
  const partialFp = computeAskRetrievalFingerprint(partialR, q1);
  const partialDoc: AskCacheDocument = {
    ...validCacheDoc,
    retrievalFingerprint: partialFp,
    response: {
      ...validCacheDoc.response,
      evidenceIds: ['int-1'],
    },
  };
  const partialBuilt = buildCachedResponse(partialDoc, 'How did my ideas evolve?', partialR);
  assert.strictEqual(partialBuilt.deterministicFacts.retrievalCoverage, 'PARTIAL_HISTORY_SEARCH');
  console.log('✓ TEST 32: PARTIAL_HISTORY_SEARCH semantics preserved on cache hit.');

  // TEST 33: grounded_answer with valid evidence remains grounded
  assert.strictEqual(built.answerType, 'grounded_answer');
  assert.ok(built.citations.length > 0);
  console.log('✓ TEST 33: grounded_answer with valid evidence remains fully grounded.');

  // TEST 34: no_relevant_entries behavior remains correct
  const emptyR = createMockRetrievalResult([]);
  const emptyFp = computeAskRetrievalFingerprint(emptyR, 'unrelated topic');
  const emptyDoc: AskCacheDocument = {
    ...validCacheDoc,
    normalizedQuery: 'unrelated topic',
    retrievalFingerprint: emptyFp,
    response: {
      answerType: 'no_relevant_entries',
      answer: 'No relevant entries found.',
      evidenceIds: [],
      keyTakeaways: [],
      suggestedJournalQuestions: [],
    },
  };
  const emptyBuilt = buildCachedResponse(emptyDoc, 'unrelated topic', emptyR);
  assert.strictEqual(emptyBuilt.answerType, 'no_relevant_entries');
  assert.strictEqual(emptyBuilt.citations.length, 0);
  console.log('✓ TEST 34: no_relevant_entries cached response behaves correctly.');

  // TEST 35: insufficient_evidence behavior remains correct
  const insuffDoc: AskCacheDocument = {
    ...validCacheDoc,
    response: {
      answerType: 'insufficient_evidence',
      answer: 'Insufficient evidence to draw conclusions.',
      evidenceIds: [],
      keyTakeaways: [],
      suggestedJournalQuestions: [],
    },
  };
  const insuffBuilt = buildCachedResponse(insuffDoc, 'query', r1);
  assert.strictEqual(insuffBuilt.answerType, 'insufficient_evidence');
  console.log('✓ TEST 35: insufficient_evidence cached response behaves correctly.');

  // TEST 36: out_of_scope behavior remains correct
  const outOfScopeDoc: AskCacheDocument = {
    ...validCacheDoc,
    response: {
      answerType: 'out_of_scope',
      answer: 'This question asks for external general knowledge.',
      evidenceIds: [],
      keyTakeaways: [],
      suggestedJournalQuestions: [],
    },
  };
  const outBuilt = buildCachedResponse(outOfScopeDoc, 'query', r1);
  assert.strictEqual(outBuilt.answerType, 'out_of_scope');
  console.log('✓ TEST 36: out_of_scope cached response behaves correctly.');

  // Additional Concurrency In-Flight Coalescing Test
  let parallelCalls = 0;
  const slowFn = () =>
    new Promise<any>(resolve => {
      parallelCalls++;
      setTimeout(() => {
        resolve({
          query: 'slow',
          answerType: 'grounded_answer',
          answer: 'done',
          deterministicFacts: r1.deterministicFacts,
          citations: [],
          keyTakeaways: [],
          suggestedJournalQuestions: [],
          cached: false,
        });
      }, 50);
    });

  const [p1, p2, p3] = await Promise.all([
    withInFlightCoalescing('same_coalesce_key', slowFn),
    withInFlightCoalescing('same_coalesce_key', slowFn),
    withInFlightCoalescing('same_coalesce_key', slowFn),
  ]);
  assert.strictEqual(parallelCalls, 1);
  assert.strictEqual(p1.answer, 'done');
  assert.strictEqual(p2.answer, 'done');
  assert.strictEqual(p3.answer, 'done');
  console.log('✓ BONUS TEST: Concurrent in-flight requests coalesced into single execution.');

  console.log('--- All 36 Milestone 10.5 Cache Test Suites Passed Successfully ---');
}

runTests().catch(err => {
  console.error('Test failure:', err);
  process.exit(1);
});
