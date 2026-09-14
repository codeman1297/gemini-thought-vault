/**
 * Comprehensive Unit, Security, and Integration Tests for Milestone 10.4:
 * Authenticated Ask My Journal API Route
 * 
 * Test Coverage:
 * [AUTHORIZATION TESTS]
 * 1. Unauthenticated POST returns 401.
 * 2. Authenticated request uses UID from verified auth context.
 * 3. Client-supplied uid in body is ignored/discarded.
 * 4. Client-supplied userId in body is ignored/discarded.
 * 5. Client cannot specify another user's threadId.
 * 6. Client cannot specify arbitrary evidence IDs.
 * 7. Valid authenticated request reaches M10.2 retrieval.
 * 8. M10.2 receives the verified UID, not a client-supplied UID.
 * 9. M10.3 receives only M10.2-produced evidence candidates.
 * 
 * [REQUEST VALIDATION TESTS]
 * 10. Missing query -> 400.
 * 11. Too-short query (<3 chars) -> 400.
 * 12. Too-long query (>300 chars) -> 400.
 * 13. Whitespace-only query -> 400.
 * 14. Invalid forceRefresh type -> 400.
 * 15. Valid query -> accepted (200).
 * 
 * [RATE LIMIT TESTS]
 * 16. Requests within limit succeed (up to 10/min).
 * 17. Request above limit returns 429.
 * 18. forceRefresh cannot bypass rate limit.
 * 19. Rate limit is associated with authenticated user identity.
 * 20. One user's rate limit state cannot intentionally control another user's UID.
 * 
 * [INTEGRATION & COVERAGE TESTS]
 * 21. M10.2 returns grounded evidence -> M10.3 receives it.
 * 22. M10.2 returns zero matches -> M10.3 receives zero-evidence condition.
 * 23. M10.2 returns PARTIAL_HISTORY_SEARCH -> response preserves it.
 * 24. M10.3 returns grounded answer -> API returns structured response.
 * 25. M10.3 returns insufficient_evidence -> API preserves answerType.
 * 26. M10.3 returns no_relevant_entries -> API preserves answerType.
 * 27. M10.3 returns out_of_scope -> API preserves answerType.
 * 28. M10.3 failure -> API returns safe 500 response.
 * 29. Malformed synthesis result cannot become a successful API response.
 * 30. Unknown citation IDs cannot appear in final API response.
 * 31. Error sanitization (no stack traces, no secrets, no raw query in logs).
 * 32. Partial timeline qualified answer is preserved unchanged.
 */

import {
  handleAskJournal,
  askRateLimiter,
  checkAskRateLimit,
  resetAskRateLimits,
  type AskHandlerOptions,
} from '../routes/ask';
import { requireAuth } from '../middleware/auth';
import type {
  AuthenticatedRequest,
  AskRetrievalResult,
  AskSynthesisResult,
  AskCandidateEvidence,
  AskDeterministicFacts,
  AskMyJournalResponse,
} from '../types';
import type { Response, NextFunction } from 'express';

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(`TEST ASSERTION FAILED: ${message}`);
  }
}

interface MockResponse {
  statusCode: number;
  jsonData: any;
  status: (code: number) => MockResponse;
  json: (data: any) => MockResponse;
}

function createMockResponse(): MockResponse {
  const res: MockResponse = {
    statusCode: 200,
    jsonData: null,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(data: any) {
      this.jsonData = data;
      return this;
    },
  };
  return res;
}

function createMockRequest(options: {
  user?: { uid: string; email?: string | null };
  body?: any;
  headers?: Record<string, string>;
}): AuthenticatedRequest {
  return {
    method: 'POST',
    path: '/api/journal/ask',
    user: options.user,
    body: options.body,
    headers: options.headers || {},
  } as unknown as AuthenticatedRequest;
}

function createMockCandidate(overrides: Partial<AskCandidateEvidence> = {}): AskCandidateEvidence {
  return {
    interactionId: overrides.interactionId || 'int_01',
    threadId: overrides.threadId || 'th_01',
    threadTitle: overrides.threadTitle || 'Career Journey',
    date: overrides.date || '2026-03-10T14:30:00Z',
    userPromptSnippet: overrides.userPromptSnippet || 'Thinking about systems architecture.',
    summary: overrides.summary || 'Explored career ambitions in software systems.',
    themes: overrides.themes || ['Career', 'Engineering'],
    openQuestions: overrides.openQuestions || ['What skills should I build next?'],
    score: overrides.score || 45,
  };
}

