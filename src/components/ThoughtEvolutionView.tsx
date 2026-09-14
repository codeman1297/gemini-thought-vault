/**
 * Thought Evolution View Component (Milestone 9)
 * 
 * Production Security & UX Rules:
 * 1. User-data isolation: Displays only the authenticated user's evolution document.
 * 2. Deterministic facts clearly separated from AI interpretations.
 * 3. Verified evidence citations are clickable; dynamically fetches current thought text on demand.
 * 4. Handles concurrency conflicts (409), rate limits (429), and insufficient history (< 2 reflections).
 * 5. Full transparency: Shows model metadata, fallback ladder indicator, and cache status.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { 
  Compass, 
  Sparkles, 
  RefreshCw, 
  Clock, 
  Layers, 
  HelpCircle, 
  Bookmark, 
  TrendingUp, 
  Calendar, 
  CheckCircle2, 
  AlertCircle, 
  Info, 
  Cpu, 
  Hash, 
  ExternalLink, 
  X, 
  FileText, 
  ArrowRight,
  ShieldCheck,
  Zap
} from 'lucide-react';
import { 
  getLatestThoughtEvolution, 
  generateThoughtEvolution, 
  getEvolutionSupportingEvidence 
} from '../lib/api';
import type { 
  ThoughtEvolutionDocument, 
  SupportingEvidenceResponse,
  EvolutionCitationReference 
} from '../types';

interface ThoughtEvolutionViewProps {
  onNavigateToJournal?: () => void;
}

export function ThoughtEvolutionView({ onNavigateToJournal }: ThoughtEvolutionViewProps) {
  const [evolutionDoc, setEvolutionDoc] = useState<ThoughtEvolutionDocument | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [isCachedHit, setIsCachedHit] = useState<boolean>(false);

  // Evidence modal state
  const [activeEvidenceModal, setActiveEvidenceModal] = useState<{
    threadId: string;
    interactionId: string;
    citation: EvolutionCitationReference;
  } | null>(null);
  const [evidenceData, setEvidenceData] = useState<SupportingEvidenceResponse | null>(null);
  const [isLoadingEvidence, setIsLoadingEvidence] = useState<boolean>(false);

  // Initial load of latest report
  const loadLatestReport = useCallback(async () => {
    setIsLoading(true);
    setErrorBanner(null);
    try {
      const doc = await getLatestThoughtEvolution();
      setEvolutionDoc(doc);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to retrieve Thought Evolution report.';
      setErrorBanner(msg);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadLatestReport();
  }, [loadLatestReport]);

  // Handle generation trigger
  const handleGenerate = async (forceRefresh: boolean = false) => {
    setIsGenerating(true);
    setErrorBanner(null);
    setIsCachedHit(false);

    try {
      const result = await generateThoughtEvolution(forceRefresh);
      setEvolutionDoc(result.evolution);
      setIsCachedHit(result.cached);
    } catch (err: unknown) {
      const error = err as { code?: string; message?: string };
      if (error?.code === 'ANALYSIS_IN_PROGRESS') {
        setErrorBanner('An evolution analysis is currently in progress for your account. Please wait a few moments.');
      } else {
        setErrorBanner(error?.message || 'Failed to synthesize Thought Evolution. Please try again.');
      }
    } finally {
      setIsGenerating(false);
    }
  };

  // Open supporting evidence drawer
  const handleOpenEvidence = async (citation: EvolutionCitationReference) => {
    setActiveEvidenceModal({
      threadId: citation.threadId,
      interactionId: citation.interactionId,
      citation,
    });
    setIsLoadingEvidence(true);
    setEvidenceData(null);

    try {
      const data = await getEvolutionSupportingEvidence(citation.threadId, citation.interactionId);
      setEvidenceData(data);
    } catch {
      setEvidenceData({
        available: false,
        interactionId: citation.interactionId,
        threadId: citation.threadId,
        message: 'Unable to retrieve supporting evidence at this time.',
      });
    } finally {
      setIsLoadingEvidence(false);
    }
  };

  const getTrajectoryBadge = (trajectory: 'emerging' | 'deepening' | 'shifting' | 'dormant') => {
    switch (trajectory) {
      case 'emerging':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-950/80 border border-emerald-800/80 text-emerald-300">
            <TrendingUp className="w-3 h-3" /> Emerging
          </span>
        );
      case 'deepening':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-indigo-950/80 border border-indigo-800/80 text-indigo-300">
            <Layers className="w-3 h-3" /> Deepening
          </span>
        );
      case 'shifting':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-950/80 border border-amber-800/80 text-amber-300">
            <RefreshCw className="w-3 h-3" /> Shifting
          </span>
        );
      case 'dormant':
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-neutral-900 border border-neutral-700 text-neutral-400">
            <Clock className="w-3 h-3" /> Dormant
          </span>
        );
    }
  };

  if (isLoading) {
    return (
      <div id="evolution-loading-container" className="py-20 text-center space-y-4">
        <div className="w-12 h-12 rounded-2xl bg-indigo-950/60 border border-indigo-800/60 flex items-center justify-center mx-auto text-indigo-400">
          <Compass className="w-6 h-6 animate-pulse" />
        </div>
        <p className="text-sm text-neutral-400">Loading your Thought Evolution records...</p>
      </div>
    );
  }

  return (
    <div id="thought-evolution-view" className="space-y-8 max-w-5xl mx-auto pb-12">
      {/* Top Header Banner */}
      <header className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6 backdrop-blur-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-indigo-950 border border-indigo-800/60 flex items-center justify-center text-indigo-400 shrink-0">
                <Compass className="w-5 h-5" />
              </div>
              <h2 className="text-lg font-semibold text-neutral-100 tracking-tight">Thought Evolution Engine</h2>
              <span className="px-2 py-0.5 rounded-full bg-indigo-950 border border-indigo-800/60 text-indigo-300 text-[10px] uppercase font-mono tracking-wider">
                Milestone 9
              </span>
            </div>
            <p className="text-xs text-neutral-400 leading-relaxed max-w-2xl mt-1">
              Cross-thread thematic analysis synthesized by Gemini over your authoritative journal history. Discover recurring patterns, shifts in focus, and ideas worth revisiting.
            </p>
          </div>

          <div className="flex items-center gap-2.5 shrink-0 flex-wrap">
            <button
              id="refresh-evolution-btn"
              onClick={() => handleGenerate(false)}
              disabled={isGenerating}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-medium bg-indigo-600 hover:bg-indigo-500 disabled:bg-neutral-800 text-white disabled:text-neutral-500 transition-colors cursor-pointer shadow-sm disabled:cursor-not-allowed"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isGenerating ? 'animate-spin' : ''}`} />
              <span>{isGenerating ? 'Synthesizing...' : 'Analyze Evolution'}</span>
            </button>

            {evolutionDoc?.status === 'ready' && (
              <button
                id="force-refresh-evolution-btn"
                onClick={() => handleGenerate(true)}
                disabled={isGenerating}
                title="Bypass content cache and force fresh Gemini synthesis"
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-neutral-300 hover:text-white transition-colors cursor-pointer disabled:opacity-50"
              >
                <Zap className="w-3.5 h-3.5 text-amber-400" />
                <span className="hidden sm:inline">Force Re-compute</span>
              </button>
            )}
          </div>
        </div>

        {/* Status Indicators & Metadata */}
        {evolutionDoc?.status === 'ready' && (
          <div className="mt-5 pt-4 border-t border-neutral-800/80 flex flex-wrap items-center justify-between gap-3 text-xs text-neutral-400 font-mono">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="flex items-center gap-1 text-neutral-300">
                <Clock className="w-3.5 h-3.5 text-neutral-500" />
                Generated {new Date(evolutionDoc.generatedAt).toLocaleDateString()} at {new Date(evolutionDoc.generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>

              {isCachedHit && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-neutral-950 border border-neutral-800 text-emerald-400 text-[11px]">
                  <CheckCircle2 className="w-3 h-3" /> Cached (Unchanged History)
                </span>
              )}

              {evolutionDoc.modelMetadata && (
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-neutral-950 border border-neutral-800 text-neutral-300 text-[11px]">
                  <Cpu className="w-3 h-3 text-indigo-400" />
                  {evolutionDoc.modelMetadata.modelUsed}
                  {evolutionDoc.modelMetadata.fallbackUsed && (
                    <span className="text-amber-400">(Fallback)</span>
                  )}
                  <span className="text-neutral-500">{evolutionDoc.modelMetadata.latencyMs}ms</span>
                </span>
              )}
            </div>

            <span className="text-[11px] text-neutral-500">
              Content Hash: {evolutionDoc.contentHash.slice(0, 8)}...
            </span>
          </div>
        )}
      </header>

      {/* Error Alert */}
      {errorBanner && (
        <div id="evolution-error-alert" className="p-4 rounded-xl border border-rose-900/80 bg-rose-950/40 text-xs text-rose-300 flex items-start gap-3">
          <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-semibold text-rose-200">Evolution Synthesis Notice</p>
            <p className="leading-relaxed">{errorBanner}</p>
          </div>
        </div>
      )}

      {/* Empty State / Not Generated Yet */}
      {!evolutionDoc && !isGenerating && (
        <div id="evolution-empty-state" className="rounded-2xl border border-dashed border-neutral-800 bg-neutral-950/40 p-12 text-center space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-indigo-950/40 border border-indigo-800/40 flex items-center justify-center mx-auto text-indigo-400">
            <Compass className="w-6 h-6" />
          </div>
          <h3 className="text-base font-semibold text-neutral-200">No Evolution Synthesis Yet</h3>
          <p className="text-xs text-neutral-400 max-w-md mx-auto leading-relaxed">
            Thought Evolution inspects your historical journal entries to map how your thoughts, creative inquiries, and priorities grow over time.
          </p>
          <button
            id="start-first-evolution-btn"
            onClick={() => handleGenerate(false)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white transition-colors cursor-pointer"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Compute First Evolution Report</span>
          </button>
        </div>
      )}

      {/* Insufficient History State */}
      {evolutionDoc?.status === 'insufficient_history' && (
        <div id="evolution-insufficient-history" className="rounded-2xl border border-amber-800/60 bg-amber-950/20 p-8 text-center space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-amber-950/60 border border-amber-800/60 flex items-center justify-center mx-auto text-amber-400">
            <Info className="w-6 h-6" />
          </div>
          <h3 className="text-base font-semibold text-amber-200">More Journal Reflections Needed</h3>
          <p className="text-xs text-neutral-300 max-w-md mx-auto leading-relaxed">
            {evolutionDoc.message || 'Thought Evolution requires at least 2 journal reflections to discover patterns and evolving thoughts.'}
          </p>
          <div className="p-3 rounded-xl bg-neutral-950 border border-neutral-800 text-xs text-neutral-400 inline-block max-w-md">
            Current History: <strong className="text-neutral-200">{evolutionDoc.metrics.totalInteractionsAnalyzed}</strong> reflection recorded across <strong className="text-neutral-200">{evolutionDoc.metrics.totalThreadsAnalyzed}</strong> thread.
          </div>
          {onNavigateToJournal && (
            <div>
              <button
                id="continue-journaling-btn"
                onClick={onNavigateToJournal}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-medium bg-amber-600 hover:bg-amber-500 text-white transition-colors cursor-pointer"
              >
                <span>Continue Journaling</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      )}

      {/* Ready State: Full Synthesis Dashboard */}
      {evolutionDoc?.status === 'ready' && (
        <div id="evolution-synthesis-content" className="space-y-8">
          {/* 1. Deterministic Metrics & Facts Bar */}
          <section aria-labelledby="metrics-heading" className="space-y-3">
            <h3 id="metrics-heading" className="text-xs font-semibold uppercase tracking-wider text-neutral-400 flex items-center gap-2">
              <ShieldCheck className="w-3.5 h-3.5 text-indigo-400" />
              Deterministic History Facts
            </h3>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-4 rounded-xl border border-neutral-800 bg-neutral-900/30">
                <span className="text-neutral-400 text-[11px] block">Analyzed Reflections</span>
                <span className="text-xl font-semibold text-neutral-100 font-mono mt-1 block">
                  {evolutionDoc.metrics.totalInteractionsAnalyzed}
                </span>
                <span className="text-[10px] text-neutral-500 block mt-0.5">25 Global Max Bound</span>
              </div>

              <div className="p-4 rounded-xl border border-neutral-800 bg-neutral-900/30">
                <span className="text-neutral-400 text-[11px] block">Threads Represented</span>
                <span className="text-xl font-semibold text-neutral-100 font-mono mt-1 block">
                  {evolutionDoc.metrics.totalThreadsAnalyzed}
                </span>
                <span className="text-[10px] text-neutral-500 block mt-0.5">Max 5 per thread</span>
              </div>

              <div className="p-4 rounded-xl border border-neutral-800 bg-neutral-900/30">
                <span className="text-neutral-400 text-[11px] block">Journal Span</span>
                <span className="text-sm font-semibold text-neutral-100 font-mono mt-2 block truncate">
                  {evolutionDoc.metrics.dateRange.firstInteractionDate 
                    ? `${new Date(evolutionDoc.metrics.dateRange.firstInteractionDate).toLocaleDateString()} - ${new Date(evolutionDoc.metrics.dateRange.lastInteractionDate).toLocaleDateString()}` 
                    : 'N/A'}
                </span>
                <span className="text-[10px] text-neutral-500 block mt-0.5">Chronological Range</span>
              </div>

              <div className="p-4 rounded-xl border border-neutral-800 bg-neutral-900/30">
                <span className="text-neutral-400 text-[11px] block">Days Since Reflection</span>
                <span className="text-xl font-semibold text-neutral-100 font-mono mt-1 block">
                  {evolutionDoc.metrics.daysSinceLastJournal}d
                </span>
                <span className="text-[10px] text-neutral-500 block mt-0.5">Recency Cadence</span>
              </div>
            </div>

            {/* Top Themes By Frequency */}
            {evolutionDoc.metrics.topThemesByFrequency.length > 0 && (
              <div className="p-3.5 rounded-xl border border-neutral-800/80 bg-neutral-900/20 text-xs flex items-center gap-2 flex-wrap">
                <span className="text-neutral-400 text-[11px] font-medium mr-1">Recurring Themes:</span>
                {evolutionDoc.metrics.topThemesByFrequency.map((t, idx) => (
                  <span
                    key={idx}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-neutral-950 border border-neutral-800 text-neutral-200"
                  >
                    <span className="font-medium text-neutral-300">{t.theme}</span>
                    <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-neutral-800 text-neutral-400">
                      {t.count}x
                    </span>
                  </span>
                ))}
              </div>
            )}
          </section>

          {/* 2. Overall Narrative Synthesis */}
          {evolutionDoc.insights?.overallSynthesis && (
            <section aria-labelledby="synthesis-heading" className="rounded-2xl border border-indigo-900/40 bg-indigo-950/10 p-6 space-y-2">
              <div className="flex items-center gap-2 text-indigo-400 text-xs font-semibold uppercase tracking-wider">
                <Sparkles className="w-4 h-4" />
                <h3 id="synthesis-heading">Thematic Evolution Narrative</h3>
              </div>
              <p className="text-sm text-neutral-200 leading-relaxed font-sans">
                {evolutionDoc.insights.overallSynthesis}
              </p>
            </section>
          )}

          {/* 3. Evolving Patterns */}
          {evolutionDoc.insights?.evolvingPatterns && evolutionDoc.insights.evolvingPatterns.length > 0 && (
            <section aria-labelledby="patterns-heading" className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 id="patterns-heading" className="text-xs font-semibold uppercase tracking-wider text-neutral-400 flex items-center gap-2">
                  <TrendingUp className="w-3.5 h-3.5 text-indigo-400" />
                  Evolving Patterns & Trajectories
                </h3>
                <span className="text-[11px] text-neutral-500 font-mono">
                  Ground-truth citations required
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {evolutionDoc.insights.evolvingPatterns.map((pattern, idx) => (
                  <div
                    key={idx}
                    id={`evolution-pattern-${idx}`}
                    className="p-5 rounded-2xl border border-neutral-800 bg-neutral-900/30 space-y-3 flex flex-col justify-between"
                  >
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <h4 className="text-sm font-semibold text-neutral-100 tracking-tight">
                          {pattern.theme}
                        </h4>
                        {getTrajectoryBadge(pattern.trajectory)}
                      </div>
                      <p className="text-xs text-neutral-300 leading-relaxed">
                        {pattern.observation}
                      </p>
                    </div>

                    {/* Verified Evidence Badges */}
                    <div className="pt-3 border-t border-neutral-800/60 space-y-1.5">
                      <span className="text-[10px] text-neutral-500 uppercase tracking-wider block">
                        Verified Supporting Entries:
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        {pattern.evidence.map((cit) => (
                          <button
                            key={cit.interactionId}
                            onClick={() => handleOpenEvidence(cit)}
                            title={`Inspect supporting reflection from ${cit.threadTitle}`}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-neutral-950 hover:bg-neutral-800 border border-neutral-800 hover:border-neutral-700 text-neutral-300 hover:text-white text-[11px] transition-colors cursor-pointer"
                          >
                            <FileText className="w-3 h-3 text-indigo-400" />
                            <span className="truncate max-w-[120px]">{cit.threadTitle}</span>
                            <span className="text-neutral-500 font-mono text-[10px]">
                              {new Date(cit.date).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                            </span>
                            <ExternalLink className="w-2.5 h-2.5 text-neutral-500" />
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* 4. Ideas Worth Revisiting */}
          {evolutionDoc.insights?.ideasWorthRevisiting && evolutionDoc.insights.ideasWorthRevisiting.length > 0 && (
            <section aria-labelledby="revisiting-heading" className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 id="revisiting-heading" className="text-xs font-semibold uppercase tracking-wider text-neutral-400 flex items-center gap-2">
                  <Bookmark className="w-3.5 h-3.5 text-amber-400" />
                  Ideas Worth Revisiting
                </h3>
                <span className="text-[11px] text-neutral-500 font-mono">
                  Dormant thoughts ripe for clarity
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {evolutionDoc.insights.ideasWorthRevisiting.map((idea, idx) => (
                  <div
                    key={idx}
                    id={`idea-worth-revisiting-${idx}`}
                    className="p-5 rounded-2xl border border-neutral-800 bg-neutral-900/30 space-y-3 flex flex-col justify-between"
                  >
                    <div className="space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <h4 className="text-sm font-semibold text-amber-200 leading-snug">
                          {idea.title}
                        </h4>
                      </div>
                      <p className="text-xs text-neutral-300 leading-relaxed">
                        {idea.context}
                      </p>

                      <div className="p-3 rounded-xl bg-neutral-950/80 border border-neutral-800 text-xs text-indigo-300/90 leading-relaxed">
                        <span className="text-[10px] text-indigo-400 uppercase font-mono block mb-1">Inquiry to Reopen:</span>
                        "{idea.openQuestion}"
                      </div>
                    </div>

                    <div className="pt-3 border-t border-neutral-800/60">
                      <button
                        onClick={() => handleOpenEvidence(idea.evidence)}
                        title="View original reflection"
                        className="w-full inline-flex items-center justify-between px-3 py-1.5 rounded-lg bg-neutral-950 hover:bg-neutral-800 border border-neutral-800 hover:border-neutral-700 text-neutral-300 text-xs transition-colors cursor-pointer"
                      >
                        <span className="flex items-center gap-1.5 truncate">
                          <FileText className="w-3 h-3 text-amber-400" />
                          <span className="truncate max-w-[140px]">{idea.evidence.threadTitle}</span>
                        </span>
                        <span className="text-neutral-500 font-mono text-[10px]">
                          {new Date(idea.evidence.date).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                        </span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* 5. Contemplative Questions */}
          {evolutionDoc.insights?.unresolvedQuestions && evolutionDoc.insights.unresolvedQuestions.length > 0 && (
            <section aria-labelledby="questions-heading" className="rounded-2xl border border-neutral-800 bg-neutral-900/30 p-6 space-y-4">
              <h3 id="questions-heading" className="text-xs font-semibold uppercase tracking-wider text-neutral-400 flex items-center gap-2">
                <HelpCircle className="w-3.5 h-3.5 text-indigo-400" />
                Unresolved Questions Arising from Your Journey
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {evolutionDoc.insights.unresolvedQuestions.map((q, idx) => (
                  <div
                    key={idx}
                    className="p-4 rounded-xl border border-neutral-800/80 bg-neutral-950/60 text-xs text-neutral-200 leading-relaxed flex items-start gap-2.5"
                  >
                    <span className="w-5 h-5 rounded-full bg-indigo-950 border border-indigo-800/60 text-indigo-400 font-mono text-[11px] flex items-center justify-center shrink-0 mt-0.5">
                      {idx + 1}
                    </span>
                    <p>{q}</p>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {/* Supporting Evidence Modal / On-Demand Dereferencing Drawer */}
      {activeEvidenceModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="evidence-dialog-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs"
        >
          <div className="w-full max-w-xl rounded-2xl border border-neutral-800 bg-neutral-900 shadow-2xl p-6 space-y-4 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-neutral-800">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-indigo-400" />
                <h4 id="evidence-dialog-title" className="text-sm font-semibold text-neutral-200">
                  Supporting Journal Thought
                </h4>
              </div>
              <button
                onClick={() => setActiveEvidenceModal(null)}
                aria-label="Close supporting thought dialog"
                className="p-1 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {isLoadingEvidence ? (
              <div className="py-12 text-center text-xs text-neutral-400 space-y-2">
                <RefreshCw className="w-4 h-4 animate-spin mx-auto text-indigo-400" />
                <p>Retrieving verified supporting thought from Cloud Firestore...</p>
              </div>
            ) : !evidenceData?.available ? (
              <div className="p-4 rounded-xl border border-neutral-800 bg-neutral-950 text-xs text-neutral-400 space-y-2 text-center">
                <AlertCircle className="w-5 h-5 text-amber-400 mx-auto" />
                <p className="font-medium text-neutral-300">
                  {evidenceData?.message || 'This supporting thought is no longer available in your active journal.'}
                </p>
                <p className="text-[11px] text-neutral-500">
                  The journal thread or interaction may have been modified or deleted since the evolution report was synthesized.
                </p>
              </div>
            ) : (
              <div className="space-y-4 text-xs">
                <div className="flex items-center justify-between text-neutral-400 font-mono text-[11px]">
                  <span>Thread: <strong className="text-neutral-200">{evidenceData.threadTitle}</strong></span>
                  {evidenceData.date && (
                    <span>{new Date(evidenceData.date).toLocaleDateString()}</span>
                  )}
                </div>

                {evidenceData.userPrompt && (
                  <div className="space-y-1.5">
                    <span className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">Your Prompt:</span>
                    <div className="p-3.5 rounded-xl bg-neutral-950 border border-neutral-800 text-neutral-200 leading-relaxed whitespace-pre-wrap">
                      {evidenceData.userPrompt}
                    </div>
                  </div>
                )}

                {evidenceData.summary && (
                  <div className="space-y-1.5">
                    <span className="text-[11px] font-semibold text-indigo-400 uppercase tracking-wider">Reflection Summary:</span>
                    <div className="p-3 rounded-xl bg-indigo-950/20 border border-indigo-900/40 text-neutral-200 leading-relaxed">
                      {evidenceData.summary}
                    </div>
                  </div>
                )}

                {evidenceData.geminiResponse && (
                  <div className="space-y-1.5">
                    <span className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">Gemini's Response:</span>
                    <div className="p-3.5 rounded-xl bg-neutral-950 border border-neutral-800 text-neutral-300 leading-relaxed max-h-48 overflow-y-auto whitespace-pre-wrap">
                      {evidenceData.geminiResponse}
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="pt-3 border-t border-neutral-800 flex justify-end">
              <button
                onClick={() => setActiveEvidenceModal(null)}
                className="px-4 py-1.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-xs font-medium transition-colors cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
