/**
 * Ask My Journal — Historical Retrieval & Deterministic Ranking Engine (Milestone 10.2)
 * 
 * Production Security Rules:
 * 1. Root of trust: Every Firestore query is strictly scoped under /users/${verifiedUid}/...
 * 2. Zero Gemini calls: This service performs zero LLM/AI model invocations.
 * 3. Zero API routes, zero cache writes, zero rules modifications.
 * 4. Transparent multi-signal scoring: Level 1 original prompt > Level 2 AI reflection > Level 3 thread title.
 * 5. Explicit retrieval budget: Max 25 threads, Max 150 interactions, Max 10 candidates returned.
 * 6. Historical coverage semantics: Accurately distinguishes FULL_HISTORY_SEARCH from PARTIAL_HISTORY_SEARCH.
 * 7. Privacy-first logging: Never logs raw journal entries or prompt prose.
 */

import { getDb, Timestamp } from '../lib/firestore';
import type { 
  AskRetrievalMode, 
  AskRetrievalCoverage, 
  AskDeterministicFacts, 
  AskCandidateEvidence, 
  AskRetrievalResult 
} from '../types';

// ============================================================================
// Retrieval Safety Budget Constants
// ============================================================================

export const MAX_THREADS_TO_SCAN = 25;
export const MAX_TOTAL_INTERACTIONS_TO_SCAN = 150;
export const MAX_EVIDENCE_TO_RETURN = 10;
export const PER_THREAD_INTERACTION_LIMIT = 20;

// ============================================================================
// Stop Words for Deterministic Tokenization
// ============================================================================

const STOP_WORDS = new Set<string>([
  'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and',
  'any', 'are', 'aren\'t', 'as', 'at', 'be', 'because', 'been', 'before', 'being',
  'below', 'between', 'both', 'but', 'by', 'can\'t', 'cannot', 'could', 'couldn\'t',
  'did', 'didn\'t', 'do', 'does', 'doesn\'t', 'doing', 'don\'t', 'down', 'during',
  'each', 'few', 'for', 'from', 'further', 'had', 'hadn\'t', 'has', 'hasn\'t',
  'have', 'haven\'t', 'having', 'he', 'he\'d', 'he\'ll', 'he\'s', 'her', 'here',
  'here\'s', 'hers', 'herself', 'him', 'himself', 'his', 'how', 'how\'s', 'i',
  'i\'d', 'i\'ll', 'i\'m', 'i\'ve', 'if', 'in', 'into', 'is', 'isn\'t', 'it',
  'it\'s', 'its', 'itself', 'let\'s', 'me', 'more', 'most', 'mustn\'t', 'my',
  'myself', 'no', 'nor', 'not', 'of', 'off', 'on', 'once', 'only', 'or', 'other',
  'ought', 'our', 'ours', 'ourselves', 'out', 'over', 'own', 'same', 'shan\'t',
  'she', 'she\'d', 'she\'ll', 'she\'s', 'should', 'shouldn\'t', 'so', 'some',
  'such', 'than', 'that', 'that\'s', 'the', 'their', 'theirs', 'them', 'themselves',
  'then', 'there', 'there\'s', 'these', 'they', 'they\'d', 'they\'ll', 'they\'re',
  'they\'ve', 'this', 'those', 'through', 'to', 'too', 'under', 'until', 'up',
  'very', 'was', 'wasn\'t', 'we', 'we\'d', 'we\'ll', 'we\'re', 'we\'ve', 'were',
  'weren\'t', 'what', 'what\'s', 'when', 'when\'s', 'where', 'where\'s', 'which',
  'while', 'who', 'who\'s', 'whom', 'why', 'why\'s', 'with', 'won\'t', 'would',
  'wouldn\'t', 'you', 'you\'d', 'you\'ll', 'you\'re', 'you\'ve', 'your', 'yours',
  'yourself', 'yourselves', 'tell', 'talk', 'talked', 'show', 'entry', 'entries',
  'journal', 'think', 'thinking', 'thought', 'felt', 'feel', 'feelings'
]);

// ============================================================================
// Controlled Semantic Expansion Dictionary
// Lower weight (4 pts) than direct terms (15-50 pts)
// ============================================================================