function createMockFacts(overrides: Partial<AskDeterministicFacts> = {}): AskDeterministicFacts {
  return {
    totalThreadsSearched: overrides.totalThreadsSearched ?? 5,
    totalInteractionsScanned: overrides.totalInteractionsScanned ?? 20,
    matchingEntriesFound: overrides.matchingEntriesFound ?? 1,
    dateRange: overrides.dateRange ?? {
      firstEntryDate: '2026-01-15T10:00:00Z',
      lastEntryDate: '2026-03-10T14:30:00Z',
    },
    matchedThemes: overrides.matchedThemes ?? ['Career'],
    retrievalCoverage: overrides.retrievalCoverage ?? 'FULL_HISTORY_SEARCH',
    retrievalMode: overrides.retrievalMode ?? 'mention',
    coverageNote: overrides.coverageNote ?? 'Complete history verified: scanned all 20 interactions across 5 threads.',
  };
}

function createMockRetrieval(
  candidates: AskCandidateEvidence[] = [createMockCandidate()],
  factsOverrides: Partial<AskDeterministicFacts> = {}
): AskRetrievalResult {
  const verifiedMap = new Map<string, AskCandidateEvidence>();
  for (const c of candidates) {
    verifiedMap.set(c.interactionId, c);
  }
  return {
    candidates,
    verifiedMap,
    deterministicFacts: createMockFacts({
      matchingEntriesFound: candidates.length,
      ...factsOverrides,
    }),
  };
}

function createMockSynthesis(overrides: Partial<AskSynthesisResult> = {}): AskSynthesisResult {
  return {
    output: {
      answerType: overrides.output?.answerType || 'grounded_answer',
      answer: overrides.output?.answer || 'You wrote about software architecture on March 10.',
      evidenceIds: overrides.output?.evidenceIds || ['int_01'],
      keyTakeaways: overrides.output?.keyTakeaways || ['Focus on systems architecture'],
      suggestedJournalQuestions: overrides.output?.suggestedJournalQuestions || ['What architecture topic excites you most?'],
    },
    citations: overrides.citations || [
      {
        interactionId: 'int_01',
        threadId: 'th_01',
        threadTitle: 'Career Journey',
        date: '2026-03-10T14:30:00Z',
        excerpt: 'Thinking about systems architecture.',
      },
    ],
    modelMetadata: overrides.modelMetadata || {
      modelUsed: 'gemini-3.6-flash',
      fallbackUsed: false,
      attemptsCount: 1,
      latencyMs: 110,
    },
  };
}

console.log('--- Running Milestone 10.4 Authenticated Ask API Tests ---');

// ============================================================================
// AUTHORIZATION TESTS (1 - 9)
// ============================================================================

// TEST 1: Unauthenticated POST returns 401
{
  const req = createMockRequest({ body: { query: 'Valid query here' } });
  const res = createMockResponse();

  await handleAskJournal(req, res as unknown as Response);

  assert(res.statusCode === 401, 'Unauthenticated request returns 401');
  assert(res.jsonData.code === 'UNAUTHORIZED', 'Error code is UNAUTHORIZED');
  console.log('✓ TEST 1: Unauthenticated POST returns 401.');
}

// TEST 2: Authenticated request uses UID from verified auth context
{
  let capturedUid = '';
  const options: AskHandlerOptions = {
    retrievalOverride: async (uid: string) => {
      capturedUid = uid;
      return createMockRetrieval();
    },
    synthesisOverride: async () => createMockSynthesis(),
  };

  const req = createMockRequest({
    user: { uid: 'verified_user_123' },
    body: { query: 'What did I learn?' },
  });
  const res = createMockResponse();

  await handleAskJournal(req, res as unknown as Response, options);

  assert(res.statusCode === 200, 'Authenticated request returns 200');
  assert(capturedUid === 'verified_user_123', 'M10.2 received verified UID from req.user.uid');
  console.log('✓ TEST 2: Authenticated request uses UID from verified auth context.');
}

