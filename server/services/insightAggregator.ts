/**
 * Milestone 10.6: Deterministic Personal Journal Insights Aggregator
 * 
 * Production Security & Mathematical Rules:
 * 1. Root of Trust: Every Firestore query is strictly scoped under /users/${verifiedUid}/...
 * 2. Absolute Server Authority: Gemini NEVER calculates counts, dates, thread counts,
 *    interaction counts, theme frequencies, trajectory classifications, evidence ownership,
 *    coverage, or support tiers. The server calculates all of them deterministically.
 * 3. Bounded Retrieval Budget:
 *    - MAX_THREADS_TO_SCAN = 30
 *    - MAX_INTERACTIONS_TO_SCAN = 150
 *    - MAX_EVIDENCE_TO_GEMINI = 16
 *    - MAX_EXCERPT_LENGTH = 300 characters
 * 4. FULL vs PARTIAL History Semantics:
 *    - FULL_HISTORY_SEARCH requires threadsScanned === totalThreadsInVault AND interactionsScanned === totalInteractionsInVault.
 *    - Otherwise PARTIAL_HISTORY_SEARCH with explicit coverageDisclosure.
 * 5. Deterministic Chronological Partitioning:
 *    - Earlier Period vs Recent Period split by temporal midpoint (or median index fallback).
 *    - Themes categorized as EMERGING, PERSISTENT, DORMANT, or TRANSIENT.
 * 6. Evidence Grounding:
 *    - All evidence citations map to verified interaction documents in the user's namespace.
 * 7. Privacy-First Logging:
 *    - Never logs raw journal entries, prompt prose, or sensitive user reflections.
 */

import { getDb, Timestamp } from '../lib/firestore';
import type {
  InsightRetrievalCoverage,
  InsightSupportTier,
  InsightThemeTrajectoryType,
  InsightCoverageFacts,
  InsightThemeTrajectory,
  InsightPattern,
  InsightGoal,
  InsightOpenQuestion,
  InsightCandidateEvidence,
  InsightDeterministicAggregation,
} from '../types';

// ============================================================================
// Retrieval Bounds & Constants
// ============================================================================

export const MAX_THREADS_TO_SCAN = 30;
export const MAX_INTERACTIONS_TO_SCAN = 150;
export const MAX_EVIDENCE_TO_GEMINI = 16;
export const MAX_EXCERPT_LENGTH = 300;
export const MIN_INTERACTIONS_REQUIRED = 3;
export const TWO_WEEKS_MS = 14 * 24 * 60 * 60 * 1000;

export interface RawScannedInteraction {
  interactionId: string;
  threadId: string;
  threadTitle: string;
  createdAt: string; // ISO string
  createdAtMs: number;
  turnIndex: number;
  userPrompt: string;
  summary?: string;
  themes: string[];
  actionItems: string[];
  openQuestions: string[];
}

export interface AggregatorScanOptions {
  dbOverride?: any;
}

/**
 * Normalizes text for grouping action items and open questions.
 * Lowercases, strips punctuation, collapses whitespace.
 */
export function normalizeJournalText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Deterministically computes the support tier for an insight item based on
 * evidence citation count, thread distribution, and temporal span.
 */
export function computeSupportTier(
  evidenceIds: string[],
  distinctThreadCount: number,
  timeSpanMs: number
): InsightSupportTier {
  if (evidenceIds.length === 0) {
    return 'INSUFFICIENT_EVIDENCE';
  }
  if (evidenceIds.length >= 3 && distinctThreadCount >= 2 && timeSpanMs >= TWO_WEEKS_MS) {
    return 'HIGH_CONFIDENCE';
  }
  if (evidenceIds.length >= 2 && distinctThreadCount >= 1) {
    return 'MODERATE_CONFIDENCE';
  }
  return 'OBSERVATIONAL';
}

/**
 * Deterministically sorts interactions chronologically:
 * 1. createdAt timestamp ascending
 * 2. turnIndex ascending (for same timestamp)
 * 3. interactionId lexicographical ascending (tie-breaker)
 */
