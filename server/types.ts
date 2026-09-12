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