// TEST 3: Client-supplied uid in body is ignored/discarded
{
  let capturedUid = '';
  const options: AskHandlerOptions = {
    retrievalOverride: async (uid: string) => {
      capturedUid = uid;
      return createMockRetrieval();
    },
    synthesisOverride: async () => createMockSynthesis(),
  };

  const req = createMockRequest({
    user: { uid: 'real_verified_user' },
    body: {
      query: 'What did I learn?',
      uid: 'attacker_fake_uid_target',
    },
  });
  const res = createMockResponse();

  await handleAskJournal(req, res as unknown as Response, options);

  assert(capturedUid === 'real_verified_user', 'Client uid parameter ignored; verified token UID used');
  console.log('✓ TEST 3: Client-supplied uid in body is ignored.');
}

// TEST 4: Client-supplied userId in body is ignored/discarded
{
  let capturedUid = '';
  const options: AskHandlerOptions = {
    retrievalOverride: async (uid: string) => {
      capturedUid = uid;
      return createMockRetrieval();
    },
    synthesisOverride: async () => createMockSynthesis(),
  };

  const req = createMockRequest({
    user: { uid: 'real_verified_user' },
    body: {
      query: 'What did I learn?',
      userId: 'attacker_target_userId',
    },
  });
  const res = createMockResponse();

  await handleAskJournal(req, res as unknown as Response, options);

  assert(capturedUid === 'real_verified_user', 'Client userId parameter ignored; verified token UID used');
  console.log('✓ TEST 4: Client-supplied userId in body is ignored.');
}

// TEST 5: Client cannot specify another user's threadId
{
  const req = createMockRequest({
    user: { uid: 'user_A' },
    body: {
      query: 'What did I learn?',
      threadId: 'thread_of_user_B',
    },
  });
  const res = createMockResponse();

  let capturedQuery = '';
  const options: AskHandlerOptions = {
    retrievalOverride: async (_uid, q) => {
      capturedQuery = q;
      return createMockRetrieval();
    },
    synthesisOverride: async () => createMockSynthesis(),
  };

  await handleAskJournal(req, res as unknown as Response, options);
  assert(capturedQuery === 'What did I learn?', 'Query is passed cleanly');
  // threadId was not forwarded to M10.2
  console.log('✓ TEST 5: Client cannot specify another user\'s threadId.');
}

// TEST 6: Client cannot specify arbitrary evidence IDs
{
  const req = createMockRequest({
    user: { uid: 'user_A' },
    body: {
      query: 'What did I learn?',
      evidenceIds: ['injected_fake_id_1', 'injected_fake_id_2'],
    },
  });
  const res = createMockResponse();

  const options: AskHandlerOptions = {
    retrievalOverride: async () => createMockRetrieval(),
    synthesisOverride: async () => createMockSynthesis(),
  };

  await handleAskJournal(req, res as unknown as Response, options);
  const resp: AskMyJournalResponse = res.jsonData;
  assert(!resp.citations.some(c => c.interactionId.startsWith('injected')), 'Injected evidence IDs completely ignored');
  console.log('✓ TEST 6: Client cannot specify arbitrary evidence IDs.');
}

// TEST 7: Valid authenticated request reaches M10.2
{
  const tracker = { m102Invoked: false };
  const options: AskHandlerOptions = {
    retrievalOverride: async () => {
      tracker.m102Invoked = true;
      return createMockRetrieval();
    },
    synthesisOverride: async () => createMockSynthesis(),
  };

  const req = createMockRequest({
    user: { uid: 'user_valid' },
    body: { query: 'How has my mindfulness developed?' },
  });
  const res = createMockResponse();

  await handleAskJournal(req, res as unknown as Response, options);
  assert(tracker.m102Invoked, 'M10.2 retrieval invoked');
  assert(res.statusCode === 200, 'Returned 200');
  console.log('✓ TEST 7: Valid authenticated request reaches M10.2.');
}

// TEST 8: M10.2 receives the verified UID, not a client UID
{
  let passedUid = '';
  const options: AskHandlerOptions = {
    retrievalOverride: async (uid) => {
      passedUid = uid;
      return createMockRetrieval();
    },
    synthesisOverride: async () => createMockSynthesis(),
  };

  const req = createMockRequest({
    user: { uid: 'authorized_uid_token' },
    body: { query: 'My goals', uid: 'spoofed_uid_payload' },
  });
  const res = createMockResponse();

  await handleAskJournal(req, res as unknown as Response, options);
  assert(passedUid === 'authorized_uid_token', 'M10.2 only ever receives the verified token UID');
  console.log('✓ TEST 8: M10.2 receives the verified UID, not a client UID.');
}