export function sortInteractionsChronologically(
  interactions: RawScannedInteraction[]
): RawScannedInteraction[] {
  return [...interactions].sort((a, b) => {
    if (a.createdAtMs !== b.createdAtMs) {
      return a.createdAtMs - b.createdAtMs;
    }
    if (a.turnIndex !== b.turnIndex) {
      return a.turnIndex - b.turnIndex;
    }
    return a.interactionId.localeCompare(b.interactionId);
  });
}

/**
 * Deterministically partitions chronologically sorted interactions into
 * Earlier Period and Recent Period.
 */
export function partitionInteractions(
  sorted: RawScannedInteraction[]
): { earlier: RawScannedInteraction[]; recent: RawScannedInteraction[] } {
  if (sorted.length === 0) {
    return { earlier: [], recent: [] };
  }
  if (sorted.length === 1) {
    return { earlier: sorted, recent: sorted };
  }

  const firstTime = sorted[0].createdAtMs;
  const lastTime = sorted[sorted.length - 1].createdAtMs;

  // If time span exists, split by temporal midpoint
  if (lastTime > firstTime) {
    const midTime = firstTime + (lastTime - firstTime) / 2;
    const earlier = sorted.filter(i => i.createdAtMs < midTime);
    const recent = sorted.filter(i => i.createdAtMs >= midTime);

    // Fall back to median index split if midpoint placed all items into one bucket
    if (earlier.length > 0 && recent.length > 0) {
      return { earlier, recent };
    }
  }

  // Median index partition fallback
  const splitIndex = Math.floor(sorted.length / 2);
  return {
    earlier: sorted.slice(0, splitIndex),
    recent: sorted.slice(splitIndex),
  };
}

/**
 * Scans the authenticated user's Firestore vault and performs the complete
 * deterministic mathematical aggregation for Milestone 10.6 Personal Journal Insights.
 */
