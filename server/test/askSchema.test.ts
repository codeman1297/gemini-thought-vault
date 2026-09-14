/**
 * Unit and Security Tests for Milestone 10.1: Ask My Journal Types & Schemas
 * 
 * Test Coverage (Mandatory Criteria):
 * 1. AskMyJournalQuery rejects invalid query lengths (< 3 characters).
 * 2. AskMyJournalQuery rejects invalid query lengths (> 300 characters).
 * 3. AskMyJournalQuery rejects whitespace-only queries.
 * 4. AskMyJournalQuery accepts valid queries.
 * 5. forceRefresh accepts only boolean values (rejects strings/numbers).
 * 6. AskMyJournalAIOutput rejects malformed/unknown answerType values.
 * 7. AskMyJournalAIOutput rejects excessive evidenceIds (> 10 items).
 * 8. AskMyJournalAIOutput rejects excessive keyTakeaways (> 3 items).
 * 9. AskMyJournalAIOutput rejects excessive suggestedJournalQuestions (> 2 items).
 * 10. AskMyJournalAIOutput accepts valid bounded model output.
 */

import { validateAskQuery, validateAskAIOutput, ValidationResult } from '../types';

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(`TEST ASSERTION FAILED: ${message}`);
  }
}

function assertFailure(res: ValidationResult<unknown>, expectedErrorSubstring: string) {
  if ('error' in res) {
    if (!res.error.includes(expectedErrorSubstring)) {
      throw new Error(`Error "${res.error}" did not include "${expectedErrorSubstring}"`);
    }
  } else {
    throw new Error('Expected failure but got success');
  }
}

function assertSuccess<T>(res: ValidationResult<T>): T {
  if ('data' in res) {
    return res.data;
  }
  throw new Error(`Expected success but got error: ${res.error}`);
}

console.log('--- Running Milestone 10.1 Ask My Journal Schema Tests ---');

// Test 1: Query rejects too short (< 3 chars)
{
  const res1 = validateAskQuery({ query: 'hi' });
  assertFailure(res1, 'at least 3 characters');

  const res2 = validateAskQuery({ query: 'a' });
  assertFailure(res2, 'at least 3 characters');
  console.log('✓ Test 1: AskMyJournalQuery rejects queries under 3 characters.');
}

// Test 2: Query rejects too long (> 300 chars)
{
  const longQuery = 'a'.repeat(301);
  const res = validateAskQuery({ query: longQuery });
  assertFailure(res, '300 characters');
  console.log('✓ Test 2: AskMyJournalQuery rejects queries over 300 characters.');
}

// Test 3: Query rejects whitespace-only
{
  const res = validateAskQuery({ query: '     \t\n   ' });
  assertFailure(res, 'whitespace-only');
  console.log('✓ Test 3: AskMyJournalQuery rejects whitespace-only queries.');
}

// Test 4: Query accepts valid inputs
{
  const res1 = validateAskQuery({ query: 'Have I talked about changing careers?' });
  const data1 = assertSuccess(res1);
  assert(data1.query === 'Have I talked about changing careers?', 'Query preserved');
  assert(data1.forceRefresh === undefined, 'forceRefresh omitted when not provided');

  const res2 = validateAskQuery({ query: '  What are my recurring themes?  ', forceRefresh: true });
  const data2 = assertSuccess(res2);
  assert(data2.query === 'What are my recurring themes?', 'Query trimmed');
  assert(data2.forceRefresh === true, 'forceRefresh preserved as boolean');
  console.log('✓ Test 4: AskMyJournalQuery accepts valid queries and trims whitespace.');
}

// Test 5: forceRefresh accepts only boolean values
{
  const resString = validateAskQuery({ query: 'Valid query text', forceRefresh: 'true' as unknown as boolean });
  assertFailure(resString, 'forceRefresh must be a boolean');

  const resNumber = validateAskQuery({ query: 'Valid query text', forceRefresh: 1 as unknown as boolean });
  assertFailure(resNumber, 'forceRefresh must be a boolean');

  const resBool = validateAskQuery({ query: 'Valid query text', forceRefresh: false });
  const dataBool = assertSuccess(resBool);
  assert(dataBool.forceRefresh === false, 'Boolean false accepted');
  console.log('✓ Test 5: forceRefresh accepts only boolean values.');
}

