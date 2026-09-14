/**
 * Server-Side Types for Gemini ThoughtVault
 * Milestone 5: Secure Firestore Persistence & Authoritative History
 */

import type { Request } from 'express';

export interface AuthenticatedUserPayload {
  uid: string;
  email: string | null;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUserPayload;
}

export interface ConversationTurn {
  role: 'user' | 'model';
  text: string;
}

export interface AIReflectionInsight {
  summary: string;
  themes: string[];
  coreThemes: string[]; // Mirror of themes for backward compatibility
  actionItems: string[];
  openQuestions: string[];
}

export type JournalReflectionInsights = AIReflectionInsight;

export interface ModelMetadata {
  modelUsed: string;
  fallbackUsed: boolean;
  attemptsCount: number;
  latencyMs: number;
}

export interface JournalThread {
  id: string;
  userId: string;
  title: string;
  previewSnippet: string;
  turnCount: number;
  coreThemes: string[];
  lastSummary?: string;
  createdAt: string;
  updatedAt: string;
  lastInteractionId?: string;
  status: 'active' | 'archived';
}

export interface JournalInteraction {
  id: string;
  threadId: string;
  userId: string;
  turnIndex: number;
  userPrompt: string;
  geminiResponse: string;
  insights: JournalReflectionInsights;
  modelMetadata: ModelMetadata;
  clientInteractionId?: string;
  createdAt: string;
}

export interface CreateThreadRequestBody {
  title?: string;
  prompt?: string;
  clientInteractionId?: string;
}

export interface JournalChatRequestBody {
  threadId?: string;
  prompt?: string;
  clientInteractionId?: string;
  // History is strictly deprecated; authoritative history is loaded from Firestore
  history?: ConversationTurn[];
}

export interface RetrySaveRequestBody {
  threadId: string;
  clientInteractionId: string;
  userPrompt: string;
  geminiResponse: string;
  insights: JournalReflectionInsights;
  modelMetadata: ModelMetadata;
}

export interface PersistenceStatus {
  status: 'persisted' | 'failed';
  savedAt?: string;
  interactionId?: string;
  threadId?: string;
}

export interface JournalChatResponsePayload {
  userPrompt: string;
  geminiResponse: string;
  insights: JournalReflectionInsights;
  modelMetadata: ModelMetadata;
  threadId: string;
  interactionId: string;
  turnIndex: number;
  persistence: PersistenceStatus;
  timestamp: string;
}

export interface PendingPersistenceRecord {
  threadId: string;
  clientInteractionId: string;
  userPrompt: string;
  geminiResponse: string;
  insights: JournalReflectionInsights;
  modelMetadata: ModelMetadata;
  failedAt: string;
}

// ============================================================================
// Milestone 9: Thought Evolution Engine Types
// ============================================================================

export interface EvolutionDeterministicMetrics {
  totalInteractionsAnalyzed: number; // Strictly <= 25
  totalThreadsAnalyzed: number;      // Strictly <= 10
  dateRange: {
    firstInteractionDate: string;
    lastInteractionDate: string;
  };
  topThemesByFrequency: Array<{
    theme: string;
    count: number;
    threadIds: string[];
  }>;
  daysSinceLastJournal: number;
}

export interface EvolutionCitationReference {
  interactionId: string;
  threadId: string;
  date: string;
  threadTitle: string;
}

export interface RawEvolvingPatternOutput {
  theme?: unknown;
  trajectory?: unknown;
  observation?: unknown;
  evidenceIds?: unknown;
}

export interface RawIdeaWorthRevisitingOutput {
  title?: unknown;
  context?: unknown;
  evidenceId?: unknown;
  openQuestion?: unknown;
}

export interface EvolutionAIOutput {
  overallSynthesis?: unknown;
  evolvingPatterns?: RawEvolvingPatternOutput[];
  unresolvedQuestions?: unknown[];
  ideasWorthRevisiting?: RawIdeaWorthRevisitingOutput[];
}

export interface EvolvingThemePattern {
  theme: string;
  trajectory: 'emerging' | 'deepening' | 'shifting' | 'dormant';
  observation: string;
  evidence: EvolutionCitationReference[]; // >= 1 verified reference
}

export interface IdeaWorthRevisiting {
  title: string;
  context: string;
  evidence: EvolutionCitationReference;  // Exactly 1 verified reference
  openQuestion: string;
}

