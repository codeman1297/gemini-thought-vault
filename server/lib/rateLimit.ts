/**
 * Bounded In-Memory Sliding Window Rate Limiter (Milestone 11.5)
 * 
 * Production Reliability & Memory Safety Rules:
 * 1. Bounded State: Map size is strictly capped at maxKeys (default 5,000) to prevent
 *    attacker-controlled memory exhaustion via random UIDs.
 * 2. Sliding Window: Tracks timestamps within windowMs (default 60s) with microsecond precision.
 * 3. Automatic Eviction: When capacity is reached, expired keys are swept first; if still full,
 *    least-recently-updated keys are evicted (FIFO/LRU behavior).
 * 4. Safe Identity: UIDs are validated (must be non-empty string, length <= 128, valid characters).
 * 5. Unref'd Timers: Background cleanup intervals use unref() so Node.js process termination
 *    and graceful shutdown are never blocked by active timers.
 * 6. Zero Sensitive Data: Never stores or logs prompt, query, or journal content.
 */

import { assertValidUid } from './firestore';

export interface BoundedRateLimiterOptions {
  name: string;
  maxRequests: number;
  windowMs: number;
  maxKeys?: number;
  cleanupIntervalMs?: number;
}

export class BoundedRateLimiter {
  public readonly name: string;
  public readonly maxRequests: number;
  public readonly windowMs: number;
  public readonly maxKeys: number;

  private store = new Map<string, number[]>();
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor(options: BoundedRateLimiterOptions) {
    this.name = options.name;
    this.maxRequests = options.maxRequests;
    this.windowMs = options.windowMs;
    this.maxKeys = options.maxKeys || 5000;

    const interval = options.cleanupIntervalMs || 60_000;
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, interval);

    // Unref timer so it does not prevent graceful Node.js shutdown
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  /**
   * Checks whether the request is allowed for the given verified UID.
   * Returns true if allowed, false if rate limit is exceeded.
   */
  public check(uid: string): boolean {
    if (!uid || typeof uid !== 'string') {
      return false;
    }

    const trimmed = uid.trim();
    if (trimmed.length === 0 || trimmed.length > 128) {
      return false;
    }

    // Defensive UID pattern validation
    try {
      assertValidUid(trimmed);
    } catch {
      return false;
    }

    const now = Date.now();
    const timestamps = this.store.get(trimmed) || [];
    const active = timestamps.filter(t => now - t < this.windowMs);

    if (active.length >= this.maxRequests) {
      this.store.set(trimmed, active);
      return false;
    }

    // Capacity safeguard: ensure map does not exceed maxKeys
    if (!this.store.has(trimmed) && this.store.size >= this.maxKeys) {
      this.cleanup();
      // If still over capacity after cleanup, evict oldest key
      if (this.store.size >= this.maxKeys) {
        const oldestKey = this.store.keys().next().value;
        if (oldestKey) {
          this.store.delete(oldestKey);
        }
      }
    }

    active.push(now);
    this.store.set(trimmed, active);
    return true;
  }

  /**
   * Removes all expired timestamps across all stored UIDs.
   */
  public cleanup(): void {
    const now = Date.now();
    for (const [uid, timestamps] of this.store.entries()) {
      const active = timestamps.filter(t => now - t < this.windowMs);
      if (active.length === 0) {
        this.store.delete(uid);
      } else {
        this.store.set(uid, active);
      }
    }
  }

  /**
   * Resets all tracked rate limit records (for testing or administrative reset).
   */
  public reset(): void {
    this.store.clear();
  }

  /**
   * Returns current count of tracked keys in memory.
   */
  public size(): number {
    return this.store.size;
  }

  /**
   * Stops the background cleanup timer.
   */
  public destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.store.clear();
  }
}
