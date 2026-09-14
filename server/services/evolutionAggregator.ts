/**
 * Thought Evolution Deterministic History Aggregator & Canonical Hasher
 * 
 * Production Security Rules:
 * 1. Admin SDK queries are strictly scoped under /users/${uid}.
 * 2. Strict global ceiling: Max 25 interactions total (sampled up to 5 from up to 10 active threads).
 * 3. All quantitative metrics (counts, date ranges, theme frequencies, days elapsed) are computed
 *    deterministically by server TypeScript code. Gemini is never allowed to fabricate these numbers.
 * 4. Canonical hashing hashes structured fields only (zero raw journal text).
 */

import { createHash } from 'crypto';
import { getDb, Timestamp } from '../lib/firestore';
import type { 
  BoundedCandidate, 
  EvolutionDeterministicMetrics 
} from '../types';

/**
 * Collects bounded historical candidates across active threads.
 * Sampling Strategy:
 * - Query up to 10 active threads ordered by updatedAt descending.
 * - Retrieve up to 5 newest interactions from EACH thread (up to 50 candidates).
 * - Globally sort candidates by createdAt descending.
 * - Slice the newest maximum 25 interactions total.
 * - Chronologically sort the selected set ascending for timeline continuity.
 */
export async function collectBoundedHistory(uid: string): Promise<{
  candidates: BoundedCandidate[];
  totalActiveThreads: number;
}> {
  if (!uid) {
    throw new Error('Unauthorized: Missing authenticated UID context.');
  }

  const db = getDb();

  // Query up to 10 active threads
  const threadsSnap = await db
    .collection(`users/${uid}/threads`)
    .where('status', '==', 'active')
    .orderBy('updatedAt', 'desc')
    .limit(10)
    .get();

  const totalActiveThreads = threadsSnap.docs.length;
  const rawCandidates: BoundedCandidate[] = [];

  for (const threadDoc of threadsSnap.docs) {
    const threadData = threadDoc.data();
    const threadTitle = typeof threadData.title === 'string' && threadData.title.trim() 
      ? threadData.title.trim().slice(0, 100) 
      : 'Untitled Reflection';

    const interactionsSnap = await db
      .collection(`users/${uid}/threads/${threadDoc.id}/interactions`)
      .orderBy('turnIndex', 'desc')
      .limit(5)
      .get();

    for (const iDoc of interactionsSnap.docs) {
      const data = iDoc.data();
      const createdAtIso = data.createdAt instanceof Timestamp 
        ? data.createdAt.toDate().toISOString() 
        : (typeof data.createdAt === 'string' ? data.createdAt : new Date().toISOString());

      const themes = Array.isArray(data.insights?.themes) 
        ? data.insights.themes 
        : (Array.isArray(data.insights?.coreThemes) ? data.insights.coreThemes : []);

      rawCandidates.push({
        interactionId: iDoc.id,
        threadId: threadDoc.id,
        threadTitle,
        createdAt: createdAtIso,
        userPrompt: typeof data.userPrompt === 'string' ? data.userPrompt.slice(0, 500) : '',
        summary: typeof data.insights?.summary === 'string' ? data.insights.summary.slice(0, 300) : '',
        themes: themes.filter((t: unknown) => typeof t === 'string').map((t: string) => t.slice(0, 40)),
        openQuestions: Array.isArray(data.insights?.openQuestions) 
          ? data.insights.openQuestions.filter((q: unknown) => typeof q === 'string').map((q: string) => q.slice(0, 120))
          : [],
      });
    }
  }

  // Globally sort candidates by createdAt DESCENDING (newest first)
  rawCandidates.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  // Global ceiling: Slice up to 25 newest interactions
  const newest25 = rawCandidates.slice(0, 25);

  // Chronologically sort ASCENDING (oldest to newest) for timeline progression
  newest25.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  return {
    candidates: newest25,
    totalActiveThreads,
  };
}

/**
 * Deterministically computes verified facts from the bounded candidates.
 * Gemini is NEVER allowed to invent or alter these values.
 */
export function computeDeterministicMetrics(
  candidates: BoundedCandidate[],
  totalActiveThreads: number
): EvolutionDeterministicMetrics {
  if (candidates.length === 0) {
    const nowIso = new Date().toISOString();
    return {
      totalInteractionsAnalyzed: 0,
      totalThreadsAnalyzed: 0,
      dateRange: {
        firstInteractionDate: nowIso,
        lastInteractionDate: nowIso,
      },
      topThemesByFrequency: [],
      daysSinceLastJournal: 0,
    };
  }

  const distinctThreads = new Set(candidates.map(c => c.threadId));
  const firstDate = candidates[0].createdAt;
  const lastDate = candidates[candidates.length - 1].createdAt;

  // Theme frequency aggregation
  const themeMap = new Map<string, { count: number; threadIds: Set<string> }>();
  for (const c of candidates) {
    for (const theme of c.themes) {
      const normalized = theme.trim();
      if (!normalized) continue;
      const existing = themeMap.get(normalized) || { count: 0, threadIds: new Set<string>() };
      existing.count += 1;
      existing.threadIds.add(c.threadId);
      themeMap.set(normalized, existing);
    }
  }

  const topThemesByFrequency = Array.from(themeMap.entries())
    .map(([theme, data]) => ({
      theme,
      count: data.count,
      threadIds: Array.from(data.threadIds),
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8); // Top 8 themes

  const lastInteractionMillis = new Date(lastDate).getTime();
  const nowMillis = Date.now();
  const diffDays = Math.max(0, Math.floor((nowMillis - lastInteractionMillis) / (1000 * 60 * 60 * 24)));

  return {
    totalInteractionsAnalyzed: candidates.length,
    totalThreadsAnalyzed: distinctThreads.size,
    dateRange: {
      firstInteractionDate: firstDate,
      lastInteractionDate: lastDate,
    },
    topThemesByFrequency,
    daysSinceLastJournal: diffDays,
  };
}

/**
 * Computes canonical SHA-256 content hash over structured historical fields.
 * Used for deterministic cache validation without hashing raw journal text.
 */
export function computeCanonicalContentHash(candidates: BoundedCandidate[]): string {
  const canonicalEntries = candidates.map(c => ({
    id: c.interactionId,
    threadId: c.threadId,
    createdAt: c.createdAt,
    summary: c.summary.trim(),
    themes: [...c.themes].sort(),
    openQuestions: [...c.openQuestions].map(q => q.trim()),
  }));

  const canonicalJson = JSON.stringify(canonicalEntries);
  return createHash('sha256').update(canonicalJson).digest('hex');
}