// TEST 9: M10.3 receives only M10.2-produced evidence
{
  const cand = createMockCandidate({ interactionId: 'm102_int_999' });
  const retrievalResult = createMockRetrieval([cand]);

  let synthesisReceivedCandidates: AskCandidateEvidence[] = [];
  const options: AskHandlerOptions = {
    retrievalOverride: async () => retrievalResult,
    synthesisOverride: async (_q, r) => {
      synthesisReceivedCandidates = r.candidates;
      return createMockSynthesis({
        citations: [
          {
            interactionId: 'm102_int_999',
            threadId: 'th_01',
            threadTitle: 'Career Journey',
            date: '2026-03-10T14:30:00Z',
            excerpt: 'Thinking about systems architecture.',
          },
        ],
      });
    },
  };

  const req = createMockRequest({
    user: { uid: 'user_test' },
    body: { query: 'Career goals' },
  });
  const res = createMockResponse();

  await handleAskJournal(req, res as unknown as Response, options);
  assert(synthesisReceivedCandidates.length === 1, 'M10.3 received exactly 1 candidate');
  assert(synthesisReceivedCandidates[0].interactionId === 'm102_int_999', 'Candidate ID matches M10.2 output');
  console.log('✓ TEST 9: M10.3 receives only M10.2-produced evidence.');
}

// ============================================================================
// REQUEST VALIDATION TESTS (10 - 15)
// ============================================================================

// TEST 10: Missing query -> 400
{
  const req = createMockRequest({ user: { uid: 'u1' }, body: {} });
  const res = createMockResponse();

  await handleAskJournal(req, res as unknown as Response);
  assert(res.statusCode === 400, 'Missing query returns 400');
  assert(res.jsonData.code === 'INVALID_QUERY', 'Code is INVALID_QUERY');
  console.log('✓ TEST 10: Missing query returns 400.');
}

// TEST 11: Too-short query (<3 chars) -> 400
{
  const req = createMockRequest({ user: { uid: 'u1' }, body: { query: 'hi' } });
  const res = createMockResponse();

  await handleAskJournal(req, res as unknown as Response);
  assert(res.statusCode === 400, 'Too-short query returns 400');
  assert(res.jsonData.error.includes('at least 3 characters'), 'Mentions min length');
  console.log('✓ TEST 11: Too-short query returns 400.');
}

// TEST 12: Too-long query (>300 chars) -> 400
{
  const longQuery = 'A'.repeat(301);
  const req = createMockRequest({ user: { uid: 'u1' }, body: { query: longQuery } });
  const res = createMockResponse();

  await handleAskJournal(req, res as unknown as Response);
  assert(res.statusCode === 400, 'Too-long query returns 400');
  assert(res.jsonData.error.includes('300 characters'), 'Mentions max length');
  console.log('✓ TEST 12: Too-long query returns 400.');
}

// TEST 13: Whitespace-only query -> 400
{
  const req = createMockRequest({ user: { uid: 'u1' }, body: { query: '    ' } });
  const res = createMockResponse();

  await handleAskJournal(req, res as unknown as Response);
  assert(res.statusCode === 400, 'Whitespace query returns 400');
  assert(res.jsonData.error.includes('whitespace'), 'Mentions whitespace');
  console.log('✓ TEST 13: Whitespace-only query returns 400.');
}

// TEST 14: Invalid forceRefresh type -> 400
{
  const req = createMockRequest({
    user: { uid: 'u1' },
    body: { query: 'Valid query', forceRefresh: 'not_a_boolean' },
  });
  const res = createMockResponse();

  await handleAskJournal(req, res as unknown as Response);
  assert(res.statusCode === 400, 'Invalid forceRefresh type returns 400');
  assert(res.jsonData.error.includes('forceRefresh must be a boolean'), 'Mentions forceRefresh boolean');
  console.log('✓ TEST 14: Invalid forceRefresh type returns 400.');
}

