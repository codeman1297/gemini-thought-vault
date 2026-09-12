/**
 * Server-Side Types for Gemini ThoughtVault
 * Milestone 4: Authenticated Gemini Interaction Layer
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

export interface JournalChatRequestBody {
  prompt?: string;
  history?: ConversationTurn[];
}

export interface JournalReflectionInsights {
  coreThemes: string[];
  openQuestions: string[];
}

export interface JournalChatResponsePayload {
  userPrompt: string;
  geminiResponse: string;
  insights: JournalReflectionInsights;
  modelMetadata: {
    modelUsed: string;
    fallbackUsed: boolean;
    attemptsCount: number;
    latencyMs: number;
  };
  timestamp: string;
}