export const CONTROLLED_VOCABULARY: Record<string, string[]> = {
  career: ['job', 'work', 'corporate', 'employment', 'vocation', 'profession', 'role'],
  job: ['career', 'work', 'employment', 'vocation', 'profession', 'role'],
  work: ['career', 'job', 'corporate', 'employment', 'profession', 'role'],
  burnout: ['exhaustion', 'fatigue', 'overwhelmed', 'drained', 'depleted', 'stress'],
  exhaustion: ['burnout', 'fatigue', 'overwhelmed', 'drained', 'stress'],
  stress: ['burnout', 'exhaustion', 'anxiety', 'overwhelmed', 'pressure'],
  idea: ['concept', 'project', 'venture', 'startup', 'prototype', 'initiative'],
  project: ['idea', 'venture', 'initiative', 'product', 'startup'],
  startup: ['venture', 'business', 'entrepreneurship', 'founder', 'company', 'product'],
  entrepreneurship: ['startup', 'venture', 'business', 'founder', 'initiative'],
  mindfulness: ['meditation', 'presence', 'calm', 'breathing', 'awareness', 'clarity'],
  meditation: ['mindfulness', 'breathing', 'presence', 'calm', 'awareness'],
  calm: ['peace', 'tranquility', 'mindfulness', 'relaxation', 'grounded'],
  anxiety: ['fear', 'worry', 'nervous', 'panic', 'apprehension', 'dread'],
  fear: ['anxiety', 'worry', 'hesitation', 'doubt', 'apprehension'],
  growth: ['learning', 'development', 'progress', 'improvement', 'advancement'],
  relationship: ['partner', 'friend', 'colleague', 'family', 'connection', 'interpersonal'],
};

// ============================================================================
// Question-Aware Classification
// ============================================================================

/**
 * Classifies natural-language query into one of 7 deterministic retrieval modes.
 * Safe fallback is 'mention'.
 */
export function classifyQueryMode(rawQuery: string): AskRetrievalMode {
  const q = rawQuery.toLowerCase().trim();

  // Timeline queries (earliest mention, first occurrence, chronological origin)
  if (
    q.includes('when did i first') ||
    q.includes('first time') ||
    q.includes('first mention') ||
    q.includes('earliest') ||
    q.includes('how long have i') ||
    q.includes('when did i start') ||
    q.includes('start thinking') ||
    q.includes('origin of') ||
    q.includes('history of my')
  ) {
    return 'timeline';
  }

  // Temporal change queries (evolution, shift, how thoughts changed over time)
  if (
    q.includes('how has my thinking') ||
    q.includes('how have my thoughts') ||
    q.includes('changed') ||
    q.includes('evolved') ||
    q.includes('shifted') ||
    q.includes('over time') ||
    q.includes('different now') ||
    q.includes('differ from') ||
    q.includes('progression')
  ) {
    return 'temporal_change';
  }

  // Recent focus queries (what am I currently/lately dealing with)
  if (
    q.includes('recently') ||
    q.includes('lately') ||
    q.includes('recent focus') ||
    q.includes('current focus') ||
    q.includes('nowadays') ||
    q.includes('past few days') ||
    q.includes('last few days') ||
    q.includes('last week') ||
    q.includes('latest thoughts')
  ) {
    return 'recent_focus';
  }

  // Recurrence queries (habits, loops, recurring topics)
  if (
    q.includes('keep coming back to') ||
    q.includes('recurring') ||
    q.includes('repeatedly') ||
    q.includes('frequently') ||
    q.includes('repeat') ||
    q.includes('patterns') ||
    q.includes('often think')
  ) {
    return 'recurrence';
  }

  // Unresolved questions queries (doubts, open questions, lingering dilemmas)
  if (
    q.includes('unresolved') ||
    q.includes('unanswered') ||
    q.includes('open question') ||
    q.includes('open questions') ||
    q.includes('left unanswered') ||
    q.includes('lingering questions') ||
    q.includes('questions have i') ||
    q.includes('doubts')
  ) {
    return 'unresolved_questions';
  }

  // Evidence lookup queries (exact retrieval, quote search)
  if (
    q.includes('show me entries where') ||
    q.includes('find entries') ||
    q.includes('entries where') ||
    q.includes('where did i mention') ||
    q.includes('exact quote') ||
    q.includes('search for')
  ) {
    return 'evidence_lookup';
  }

  // Default: general mention
  return 'mention';
}

// ============================================================================
// Query Normalization & Controlled Expansion
// ============================================================================