// Test 6: AskMyJournalAIOutput rejects malformed answerType values
{
  const malformed = {
    answerType: 'PARTIAL_HISTORY_SEARCH', // PARTIAL_HISTORY_SEARCH is NOT an answerType!
    answer: 'Here is an answer',
    evidenceIds: ['int_1'],
    keyTakeaways: ['Takeaway 1'],
    suggestedJournalQuestions: ['Question 1?']
  };

  const res = validateAskAIOutput(malformed);
  assertFailure(res, 'Invalid or missing answerType');

  const invalidType2 = {
    ...malformed,
    answerType: 'random_hallucinated_type'
  };
  assertFailure(validateAskAIOutput(invalidType2), 'Invalid or missing answerType');
  console.log('✓ Test 6: AskMyJournalAIOutput rejects malformed answerType values.');
}

// Test 7: AskMyJournalAIOutput rejects excessive evidenceIds (> 10 items)
{
  const excessiveIds = {
    answerType: 'grounded_answer',
    answer: 'Based on your entries...',
    evidenceIds: Array.from({ length: 11 }, (_, i) => `int_${i}`),
    keyTakeaways: ['Takeaway 1'],
    suggestedJournalQuestions: ['Question 1?']
  };

  const res = validateAskAIOutput(excessiveIds);
  assertFailure(res, 'bound of 10 items');
  console.log('✓ Test 7: AskMyJournalAIOutput rejects excessive evidenceIds (> 10 items).');
}

// Test 8: AskMyJournalAIOutput rejects excessive keyTakeaways (> 3 items)
{
  const excessiveTakeaways = {
    answerType: 'grounded_answer',
    answer: 'Based on your entries...',
    evidenceIds: ['int_1'],
    keyTakeaways: ['Takeaway 1', 'Takeaway 2', 'Takeaway 3', 'Takeaway 4'],
    suggestedJournalQuestions: ['Question 1?']
  };

  const res = validateAskAIOutput(excessiveTakeaways);
  assertFailure(res, 'bound of 3 items');
  console.log('✓ Test 8: AskMyJournalAIOutput rejects excessive keyTakeaways (> 3 items).');
}

// Test 9: AskMyJournalAIOutput rejects excessive suggestedJournalQuestions (> 2 items)
{
  const excessiveQuestions = {
    answerType: 'grounded_answer',
    answer: 'Based on your entries...',
    evidenceIds: ['int_1'],
    keyTakeaways: ['Takeaway 1'],
    suggestedJournalQuestions: ['Q1?', 'Q2?', 'Q3?']
  };

  const res = validateAskAIOutput(excessiveQuestions);
  assertFailure(res, 'bound of 2 items');
  console.log('✓ Test 9: AskMyJournalAIOutput rejects excessive suggestedJournalQuestions (> 2 items).');
}

// Test 10: AskMyJournalAIOutput accepts valid bounded model output
{
  const validOutput = {
    answerType: 'grounded_answer',
    answer: 'You contemplated leaving your corporate career on two separate occasions in May and July.',
    evidenceIds: ['int_101', 'int_202'],
    keyTakeaways: ['You valued autonomy over prestige.', 'Financial security was your primary hesitance.'],
    suggestedJournalQuestions: ['What does autonomy mean to you now in your current project?']
  };

  const res = validateAskAIOutput(validOutput);
  const data = assertSuccess(res);
  assert(data.answerType === 'grounded_answer', 'answerType correct');
  assert(data.evidenceIds.length === 2, 'evidenceIds preserved');
  assert(data.keyTakeaways.length === 2, 'keyTakeaways preserved');
  assert(data.suggestedJournalQuestions.length === 1, 'questions preserved');
  console.log('✓ Test 10: AskMyJournalAIOutput accepts valid bounded model output.');
}

console.log('--- All 10 Milestone 10.1 Schema Test Suites Passed Successfully ---');