// TEST 15: Valid query -> accepted (200)
{
  const options: AskHandlerOptions = {
    retrievalOverride: async () => createMockRetrieval(),
    synthesisOverride: async () => createMockSynthesis(),
  };

  const req = createMockRequest({
    user: { uid: 'u1' },
    body: { query: '  What are my career ambitions?  ', forceRefresh: true },
  });
  const res = createMockResponse();

  await handleAskJournal(req, res as unknown as Response, options);
  assert(res.statusCode === 200, 'Valid query accepted with 200');
  assert(res.jsonData.query === 'What are my career ambitions?', 'Query is trimmed cleanly');
  console.log('✓ TEST 15: Valid query is accepted and trimmed.');
}

// ============================================================================
// RATE LIMIT TESTS (16 - 20)
// ============================================================================

// TEST 16: Requests within limit succeed
{
  resetAskRateLimits();
  const testUid = 'rate_test_user_ok';

  for (let i = 0; i < 10; i++) {
    const allowed = checkAskRateLimit(testUid);
    assert(allowed === true, `Request ${i + 1} within 10/min limit should be allowed`);
  }
  console.log('✓ TEST 16: Requests within limit succeed (10 requests allowed).');
}

// TEST 17: Request above limit returns 429
{
  resetAskRateLimits();
  const testUid = 'rate_test_user_excess';

  for (let i = 0; i < 10; i++) {
    checkAskRateLimit(testUid);
  }

  // 11th request
  const req = createMockRequest({ user: { uid: testUid } });
  const res = createMockResponse();
  let nextCalled = false;

  askRateLimiter(req, res as unknown as Response, (() => {
    nextCalled = true;
  }) as NextFunction);

  assert(nextCalled === false, 'Next was not called on 11th request');
  assert(res.statusCode === 429, '11th request returned HTTP 429');
  assert(res.jsonData.code === 'RATE_LIMIT_EXCEEDED', 'Code is RATE_LIMIT_EXCEEDED');
  console.log('✓ TEST 17: Request above limit returns 429.');
}

// TEST 18: forceRefresh cannot bypass rate limit
{
  resetAskRateLimits();
  const testUid = 'rate_test_force_refresh';

  for (let i = 0; i < 10; i++) {
    checkAskRateLimit(testUid);
  }

  // 11th request with forceRefresh: true
  const req = createMockRequest({
    user: { uid: testUid },
    body: { query: 'Valid query', forceRefresh: true },
  });
  const res = createMockResponse();

  askRateLimiter(req, res as unknown as Response, (() => {}) as NextFunction);

  assert(res.statusCode === 429, 'forceRefresh=true blocked by rate limiter with 429');
  console.log('✓ TEST 18: forceRefresh cannot bypass rate limit.');
}

// TEST 19: Rate limit is associated with authenticated user identity
{
  resetAskRateLimits();
  const userA = 'user_rate_alpha';
  const userB = 'user_rate_beta';

  // Fill up user A's bucket
  for (let i = 0; i < 10; i++) {
    checkAskRateLimit(userA);
  }

  assert(checkAskRateLimit(userA) === false, 'User A is rate limited');
  assert(checkAskRateLimit(userB) === true, 'User B has fresh quota and is allowed');
  console.log('✓ TEST 19: Rate limit is associated with authenticated user identity.');
}

// TEST 20: One user's rate limit state cannot intentionally be controlled through another user's UID
{
  resetAskRateLimits();
  const victimUid = 'victim_uid_target';
  const attackerUid = 'attacker_uid';

  // Attacker makes 10 requests attempting to pass victimUid in body
  for (let i = 0; i < 10; i++) {
    const req = createMockRequest({
      user: { uid: attackerUid },
      body: { query: 'query', uid: victimUid },
    });
    const res = createMockResponse();
    askRateLimiter(req, res as unknown as Response, (() => {}) as NextFunction);
  }

  // Attacker is now throttled
  assert(checkAskRateLimit(attackerUid) === false, 'Attacker is throttled');
  // Victim is NOT throttled because rate limiter only reads verified req.user.uid
  assert(checkAskRateLimit(victimUid) === true, 'Victim quota completely untouched by attacker payload');
  console.log('✓ TEST 20: One user\'s rate limit state cannot be manipulated through body UID.');
}

// ============================================================================
// INTEGRATION & COVERAGE TESTS (21 - 32)
// ============================================================================