export interface NormalizedQuery {
  original: string;
  normalizedPhrase: string;
  directTokens: string[];
  expandedTokens: string[];
}

/**
 * Normalizes query string deterministically.
 */
export function normalizeQuery(rawQuery: string): NormalizedQuery {
  const trimmed = rawQuery.trim().toLowerCase();
  // Strip non-alphanumeric except whitespace
  const cleanChars = trimmed.replace(/[^a-z0-9\s]/g, ' ');
  // Collapse whitespace
  const normalizedPhrase = cleanChars.replace(/\s+/g, ' ').trim();

  const allTokens = normalizedPhrase.split(' ').filter(t => t.length > 1);
  const directTokens = allTokens.filter(t => !STOP_WORDS.has(t));

  // If all tokens were stop words, keep original tokens > 1 char
  const effectiveTokens = directTokens.length > 0 ? directTokens : allTokens;

  // Generate controlled expansions
  const expandedSet = new Set<string>();
  for (const token of effectiveTokens) {
    const synonyms = CONTROLLED_VOCABULARY[token];
    if (synonyms) {
      for (const syn of synonyms) {
        if (!effectiveTokens.includes(syn)) {
          expandedSet.add(syn);
        }
      }
    }
  }

  return {
    original: rawQuery,
    normalizedPhrase,
    directTokens: effectiveTokens,
    expandedTokens: Array.from(expandedSet),
  };
}

// ============================================================================
// Multi-Signal Deterministic Scoring Engine
// Weights:
// - Direct Phrase Match in Prompt: 50
// - Direct Token Overlap in Prompt: 15 per token
// - Theme Match: 25 per theme
// - Summary Match: 8 per token + 20 for phrase
// - Open Questions Match: 15
// - Thread Title Match: 10
// - Expanded Synonym Match: 4 (strictly lower weight)
// - Mode-specific bonuses
// ============================================================================

export interface ScoringWeights {
  phraseScore: number;
  tokenScore: number;
  themeScore: number;
  summaryScore: number;
  openQuestionScore: number;
  titleScore: number;
  expansionScore: number;
  modeBonus: number;
}

export function scoreInteraction(
  interaction: {
    interactionId: string;
    threadTitle: string;
    createdAt: string;
    userPrompt: string;
    summary?: string;
    themes: string[];
    openQuestions?: string[];
  },
  norm: NormalizedQuery,
  mode: AskRetrievalMode,
  temporalContext?: { minTime: number; maxTime: number }
): { totalScore: number; breakdown: ScoringWeights } {
  const promptLower = interaction.userPrompt.toLowerCase();
  const summaryLower = (interaction.summary || '').toLowerCase();
  const titleLower = interaction.threadTitle.toLowerCase();
  const themesLower = interaction.themes.map(t => t.toLowerCase());
  const questionsLower = (interaction.openQuestions || []).map(q => q.toLowerCase());

  let phraseScore = 0;
  let tokenScore = 0;
  let themeScore = 0;
  let summaryScore = 0;
  let openQuestionScore = 0;
  let titleScore = 0;
  let expansionScore = 0;
  let modeBonus = 0;

  // 1. Exact phrase match in prompt (Level 1 Authoritative)
  if (norm.normalizedPhrase.length >= 4 && promptLower.includes(norm.normalizedPhrase)) {
    phraseScore += 50;
  }

  // 2. Direct token matches in prompt (Level 1 Authoritative)
  for (const token of norm.directTokens) {
    if (promptLower.includes(token)) {
      tokenScore += 15;
    }
  }

  // 3. Theme match (Level 2 High Semantic Density)
  for (const token of norm.directTokens) {
    const matchedTheme = themesLower.some(th => th.includes(token));
    if (matchedTheme) {
      themeScore += 25;
    }
  }

  // 4. Summary match (Level 2 Derived)
  if (norm.normalizedPhrase.length >= 4 && summaryLower.includes(norm.normalizedPhrase)) {
    summaryScore += 20;
  }
  for (const token of norm.directTokens) {
    if (summaryLower.includes(token)) {
      summaryScore += 8;
    }
  }

  // 5. Open Questions match (Level 2 Derived)
  for (const token of norm.directTokens) {
    const matchedQuestion = questionsLower.some(q => q.includes(token));
    if (matchedQuestion) {
      openQuestionScore += 15;
    }
  }

  // 6. Thread Title match (Level 3 Contextual)
  for (const token of norm.directTokens) {
    if (titleLower.includes(token)) {
      titleScore += 10;
    }
  }

  // 7. Controlled expansion matches (Strictly Lower Weight: 4 pts)
  for (const syn of norm.expandedTokens) {
    if (promptLower.includes(syn) || summaryLower.includes(syn) || themesLower.some(th => th.includes(syn))) {
      expansionScore += 4;
    }
  }

  // 8. Mode-specific adjustments
  const baseRelevance = phraseScore + tokenScore + themeScore + summaryScore + openQuestionScore + titleScore + expansionScore;

  if (baseRelevance > 0) {
    if (mode === 'unresolved_questions' && interaction.openQuestions && interaction.openQuestions.length > 0) {
      modeBonus += 30;
    }

    if (mode === 'evidence_lookup' && phraseScore > 0) {
      modeBonus += 25;
    }

    if (mode === 'recent_focus' && temporalContext && temporalContext.maxTime > temporalContext.minTime) {
      const itemTime = new Date(interaction.createdAt).getTime();
      const freshness = (itemTime - temporalContext.minTime) / (temporalContext.maxTime - temporalContext.minTime);
      // Up to 25 bonus points for newest items
      modeBonus += Math.round(freshness * 25);
    }
  }

  const totalScore = baseRelevance > 0 ? baseRelevance + modeBonus : 0;

  return {
    totalScore,
    breakdown: {
      phraseScore,
      tokenScore,
      themeScore,
      summaryScore,
      openQuestionScore,
      titleScore,
      expansionScore,
      modeBonus,
    },
  };
}

