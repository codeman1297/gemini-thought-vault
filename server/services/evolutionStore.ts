/**
 * Thought Evolution Firestore Store (Milestone 9)
 * 
 * Production Security Rules:
 * 1. Admin SDK scopes all operations strictly to /users/${uid}/evolution/latest.
 * 2. Pre-commit fencing: Verifies lock ownership before writing results to prevent stale overwrites.
 * 3. Sanitizes all undefined values prior to Firestore writes.
 * 4. Zero raw journal snippets stored in evolution documents.
 * 5. Dynamic evidence resolution: Fetches supporting interaction text on-demand from current Firestore data.
 */

import { getDb, stripUndefined, Timestamp, assertValidUid, assertValidId } from '../lib/firestore';
import { verifyLockOwnership } from './evolutionLock';
import type { ThoughtEvolutionDocument } from '../types';

/**
 * Retrieves the user's latest Thought Evolution document.
 * Returns null if no evolution has been computed yet.
 */
export async function getLatestEvolution(uid: string): Promise<ThoughtEvolutionDocument | null> {
  assertValidUid(uid);

  const db = getDb();
  const docRef = db.doc(`users/${uid}/evolution/latest`);
  const snap = await docRef.get();

  if (!snap.exists) {
    return null;
  }

  const data = snap.data();
  if (!data) return null;

  return {
    id: 'latest',
    userId: uid,
    status: data.status || 'ready',
    generatedAt: data.generatedAt instanceof Timestamp 
      ? data.generatedAt.toDate().toISOString() 
      : (typeof data.generatedAt === 'string' ? data.generatedAt : new Date().toISOString()),
    metrics: data.metrics || {
      totalInteractionsAnalyzed: 0,
      totalThreadsAnalyzed: 0,
      dateRange: { firstInteractionDate: '', lastInteractionDate: '' },
      topThemesByFrequency: [],
      daysSinceLastJournal: 0,
    },
    insights: data.insights,
    modelMetadata: data.modelMetadata,
    contentHash: data.contentHash || '',
    message: data.message,
  };
}

/**
 * Persists the Thought Evolution document to /users/${uid}/evolution/latest.
 * Performs pre-commit fencing verification if lockId is provided.
 */
export async function saveEvolutionDocument(
  uid: string,
  document: ThoughtEvolutionDocument,
  lockId?: string
): Promise<boolean> {
  assertValidUid(uid);

  // Pre-commit fencing check: ensure caller still owns the active lock
  if (lockId) {
    const isOwner = await verifyLockOwnership(uid, lockId);
    if (!isOwner) {
      console.warn(`[EVOLUTION ABORT] Stale request (lockId ${lockId}) attempted to persist after lock reclamation.`);
      return false;
    }
  }

  const db = getDb();
  const docRef = db.doc(`users/${uid}/evolution/latest`);

  const payload: Record<string, unknown> = {
    userId: uid,
    status: document.status,
    generatedAt: Timestamp.now(),
    metrics: document.metrics,
    contentHash: document.contentHash,
  };

  // Only include insights and modelMetadata if status === 'ready'
  if (document.status === 'ready' && document.insights) {
    payload.insights = document.insights;
  }
  if (document.status === 'ready' && document.modelMetadata) {
    payload.modelMetadata = document.modelMetadata;
  }
  if (document.message) {
    payload.message = document.message;
  }

  const cleanPayload = stripUndefined(payload);
  await docRef.set(cleanPayload, { merge: false });
  return true;
}

/**
 * Dynamically resolves supporting interaction evidence from current Firestore data.
 * If the user has deleted the interaction or thread, returns a graceful unavailable message.
 */
export async function getSupportingInteractionEvidence(
  uid: string,
  threadId: string,
  interactionId: string
): Promise<{
  available: boolean;
  interactionId: string;
  threadId: string;
  threadTitle?: string;
  userPrompt?: string;
  geminiResponse?: string;
  summary?: string;
  date?: string;
  message?: string;
}> {
  if (!uid || !threadId || !interactionId) {
    return {
      available: false,
      interactionId: interactionId || '',
      threadId: threadId || '',
      message: 'This supporting thought is no longer available.',
    };
  }

  assertValidUid(uid);
  assertValidId(threadId, 'threadId');
  assertValidId(interactionId, 'interactionId');

  const db = getDb();

  try {
    // 1. Check thread existence and ownership
    const threadRef = db.doc(`users/${uid}/threads/${threadId}`);
    const threadSnap = await threadRef.get();
    if (!threadSnap.exists) {
      return {
        available: false,
        interactionId,
        threadId,
        message: 'This supporting thought is no longer available (thread archived or deleted).',
      };
    }

    const threadTitle = threadSnap.data()?.title || 'Untitled Reflection';

    // 2. Check interaction existence
    const interactionRef = db.doc(`users/${uid}/threads/${threadId}/interactions/${interactionId}`);
    const interactionSnap = await interactionRef.get();
    if (!interactionSnap.exists) {
      return {
        available: false,
        interactionId,
        threadId,
        threadTitle,
        message: 'This supporting thought is no longer available.',
      };
    }

    const data = interactionSnap.data() || {};
    const dateIso = data.createdAt instanceof Timestamp 
      ? data.createdAt.toDate().toISOString() 
      : (typeof data.createdAt === 'string' ? data.createdAt : undefined);

    return {
      available: true,
      interactionId,
      threadId,
      threadTitle,
      userPrompt: typeof data.userPrompt === 'string' ? data.userPrompt : '',
      geminiResponse: typeof data.geminiResponse === 'string' ? data.geminiResponse : '',
      summary: data.insights?.summary || '',
      date: dateIso,
    };
  } catch {
    return {
      available: false,
      interactionId,
      threadId,
      message: 'This supporting thought is no longer available.',
    };
  }
}
