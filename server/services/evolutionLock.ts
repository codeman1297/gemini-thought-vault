/**
 * Distributed Transactional Concurrency Lock for Thought Evolution (Milestone 9)
 * 
 * Production Security Rules:
 * 1. Admin SDK performs lock operations inside atomic Firestore transactions.
 * 2. Scope is strictly user-isolated: /users/${uid}/evolution/lock.
 * 3. Lock duration: 90 seconds TTL (safe for multi-model fallback ladder).
 * 4. Lock acquisition is atomic; concurrent attempts encounter HTTP 409 ANALYSIS_IN_PROGRESS.
 * 5. Fencing Token: Unique UUID v4 lockId ensures only the active lock owner can commit or release.
 * 6. Stale/expired lock reclaim: If expired, the next request safely reclaims the lock.
 * 7. Stale requests cannot release or overwrite a newer request's lock.
 */

import { randomUUID } from 'crypto';
import { getDb, Timestamp, assertValidUid } from '../lib/firestore';

export const EVOLUTION_LOCK_TTL_MS = 90_000; // 90 seconds safe lease

export class EvolutionLockConflictError extends Error {
  constructor(message = 'Thought Evolution analysis is already in progress.') {
    super(message);
    this.name = 'EvolutionLockConflictError';
  }
}

/**
 * Atomically attempts to acquire the distributed evolution lock.
 * Returns the acquired lockId fencing token.
 * Throws EvolutionLockConflictError if an unexpired lock is held.
 */
export async function acquireEvolutionLock(
  uid: string, 
  ttlMs: number = EVOLUTION_LOCK_TTL_MS
): Promise<string> {
  assertValidUid(uid);

  const db = getDb();
  const lockRef = db.doc(`users/${uid}/evolution/lock`);
  const lockId = randomUUID();

  return await db.runTransaction(async (transaction) => {
    const snap = await transaction.get(lockRef);
    const now = Date.now();

    if (snap.exists) {
      const data = snap.data();
      if (data && data.status === 'generating') {
        const expiresAtMillis = data.expiresAt instanceof Timestamp 
          ? data.expiresAt.toMillis() 
          : (typeof data.expiresAt === 'number' ? data.expiresAt : 0);

        // If lock is still active and not expired, reject with conflict
        if (now < expiresAtMillis) {
          throw new EvolutionLockConflictError(
            'Thought Evolution analysis is already in progress. Please wait for the current analysis to finish.'
          );
        }
      }
    }

    // Lock is either uninitialized, idle, or expired -> safe to acquire/reclaim
    const nowTimestamp = Timestamp.fromMillis(now);
    const expiresTimestamp = Timestamp.fromMillis(now + ttlMs);

    transaction.set(lockRef, {
      status: 'generating',
      lockId,
      lockedAt: nowTimestamp,
      expiresAt: expiresTimestamp,
    }, { merge: true });

    return lockId;
  });
}

/**
 * Pre-commit fencing check: verifies that the caller still owns the active lock.
 * Prevents a stale request that completed after the TTL expired from committing
 * results over a newer request that reclaimed the lock.
 */
export async function verifyLockOwnership(uid: string, lockId: string): Promise<boolean> {
  if (!uid || !lockId) return false;
  assertValidUid(uid);

  const db = getDb();
  const lockRef = db.doc(`users/${uid}/evolution/lock`);
  const snap = await lockRef.get();

  if (!snap.exists) return false;
  const data = snap.data();
  return data?.status === 'generating' && data?.lockId === lockId;
}

/**
 * Ownership-safe lock release: only releases the lock if the stored lockId
 * matches the caller's lockId. Runs inside a Firestore transaction.
 */
export async function releaseEvolutionLock(uid: string, lockId: string): Promise<boolean> {
  if (!uid || !lockId) return false;
  assertValidUid(uid);

  const db = getDb();
  const lockRef = db.doc(`users/${uid}/evolution/lock`);

  try {
    return await db.runTransaction(async (transaction) => {
      const snap = await transaction.get(lockRef);
      if (!snap.exists) return false;

      const data = snap.data();
      if (data?.lockId === lockId) {
        transaction.set(lockRef, {
          status: 'idle',
          lockId: '',
          lockedAt: Timestamp.now(),
          expiresAt: Timestamp.now(),
        }, { merge: true });
        return true;
      }

      // Lock was already reclaimed or altered by a newer request; do not touch
      return false;
    });
  } catch (err) {
    // Release failure should not crash the request, but return false
    return false;
  }
}
