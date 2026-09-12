/**
 * Server-Side Journal Persistence Service (Cloud Firestore)
 * 
 * Production Security Rules:
 * 1. Absolute User Isolation: All queries and document paths are scoped strictly under /users/${trustedUid}.
 * 2. Never accepts client-provided userId as an identity source.
 * 3. Never performs global or collection-group lookups.
 * 4. Idempotency: Uses clientInteractionId as document key to prevent duplicate writes.
 * 5. Strips all undefined fields prior to Firestore persistence.
 * 6. Zero journal text in server logs.
 */

import { getDb, stripUndefined, Timestamp } from '../lib/firestore';
import type { 
  JournalThread, 
  JournalInteraction, 
  ConversationTurn,
  JournalReflectionInsights,
  ModelMetadata,
  RetrySaveRequestBody
} from '../types';

/**
 * Lists threads owned exclusively by the authenticated user.
 * Path: /users/${uid}/threads
 */
export async function listUserThreads(uid: string, limitCount = 30): Promise<JournalThread[]> {
  if (!uid) {
    throw new Error('Unauthorized: Missing authenticated UID context.');
  }

  const db = getDb();
  const threadsRef = db.collection(`users/${uid}/threads`);
  const snapshot = await threadsRef
    .orderBy('updatedAt', 'desc')
    .limit(Math.min(limitCount, 50))
    .get();

  const threads: JournalThread[] = [];
  for (const doc of snapshot.docs) {
    const data = doc.data();
    threads.push({
      id: doc.id,
      userId: uid,
      title: data.title || 'Untitled Reflection',
      previewSnippet: data.previewSnippet || '',
      turnCount: typeof data.turnCount === 'number' ? data.turnCount : 0,
      coreThemes: Array.isArray(data.coreThemes) ? data.coreThemes : [],
      createdAt: data.createdAt instanceof Timestamp ? data.createdAt.toDate().toISOString() : (data.createdAt || new Date().toISOString()),
      updatedAt: data.updatedAt instanceof Timestamp ? data.updatedAt.toDate().toISOString() : (data.updatedAt || new Date().toISOString()),
      lastInteractionId: data.lastInteractionId,
      status: data.status === 'archived' ? 'archived' : 'active',
    });
  }

  return threads;
}

/**
 * Retrieves a single thread belonging to the authenticated user.
 * Returns null if the thread does not exist under this user.
 * Path: /users/${uid}/threads/${threadId}
 */
export async function getUserThread(uid: string, threadId: string): Promise<JournalThread | null> {
  if (!uid || !threadId) return null;

  const db = getDb();
  const docRef = db.doc(`users/${uid}/threads/${threadId}`);
  const doc = await docRef.get();

  if (!doc.exists) {
    return null;
  }

  const data = doc.data();
  if (!data) return null;

  return {
    id: doc.id,
    userId: uid,
    title: data.title || 'Untitled Reflection',
    previewSnippet: data.previewSnippet || '',
    turnCount: typeof data.turnCount === 'number' ? data.turnCount : 0,
    coreThemes: Array.isArray(data.coreThemes) ? data.coreThemes : [],
    createdAt: data.createdAt instanceof Timestamp ? data.createdAt.toDate().toISOString() : (data.createdAt || new Date().toISOString()),
    updatedAt: data.updatedAt instanceof Timestamp ? data.updatedAt.toDate().toISOString() : (data.updatedAt || new Date().toISOString()),
    lastInteractionId: data.lastInteractionId,
    status: data.status === 'archived' ? 'archived' : 'active',
  };
}

/**
 * Loads authoritative interactions for a user thread.
 * Ordered by turnIndex ascending (or createdAt ascending).
 * Path: /users/${uid}/threads/${threadId}/interactions
 */