export interface EvolutionAIInsights {
  overallSynthesis: string;
  evolvingPatterns: EvolvingThemePattern[];
  unresolvedQuestions: string[];
  ideasWorthRevisiting: IdeaWorthRevisiting[];
}

export interface EvolutionLockDocument {
  status: 'idle' | 'generating';
  lockId: string;
  lockedAt: string;
  expiresAt: string;
}

export interface ThoughtEvolutionDocument {
  id: 'latest';
  userId: string;
  status: 'ready' | 'insufficient_history';
  generatedAt: string;
  metrics: EvolutionDeterministicMetrics;
  insights?: EvolutionAIInsights;
  modelMetadata?: {
    modelUsed: string;
    fallbackUsed: boolean;
    attemptsCount: number;
    latencyMs: number;
  };
  contentHash: string;
  message?: string;
}

export interface BoundedCandidate {
  interactionId: string;
  threadId: string;
  threadTitle: string;
  createdAt: string;
  userPrompt: string;
  summary: string;
  themes: string[];
  openQuestions: string[];
}

export interface SupportingEvidenceResponse {
  available: boolean;
  interactionId: string;
  threadId: string;
  threadTitle?: string;
  userPrompt?: string;
  geminiResponse?: string;
  summary?: string;
  date?: string;
  message?: string;
}

// ============================================================================
// Milestone 10: Ask My Journal Types & Schemas
// ============================================================================

export type AskAnswerType =
  | 'grounded_answer'
  | 'insufficient_evidence'
  | 'no_relevant_entries'
  | 'out_of_scope';

export type AskRetrievalMode =
  | 'mention'
  | 'timeline'
  | 'recent_focus'
  | 'recurrence'
  | 'temporal_change'
  | 'evidence_lookup'
  | 'unresolved_questions';

export type AskRetrievalCoverage =
  | 'FULL_HISTORY_SEARCH'
  | 'PARTIAL_HISTORY_SEARCH';

export interface AskMyJournalQuery {
  query: string;
  forceRefresh?: boolean;
}

export interface AskEvidenceReference {
  interactionId: string;
  threadId: string;
  threadTitle: string;
  date: string;
  excerpt: string;
}

export interface AskDeterministicFacts {
  totalThreadsSearched: number;
  totalInteractionsScanned: number;
  matchingEntriesFound: number;
  dateRange: {
    firstEntryDate: string | null;
    lastEntryDate: string | null;
  };
  matchedThemes: string[];
  retrievalCoverage: AskRetrievalCoverage;
  retrievalMode: AskRetrievalMode;
  coverageNote?: string;
}

export interface AskCandidateEvidence {
  interactionId: string;
  threadId: string;
  threadTitle: string;
  date: string;
  userPromptSnippet: string;
  summary?: string;
  themes: string[];
  openQuestions?: string[];
  score: number;
  scoreBreakdown?: {
    phraseScore: number;
    tokenScore: number;
    themeScore: number;
    summaryScore: number;
    openQuestionScore: number;
    titleScore: number;
    expansionScore: number;
    modeBonus: number;
  };
}

export interface AskRetrievalResult {
  candidates: AskCandidateEvidence[];
  verifiedMap: Map<string, AskCandidateEvidence>;
  deterministicFacts: AskDeterministicFacts;
}

export interface AskMyJournalAIOutput {
  answerType: AskAnswerType;
  answer: string;
  evidenceIds: string[];
  keyTakeaways: string[];
  suggestedJournalQuestions: string[];
}

export interface AskMyJournalResponse {
  query: string;
  answerType: AskAnswerType;
  answer: string;
  deterministicFacts: AskDeterministicFacts;
  citations: AskEvidenceReference[];
  keyTakeaways: string[];
  suggestedJournalQuestions: string[];
  modelMetadata?: {
    modelUsed: string;
    fallbackUsed: boolean;
    attemptsCount: number;
    latencyMs: number;
  };
  cached: boolean;
}

export interface AskSynthesisResult {
  output: AskMyJournalAIOutput;
  citations: AskEvidenceReference[];
  modelMetadata: {
    modelUsed: string;
    fallbackUsed: boolean;
    attemptsCount: number;
    latencyMs: number;
  };
}

export type ValidationResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

