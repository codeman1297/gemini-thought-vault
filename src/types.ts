/**
 * Client-Side Types for Gemini ThoughtVault
 * Milestone 5: Persistent Journal Threads & Firestore Sync
 */

export interface ConversationTurn {
  role: 'user' | 'model';
  text: string;
}

export interface AIReflectionInsight {
  summary: string;
  themes: string[];
  coreThemes: string[];
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

export interface PersistenceStatus {
  status: 'persisted' | 'failed';
  savedAt?: string;
  interactionId?: string;
  threadId?: string;
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

export interface JournalReflectionData {
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
// Milestone 9: Thought Evolution Engine Types (Client)
// ============================================================================

export interface EvolutionDeterministicMetrics {
  totalInteractionsAnalyzed: number;
  totalThreadsAnalyzed: number;
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

export interface EvolvingThemePattern {
  theme: string;
  trajectory: 'emerging' | 'deepening' | 'shifting' | 'dormant';
  observation: string;
  evidence: EvolutionCitationReference[];
}

export interface IdeaWorthRevisiting {
  title: string;
  context: string;
  evidence: EvolutionCitationReference;
  openQuestion: string;
}

export interface EvolutionAIInsights {
  overallSynthesis: string;
  evolvingPatterns: EvolvingThemePattern[];
  unresolvedQuestions: string[];
  ideasWorthRevisiting: IdeaWorthRevisiting[];
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
// Milestone 10: Ask My Journal Types (Client)
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

// ============================================================================
// Milestone 10.6: Personal Journal Insights Types (Client-Safe)
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
  aiInsight?: string;
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
  aiInsight?: string;
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
  aiInsight?: string;
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
  aiInsight?: string;
}

export interface InsightEvidenceReference {
  interactionId: string;
  threadId: string;
  threadTitle: string;
  date: string;
  excerpt: string;
}

export interface PersonalInsightsResponse {
  status: 'ready' | 'insufficient_history';
  coverage: InsightCoverageFacts;
  narrativeSummary: string;
  themeTrajectories: InsightThemeTrajectory[];
  recurringPatterns: InsightPattern[];
  repeatedActionItems: InsightGoal[];
  repeatedOpenQuestions: InsightOpenQuestion[];
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