// ============================================================================
// Firestore Data Retrieval & Candidate Aggregation
// ============================================================================

export interface RawScannedInteraction {
  interactionId: string;
  threadId: string;
  threadTitle: string;
  threadStatus?: 'active' | 'archived';
  createdAt: string;
  userPrompt: string;
  summary?: string;
  themes: string[];
  openQuestions?: string[];
}

export interface ScanUserJournalOptions {
  mode?: AskRetrievalMode;
  dbOverride?: any;
}

/**
 * Scans user's threads and interactions under strict ceilings.
 * Scoped strictly to /users/${uid}/...
 * Searches both active and archived threads (all legitimate journal history).
 */
export async function scanUserJournal(
  uid: string,
  options?: ScanUserJournalOptions
): Promise<{
  interactions: RawScannedInteraction[];
  totalThreadsSearched: number;
  totalInteractionsScanned: number;
  scanCeilingReached: boolean;
  totalThreadsAvailable: number;
}> {
  if (!uid || typeof uid !== 'string' || uid.trim().length === 0) {
    throw new Error('Unauthorized: Missing authenticated UID context.');
  }

  // Prevent path traversal
  if (uid.includes('/') || uid.includes('..') || uid.trim() !== uid) {
    throw new Error('Unauthorized: Invalid UID format.');
  }

  const db = options?.dbOverride || getDb();
  const isTimeline = options?.mode === 'timeline';

  // 1. Fetch threads (both active and archived are legitimate journal history)
  // Timeline mode scans from origin (createdAt asc), other modes scan newest first (updatedAt desc)
  const threadsQuery = isTimeline
    ? db
        .collection(`users/${uid}/threads`)
        .orderBy('createdAt', 'asc')
        .limit(MAX_THREADS_TO_SCAN + 1)
    : db
        .collection(`users/${uid}/threads`)
        .orderBy('updatedAt', 'desc')
        .limit(MAX_THREADS_TO_SCAN + 1);

  const threadsSnap = await threadsQuery.get();

  const totalThreadsAvailable = threadsSnap.docs.length;
  const threadsToScan = threadsSnap.docs.slice(0, MAX_THREADS_TO_SCAN);

  let totalInteractionsScanned = 0;
  let actualThreadsScanned = 0;
  let scanCeilingReached = totalThreadsAvailable > MAX_THREADS_TO_SCAN;
  const interactions: RawScannedInteraction[] = [];

  for (const threadDoc of threadsToScan) {
    if (totalInteractionsScanned >= MAX_TOTAL_INTERACTIONS_TO_SCAN) {
      scanCeilingReached = true;
      break;
    }

    actualThreadsScanned++;

    const threadData = threadDoc.data();
    const threadTitle = typeof threadData.title === 'string' && threadData.title.trim()
      ? threadData.title.trim().slice(0, 100)
      : 'Untitled Reflection';
    const threadStatus: 'active' | 'archived' = threadData.status === 'archived' ? 'archived' : 'active';

    const remainingBudget = MAX_TOTAL_INTERACTIONS_TO_SCAN - totalInteractionsScanned;
    const fetchLimit = Math.min(PER_THREAD_INTERACTION_LIMIT, remainingBudget);

    // Timeline queries fetch earliest turns first (turnIndex asc), other modes fetch latest turns (turnIndex desc)
    const interactionsQuery = isTimeline
      ? db
          .collection(`users/${uid}/threads/${threadDoc.id}/interactions`)
          .orderBy('turnIndex', 'asc')
          .limit(fetchLimit + 1) // +1 to check if thread has uninspected older interactions
      : db
          .collection(`users/${uid}/threads/${threadDoc.id}/interactions`)
          .orderBy('turnIndex', 'desc')
          .limit(fetchLimit + 1);

    const interactionsSnap = await interactionsQuery.get();

    const docs = interactionsSnap.docs;
    const hasMoreInThread = docs.length > fetchLimit;
    const docsToProcess = docs.slice(0, fetchLimit);

    if (hasMoreInThread) {
      scanCeilingReached = true;
    }

    for (const iDoc of docsToProcess) {
      const data = iDoc.data();
      const createdAtIso = data.createdAt instanceof Timestamp
        ? data.createdAt.toDate().toISOString()
        : (typeof data.createdAt === 'string' ? data.createdAt : new Date().toISOString());

      const themes = Array.isArray(data.insights?.themes)
        ? data.insights.themes
        : (Array.isArray(data.insights?.coreThemes) ? data.insights.coreThemes : []);

      interactions.push({
        interactionId: iDoc.id,
        threadId: threadDoc.id,
        threadTitle,
        threadStatus,
        createdAt: createdAtIso,
        userPrompt: typeof data.userPrompt === 'string' ? data.userPrompt : '',
        summary: typeof data.insights?.summary === 'string' ? data.insights.summary : undefined,
        themes: themes.filter((t: unknown): t is string => typeof t === 'string').map((t: string) => t.slice(0, 40)),
        openQuestions: Array.isArray(data.insights?.openQuestions)
          ? data.insights.openQuestions.filter((q: unknown): q is string => typeof q === 'string').map((q: string) => q.slice(0, 140))
          : [],
      });

      totalInteractionsScanned++;
    }
  }

  // If there were threads in threadsToScan that could not be searched because budget ran out
  if (threadsToScan.length > actualThreadsScanned) {
    scanCeilingReached = true;
  }

  // If global ceiling was hit, mark ceiling reached
  if (totalInteractionsScanned >= MAX_TOTAL_INTERACTIONS_TO_SCAN) {
    scanCeilingReached = true;
  }

  return {
    interactions,
    totalThreadsSearched: actualThreadsScanned,
    totalInteractionsScanned,
    scanCeilingReached,
    totalThreadsAvailable,
  };
}