export async function getThreadInteractions(
  uid: string, 
  threadId: string, 
  maxCount = 50
): Promise<JournalInteraction[]> {
  if (!uid || !threadId) return [];

  const db = getDb();
  const interactionsRef = db.collection(`users/${uid}/threads/${threadId}/interactions`);
  const snapshot = await interactionsRef
    .orderBy('turnIndex', 'asc')
    .limit(maxCount)
    .get();

  const interactions: JournalInteraction[] = [];
  for (const doc of snapshot.docs) {
    const data = doc.data();
    interactions.push({
      id: doc.id,
      threadId,
      userId: uid,
      turnIndex: typeof data.turnIndex === 'number' ? data.turnIndex : 0,
      userPrompt: data.userPrompt || '',
      geminiResponse: data.geminiResponse || '',
      insights: {
        coreThemes: Array.isArray(data.insights?.coreThemes) ? data.insights.coreThemes : [],
        openQuestions: Array.isArray(data.insights?.openQuestions) ? data.insights.openQuestions : [],
      },
      modelMetadata: {
        modelUsed: data.modelMetadata?.modelUsed || 'unknown',
        fallbackUsed: Boolean(data.modelMetadata?.fallbackUsed),
        attemptsCount: typeof data.modelMetadata?.attemptsCount === 'number' ? data.modelMetadata.attemptsCount : 1,
        latencyMs: typeof data.modelMetadata?.latencyMs === 'number' ? data.modelMetadata.latencyMs : 0,
      },
      clientInteractionId: data.clientInteractionId,
      createdAt: data.createdAt instanceof Timestamp ? data.createdAt.toDate().toISOString() : (data.createdAt || new Date().toISOString()),
    });
  }

  return interactions;
}

/**
 * Converts authoritative stored interactions into ConversationTurn format for Gemini.
 */
export async function loadAuthoritativeGeminiHistory(
  uid: string, 
  threadId: string, 
  limitTurns = 10
): Promise<ConversationTurn[]> {
  const interactions = await getThreadInteractions(uid, threadId, limitTurns);
  const turns: ConversationTurn[] = [];

  for (const item of interactions) {
    if (item.userPrompt) {
      turns.push({ role: 'user', text: item.userPrompt });
    }
    if (item.geminiResponse) {
      turns.push({ role: 'model', text: item.geminiResponse });
    }
  }

  // Return the most recent turns up to limitTurns * 2 (turns are user+model pairs)
  return turns.slice(-(limitTurns * 2));
}

/**
 * Checks if an interaction with clientInteractionId already exists in this thread (Idempotency).
 */
export async function checkInteractionExists(
  uid: string, 
  threadId: string, 
  clientInteractionId: string
): Promise<JournalInteraction | null> {
  if (!uid || !threadId || !clientInteractionId) return null;

  const db = getDb();
  const docRef = db.doc(`users/${uid}/threads/${threadId}/interactions/${clientInteractionId}`);
  const doc = await docRef.get();

  if (!doc.exists) return null;

  const data = doc.data();
  if (!data) return null;

  return {
    id: doc.id,
    threadId,
    userId: uid,
    turnIndex: typeof data.turnIndex === 'number' ? data.turnIndex : 0,
    userPrompt: data.userPrompt || '',
    geminiResponse: data.geminiResponse || '',
    insights: {
      coreThemes: Array.isArray(data.insights?.coreThemes) ? data.insights.coreThemes : [],
      openQuestions: Array.isArray(data.insights?.openQuestions) ? data.insights.openQuestions : [],
    },
    modelMetadata: {
      modelUsed: data.modelMetadata?.modelUsed || 'unknown',
      fallbackUsed: Boolean(data.modelMetadata?.fallbackUsed),
      attemptsCount: typeof data.modelMetadata?.attemptsCount === 'number' ? data.modelMetadata.attemptsCount : 1,
      latencyMs: typeof data.modelMetadata?.latencyMs === 'number' ? data.modelMetadata.latencyMs : 0,
    },
    clientInteractionId: data.clientInteractionId,
    createdAt: data.createdAt instanceof Timestamp ? data.createdAt.toDate().toISOString() : (data.createdAt || new Date().toISOString()),
  };
}

/**
 * Creates a new user-owned thread in Firestore.
 * Path: /users/${uid}/threads/${threadId}
 */
