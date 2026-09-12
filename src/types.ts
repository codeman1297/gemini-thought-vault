/**
 * Client-Side Types for Gemini ThoughtVault
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

export interface JournalReflectionData {
  userPrompt: string;
  geminiResponse: string;
  insights: JournalReflectionInsights;
  modelMetadata: ModelMetadata;
  timestamp: string;
}

export interface JournalInteractionItem {
  id: string;
  userPrompt: string;
  geminiResponse: string;
  insights: JournalReflectionInsights;
  modelMetadata: ModelMetadata;
  timestamp: string;
}