/**
 * Validates an incoming AskMyJournalQuery request payload.
 * Enforces:
 * - query must be string
 * - query length between 3 and 300 characters
 * - query must not be whitespace-only
 * - forceRefresh, if supplied, must be boolean
 */
export function validateAskQuery(input: unknown): ValidationResult<AskMyJournalQuery> {
  if (!input || typeof input !== 'object') {
    return { success: false, error: 'Request body must be a JSON object.' };
  }

  const payload = input as Record<string, unknown>;

  if (typeof payload.query !== 'string') {
    return { success: false, error: 'Query must be a string.' };
  }

  const trimmedQuery = payload.query.trim();
  if (trimmedQuery.length === 0) {
    return { success: false, error: 'Query must not be whitespace-only.' };
  }

  if (payload.query.length < 3) {
    return { success: false, error: 'Query must be at least 3 characters in length.' };
  }

  if (payload.query.length > 300) {
    return { success: false, error: 'Query must not exceed 300 characters.' };
  }

  let forceRefresh: boolean | undefined = undefined;
  if ('forceRefresh' in payload && payload.forceRefresh !== undefined) {
    if (typeof payload.forceRefresh !== 'boolean') {
      return { success: false, error: 'forceRefresh must be a boolean when provided.' };
    }
    forceRefresh = payload.forceRefresh;
  }

  return {
    success: true,
    data: {
      query: trimmedQuery,
      ...(forceRefresh !== undefined ? { forceRefresh } : {}),
    },
  };
}

const VALID_ANSWER_TYPES: ReadonlySet<string> = new Set<AskAnswerType>([
  'grounded_answer',
  'insufficient_evidence',
  'no_relevant_entries',
  'out_of_scope',
]);

/**
 * Validates raw, untrusted Gemini AI output for Ask My Journal.
 * Enforces strict boundaries:
 * - answerType: must be one of the four allowed AskAnswerType values
 * - answer: string, max 600 characters
 * - evidenceIds: array of strings, max 10 items, max 100 characters each
 * - keyTakeaways: array of strings, max 3 items, max 150 characters each
 * - suggestedJournalQuestions: array of strings, max 2 items, max 120 characters each
 */
export function validateAskAIOutput(raw: unknown): ValidationResult<AskMyJournalAIOutput> {
  if (!raw || typeof raw !== 'object') {
    return { success: false, error: 'Model output must be a non-null object.' };
  }

  const obj = raw as Record<string, unknown>;

  if (typeof obj.answerType !== 'string' || !VALID_ANSWER_TYPES.has(obj.answerType)) {
    return { success: false, error: `Invalid or missing answerType: ${String(obj.answerType)}` };
  }
  const answerType = obj.answerType as AskAnswerType;

  if (typeof obj.answer !== 'string' || obj.answer.trim().length === 0) {
    return { success: false, error: 'Missing or empty answer field.' };
  }
  if (obj.answer.length > 600) {
    return { success: false, error: 'Answer exceeds maximum allowed length of 600 characters.' };
  }
  const answer = obj.answer.trim();

  if (!Array.isArray(obj.evidenceIds)) {
    return { success: false, error: 'evidenceIds must be an array of strings.' };
  }
  if (obj.evidenceIds.length > 10) {
    return { success: false, error: 'evidenceIds exceeds maximum bound of 10 items.' };
  }
  const evidenceIds: string[] = [];
  for (const id of obj.evidenceIds) {
    if (typeof id !== 'string' || id.trim().length === 0) {
      return { success: false, error: 'Each evidenceId must be a non-empty string.' };
    }
    if (id.length > 100) {
      return { success: false, error: 'evidenceId exceeds maximum length of 100 characters.' };
    }
    evidenceIds.push(id.trim());
  }

  if (!Array.isArray(obj.keyTakeaways)) {
    return { success: false, error: 'keyTakeaways must be an array of strings.' };
  }
  if (obj.keyTakeaways.length > 3) {
    return { success: false, error: 'keyTakeaways exceeds maximum bound of 3 items.' };
  }
  const keyTakeaways: string[] = [];
  for (const item of obj.keyTakeaways) {
    if (typeof item !== 'string' || item.trim().length === 0) {
      return { success: false, error: 'Each keyTakeaway must be a non-empty string.' };
    }
    if (item.length > 150) {
      return { success: false, error: 'keyTakeaway exceeds maximum length of 150 characters.' };
    }
    keyTakeaways.push(item.trim());
  }

  if (!Array.isArray(obj.suggestedJournalQuestions)) {
    return { success: false, error: 'suggestedJournalQuestions must be an array of strings.' };
  }
  if (obj.suggestedJournalQuestions.length > 2) {
    return { success: false, error: 'suggestedJournalQuestions exceeds maximum bound of 2 items.' };
  }
  const suggestedJournalQuestions: string[] = [];
  for (const q of obj.suggestedJournalQuestions) {
    if (typeof q !== 'string' || q.trim().length === 0) {
      return { success: false, error: 'Each suggestedJournalQuestion must be a non-empty string.' };
    }
    if (q.length > 120) {
      return { success: false, error: 'suggestedJournalQuestion exceeds maximum length of 120 characters.' };
    }
    suggestedJournalQuestions.push(q.trim());
  }

  return {
    success: true,
    data: {
      answerType,
      answer,
      evidenceIds,
      keyTakeaways,
      suggestedJournalQuestions,
    },
  };
}