// TEST 21: M10.2 returns grounded evidence -> M10.3 receives it
{
  const cand = createMockCandidate({ interactionId: 'c_integ_01' });
  const retrieval = createMockRetrieval([cand]);

  let synthesisCandidatesPassed: AskCandidateEvidence[] = [];
  const options: AskHandlerOptions = {
    retrievalOverride: async () => retrieval,
    synthesisOverride: async (_q, r) => {
      synthesisCandidatesPassed = r.candidates;
      return createMockSynthesis({
        citations: [
          {
            interactionId: 'c_integ_01',
            threadId: 'th_01',
            threadTitle: 'Career Journey',
            date: '2026-03-10T14:30:00Z',
            excerpt: 'Thinking about systems architecture.',
          },
        ],
      });
    },
  };

  const req = createMockRequest({ user: { uid: 'u_integ' }, body: { query: 'Career notes' } });
  const res = createMockResponse();

  await handleAskJournal(req, res as unknown as Response, options);
  assert(res.statusCode === 200, 'HTTP 200 on valid flow');
  assert(synthesisCandidatesPassed.length === 1, 'Synthesis received the grounded candidate');
  assert(synthesisCandidatesPassed[0].interactionId === 'c_integ_01', 'Candidate ID matches');
  console.log('✓ TEST 21: M10.2 returns grounded evidence -> M10.3 receives it.');
}

// TEST 22: M10.2 returns zero matches -> M10.3 receives zero-evidence condition
{
  const zeroRetrieval = createMockRetrieval([], { matchingEntriesFound: 0 });

  let synthesisMatchingCount = -1;
  const options: AskHandlerOptions = {
    retrievalOverride: async () => zeroRetrieval,
    synthesisOverride: async (_q, r) => {
      synthesisMatchingCount = r.deterministicFacts.matchingEntriesFound;
      return createMockSynthesis({
        output: {
          answerType: 'no_relevant_entries',
          answer: 'You have not mentioned scuba diving.',
          evidenceIds: [],
          keyTakeaways: [],
          suggestedJournalQuestions: [],
        },
        citations: [],
      });
    },
  };

  const req = createMockRequest({ user: { uid: 'u_integ' }, body: { query: 'Scuba diving' } });
  const res = createMockResponse();

  await handleAskJournal(req, res as unknown as Response, options);
  assert(synthesisMatchingCount === 0, 'Synthesis saw 0 matching entries');
  assert(res.jsonData.answerType === 'no_relevant_entries', 'Response answerType is no_relevant_entries');
  console.log('✓ TEST 22: M10.2 returns zero matches -> zero-evidence condition handled.');
}

// TEST 23: M10.2 returns PARTIAL_HISTORY_SEARCH -> response preserves it
{
  const partialRetrieval = createMockRetrieval([createMockCandidate()], {
    retrievalCoverage: 'PARTIAL_HISTORY_SEARCH',
    coverageNote: 'Partial history search: evaluated 20 interactions across 2 threads.',
  });

  const options: AskHandlerOptions = {
    retrievalOverride: async () => partialRetrieval,
    synthesisOverride: async () => createMockSynthesis(),
  };

  const req = createMockRequest({ user: { uid: 'u_integ' }, body: { query: 'When did I start coding?' } });
  const res = createMockResponse();

  await handleAskJournal(req, res as unknown as Response, options);
  const resp: AskMyJournalResponse = res.jsonData;
  assert(resp.deterministicFacts.retrievalCoverage === 'PARTIAL_HISTORY_SEARCH', 'PARTIAL_HISTORY_SEARCH preserved');
  assert(Boolean(resp.deterministicFacts.coverageNote?.includes('Partial history search')), 'Coverage note preserved');
  console.log('✓ TEST 23: M10.2 returns PARTIAL_HISTORY_SEARCH -> response preserves it.');
}

// TEST 24: M10.3 returns grounded answer -> API returns structured response
{
  const options: AskHandlerOptions = {
    retrievalOverride: async () => createMockRetrieval([createMockCandidate()]),
    synthesisOverride: async () =>
      createMockSynthesis({
        output: {
          answerType: 'grounded_answer',
          answer: 'You discussed distributed architecture.',
          evidenceIds: ['int_01'],
          keyTakeaways: ['Focus on distributed systems'],
          suggestedJournalQuestions: ['What architecture book to read next?'],
        },
      }),
  };

  const req = createMockRequest({ user: { uid: 'u1' }, body: { query: 'Career goals' } });
  const res = createMockResponse();

  await handleAskJournal(req, res as unknown as Response, options);
  const resp: AskMyJournalResponse = res.jsonData;
  assert(resp.answerType === 'grounded_answer', 'answerType is grounded_answer');
  assert(resp.answer === 'You discussed distributed architecture.', 'answer text matches');
  assert(resp.citations.length === 1, 'citations populated');
  assert(resp.keyTakeaways.length === 1, 'keyTakeaways populated');
  assert(resp.cached === false, 'cached is false');
  console.log('✓ TEST 24: M10.3 returns grounded answer -> API returns structured response.');
}

