/**
 * Client API Layer for Gemini ThoughtVault
 * Milestone 5: Persistent Journal Threads, Authoritative History, & Retry Save
 * 
 * Production Security Rules:
 * 1. Attaches fresh Firebase ID token via Authorization: Bearer <id_token>.
 * 2. Never transmits client-specified user IDs.
 * 3. Preserves pending persistence records on database failures to power Retry Save.
 */

import { auth } from './firebase';
import type { 
  JournalThread, 
  JournalInteraction, 
  JournalReflectionData, 
  PendingPersistenceRecord,
  PersistenceStatus
} from '../types';

async function getAuthToken(): Promise<string> {
  const currentUser = auth?.currentUser;
  if (!currentUser) {
    throw new Error('Authentication required. Please sign in to access your ThoughtVault.');
  }
  return currentUser.getIdToken();
}

/**
 * Lists all journal threads owned by the authenticated user.
 */
export async function listJournalThreads(): Promise<JournalThread[]> {
  const token = await getAuthToken();

  const response = await fetch('/api/journal/threads', {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
    },
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || 'Failed to load journal threads.');
  }

  return payload.threads || [];
}

/**
 * Retrieves a single thread and its authoritative chronological interactions.
 */
export async function getJournalThread(threadId: string): Promise<{
  thread: JournalThread;
  interactions: JournalInteraction[];
}> {
  const token = await getAuthToken();

  const response = await fetch(`/api/journal/threads/${encodeURIComponent(threadId)}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
    },
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new Error(payload.error || 'Failed to load thread details.');
    (err as unknown as { code: string }).code = payload.code || 'FETCH_FAILED';
    throw err;
  }

  return {
    thread: payload.thread,
    interactions: payload.interactions || [],
  };
}

/**
 * Creates a new journal thread, optionally generating an initial reflection.
 */
export async function createJournalThread(data: {
  title?: string;
  prompt?: string;
  clientInteractionId?: string;
}): Promise<{
  thread: JournalThread;
  interaction?: JournalInteraction;
  persistence?: PersistenceStatus;
}> {
  const token = await getAuthToken();

  const response = await fetch('/api/journal/threads', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(data),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || 'Failed to create journal thread.');
  }

  return {
    thread: payload.thread,
    interaction: payload.interaction,
    persistence: payload.persistence,
  };
}

/**
 * Sends a reflection prompt within an existing or new thread.
 * Authoritative history is loaded server-side from Firestore.
 */
export async function sendJournalReflection({
  threadId,
  prompt,
  clientInteractionId,
}: {
  threadId?: string;
  prompt: string;
  clientInteractionId?: string;
}): Promise<JournalReflectionData> {
  const token = await getAuthToken();

  const response = await fetch('/api/journal/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      threadId,
      prompt,
      clientInteractionId,
    }),
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const errorMessage = payload.error || `Server responded with status ${response.status}`;
    const error = new Error(errorMessage);
    const customErr = error as unknown as { 
      code: string; 
      pendingRecord?: PendingPersistenceRecord 
    };
    customErr.code = payload.code || 'REQUEST_FAILED';
    if (payload.pendingRecord) {
      customErr.pendingRecord = payload.pendingRecord;
    }
    throw error;
  }

  return payload.data;
}

/**
 * Retries saving an interaction that succeeded in AI generation but failed in database persistence.
 */
export async function retrySaveInteraction(pendingRecord: {
  threadId: string;
  clientInteractionId: string;
  userPrompt: string;
  geminiResponse: string;
  insights: { coreThemes: string[]; openQuestions: string[] };
  modelMetadata: { modelUsed: string; fallbackUsed: boolean; attemptsCount: number; latencyMs: number };
}): Promise<{ interaction: JournalInteraction; persistence: PersistenceStatus }> {
  const token = await getAuthToken();

  const response = await fetch('/api/journal/retry-save', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(pendingRecord),
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error || 'Retry save failed. Please check your network.');
  }

  return {
    interaction: payload.interaction,
    persistence: payload.persistence,
  };
}