export async function aggregatePersonalJournalInsights(
  verifiedUid: string,
  options?: AggregatorScanOptions
): Promise<InsightDeterministicAggregation> {
  if (!verifiedUid || typeof verifiedUid !== 'string' || verifiedUid.trim().length === 0) {
    throw new Error('Unauthorized: Missing authenticated UID context.');
  }
  if (verifiedUid.includes('/') || verifiedUid.includes('..') || verifiedUid.trim() !== verifiedUid) {
    throw new Error('Unauthorized: Invalid UID format.');
  }

  const db = options?.dbOverride || getDb();

  // 1. Fetch all user threads to establish vault totals
  const threadsRef = db.collection(`users/${verifiedUid}/threads`);
  const allThreadsSnap = await threadsRef.orderBy('updatedAt', 'desc').get();

  const totalThreadsInVault = allThreadsSnap.docs.length;
  let totalInteractionsInVault = 0;

  for (const doc of allThreadsSnap.docs) {
    const data = doc.data();
    const count = typeof data.turnCount === 'number' ? data.turnCount : 0;
    totalInteractionsInVault += count;
  }

  // 2. Scan up to MAX_THREADS_TO_SCAN threads
  const threadsToScan = allThreadsSnap.docs.slice(0, MAX_THREADS_TO_SCAN);
  const rawInteractions: RawScannedInteraction[] = [];
  let interactionsScanned = 0;
  let threadsScanned = 0;

  for (const threadDoc of threadsToScan) {
    if (interactionsScanned >= MAX_INTERACTIONS_TO_SCAN) {
      break;
    }

    threadsScanned++;
    const threadData = threadDoc.data();
    const threadTitle = typeof threadData.title === 'string' && threadData.title.trim()
      ? threadData.title.trim().slice(0, 100)
      : 'Untitled Reflection';

    const remainingBudget = MAX_INTERACTIONS_TO_SCAN - interactionsScanned;
    const fetchLimit = Math.min(25, remainingBudget);

    const interactionsQuery = db
      .collection(`users/${verifiedUid}/threads/${threadDoc.id}/interactions`)
      .orderBy('turnIndex', 'asc')
      .limit(fetchLimit);

    const interactionsSnap = await interactionsQuery.get();

    for (const iDoc of interactionsSnap.docs) {
      const data = iDoc.data();

      // Extract authoritative createdAt timestamp
      let createdAtIso: string;
      let createdAtMs: number;

      if (data.createdAt instanceof Timestamp) {
        const dateObj = data.createdAt.toDate();
        createdAtIso = dateObj.toISOString();
        createdAtMs = dateObj.getTime();
      } else if (typeof data.createdAt === 'string' && !isNaN(Date.parse(data.createdAt))) {
        createdAtIso = data.createdAt;
        createdAtMs = Date.parse(data.createdAt);
      } else {
        // Discard invalid timestamps
        continue;
      }

      const turnIndex = typeof data.turnIndex === 'number' ? data.turnIndex : 0;
      const userPrompt = typeof data.userPrompt === 'string' ? data.userPrompt : '';

      // Themes from reflection insights
      const themes = Array.isArray(data.insights?.coreThemes)
        ? data.insights.coreThemes
        : (Array.isArray(data.insights?.themes) ? data.insights.themes : []);

      const validThemes = themes
        .filter((t: unknown): t is string => typeof t === 'string' && t.trim().length > 0)
        .map((t: string) => t.trim().slice(0, 50));

      // Action items from reflection insights
      const actionItems = Array.isArray(data.insights?.actionItems)
        ? data.insights.actionItems
            .filter((a: unknown): a is string => typeof a === 'string' && a.trim().length > 0)
            .map((a: string) => a.trim().slice(0, 150))
        : [];

      // Open questions from reflection insights
      const openQuestions = Array.isArray(data.insights?.openQuestions)
        ? data.insights.openQuestions
            .filter((q: unknown): q is string => typeof q === 'string' && q.trim().length > 0)
            .map((q: string) => q.trim().slice(0, 150))
        : [];

      rawInteractions.push({
        interactionId: iDoc.id,
        threadId: threadDoc.id,
        threadTitle,
        createdAt: createdAtIso,
        createdAtMs,
        turnIndex,
        userPrompt,
        summary: typeof data.insights?.summary === 'string' ? data.insights.summary : undefined,
        themes: validThemes,
        actionItems,
        openQuestions,
      });

      interactionsScanned++;
    }
  }

  // 3. Evaluate exact coverage
  const isFullHistory =
    threadsScanned === totalThreadsInVault &&
    interactionsScanned === totalInteractionsInVault;

  const retrievalCoverage: InsightRetrievalCoverage = isFullHistory
    ? 'FULL_HISTORY_SEARCH'
    : 'PARTIAL_HISTORY_SEARCH';

  // 4. Sort interactions chronologically
  const sortedInteractions = sortInteractionsChronologically(rawInteractions);

  const earliestAnalyzedDate = sortedInteractions.length > 0 ? sortedInteractions[0].createdAt : null;
  const latestAnalyzedDate = sortedInteractions.length > 0 ? sortedInteractions[sortedInteractions.length - 1].createdAt : null;

  const coverageDisclosure = isFullHistory
    ? `Complete journal history analyzed: ${interactionsScanned} interactions across ${threadsScanned} threads.`
    : `Analysis reflects a bounded window of ${interactionsScanned} interactions across ${threadsScanned} threads out of ${totalInteractionsInVault} total interactions in ${totalThreadsInVault} threads in your ThoughtVault. Earlier entries were not included.`;

  const coverageFacts: InsightCoverageFacts = {
    totalThreadsInVault,
    threadsScanned,
    totalInteractionsInVault,
    interactionsScanned,
    retrievalCoverage,
    earliestAnalyzedDate,
    latestAnalyzedDate,
    coverageDisclosure,
  };

  // Check sufficient history
  if (sortedInteractions.length < MIN_INTERACTIONS_REQUIRED) {
    return {
      coverage: coverageFacts,
      themeTrajectories: [],
      recurringPatterns: [],
      repeatedActionItems: [],
      repeatedOpenQuestions: [],
      selectedEvidence: [],
      verifiedMap: new Map(),
      hasSufficientHistory: false,
    };
  }

  // 5. Partition interactions into Earlier and Recent
  const { earlier, recent } = partitionInteractions(sortedInteractions);

  // Map of all interactions for fast ID lookup
  const interactionLookup = new Map<string, RawScannedInteraction>();
  for (const i of sortedInteractions) {
    interactionLookup.set(i.interactionId, i);
  }

  // 6. Aggregate Themes & Trajectories
  interface ThemeStat {
    theme: string;
    earlierFreq: number;
    recentFreq: number;
    earlierThreads: Set<string>;
    recentThreads: Set<string>;
    evidenceIds: Set<string>;
    firstSeenMs: number;
    lastSeenMs: number;
  }

  const themeStats = new Map<string, ThemeStat>();

  function processThemeMention(theme: string, interaction: RawScannedInteraction, isRecent: boolean) {
    const canonicalTheme = theme.trim();
    if (!canonicalTheme) return;

    let stat = themeStats.get(canonicalTheme);
    if (!stat) {
      stat = {
        theme: canonicalTheme,
        earlierFreq: 0,
        recentFreq: 0,
        earlierThreads: new Set(),
        recentThreads: new Set(),
        evidenceIds: new Set(),
        firstSeenMs: interaction.createdAtMs,
        lastSeenMs: interaction.createdAtMs,
      };
      themeStats.set(canonicalTheme, stat);
    }

    stat.evidenceIds.add(interaction.interactionId);
    stat.firstSeenMs = Math.min(stat.firstSeenMs, interaction.createdAtMs);
    stat.lastSeenMs = Math.max(stat.lastSeenMs, interaction.createdAtMs);

    if (isRecent) {
      stat.recentFreq++;
      stat.recentThreads.add(interaction.threadId);
    } else {
      stat.earlierFreq++;
      stat.earlierThreads.add(interaction.threadId);
    }
  }

  for (const i of earlier) {
    for (const t of i.themes) {
      processThemeMention(t, i, false);
    }
  }

  for (const i of recent) {
    for (const t of i.themes) {
      processThemeMention(t, i, true);
    }
  }

  const themeTrajectories: InsightThemeTrajectory[] = [];
  const recurringPatterns: InsightPattern[] = [];

  for (const stat of themeStats.values()) {
    const totalFreq = stat.earlierFreq + stat.recentFreq;
    const allDistinctThreads = new Set([...stat.earlierThreads, ...stat.recentThreads]);
    const distinctThreadCount = allDistinctThreads.size;
    const timeSpanMs = stat.lastSeenMs - stat.firstSeenMs;
    const evIds = Array.from(stat.evidenceIds);

    // Trajectory classification
    let trajectory: InsightThemeTrajectoryType;
    if (stat.earlierFreq === 0 && stat.recentFreq >= 2) {
      trajectory = 'EMERGING';
    } else if (stat.earlierFreq >= 1 && stat.recentFreq >= 1) {
      trajectory = 'PERSISTENT';
    } else if (stat.earlierFreq >= 2 && stat.recentFreq === 0) {
      trajectory = 'DORMANT';
    } else {
      trajectory = 'TRANSIENT';
    }

    const supportTier = computeSupportTier(evIds, distinctThreadCount, timeSpanMs);

    // Include non-transient themes in themeTrajectories
    if (trajectory !== 'TRANSIENT') {
      themeTrajectories.push({
        theme: stat.theme,
        trajectory,
        earlierFrequency: stat.earlierFreq,
        recentFrequency: stat.recentFreq,
        totalFrequency: totalFreq,
        earlierThreadCount: stat.earlierThreads.size,
        recentThreadCount: stat.recentThreads.size,
        evidenceIds: evIds,
        supportTier,
      });
    }

    // Include multi-thread themes (>=2 distinct threads, total >=2) as recurring patterns
    if (distinctThreadCount >= 2 && totalFreq >= 2) {
      recurringPatterns.push({
        patternId: `pat_${stat.theme.toLowerCase().replace(/[^\w]/g, '_')}`,
        name: stat.theme,
        description: `Frequently mentioned topic across ${distinctThreadCount} threads with ${totalFreq} reflections.`,
        frequency: totalFreq,
        distinctThreadCount,
        firstSeenDate: new Date(stat.firstSeenMs).toISOString(),
        lastSeenDate: new Date(stat.lastSeenMs).toISOString(),
        evidenceIds: evIds,
        supportTier,
      });
    }
  }

  // Sort theme trajectories by totalFrequency desc, then theme name asc
  themeTrajectories.sort((a, b) => b.totalFrequency - a.totalFrequency || a.theme.localeCompare(b.theme));

  // Sort recurring patterns by frequency desc, then name asc
  recurringPatterns.sort((a, b) => b.frequency - a.frequency || a.name.localeCompare(b.name));

  // 7. Aggregate Action Items (Goals)
  interface ItemStat {
    id: string;
    text: string;
    freq: number;
    threads: Set<string>;
    evidenceIds: Set<string>;
    firstSeenMs: number;
    lastSeenMs: number;
  }

  const actionMap = new Map<string, ItemStat>();

  for (const i of sortedInteractions) {
    for (const act of i.actionItems) {
      const norm = normalizeJournalText(act);
      if (norm.length < 5) continue;

      let stat = actionMap.get(norm);
      if (!stat) {
        stat = {
          id: `goal_${norm.slice(0, 20).replace(/\s+/g, '_')}`,
          text: act,
          freq: 0,
          threads: new Set(),
          evidenceIds: new Set(),
          firstSeenMs: i.createdAtMs,
          lastSeenMs: i.createdAtMs,
        };
        actionMap.set(norm, stat);
      }
      stat.freq++;
      stat.threads.add(i.threadId);
      stat.evidenceIds.add(i.interactionId);
      stat.firstSeenMs = Math.min(stat.firstSeenMs, i.createdAtMs);
      stat.lastSeenMs = Math.max(stat.lastSeenMs, i.createdAtMs);
    }
  }

  const repeatedActionItems: InsightGoal[] = [];
  for (const stat of actionMap.values()) {
    if (stat.freq >= 2 || stat.threads.size >= 2) {
      const evIds = Array.from(stat.evidenceIds);
      const timeSpanMs = stat.lastSeenMs - stat.firstSeenMs;
      repeatedActionItems.push({
        goalId: stat.id,
        text: stat.text,
        frequency: stat.freq,
        distinctThreadCount: stat.threads.size,
        firstSeenDate: new Date(stat.firstSeenMs).toISOString(),
        lastSeenDate: new Date(stat.lastSeenMs).toISOString(),
        evidenceIds: evIds,
        supportTier: computeSupportTier(evIds, stat.threads.size, timeSpanMs),
      });
    }
  }
  repeatedActionItems.sort((a, b) => b.frequency - a.frequency || a.text.localeCompare(b.text));

  // 8. Aggregate Open Questions
  const questionMap = new Map<string, ItemStat>();

  for (const i of sortedInteractions) {
    for (const q of i.openQuestions) {
      const norm = normalizeJournalText(q);
      if (norm.length < 5) continue;

      let stat = questionMap.get(norm);
      if (!stat) {
        stat = {
          id: `q_${norm.slice(0, 20).replace(/\s+/g, '_')}`,
          text: q,
          freq: 0,
          threads: new Set(),
          evidenceIds: new Set(),
          firstSeenMs: i.createdAtMs,
          lastSeenMs: i.createdAtMs,
        };
        questionMap.set(norm, stat);
      }
      stat.freq++;
      stat.threads.add(i.threadId);
      stat.evidenceIds.add(i.interactionId);
      stat.firstSeenMs = Math.min(stat.firstSeenMs, i.createdAtMs);
      stat.lastSeenMs = Math.max(stat.lastSeenMs, i.createdAtMs);
    }
  }

  const repeatedOpenQuestions: InsightOpenQuestion[] = [];
  for (const stat of questionMap.values()) {
    if (stat.freq >= 2 || stat.threads.size >= 2) {
      const evIds = Array.from(stat.evidenceIds);
      const timeSpanMs = stat.lastSeenMs - stat.firstSeenMs;
      repeatedOpenQuestions.push({
        questionId: stat.id,
        text: stat.text,
        frequency: stat.freq,
        distinctThreadCount: stat.threads.size,
        firstSeenDate: new Date(stat.firstSeenMs).toISOString(),
        lastSeenDate: new Date(stat.lastSeenMs).toISOString(),
        evidenceIds: evIds,
        supportTier: computeSupportTier(evIds, stat.threads.size, timeSpanMs),
      });
    }
  }
  repeatedOpenQuestions.sort((a, b) => b.frequency - a.frequency || a.text.localeCompare(b.text));

  // 9. Select up to MAX_EVIDENCE_TO_GEMINI (16) Representative Candidates
  const selectedEvidenceIds = new Set<string>();

  // Prioritize evidence from emerging themes (up to 5)
  for (const t of themeTrajectories.filter(tr => tr.trajectory === 'EMERGING')) {
    for (const id of t.evidenceIds) {
      if (selectedEvidenceIds.size >= 5) break;
      selectedEvidenceIds.add(id);
    }
  }

  // Next, evidence from persistent themes (up to 5)
  for (const t of themeTrajectories.filter(tr => tr.trajectory === 'PERSISTENT')) {
    for (const id of t.evidenceIds) {
      if (selectedEvidenceIds.size >= 10) break;
      selectedEvidenceIds.add(id);
    }
  }

  // Next, evidence from dormant themes (up to 3)
  for (const t of themeTrajectories.filter(tr => tr.trajectory === 'DORMANT')) {
    for (const id of t.evidenceIds) {
      if (selectedEvidenceIds.size >= 13) break;
      selectedEvidenceIds.add(id);
    }
  }

  // Next, evidence from repeated action items or open questions (up to 3)
  for (const item of [...repeatedActionItems, ...repeatedOpenQuestions]) {
    for (const id of item.evidenceIds) {
      if (selectedEvidenceIds.size >= MAX_EVIDENCE_TO_GEMINI) break;
      selectedEvidenceIds.add(id);
    }
  }

  // If still below 16, backfill from latest and earliest interactions to ensure temporal anchoring
  if (selectedEvidenceIds.size < MAX_EVIDENCE_TO_GEMINI) {
    for (let i = sortedInteractions.length - 1; i >= 0 && selectedEvidenceIds.size < MAX_EVIDENCE_TO_GEMINI; i--) {
      selectedEvidenceIds.add(sortedInteractions[i].interactionId);
    }
  }
  if (selectedEvidenceIds.size < MAX_EVIDENCE_TO_GEMINI) {
    for (let i = 0; i < sortedInteractions.length && selectedEvidenceIds.size < MAX_EVIDENCE_TO_GEMINI; i++) {
      selectedEvidenceIds.add(sortedInteractions[i].interactionId);
    }
  }

  // Project selected candidates
  const verifiedMap = new Map<string, InsightCandidateEvidence>();
  const selectedEvidence: InsightCandidateEvidence[] = [];

  for (const id of selectedEvidenceIds) {
    const raw = interactionLookup.get(id);
    if (!raw) continue;

    const candidate: InsightCandidateEvidence = {
      interactionId: raw.interactionId,
      threadId: raw.threadId,
      threadTitle: raw.threadTitle,
      date: raw.createdAt,
      userPromptSnippet: raw.userPrompt.slice(0, MAX_EXCERPT_LENGTH),
      summary: raw.summary ? raw.summary.slice(0, MAX_EXCERPT_LENGTH) : undefined,
      themes: raw.themes,
      actionItems: raw.actionItems,
      openQuestions: raw.openQuestions,
    };

    verifiedMap.set(id, candidate);
    selectedEvidence.push(candidate);
  }

  // Sort selected evidence chronologically
  selectedEvidence.sort((a, b) => a.date.localeCompare(b.date));

  return {
    coverage: coverageFacts,
    themeTrajectories,
    recurringPatterns,
    repeatedActionItems,
    repeatedOpenQuestions,
    selectedEvidence,
    verifiedMap,
    hasSufficientHistory: true,
  };
}