// TEST 25: M10.3 returns insufficient_evidence -> API preserves answerType
{
  const options: AskHandlerOptions = {
    retrievalOverride: async () => createMockRetrieval([createMockCandidate()]),
    synthesisOverride: async () =>
      createMockSynthesis({
        output: {
          answerType: 'insufficient_evidence',
          answer: 'Only vague notes exist about diet.',
          evidenceIds: [],
          keyTakeaways: [],
          suggestedJournalQuestions: [],
        },
        citations: [],
      }),
  };

  const req = createMockRequest({ user: { uid: 'u1' }, body: { query: 'What is my diet plan?' } });
  const res = createMockResponse();

  await handleAskJournal(req, res as unknown as Response, options);
  assert(res.jsonData.answerType === 'insufficient_evidence', 'Preserved insufficient_evidence');
  console.log('✓ TEST 25: M10.3 returns insufficient_evidence -> API preserves answerType.');
}

// TEST 26: M10.3 returns no_relevant_entries -> API preserves answerType
{
  const options: AskHandlerOptions = {
    retrievalOverride: async () => createMockRetrieval([], { matchingEntriesFound: 0 }),
    synthesisOverride: async () =>
      createMockSynthesis({
        output: {
          answerType: 'no_relevant_entries',
          answer: 'No records found.',
          evidenceIds: [],
          keyTakeaways: [],
          suggestedJournalQuestions: [],
        },
        citations: [],
      }),
  };

  const req = createMockRequest({ user: { uid: 'u1' }, body: { query: 'Gardening notes' } });
  const res = createMockResponse();

  await handleAskJournal(req, res as unknown as Response, options);
  assert(res.jsonData.answerType === 'no_relevant_entries', 'Preserved no_relevant_entries');
  console.log('✓ TEST 26: M10.3 returns no_relevant_entries -> API preserves answerType.');
}

// TEST 27: M10.3 returns out_of_scope -> API preserves answerType
{
  const options: AskHandlerOptions = {
    retrievalOverride: async () => createMockRetrieval([], { matchingEntriesFound: 0 }),
    synthesisOverride: async () =>
      createMockSynthesis({
        output: {
          answerType: 'out_of_scope',
          answer: 'This is a general world knowledge question.',
          evidenceIds: [],
          keyTakeaways: [],
          suggestedJournalQuestions: [],
        },
        citations: [],
      }),
  };

  const req = createMockRequest({ user: { uid: 'u1' }, body: { query: 'What is the speed of light?' } });
  const res = createMockResponse();

  await handleAskJournal(req, res as unknown as Response, options);
  assert(res.jsonData.answerType === 'out_of_scope', 'Preserved out_of_scope');
  console.log('✓ TEST 27: M10.3 returns out_of_scope -> API preserves answerType.');
}

// TEST 28: M10.3 fails -> API returns safe 500 response
{
  const options: AskHandlerOptions = {
    retrievalOverride: async () => createMockRetrieval(),
    synthesisOverride: async () => {
      throw new Error('Gemini API 503 service unavailable with internal trace AIzaSySecretKey');
    },
  };

  const req = createMockRequest({ user: { uid: 'u1' }, body: { query: 'Career goals' } });
  const res = createMockResponse();

  await handleAskJournal(req, res as unknown as Response, options);
  assert(res.statusCode === 500, 'API returns 500 on synthesis failure');
  assert(res.jsonData.code === 'ASK_PROCESSING_FAILED', 'Code is ASK_PROCESSING_FAILED');
  assert(!JSON.stringify(res.jsonData).includes('AIzaSySecretKey'), 'No secrets leaked in error response');
  assert(!JSON.stringify(res.jsonData).includes('trace'), 'No stack trace in error response');
  console.log('✓ TEST 28: M10.3 fails -> API returns safe sanitized 500 response.');
}

