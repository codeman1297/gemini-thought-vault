/**
 * Client-Side Types for Gemini ThoughtVault
 * Milestone 5: Persistent Journal Threads & Firestore Sync
 */

export interface ConversationTurn {
  role: 'user' | 'model';
  text: string;
}

export interface JournalReflectionInsights {
  coreThemes: string[];
  openQuestions: string[];
}

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