// ============================================================================
// Milestone 10.6: Personal Journal Insights Types & Schemas
// ============================================================================

export type InsightRetrievalCoverage =
  | 'FULL_HISTORY_SEARCH'
  | 'PARTIAL_HISTORY_SEARCH';

export type InsightSupportTier =
  | 'HIGH_CONFIDENCE'
  | 'MODERATE_CONFIDENCE'
  | 'OBSERVATIONAL'
  | 'INSUFFICIENT_EVIDENCE';

export type InsightThemeTrajectoryType =
  | 'EMERGING'
  | 'PERSISTENT'
  | 'DORMANT'
  | 'TRANSIENT';

export interface InsightCoverageFacts {
  totalThreadsInVault: number;
  threadsScanned: number;
  totalInteractionsInVault: number;
  interactionsScanned: number;
  retrievalCoverage: InsightRetrievalCoverage;
  earliestAnalyzedDate: string | null;
  latestAnalyzedDate: string | null;
  coverageDisclosure: string;
}

export interface InsightThemeTrajectory {
  theme: string;
  trajectory: InsightThemeTrajectoryType;
  earlierFrequency: number;
  recentFrequency: number;
  totalFrequency: number;
  earlierThreadCount: number;
  recentThreadCount: number;
  evidenceIds: string[];
  supportTier: InsightSupportTier;
}

export interface InsightPattern {
  patternId: string;
  name: string;
  description: string;
  frequency: number;
  distinctThreadCount: number;
  firstSeenDate: string;
  lastSeenDate: string;
  evidenceIds: string[];
  supportTier: InsightSupportTier;
}

export interface InsightGoal {
  goalId: string;
  text: string;
  frequency: number;
  distinctThreadCount: number;
  firstSeenDate: string;
  lastSeenDate: string;
  evidenceIds: string[];
  supportTier: InsightSupportTier;
}

export interface InsightOpenQuestion {
  questionId: string;
  text: string;
  frequency: number;
  distinctThreadCount: number;
  firstSeenDate: string;
  lastSeenDate: string;
  evidenceIds: string[];
  supportTier: InsightSupportTier;
}

export interface InsightEvidenceReference {
  interactionId: string;
  threadId: string;
  threadTitle: string;
  date: string;
  excerpt: string;
}

export interface InsightCandidateEvidence {
  interactionId: string;
  threadId: string;
  threadTitle: string;
  date: string;
  userPromptSnippet: string;
  summary?: string;
  themes: string[];
  actionItems?: string[];
  openQuestions?: string[];
}

export interface InsightDeterministicAggregation {
  coverage: InsightCoverageFacts;
  themeTrajectories: InsightThemeTrajectory[];
  recurringPatterns: InsightPattern[];
  repeatedActionItems: InsightGoal[];
  repeatedOpenQuestions: InsightOpenQuestion[];
  selectedEvidence: InsightCandidateEvidence[];
  verifiedMap: Map<string, InsightCandidateEvidence>;
  hasSufficientHistory: boolean;
}

export interface InsightThemeAIItem {
  theme: string;
  insight: string;
  evidenceIds: string[];
}

export interface InsightPatternAIItem {
  patternName: string;
  insight: string;
  evidenceIds: string[];
}

export interface InsightGoalAIItem {
  goalText: string;
  insight: string;
  evidenceIds: string[];
}

