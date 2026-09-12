/**
 * Client API Layer for Gemini ThoughtVault
 * 
 * Production Security Rules:
 * 1. Attaches fresh Firebase ID token via Authorization: Bearer <id_token>.
 * 2. Never transmits client-specified user IDs.
 * 3. Handles non-200 responses safely without exposing raw network internals.
 */

import { auth } from './firebase';
import type { ConversationTurn, JournalReflectionData } from '../types';

export async function sendJournalReflection({
  prompt,
  history = [],
}: {
  prompt: string;
  history?: ConversationTurn[];
}): Promise<JournalReflectionData> {
  const currentUser = auth?.currentUser;
  if (!currentUser) {
    throw new Error('Authentication required. Please sign in to reflect with Gemini.');
  }

  // Retrieve fresh Firebase ID token (auto-refreshes if close to 1-hour expiry)
  const idToken = await currentUser.getIdToken();

  const response = await fetch('/api/journal/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${idToken}`,
    },
    body: JSON.stringify({
      prompt,
      history,
    }),
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const errorMessage = payload.error || `Server responded with status ${response.status}`;
    const error = new Error(errorMessage);
    (error as unknown as { code: string }).code = payload.code || 'REQUEST_FAILED';
    throw error;
  }

  return payload.data;
}