export async function createThread(
  uid: string, 
  options: {
    title?: string;
    previewSnippet?: string;
    threadId?: string;
  } = {}
): Promise<JournalThread> {
  if (!uid) {
    throw new Error('Unauthorized: Missing authenticated UID context.');
  }

  const db = getDb();
  const threadId = options.threadId || `thread_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const threadRef = db.doc(`users/${uid}/threads/${threadId}`);

  const now = Timestamp.now();
  const threadData = stripUndefined({
    id: threadId,
    userId: uid,
    title: (options.title && options.title.trim()) ? options.title.trim().slice(0, 100) : 'New Thought Thread',
    previewSnippet: (options.previewSnippet && options.previewSnippet.trim()) ? options.previewSnippet.trim().slice(0, 150) : '',
    turnCount: 0,
    coreThemes: [],
    createdAt: now,
    updatedAt: now,
    status: 'active',
  });

  await threadRef.set(threadData);

  return {
    id: threadId,
    userId: uid,
    title: threadData.title,
    previewSnippet: threadData.previewSnippet,
    turnCount: 0,
    coreThemes: [],
    createdAt: now.toDate().toISOString(),
    updatedAt: now.toDate().toISOString(),
    status: 'active',
  };
}

/**
 * Persists an interaction and atomically updates thread summary metadata.
 * Path: /users/${uid}/threads/${threadId}/interactions/${interactionId}
 */
export async function persistInteraction({
  uid,
  threadId,
  userPrompt,
  geminiResponse,
  insights,
  modelMetadata,
  clientInteractionId,
  turnIndex,
}: {
  uid: string;
  threadId: string;
  userPrompt: string;
  geminiResponse: string;
  insights: JournalReflectionInsights;
  modelMetadata: ModelMetadata;
  clientInteractionId?: string;
  turnIndex: number;
}): Promise<JournalInteraction> {
  if (!uid || !threadId) {
    throw new Error('Missing required user or thread identifiers for persistence.');
  }

  const db = getDb();
  const interactionId = clientInteractionId || `int_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  
  const interactionRef = db.doc(`users/${uid}/threads/${threadId}/interactions/${interactionId}`);
  const threadRef = db.doc(`users/${uid}/threads/${threadId}`);

  const now = Timestamp.now();

  const rawInteractionPayload = {
    id: interactionId,
    threadId,
    userId: uid,
    turnIndex,
    userPrompt,
    geminiResponse,
    insights: {
      coreThemes: Array.isArray(insights.coreThemes) ? insights.coreThemes.slice(0, 5) : [],
      openQuestions: Array.isArray(insights.openQuestions) ? insights.openQuestions.slice(0, 3) : [],
    },
    modelMetadata: {
      modelUsed: modelMetadata.modelUsed,
      fallbackUsed: modelMetadata.fallbackUsed,
      attemptsCount: modelMetadata.attemptsCount,
      latencyMs: modelMetadata.latencyMs,
    },
    clientInteractionId: clientInteractionId || undefined,
    createdAt: now,
  };

  const interactionPayload = stripUndefined(rawInteractionPayload);

  // Use batch write for atomic consistency
  const batch = db.batch();
  batch.set(interactionRef, interactionPayload, { merge: true });

  // Update parent thread metadata
  const existingThread = await getUserThread(uid, threadId);
  const updatedThemes = Array.from(
    new Set([...(existingThread?.coreThemes || []), ...(insights.coreThemes || [])])
  ).slice(0, 10);

  const threadUpdatePayload = stripUndefined({
    turnCount: turnIndex + 1,
    updatedAt: now,
    lastInteractionId: interactionId,
    coreThemes: updatedThemes,
    // If opening turn and thread had empty preview, update previewSnippet
    ...(turnIndex === 0 ? { previewSnippet: userPrompt.slice(0, 150) } : {}),
  });

  batch.update(threadRef, threadUpdatePayload);

  await batch.commit();

  return {
    id: interactionId,
    threadId,
    userId: uid,
    turnIndex,
    userPrompt,
    geminiResponse,
    insights: interactionPayload.insights,
    modelMetadata: interactionPayload.modelMetadata,
    clientInteractionId,
    createdAt: now.toDate().toISOString(),
  };
}

/**
 * Handles explicit "Retry Save" requests from the client.
 * Persists previously generated reflection content without re-invoking Gemini.
 */
export async function retrySaveInteraction(
  uid: string, 
  payload: RetrySaveRequestBody
): Promise<JournalInteraction> {
  const { threadId, clientInteractionId, userPrompt, geminiResponse, insights, modelMetadata } = payload;

  const thread = await getUserThread(uid, threadId);
  if (!thread) {
    throw new Error('Thread not found or unauthorized.');
  }

  // Calculate turn index based on existing interactions
  const existingInteractions = await getThreadInteractions(uid, threadId);
  const turnIndex = existingInteractions.length;

  return persistInteraction({
    uid,
    threadId,
    userPrompt,
    geminiResponse,
    insights,
    modelMetadata,
    clientInteractionId,
    turnIndex,
  });
}