export interface InsightQuestionAIItem {
  questionText: string;
  insight: string;
  evidenceIds: string[];
}

export interface InsightAIOutput {
  narrativeSummary: string;
  themeInsights: InsightThemeAIItem[];
  patternInsights: InsightPatternAIItem[];
  goalInsights: InsightGoalAIItem[];
  openQuestionInsights: InsightQuestionAIItem[];
  reflectiveQuestions: string[];
  citedEvidenceIds: string[];
}

export interface PersonalInsightsResponse {
  status: 'ready' | 'insufficient_history';
  coverage: InsightCoverageFacts;
  narrativeSummary: string;
  themeTrajectories: (InsightThemeTrajectory & { aiInsight?: string })[];
  recurringPatterns: (InsightPattern & { aiInsight?: string })[];
  repeatedActionItems: (InsightGoal & { aiInsight?: string })[];
  repeatedOpenQuestions: (InsightOpenQuestion & { aiInsight?: string })[];
  reflectiveQuestions: string[];
  citations: InsightEvidenceReference[];
  cached: boolean;
  generatedAt: string;
  modelMetadata?: {
    modelUsed: string;
    fallbackUsed: boolean;
    attemptsCount: number;
    latencyMs: number;
  };
}

/**
 * Validates raw Gemini AI output for Personal Journal Insights (Milestone 10.6).
 * Enforces strict boundaries:
 * - narrativeSummary: max 1200 characters
 * - themeInsights: max 6 items, max 300 chars each
 * - patternInsights: max 5 items, max 300 chars each
 * - goalInsights: max 4 items, max 300 chars each
 * - openQuestionInsights: max 4 items, max 300 chars each
 * - reflectiveQuestions: exactly 3 items, max 180 chars each
 * - citedEvidenceIds: array of strings, max 20 items
 */