// ============================================================================
// Deterministic Ranking & Selection Strategy
// ============================================================================

export function rankAndSelectCandidates(
  scannedItems: RawScannedInteraction[],
  norm: NormalizedQuery,
  mode: AskRetrievalMode
): {
  rankedCandidates: AskCandidateEvidence[];
  matchingCount: number;
} {
  if (scannedItems.length === 0) {
    return { rankedCandidates: [], matchingCount: 0 };
  }

  // Calculate temporal min/max for recency scoring
  const times = scannedItems.map(i => new Date(i.createdAt).getTime()).filter(t => !isNaN(t));
  const minTime = times.length > 0 ? Math.min(...times) : 0;
  const maxTime = times.length > 0 ? Math.max(...times) : 0;
  const temporalContext = { minTime, maxTime };

  // Score each item
  const scoredItems: AskCandidateEvidence[] = [];

  for (const item of scannedItems) {
    const { totalScore, breakdown } = scoreInteraction(item, norm, mode, temporalContext);
    if (totalScore > 0) {
      // Snippet bounded to 350 chars
      const snippet = item.userPrompt.trim().slice(0, 350);
      scoredItems.push({
        interactionId: item.interactionId,
        threadId: item.threadId,
        threadTitle: item.threadTitle,
        date: item.createdAt,
        userPromptSnippet: snippet,
        summary: item.summary ? item.summary.slice(0, 200) : undefined,
        themes: item.themes,
        openQuestions: item.openQuestions,
        score: totalScore,
        scoreBreakdown: breakdown,
      });
    }
  }

  const matchingCount = scoredItems.length;
  if (matchingCount === 0) {
    return { rankedCandidates: [], matchingCount: 0 };
  }

  // Mode-specific selection & ordering
  let selected: AskCandidateEvidence[] = [];

  if (mode === 'timeline') {
    // For timeline: filter relevant matches, then sort chronologically ascending (oldest first)
    // Deterministic tie-breaking: date -> score -> threadId -> interactionId
    scoredItems.sort((a, b) => {
      const timeDiff = new Date(a.date).getTime() - new Date(b.date).getTime();
      if (timeDiff !== 0) return timeDiff;
      if (b.score !== a.score) return b.score - a.score;
      const threadDiff = a.threadId.localeCompare(b.threadId);
      if (threadDiff !== 0) return threadDiff;
      return a.interactionId.localeCompare(b.interactionId);
    });
    selected = scoredItems.slice(0, MAX_EVIDENCE_TO_RETURN);
  } else if (mode === 'temporal_change') {
    // For temporal change: select evidence that spans time (earliest matches + latest matches)
    // Deterministic tie-breaking: date -> score -> threadId -> interactionId
    scoredItems.sort((a, b) => {
      const timeDiff = new Date(a.date).getTime() - new Date(b.date).getTime();
      if (timeDiff !== 0) return timeDiff;
      if (b.score !== a.score) return b.score - a.score;
      const threadDiff = a.threadId.localeCompare(b.threadId);
      if (threadDiff !== 0) return threadDiff;
      return a.interactionId.localeCompare(b.interactionId);
    });
    if (scoredItems.length <= MAX_EVIDENCE_TO_RETURN) {
      selected = scoredItems;
    } else {
      const half = Math.floor(MAX_EVIDENCE_TO_RETURN / 2);
      const earlySlice = scoredItems.slice(0, half);
      const lateSlice = scoredItems.slice(-half);
      // Combine without duplicates
      const seen = new Set<string>();
      for (const item of [...earlySlice, ...lateSlice]) {
        if (!seen.has(item.interactionId)) {
          seen.add(item.interactionId);
          selected.push(item);
        }
      }
    }
  } else {
    // Standard ranking by score descending
    // Deterministic tie-breaking: score -> newest first -> threadId -> interactionId
    scoredItems.sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      const timeDiff = new Date(b.date).getTime() - new Date(a.date).getTime();
      if (timeDiff !== 0) return timeDiff;
      const threadDiff = a.threadId.localeCompare(b.threadId);
      if (threadDiff !== 0) return threadDiff;
      return a.interactionId.localeCompare(b.interactionId);
    });
    selected = scoredItems.slice(0, MAX_EVIDENCE_TO_RETURN);
  }

  return {
    rankedCandidates: selected,
    matchingCount,
  };
}