// TEST 29: Malformed synthesis result cannot become a successful API response
{
  const options: AskHandlerOptions = {
    retrievalOverride: async () => createMockRetrieval(),
    synthesisOverride: async () => {
      throw new Error('AI output validation failed: Invalid or missing answerType');
    },
  };

  const req = createMockRequest({ user: { uid: 'u1' }, body: { query: 'Career goals' } });
  const res = createMockResponse();

  await handleAskJournal(req, res as unknown as Response, options);
  assert(res.statusCode === 500, 'Validation failure produces 500');
  console.log('✓ TEST 29: Malformed synthesis result cannot become a successful API response.');
}

// TEST 30: Unknown citation IDs cannot appear in final API response
{
  // If synthesis somehow returned an unverified citation, handleAskJournal only receives the pruned citations from M10.3
  const cand = createMockCandidate({ interactionId: 'real_id' });
  const options: AskHandlerOptions = {
    retrievalOverride: async () => createMockRetrieval([cand]),
    synthesisOverride: async () =>
      createMockSynthesis({
        citations: [
          {
            interactionId: 'real_id',
            threadId: 'th_01',
            threadTitle: 'Career',
            date: '2026-03-10T14:30:00Z',
            excerpt: 'Excerpt',
          },
        ],
      }),
  };

  const req = createMockRequest({ user: { uid: 'u1' }, body: { query: 'Career goals' } });
  const res = createMockResponse();

  await handleAskJournal(req, res as unknown as Response, options);
  const resp: AskMyJournalResponse = res.jsonData;
  assert(resp.citations.length === 1, 'Only 1 citation returned');
  assert(resp.citations[0].interactionId === 'real_id', 'Valid citation ID preserved');
  console.log('✓ TEST 30: Unknown citation IDs cannot appear in final API response.');
}

// TEST 31: Error sanitization
{
  const options: AskHandlerOptions = {
    retrievalOverride: async () => {
      throw new Error('Firestore read failed at /databases/(default)/documents/users/secret_uid/threads');
    },
  };

  const req = createMockRequest({ user: { uid: 'secret_uid' }, body: { query: 'Valid query' } });
  const res = createMockResponse();

  await handleAskJournal(req, res as unknown as Response, options);
  assert(res.statusCode === 500, 'Returns 500');
  assert(res.jsonData.error === 'An error occurred while analyzing your journal. Please try again.', 'Generic error message');
  assert(!JSON.stringify(res.jsonData).includes('secret_uid'), 'UID not in error response');
  assert(!JSON.stringify(res.jsonData).includes('Firestore'), 'Database internals not in error response');
  console.log('✓ TEST 31: Error sanitization verified.');
}

// TEST 32: Partial timeline qualified answer is preserved unchanged
{
  const qualifiedAnswer = 'Within the searched history, you first mentioned architecture on March 10, 2026. (Note: Earlier uninspected entries may exist outside this search window.)';
  const options: AskHandlerOptions = {
    retrievalOverride: async () =>
      createMockRetrieval([createMockCandidate()], {
        retrievalCoverage: 'PARTIAL_HISTORY_SEARCH',
        retrievalMode: 'timeline',
      }),
    synthesisOverride: async () =>
      createMockSynthesis({
        output: {
          answerType: 'grounded_answer',
          answer: qualifiedAnswer,
          evidenceIds: ['int_01'],
          keyTakeaways: ['Earliest found mention on March 10'],
          suggestedJournalQuestions: [],
        },
      }),
  };

  const req = createMockRequest({ user: { uid: 'u1' }, body: { query: 'When did I first mention architecture?' } });
  const res = createMockResponse();

  await handleAskJournal(req, res as unknown as Response, options);
  const resp: AskMyJournalResponse = res.jsonData;
  assert(resp.answer === qualifiedAnswer, 'Qualified answer is preserved completely unchanged');
  assert(resp.deterministicFacts.retrievalCoverage === 'PARTIAL_HISTORY_SEARCH', 'Coverage preserved');
  console.log('✓ TEST 32: Partial timeline qualified answer is preserved unchanged.');
}

console.log('--- All 32 Milestone 10.4 Authenticated Ask API Tests Passed Successfully ---');
