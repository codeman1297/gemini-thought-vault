/**
 * Personal Journal Insights View (Milestone 10.6)
 * 
 * Production Security & UX Rules:
 * 1. Read-Only Longitudinal Intelligence: Displays grounded synthesis and deterministic trajectories.
 * 2. Coverage Transparency: Accurately presents FULL_HISTORY_SEARCH vs PARTIAL_HISTORY_SEARCH.
 * 3. Evidence Grounding: Every trajectory and pattern displays its support tier and verified citations.
 * 4. Insufficient History Handling: Friendly guidance if fewer than 3 interactions exist.
 * 5. One-Click Prompting: "Reflect on this" copies reflective inquiry to journal draft.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Sparkles,
  TrendingUp,
  RefreshCw,
  Clock,
  CheckCircle2,
  AlertCircle,
  ArrowUpRight,
  Shield,
  HelpCircle,
  Target,
  FileText,
  Compass,
  Layers,
  ChevronRight,
  ChevronDown,
  Info
} from 'lucide-react';
import { getPersonalInsights } from '../lib/api';
import type {
  PersonalInsightsResponse,
  InsightThemeTrajectory,
  InsightPattern,
  InsightGoal,
  InsightOpenQuestion,
  InsightEvidenceReference
} from '../types';

interface PersonalInsightsViewProps {
  onStartReflectionWithPrompt?: (prompt: string) => void;
  onNavigateToJournal?: () => void;
}

export function PersonalInsightsView({
  onStartReflectionWithPrompt,
  onNavigateToJournal,
}: PersonalInsightsViewProps) {
  const [data, setData] = useState<PersonalInsightsResponse | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedCitation, setSelectedCitation] = useState<InsightEvidenceReference | null>(null);
  const [showCoverageDetails, setShowCoverageDetails] = useState<boolean>(false);

  const fetchInsights = useCallback(async (forceRefresh = false) => {
    if (forceRefresh) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }
    setError(null);

    try {
      const result = await getPersonalInsights(forceRefresh);
      setData(result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load personal insights.';
      setError(msg);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchInsights(false);
  }, [fetchInsights]);

  const handleReflectOnQuestion = (question: string) => {
    if (onStartReflectionWithPrompt) {
      onStartReflectionWithPrompt(question);
    } else if (onNavigateToJournal) {
      onNavigateToJournal();
    }
  };

  const getTrajectoryBadge = (trajectory: InsightThemeTrajectory['trajectory']) => {
    switch (trajectory) {
      case 'EMERGING':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-emerald-950/60 text-emerald-300 border border-emerald-800/60">
            <ArrowUpRight className="w-3 h-3 text-emerald-400" />
            Emerging Focus
          </span>
        );
      case 'PERSISTENT':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-indigo-950/60 text-indigo-300 border border-indigo-800/60">
            <TrendingUp className="w-3 h-3 text-indigo-400" />
            Sustained Theme
          </span>
        );
      case 'DORMANT':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-amber-950/60 text-amber-300 border border-amber-800/60">
            <Clock className="w-3 h-3 text-amber-400" />
            Previous Focus
          </span>
        );
      default:
        return null;
    }
  };

  const getSupportBadge = (tier: string) => {
    switch (tier) {
      case 'HIGH_CONFIDENCE':
        return (
          <span className="px-1.5 py-0.5 rounded text-[10px] bg-indigo-950 text-indigo-300 border border-indigo-800/40">
            High Support
          </span>
        );
      case 'MODERATE_CONFIDENCE':
        return (
          <span className="px-1.5 py-0.5 rounded text-[10px] bg-neutral-800 text-neutral-300 border border-neutral-700/40">
            Multi-Thread
          </span>
        );
      default:
        return (
          <span className="px-1.5 py-0.5 rounded text-[10px] bg-neutral-900 text-neutral-400 border border-neutral-800">
            Observational
          </span>
        );
    }
  };

  if (isLoading) {
    return (
      <div id="insights-loading" className="py-20 text-center space-y-4">
        <RefreshCw className="w-6 h-6 animate-spin mx-auto text-indigo-400" />
        <div className="space-y-1">
          <h3 className="text-sm font-semibold text-neutral-200">Synthesizing Personal Insights</h3>
          <p className="text-xs text-neutral-400 max-w-sm mx-auto">
            Analyzing longitudinal trajectories across your private thought threads...
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div id="insights-error" className="rounded-2xl border border-red-900/60 bg-red-950/20 p-8 text-center space-y-4">
        <AlertCircle className="w-8 h-8 mx-auto text-red-400" />
        <div className="space-y-1">
          <h3 className="text-base font-semibold text-neutral-200">Unable to Load Insights</h3>
          <p className="text-xs text-neutral-400 max-w-md mx-auto">{error}</p>
        </div>
        <button
          id="retry-insights-btn"
          onClick={() => fetchInsights(true)}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-medium bg-red-600 hover:bg-red-500 text-white transition-colors cursor-pointer"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Retry Analysis</span>
        </button>
      </div>
    );
  }

  if (!data || data.status === 'insufficient_history') {
    return (
      <div id="insights-insufficient-history" className="rounded-2xl border border-neutral-800 bg-neutral-900/30 p-8 text-center space-y-6">
        <div className="w-12 h-12 rounded-2xl bg-indigo-950/60 border border-indigo-800/60 flex items-center justify-center mx-auto text-indigo-400">
          <Sparkles className="w-6 h-6" />
        </div>
        <div className="space-y-2 max-w-lg mx-auto">
          <h3 className="text-base font-semibold text-neutral-200">
            More Journal Reflections Needed
          </h3>
          <p className="text-xs text-neutral-400 leading-relaxed">
            {data?.narrativeSummary ||
              'Personal Insights analyze longitudinal patterns across your entries. Record at least 3 reflections to discover your emerging themes, recurring questions, and goal trajectories.'}
          </p>
        </div>

        {data?.reflectiveQuestions && data.reflectiveQuestions.length > 0 && (
          <div className="max-w-md mx-auto space-y-2 text-left">
            <p className="text-xs font-medium text-neutral-300">Starter Reflection Prompts:</p>
            <div className="space-y-2">
              {data.reflectiveQuestions.map((q, i) => (
                <button
                  key={i}
                  id={`starter-prompt-${i}`}
                  onClick={() => handleReflectOnQuestion(q)}
                  className="w-full text-left p-3 rounded-xl border border-neutral-800 bg-neutral-950/40 hover:bg-neutral-900 hover:border-indigo-500/50 transition-all text-xs text-neutral-300 flex items-center justify-between group cursor-pointer"
                >
                  <span className="line-clamp-2">{q}</span>
                  <ChevronRight className="w-4 h-4 text-neutral-500 group-hover:text-indigo-400 shrink-0 ml-2" />
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="pt-2">
          <button
            id="start-journaling-btn"
            onClick={onNavigateToJournal}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white transition-colors cursor-pointer"
          >
            <FileText className="w-3.5 h-3.5" />
            <span>Go to Journal</span>
          </button>
        </div>
      </div>
    );
  }

  const coverage = data.coverage;
  const isFullHistory = coverage.retrievalCoverage === 'FULL_HISTORY_SEARCH';

  return (
    <div id="personal-insights-container" className="space-y-6">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-neutral-800">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-indigo-400" />
            <h2 className="text-base font-semibold text-neutral-100">Personal Journal Insights</h2>
            <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-indigo-950/80 text-indigo-300 border border-indigo-800/50">
              Longitudinal Intelligence
            </span>
          </div>
          <p className="text-xs text-neutral-400">
            Empathetic, evidence-grounded reflection on how your thoughts, goals, and inquiries evolve over time.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {data.cached && (
            <span className="px-2 py-1 rounded-md text-[11px] bg-neutral-900 border border-neutral-800 text-neutral-400 flex items-center gap-1.5">
              <Clock className="w-3 h-3 text-neutral-500" />
              Cached snapshot
            </span>
          )}

          <button
            id="refresh-insights-btn"
            onClick={() => fetchInsights(true)}
            disabled={isRefreshing}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium bg-neutral-900 hover:bg-neutral-850 border border-neutral-800 text-neutral-200 transition-colors disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-indigo-400' : ''}`} />
            <span>{isRefreshing ? 'Refreshing...' : 'Refresh'}</span>
          </button>
        </div>
      </div>

      {/* Coverage Facts Pill & Disclosure */}
      <div className="rounded-xl border border-neutral-800/80 bg-neutral-900/30 p-3 flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs">
            <Shield className="w-3.5 h-3.5 text-indigo-400" />
            <span className="text-neutral-300 font-medium">Vault Coverage:</span>
            <span
              className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${
                isFullHistory
                  ? 'bg-emerald-950/60 text-emerald-300 border border-emerald-800/60'
                  : 'bg-amber-950/60 text-amber-300 border border-amber-800/60'
              }`}
            >
              {isFullHistory ? 'COMPLETE HISTORY' : 'BOUNDED WINDOW'}
            </span>
            <span className="text-neutral-400 text-[11px]">
              {coverage.interactionsScanned} reflections across {coverage.threadsScanned} threads
            </span>
          </div>

          <button
            id="toggle-coverage-disclosure"
            onClick={() => setShowCoverageDetails(!showCoverageDetails)}
            className="text-[11px] text-indigo-400 hover:text-indigo-300 flex items-center gap-1 cursor-pointer"
          >
            <span>{showCoverageDetails ? 'Hide details' : 'Audit details'}</span>
            {showCoverageDetails ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          </button>
        </div>

        {showCoverageDetails && (
          <div className="pt-2 border-t border-neutral-800/60 text-[11px] text-neutral-400 space-y-1">
            <p>{coverage.coverageDisclosure}</p>
            {coverage.earliestAnalyzedDate && coverage.latestAnalyzedDate && (
              <p className="font-mono text-[10px] text-neutral-500">
                Window: {coverage.earliestAnalyzedDate.split('T')[0]} to {coverage.latestAnalyzedDate.split('T')[0]}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Narrative Synthesis Card */}
      <div id="narrative-synthesis-card" className="rounded-2xl border border-indigo-900/40 bg-indigo-950/10 p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Compass className="w-4 h-4 text-indigo-400" />
            <h3 className="text-xs font-semibold uppercase tracking-wider text-indigo-300">
              Longitudinal Narrative
            </h3>
          </div>
          {data.modelMetadata && (
            <span className="text-[10px] font-mono text-neutral-500">
              Generated by {data.modelMetadata.modelUsed} ({data.modelMetadata.latencyMs}ms)
            </span>
          )}
        </div>
        <p className="text-sm text-neutral-200 leading-relaxed font-serif whitespace-pre-line">
          {data.narrativeSummary}
        </p>
      </div>

      {/* Theme Trajectories Section */}
      {data.themeTrajectories.length > 0 && (
        <div id="theme-trajectories-section" className="space-y-3">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-indigo-400" />
            <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-300">
              Theme Trajectories (Earlier vs. Recent)
            </h3>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {data.themeTrajectories.map((t, idx) => (
              <div
                key={idx}
                id={`trajectory-${idx}`}
                className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4 space-y-2.5 hover:border-neutral-700 transition-colors"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-1">
                    <h4 className="text-sm font-semibold text-neutral-100">{t.theme}</h4>
                    <div className="flex items-center gap-2">
                      {getTrajectoryBadge(t.trajectory)}
                      {getSupportBadge(t.supportTier)}
                    </div>
                  </div>

                  <div className="text-right text-[11px] text-neutral-400 font-mono">
                    <div>{t.totalFrequency} total mentions</div>
                    <div className="text-[10px] text-neutral-500">
                      earlier: {t.earlierFrequency} | recent: {t.recentFrequency}
                    </div>
                  </div>
                </div>

                {t.aiInsight && (
                  <p className="text-xs text-neutral-300 leading-relaxed border-l-2 border-indigo-500/50 pl-2.5">
                    {t.aiInsight}
                  </p>
                )}

                {t.evidenceIds && t.evidenceIds.length > 0 && (
                  <div className="text-[11px] text-neutral-500 pt-1 flex items-center gap-1.5">
                    <CheckCircle2 className="w-3 h-3 text-indigo-400" />
                    <span>Grounded in {t.evidenceIds.length} verified reflection{t.evidenceIds.length === 1 ? '' : 's'}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Two-Column Grid: Recurring Patterns & Intentions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recurring Concerns / Patterns */}
        {data.recurringPatterns.length > 0 && (
          <div id="recurring-patterns-section" className="space-y-3">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-indigo-400" />
              <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-300">
                Recurring Topics & Patterns
              </h3>
            </div>

            <div className="space-y-2.5">
              {data.recurringPatterns.map((p, idx) => (
                <div
                  key={idx}
                  id={`pattern-${idx}`}
                  className="rounded-xl border border-neutral-800/80 bg-neutral-900/30 p-3.5 space-y-1.5"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-neutral-200">{p.name}</span>
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-400">
                      {p.frequency}x across {p.distinctThreadCount} threads
                    </span>
                  </div>
                  {p.aiInsight && (
                    <p className="text-xs text-neutral-300 leading-relaxed">{p.aiInsight}</p>
                  )}
                  <p className="text-[10px] text-neutral-500">
                    Spans {p.firstSeenDate.split('T')[0]} to {p.lastSeenDate.split('T')[0]}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Longitudinal Goals & Action Items */}
        {data.repeatedActionItems.length > 0 && (
          <div id="repeated-goals-section" className="space-y-3">
            <div className="flex items-center gap-2">
              <Target className="w-4 h-4 text-emerald-400" />
              <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-300">
                Longitudinal Goals & Intentions
              </h3>
            </div>

            <div className="space-y-2.5">
              {data.repeatedActionItems.map((g, idx) => (
                <div
                  key={idx}
                  id={`goal-${idx}`}
                  className="rounded-xl border border-neutral-800/80 bg-neutral-900/30 p-3.5 space-y-1.5"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-neutral-200 italic">"{g.text}"</span>
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-950/60 text-emerald-300 border border-emerald-800/40">
                      {g.frequency}x recorded
                    </span>
                  </div>
                  {g.aiInsight && (
                    <p className="text-xs text-neutral-300 leading-relaxed">{g.aiInsight}</p>
                  )}
                  <p className="text-[10px] text-neutral-500">
                    Tracked across {g.distinctThreadCount} separate thread{g.distinctThreadCount === 1 ? '' : 's'}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Repeated Open Questions */}
      {data.repeatedOpenQuestions.length > 0 && (
        <div id="unresolved-questions-section" className="space-y-3">
          <div className="flex items-center gap-2">
            <HelpCircle className="w-4 h-4 text-amber-400" />
            <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-300">
              Recurring Unresolved Inquiries
            </h3>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {data.repeatedOpenQuestions.map((q, idx) => (
              <div
                key={idx}
                id={`open-question-${idx}`}
                className="rounded-xl border border-neutral-800/80 bg-neutral-900/30 p-3.5 space-y-2"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-neutral-200">"{q.text}"</span>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-950/60 text-amber-300 border border-amber-800/40">
                    {q.frequency}x posed
                  </span>
                </div>
                {q.aiInsight && (
                  <p className="text-xs text-neutral-300 leading-relaxed">{q.aiInsight}</p>
                )}
                <div className="pt-1">
                  <button
                    id={`reflect-on-unresolved-${idx}`}
                    onClick={() => handleReflectOnQuestion(q.text)}
                    className="text-[11px] text-indigo-400 hover:text-indigo-300 flex items-center gap-1 cursor-pointer"
                  >
                    <span>Reflect on this question</span>
                    <ArrowUpRight className="w-3 h-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Reflective Questions for Future Journaling */}
      {data.reflectiveQuestions && data.reflectiveQuestions.length > 0 && (
        <div id="future-prompts-section" className="rounded-2xl border border-indigo-900/40 bg-indigo-950/20 p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-indigo-400" />
            <h3 className="text-xs font-semibold uppercase tracking-wider text-indigo-300">
              Inquiries for Your Next Journal Entry
            </h3>
          </div>
          <p className="text-xs text-neutral-400">
            Open-ended questions synthesized from your recent pattern shifts. Click any inquiry to draft a reflection.
          </p>

          <div className="space-y-2 pt-1">
            {data.reflectiveQuestions.map((q, idx) => (
              <button
                key={idx}
                id={`reflective-question-${idx}`}
                onClick={() => handleReflectOnQuestion(q)}
                className="w-full text-left p-3.5 rounded-xl border border-indigo-800/40 bg-neutral-950/40 hover:bg-neutral-900 hover:border-indigo-500/60 transition-all text-xs text-neutral-200 flex items-center justify-between group cursor-pointer"
              >
                <span className="leading-relaxed">{q}</span>
                <span className="inline-flex items-center gap-1 text-[11px] text-indigo-400 group-hover:text-indigo-300 shrink-0 ml-3 font-medium">
                  <span>Reflect</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Verified Grounding Citations Drawer */}
      {data.citations && data.citations.length > 0 && (
        <div id="verified-citations-section" className="space-y-3 pt-2">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-neutral-400" />
            <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
              Verified Grounding Sources ({data.citations.length})
            </h3>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
            {data.citations.map((c, idx) => (
              <div
                key={idx}
                id={`citation-card-${idx}`}
                className="rounded-xl border border-neutral-800/80 bg-neutral-950/40 p-3 space-y-1 text-xs"
              >
                <div className="flex items-center justify-between text-[10px] text-neutral-500">
                  <span className="font-semibold text-neutral-300 truncate max-w-[140px]">
                    {c.threadTitle}
                  </span>
                  <span>{c.date.split('T')[0]}</span>
                </div>
                <p className="text-[11px] text-neutral-400 line-clamp-2 italic">
                  "{c.excerpt}"
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