// ============================================================================
// Deterministic Facts Generation
// ============================================================================

export function computeDeterministicFacts(
  rankedCandidates: AskCandidateEvidence[],
  allScannedItems: RawScannedInteraction[],
  matchingCount: number,
  totalThreadsSearched: number,
  totalInteractionsScanned: number,
  scanCeilingReached: boolean,
  mode: AskRetrievalMode
): AskDeterministicFacts {
  // Coverage determination:
  // If scan ceiling was reached (either thread limit or interaction limit hit), coverage is PARTIAL
  const retrievalCoverage: AskRetrievalCoverage = scanCeilingReached
    ? 'PARTIAL_HISTORY_SEARCH'
    : 'FULL_HISTORY_SEARCH';

  let coverageNote: string;
  if (retrievalCoverage === 'FULL_HISTORY_SEARCH') {
    coverageNote = `Complete history verified: scanned all ${totalInteractionsScanned} interactions across ${totalThreadsSearched} threads.`;
  } else if (mode === 'timeline') {
    coverageNote = `Partial history scan: evaluated ${totalInteractionsScanned} interactions across ${totalThreadsSearched} threads under the safety ceiling. Uninspected records exist outside this retrieval window; the earliest matching candidate represents the earliest entry found within the searched history, NOT a confirmed absolute first historical mention.`;
  } else {
    coverageNote = `Partial history scan: evaluated ${totalInteractionsScanned} interactions across ${totalThreadsSearched} threads under the safety ceiling. Older entries may exist uninspected.`;
  }

  // Dates
  let firstEntryDate: string | null = null;
  let lastEntryDate: string | null = null;

  if (rankedCandidates.length > 0) {
    const dates = rankedCandidates.map(c => new Date(c.date).getTime()).filter(t => !isNaN(t));
    if (dates.length > 0) {
      firstEntryDate = new Date(Math.min(...dates)).toISOString();
      lastEntryDate = new Date(Math.max(...dates)).toISOString();
    }
  }

  // Recurring theme frequency aggregation
  const themeFreq = new Map<string, number>();
  for (const c of rankedCandidates) {
    for (const theme of c.themes) {
      themeFreq.set(theme, (themeFreq.get(theme) || 0) + 1);
    }
  }
  const matchedThemes = Array.from(themeFreq.entries())
    .sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return a[0].localeCompare(b[0]); // Deterministic alphabetical tie-breaker
    })
    .map(([theme]) => theme)
    .slice(0, 10);

  return {
    totalThreadsSearched,
    totalInteractionsScanned,
    matchingEntriesFound: matchingCount,
    dateRange: {
      firstEntryDate,
      lastEntryDate,
    },
    matchedThemes,
    retrievalCoverage,
    retrievalMode: mode,
    coverageNote,
  };
}