export function validateInsightAIOutput(raw: unknown): ValidationResult<InsightAIOutput> {
  if (!raw || typeof raw !== 'object') {
    return { success: false, error: 'Model output must be a non-null object.' };
  }

  const obj = raw as Record<string, unknown>;

  if (typeof obj.narrativeSummary !== 'string' || obj.narrativeSummary.trim().length === 0) {
    return { success: false, error: 'Missing or empty narrativeSummary field.' };
  }
  if (obj.narrativeSummary.length > 1000) {
    return { success: false, error: 'narrativeSummary exceeds maximum allowed length of 1000 characters.' };
  }
  const narrativeSummary = obj.narrativeSummary.trim();

  // Validate themeInsights
  if (!Array.isArray(obj.themeInsights)) {
    return { success: false, error: 'themeInsights must be an array.' };
  }
  if (obj.themeInsights.length > 6) {
    return { success: false, error: 'themeInsights exceeds maximum bound of 6 items.' };
  }
  const themeInsights: InsightThemeAIItem[] = [];
  for (const item of obj.themeInsights) {
    if (!item || typeof item !== 'object') {
      return { success: false, error: 'Each themeInsight must be an object.' };
    }
    const t = item as Record<string, unknown>;
    if (typeof t.theme !== 'string' || typeof t.insight !== 'string') {
      return { success: false, error: 'themeInsight requires theme and insight strings.' };
    }
    const evIds: string[] = Array.isArray(t.evidenceIds)
      ? (t.evidenceIds as unknown[]).filter((x): x is string => typeof x === 'string' && x.length <= 100)
      : [];
    themeInsights.push({
      theme: t.theme.trim().slice(0, 80),
      insight: t.insight.trim().slice(0, 300),
      evidenceIds: evIds,
    });
  }

  // Validate patternInsights
  if (!Array.isArray(obj.patternInsights)) {
    return { success: false, error: 'patternInsights must be an array.' };
  }
  if (obj.patternInsights.length > 5) {
    return { success: false, error: 'patternInsights exceeds maximum bound of 5 items.' };
  }
  const patternInsights: InsightPatternAIItem[] = [];
  for (const item of obj.patternInsights) {
    if (!item || typeof item !== 'object') {
      return { success: false, error: 'Each patternInsight must be an object.' };
    }
    const p = item as Record<string, unknown>;
    if (typeof p.patternName !== 'string' || typeof p.insight !== 'string') {
      return { success: false, error: 'patternInsight requires patternName and insight strings.' };
    }
    const evIds: string[] = Array.isArray(p.evidenceIds)
      ? (p.evidenceIds as unknown[]).filter((x): x is string => typeof x === 'string' && x.length <= 100)
      : [];
    patternInsights.push({
      patternName: p.patternName.trim().slice(0, 100),
      insight: p.insight.trim().slice(0, 300),
      evidenceIds: evIds,
    });
  }

  // Validate goalInsights
  if (!Array.isArray(obj.goalInsights)) {
    return { success: false, error: 'goalInsights must be an array.' };
  }
  if (obj.goalInsights.length > 4) {
    return { success: false, error: 'goalInsights exceeds maximum bound of 4 items.' };
  }
  const goalInsights: InsightGoalAIItem[] = [];
  for (const item of obj.goalInsights) {
    if (!item || typeof item !== 'object') {
      return { success: false, error: 'Each goalInsight must be an object.' };
    }
    const g = item as Record<string, unknown>;
    if (typeof g.goalText !== 'string' || typeof g.insight !== 'string') {
      return { success: false, error: 'goalInsight requires goalText and insight strings.' };
    }
    const evIds: string[] = Array.isArray(g.evidenceIds)
      ? (g.evidenceIds as unknown[]).filter((x): x is string => typeof x === 'string' && x.length <= 100)
      : [];
    goalInsights.push({
      goalText: g.goalText.trim().slice(0, 150),
      insight: g.insight.trim().slice(0, 300),
      evidenceIds: evIds,
    });
  }

  // Validate openQuestionInsights
  if (!Array.isArray(obj.openQuestionInsights)) {
    return { success: false, error: 'openQuestionInsights must be an array.' };
  }
  if (obj.openQuestionInsights.length > 4) {
    return { success: false, error: 'openQuestionInsights exceeds maximum bound of 4 items.' };
  }
  const openQuestionInsights: InsightQuestionAIItem[] = [];
  for (const item of obj.openQuestionInsights) {
    if (!item || typeof item !== 'object') {
      return { success: false, error: 'Each openQuestionInsight must be an object.' };
    }
    const q = item as Record<string, unknown>;
    if (typeof q.questionText !== 'string' || typeof q.insight !== 'string') {
      return { success: false, error: 'openQuestionInsight requires questionText and insight strings.' };
    }
    const evIds: string[] = Array.isArray(q.evidenceIds)
      ? (q.evidenceIds as unknown[]).filter((x): x is string => typeof x === 'string' && x.length <= 100)
      : [];
    openQuestionInsights.push({
      questionText: q.questionText.trim().slice(0, 150),
      insight: q.insight.trim().slice(0, 300),
      evidenceIds: evIds,
    });
  }

  // Validate reflectiveQuestions (must be exactly 3 thoughtful questions)
  if (!Array.isArray(obj.reflectiveQuestions)) {
    return { success: false, error: 'reflectiveQuestions must be an array.' };
  }
  if (obj.reflectiveQuestions.length !== 3) {
    return { success: false, error: 'reflectiveQuestions must contain exactly 3 questions.' };
  }
  const reflectiveQuestions: string[] = [];
  for (const rq of obj.reflectiveQuestions) {
    if (typeof rq !== 'string' || rq.trim().length === 0) {
      return { success: false, error: 'Each reflective question must be a non-empty string.' };
    }
    if (rq.length > 200) {
      return { success: false, error: 'Reflective question exceeds maximum length of 200 characters.' };
    }
    reflectiveQuestions.push(rq.trim());
  }

  // Validate citedEvidenceIds
  if (!Array.isArray(obj.citedEvidenceIds)) {
    return { success: false, error: 'citedEvidenceIds must be an array of strings.' };
  }
  if (obj.citedEvidenceIds.length > 20) {
    return { success: false, error: 'citedEvidenceIds exceeds maximum bound of 20 items.' };
  }
  const citedEvidenceIds: string[] = [];
  for (const id of obj.citedEvidenceIds) {
    if (typeof id !== 'string' || id.trim().length === 0 || id.length > 100) {
      return { success: false, error: 'citedEvidenceIds must contain valid strings.' };
    }
    citedEvidenceIds.push(id.trim());
  }

  return {
    success: true,
    data: {
      narrativeSummary,
      themeInsights,
      patternInsights,
      goalInsights,
      openQuestionInsights,
      reflectiveQuestions,
      citedEvidenceIds,
    },
  };
}