// ============================================================================
// Public Entry Point: retrieveAskJournalCandidates
// ============================================================================

export interface AskRetrievalOptions {
  modeOverride?: AskRetrievalMode;
  inMemoryCandidatesOverride?: RawScannedInteraction[];
  scanCeilingReachedOverride?: boolean;
  dbOverride?: any;
}

/**
 * Retrieves and deterministically ranks journal candidates for Ask My Journal.
 * Does NOT call Gemini. Does NOT write cache. Does NOT expose unverified data.
 */
export async function retrieveAskJournalCandidates(
  uid: string,
  rawQuery: string,
  options?: AskRetrievalOptions
): Promise<AskRetrievalResult> {
  if (!uid || typeof uid !== 'string' || uid.trim().length === 0) {
    throw new Error('Unauthorized: Missing authenticated UID context.');
  }

  const query = rawQuery.trim();
  if (query.length < 3) {
    throw new Error('Invalid query: Query must be at least 3 characters.');
  }

  // 1. Classify query mode deterministically
  const mode = options?.modeOverride || classifyQueryMode(query);

  // 2. Normalize query and generate controlled expansions
  const norm = normalizeQuery(query);

  // 3. Scan user history (using override for tests or Firestore for production)
  let scannedItems: RawScannedInteraction[];
  let totalThreadsSearched: number;
  let totalInteractionsScanned: number;
  let scanCeilingReached: boolean;

  if (options?.inMemoryCandidatesOverride) {
    scannedItems = options.inMemoryCandidatesOverride;
    const threadSet = new Set(scannedItems.map(i => i.threadId));
    totalThreadsSearched = threadSet.size;
    totalInteractionsScanned = scannedItems.length;
    scanCeilingReached = options.scanCeilingReachedOverride ?? false;
  } else {
    const scanResult = await scanUserJournal(uid, {
      mode,
      dbOverride: options?.dbOverride,
    });
    scannedItems = scanResult.interactions;
    totalThreadsSearched = scanResult.totalThreadsSearched;
    totalInteractionsScanned = scanResult.totalInteractionsScanned;
    scanCeilingReached = scanResult.scanCeilingReached;
  }

  // 4. Multi-signal ranking and selection
  const { rankedCandidates, matchingCount } = rankAndSelectCandidates(scannedItems, norm, mode);

  // 5. Deterministic facts computation
  const deterministicFacts = computeDeterministicFacts(
    rankedCandidates,
    scannedItems,
    matchingCount,
    totalThreadsSearched,
    totalInteractionsScanned,
    scanCeilingReached,
    mode
  );

  // 6. Build verified candidate map (keyed strictly by interactionId)
  const verifiedMap = new Map<string, AskCandidateEvidence>();
  for (const candidate of rankedCandidates) {
    verifiedMap.set(candidate.interactionId, candidate);
  }

  return {
    candidates: rankedCandidates,
    verifiedMap,
    deterministicFacts,
  };
}
