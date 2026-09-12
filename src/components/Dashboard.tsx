/**
 * Protected Dashboard View for Gemini ThoughtVault
 * 
 * Production Security Enforcement:
 * 1. Accessible ONLY when user is authenticated.
 * 2. Displays the authoritative Firebase UID derived strictly from authentication state.
 * 3. Zero capability for client-side UID substitution or impersonation.
 * 4. Modular scaffolding for upcoming Milestones (Journaling, Thought Evolution, Ask My Journal).
 */

import { useState } from 'react';
import { 
  ShieldCheck, 
  Lock, 
  BookOpen, 
  Compass, 
  Search, 
  LogOut, 
  Sparkles, 
  Key, 
  Clock, 
  UserCheck,
  Calendar,
  Eye,
  EyeOff,
  Send,
  RefreshCw,
  AlertCircle,
  MessageSquare,
  Tag,
  HelpCircle,
  Cpu,
  Trash2,
  CheckCircle2
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { sendJournalReflection } from '../lib/api';
import type { ConversationTurn, JournalReflectionData } from '../types';

interface SessionInteraction {
  id: string;
  userPrompt: string;
  geminiResponse: string;
  insights: {
    coreThemes: string[];
    openQuestions: string[];
  };
  modelMetadata: {
    modelUsed: string;
    fallbackUsed: boolean;
    attemptsCount: number;
    latencyMs: number;
  };
  timestamp: string;
}

export function Dashboard() {
  const { user, logout } = useAuth();
  const [activeTab, setActiveTab] = useState<'journal' | 'evolution' | 'ask'>('journal');
  const [reflectionInput, setReflectionInput] = useState('');
  const [showFullUid, setShowFullUid] = useState(false);
  
  // Active session multi-turn conversation state
  const [sessionInteractions, setSessionInteractions] = useState<SessionInteraction[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [lastAttemptedPrompt, setLastAttemptedPrompt] = useState<string | null>(null);

  if (!user) {
    return null; // Route guarded by parent
  }

  // Convert session interactions into ConversationTurn format for Gemini multi-turn
  const buildConversationHistory = (): ConversationTurn[] => {
    const history: ConversationTurn[] = [];
    for (const item of sessionInteractions.slice(-5)) { // Keep latest turns bounded
      history.push({ role: 'user', text: item.userPrompt });
      history.push({ role: 'model', text: item.geminiResponse });
    }
    return history;
  };

  const handleGenerateReflection = async () => {
    const trimmed = reflectionInput.trim();
    if (!trimmed || isSubmitting) return;

    setIsSubmitting(true);
    setSubmissionError(null);
    setLastAttemptedPrompt(trimmed);

    try {
      const history = buildConversationHistory();
      const reflectionData: JournalReflectionData = await sendJournalReflection({
        prompt: trimmed,
        history,
      });

      const newInteraction: SessionInteraction = {
        id: `sess_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        userPrompt: reflectionData.userPrompt,
        geminiResponse: reflectionData.geminiResponse,
        insights: reflectionData.insights,
        modelMetadata: reflectionData.modelMetadata,
        timestamp: reflectionData.timestamp,
      };

      setSessionInteractions((prev) => [...prev, newInteraction]);
      setReflectionInput(''); // Clear ONLY on confirmed success
      setLastAttemptedPrompt(null);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to generate reflection.';
      setSubmissionError(errorMessage);
      // NOTE: reflectionInput is preserved so user never loses their draft!
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRetry = () => {
    if (lastAttemptedPrompt) {
      setReflectionInput(lastAttemptedPrompt);
      handleGenerateReflection();
    }
  };

  const handleClearSession = () => {
    if (sessionInteractions.length > 0) {
      setSessionInteractions([]);
      setSubmissionError(null);
    }
  };

  // Collect all discovered session themes
  const sessionThemes = Array.from(
    new Set(sessionInteractions.flatMap((item) => item.insights.coreThemes))
  );

  return (
    <div id="protected-dashboard" className="min-h-[calc(100vh-4rem)] max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Session Identity Verification Banner */}
      <section 
        id="session-verification-banner"
        className="mb-8 rounded-2xl border border-neutral-800 bg-neutral-900/60 p-5 sm:p-6 backdrop-blur-sm"
      >
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-emerald-950/80 border border-emerald-800/60 flex items-center justify-center text-emerald-400 shrink-0 mt-0.5">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-base font-semibold text-neutral-100">
                  Authenticated Private Session
                </h1>
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-950/80 border border-emerald-800/80 text-emerald-300">
                  <UserCheck className="w-3 h-3" />
                  Verified Identity
                </span>
              </div>
              <div className="flex items-center gap-2 flex-wrap text-xs text-neutral-400">
                <span className="inline-flex items-center gap-1.5 font-mono text-neutral-300 bg-neutral-950 px-2 py-0.5 rounded border border-neutral-800">
                  <Key className="w-3 h-3 text-indigo-400" />
                  <span>
                    UID: {showFullUid ? user.uid : `${user.uid.slice(0, 6)}...${user.uid.slice(-4)}`}
                  </span>
                  <button
                    id="toggle-uid-visibility-btn"
                    onClick={() => setShowFullUid(!showFullUid)}
                    className="text-neutral-500 hover:text-neutral-300 ml-0.5 transition-colors cursor-pointer"
                    title={showFullUid ? "Mask UID" : "Reveal full UID"}
                    aria-label={showFullUid ? "Mask UID" : "Reveal full UID"}
                  >
                    {showFullUid ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                  </button>
                </span>
                <span>&bull;</span>
                <span>{user.email}</span>
                <span>&bull;</span>
                <span className="text-neutral-500">Gemini Fallback Ladder Active</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              id="dashboard-logout-btn"
              onClick={logout}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-medium bg-neutral-800 hover:bg-neutral-700 text-neutral-200 transition-colors cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sign Out</span>
            </button>
          </div>
        </div>

        {/* Security Rule Assurance Bar */}
        <div className="mt-4 pt-4 border-t border-neutral-800/80 flex flex-col sm:flex-row sm:items-center justify-between text-[11px] text-neutral-400 gap-2">
          <div className="flex items-center gap-2">
            <Lock className="w-3.5 h-3.5 text-emerald-400" />
            <span>Server verifies Firebase ID token &bull; Model calls bound to <code className="font-mono text-neutral-300">{user.uid.slice(0, 8)}...</code></span>
          </div>
          <span className="text-neutral-500">Zero client-side API keys &bull; Fail-closed authorization</span>
        </div>
      </section>

      {/* Navigation Tabs for Application Modules */}
      <div className="flex border-b border-neutral-800 gap-2 sm:gap-4 mb-8 overflow-x-auto">
        <button
          id="tab-journal"
          onClick={() => setActiveTab('journal')}
          className={`flex items-center gap-2 pb-3.5 px-3 text-sm font-medium border-b-2 transition-all whitespace-nowrap cursor-pointer ${
            activeTab === 'journal'
              ? 'border-indigo-500 text-neutral-100'
              : 'border-transparent text-neutral-400 hover:text-neutral-200'
          }`}
        >
          <BookOpen className="w-4 h-4" />
          <span>Journal & Reflection</span>
          {sessionInteractions.length > 0 && (
            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-indigo-900/60 text-indigo-300 font-mono">
              {sessionInteractions.length}
            </span>
          )}
        </button>

        <button
          id="tab-evolution"
          onClick={() => setActiveTab('evolution')}
          className={`flex items-center gap-2 pb-3.5 px-3 text-sm font-medium border-b-2 transition-all whitespace-nowrap cursor-pointer ${
            activeTab === 'evolution'
              ? 'border-indigo-500 text-neutral-100'
              : 'border-transparent text-neutral-400 hover:text-neutral-200'
          }`}
        >
          <Compass className="w-4 h-4" />
          <span>Thought Evolution</span>
          <span className="px-1.5 py-0.2 rounded text-[10px] bg-neutral-800 text-neutral-400">Milestone 5</span>
        </button>

        <button
          id="tab-ask"
          onClick={() => setActiveTab('ask')}
          className={`flex items-center gap-2 pb-3.5 px-3 text-sm font-medium border-b-2 transition-all whitespace-nowrap cursor-pointer ${
            activeTab === 'ask'
              ? 'border-indigo-500 text-neutral-100'
              : 'border-transparent text-neutral-400 hover:text-neutral-200'
          }`}
        >
          <Search className="w-4 h-4" />
          <span>Ask My Journal</span>
          <span className="px-1.5 py-0.2 rounded text-[10px] bg-neutral-800 text-neutral-400">Milestone 5</span>
        </button>
      </div>

      {/* Tab 1: Journal Workspace */}
      {activeTab === 'journal' && (
        <div id="journal-workspace" className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* Left Column: Reflection Input Canvas and Conversation Stream */}
          <div className="lg:col-span-7 space-y-6">
            {/* Input Canvas */}
            <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-indigo-400" />
                  <h2 className="text-sm font-semibold text-neutral-200">
                    {sessionInteractions.length === 0 ? 'Start a New Reflection' : 'Continue Reflection'}
                  </h2>
                </div>
                <div className="flex items-center gap-2 text-xs text-neutral-500">
                  <Calendar className="w-3.5 h-3.5" />
                  <span>Session Active</span>
                </div>
              </div>

              <div className="space-y-2">
                <label htmlFor="journal-prompt-input" className="sr-only">
                  Your thoughts or reflection
                </label>
                <textarea
                  id="journal-prompt-input"
                  rows={5}
                  value={reflectionInput}
                  onChange={(e) => setReflectionInput(e.target.value)}
                  placeholder="What thoughts, challenges, or ideas are you navigating right now? Write openly..."
                  disabled={isSubmitting}
                  className="w-full rounded-xl border border-neutral-800 bg-neutral-950 p-4 text-sm text-neutral-200 placeholder-neutral-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-colors resize-y font-sans leading-relaxed disabled:opacity-50"
                />
              </div>

              {/* Error Banner with Preserved Draft Recovery */}
              {submissionError && (
                <div 
                  id="reflection-error-banner"
                  className="rounded-xl border border-rose-900/80 bg-rose-950/40 p-3.5 text-xs text-rose-300 flex items-start justify-between gap-3"
                >
                  <div className="flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-medium text-rose-200">AI Reflection Failed</p>
                      <p className="text-rose-300/80 mt-0.5">{submissionError}</p>
                      <p className="text-[11px] text-rose-400/70 mt-1 font-mono">Your draft has been preserved.</p>
                    </div>
                  </div>
                  <button
                    id="retry-reflection-btn"
                    onClick={handleRetry}
                    disabled={isSubmitting}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-900/80 hover:bg-rose-800 text-rose-100 font-medium shrink-0 transition-colors cursor-pointer disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isSubmitting ? 'animate-spin' : ''}`} />
                    <span>Retry</span>
                  </button>
                </div>
              )}

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
                <div className="flex items-center gap-3 text-xs text-neutral-500">
                  <span>{reflectionInput.length} / 10,000 characters</span>
                  {sessionInteractions.length > 0 && (
                    <button
                      id="clear-session-thread-btn"
                      onClick={handleClearSession}
                      disabled={isSubmitting}
                      className="inline-flex items-center gap-1 text-neutral-400 hover:text-neutral-200 transition-colors cursor-pointer"
                      title="Clear in-memory session thread"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>New Topic</span>
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-3">
                  <button
                    id="submit-journal-reflection-btn"
                    onClick={handleGenerateReflection}
                    disabled={isSubmitting || reflectionInput.trim().length === 0}
                    className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-xs font-medium bg-indigo-600 hover:bg-indigo-500 disabled:bg-neutral-800 text-white disabled:text-neutral-500 transition-colors cursor-pointer disabled:cursor-not-allowed"
                  >
                    {isSubmitting ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        <span>Reflecting with Gemini...</span>
                      </>
                    ) : (
                      <>
                        <Send className="w-3.5 h-3.5" />
                        <span>Reflect with Gemini</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>

            {/* Conversation Stream */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-400 flex items-center gap-2">
                  <MessageSquare className="w-3.5 h-3.5" />
                  <span>Session Conversation Thread</span>
                </h3>
                {sessionInteractions.length > 0 && (
                  <span className="text-[11px] text-neutral-500 font-mono">
                    {sessionInteractions.length} {sessionInteractions.length === 1 ? 'turn' : 'turns'}
                  </span>
                )}
              </div>

              {sessionInteractions.length === 0 ? (
                <div 
                  id="empty-journal-thread"
                  className="rounded-2xl border border-dashed border-neutral-800 bg-neutral-950/40 p-8 text-center space-y-3"
                >
                  <div className="w-10 h-10 rounded-xl bg-neutral-900 border border-neutral-800 flex items-center justify-center mx-auto text-neutral-500">
                    <BookOpen className="w-5 h-5" />
                  </div>
                  <h4 className="text-sm font-medium text-neutral-300">No reflections in this session</h4>
                  <p className="text-xs text-neutral-500 max-w-sm mx-auto leading-relaxed">
                    Write your thoughts above. Gemini will listen, uncover core themes, and ask thoughtful questions to help you understand your evolving perspectives.
                  </p>
                </div>
              ) : (
                <div id="journal-interactions-list" className="space-y-6">
                  {sessionInteractions.map((interaction, index) => (
                    <article
                      key={interaction.id}
                      id={`interaction-turn-${index}`}
                      className="rounded-2xl border border-neutral-800 bg-neutral-900/30 overflow-hidden"
                    >
                      {/* User Thought */}
                      <div className="p-5 border-b border-neutral-800/60 bg-neutral-900/20">
                        <div className="flex items-center justify-between text-xs text-neutral-400 mb-2">
                          <span className="font-medium text-neutral-300 flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-indigo-400"></span>
                            Your Thought
                          </span>
                          <span className="text-neutral-500 font-mono text-[11px]">
                            {new Date(interaction.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        <p className="text-sm text-neutral-200 whitespace-pre-wrap leading-relaxed">
                          {interaction.userPrompt}
                        </p>
                      </div>

                      {/* Gemini Reflection */}
                      <div className="p-5 space-y-4">
                        <div className="flex items-center justify-between flex-wrap gap-2 text-xs">
                          <div className="flex items-center gap-2">
                            <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                            <span className="font-semibold text-neutral-200">Gemini Reflection</span>
                          </div>
                          <div className="flex items-center gap-2 flex-wrap text-[11px]">
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-neutral-950 border border-neutral-800 text-neutral-300 font-mono">
                              <Cpu className="w-3 h-3 text-indigo-400" />
                              {interaction.modelMetadata.modelUsed}
                            </span>
                            {interaction.modelMetadata.fallbackUsed && (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-950/80 border border-amber-800/80 text-amber-300 text-[10px]">
                                Fallback Ladder Triggered
                              </span>
                            )}
                            <span className="text-neutral-500 font-mono">
                              {interaction.modelMetadata.latencyMs}ms
                            </span>
                          </div>
                        </div>

                        {/* Reflection Content */}
                        <div className="text-sm text-neutral-300 whitespace-pre-wrap leading-relaxed pl-3 border-l-2 border-indigo-500/40">
                          {interaction.geminiResponse}
                        </div>

                        {/* Extracted Core Themes */}
                        {interaction.insights.coreThemes.length > 0 && (
                          <div className="pt-2">
                            <p className="text-[11px] font-medium text-neutral-400 flex items-center gap-1 mb-2">
                              <Tag className="w-3 h-3 text-indigo-400" />
                              Core Themes
                            </p>
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {interaction.insights.coreThemes.map((theme, i) => (
                                <span
                                  key={i}
                                  className="px-2.5 py-1 rounded-lg text-xs bg-indigo-950/40 border border-indigo-800/50 text-indigo-300"
                                >
                                  {theme}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Open Questions to Contemplate */}
                        {interaction.insights.openQuestions.length > 0 && (
                          <div className="pt-2 border-t border-neutral-800/60">
                            <p className="text-[11px] font-medium text-neutral-400 flex items-center gap-1 mb-2">
                              <HelpCircle className="w-3 h-3 text-indigo-400" />
                              Questions to Contemplate
                            </p>
                            <ul className="space-y-1.5 text-xs text-neutral-300">
                              {interaction.insights.openQuestions.map((q, i) => (
                                <li key={i} className="flex items-start gap-2">
                                  <span className="text-indigo-400 select-none">&bull;</span>
                                  <span className="italic">{q}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right Column: Session Themes & AI Fallback Architecture Status */}
          <div className="lg:col-span-5 space-y-6">
            {/* Discovered Session Themes */}
            <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-neutral-200 flex items-center gap-2">
                  <Tag className="w-4 h-4 text-indigo-400" />
                  <span>Session Themes</span>
                </h3>
                <span className="text-xs text-neutral-500 font-mono">
                  {sessionThemes.length} identified
                </span>
              </div>

              {sessionThemes.length === 0 ? (
                <p className="text-xs text-neutral-500 leading-relaxed">
                  As you converse with Gemini, recurring ideas and themes will be summarized here to guide your reflection.
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {sessionThemes.map((theme, i) => (
                    <span 
                      key={i}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs bg-neutral-950 border border-neutral-800 text-neutral-200"
                    >
                      <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                      {theme}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Gemini Fallback Engine Architecture Card */}
            <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-5 space-y-3 text-xs">
              <div className="flex items-center gap-2 text-neutral-200 font-semibold">
                <Cpu className="w-4 h-4 text-indigo-400" />
                <span>4-Tier Fallback Ladder</span>
              </div>
              <p className="text-neutral-400 leading-relaxed">
                All generation calls strictly adhere to the project Security Constitution fallback ladder:
              </p>
              <ol className="space-y-1.5 font-mono text-[11px] text-neutral-300">
                <li className="flex items-center gap-2">
                  <span className="text-indigo-400">1.</span>
                  <span>gemini-3.6-flash</span>
                  <span className="text-[10px] text-emerald-400 font-sans ml-auto">Primary</span>
                </li>
                <li className="flex items-center gap-2 text-neutral-400">
                  <span className="text-neutral-600">2.</span>
                  <span>gemini-3.1-flash-lite</span>
                  <span className="text-[10px] text-neutral-500 font-sans ml-auto">Fallback 1</span>
                </li>
                <li className="flex items-center gap-2 text-neutral-400">
                  <span className="text-neutral-600">3.</span>
                  <span>gemini-flash-latest</span>
                  <span className="text-[10px] text-neutral-500 font-sans ml-auto">Fallback 2</span>
                </li>
                <li className="flex items-center gap-2 text-neutral-400">
                  <span className="text-neutral-600">4.</span>
                  <span>gemini-3.7-flash</span>
                  <span className="text-[10px] text-neutral-500 font-sans ml-auto">Fallback 3</span>
                </li>
              </ol>
              <div className="pt-2 border-t border-neutral-800/80 text-[11px] text-neutral-500">
                Recovers transparently from 429 (quota), 503 (overload), 404, or 500 errors.
              </div>
            </div>

            {/* Architecture Preview: Milestone 5 Firestore Notice */}
            <div className="rounded-2xl border border-neutral-800/70 bg-neutral-900/20 p-5 text-xs text-neutral-400 space-y-2">
              <p className="font-medium text-neutral-300 flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5 text-indigo-400" />
                Milestone 5 Persistence Ready
              </p>
              <p className="leading-relaxed">
                Current reflections exist in-memory for this active browser session. In Milestone 5, the response payload will be persisted to{' '}
                <code className="text-neutral-300 font-mono">/users/{user.uid}/interactions</code> without modifying this API contract.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Tab 2: Thought Evolution Scaffold */}
      {activeTab === 'evolution' && (
        <div id="evolution-scaffold" className="rounded-2xl border border-neutral-800 bg-neutral-900/30 p-8 text-center space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-indigo-950/60 border border-indigo-800/60 flex items-center justify-center mx-auto text-indigo-400">
            <Compass className="w-6 h-6" />
          </div>
          <h3 className="text-base font-semibold text-neutral-200">Thought Evolution Engine</h3>
          <p className="text-sm text-neutral-400 max-w-md mx-auto leading-relaxed">
            The original Thought Evolution engine will analyze patterns across your historical thoughts, recurring themes, and unresolved ideas. Scheduled for Milestone 5.
          </p>
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-neutral-900 border border-neutral-800 text-xs text-neutral-400">
            <span>Pre-requisite: Milestone 5 Firestore Database</span>
          </div>
        </div>
      )}

      {/* Tab 3: Ask My Journal Scaffold */}
      {activeTab === 'ask' && (
        <div id="ask-scaffold" className="rounded-2xl border border-neutral-800 bg-neutral-900/30 p-8 text-center space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-amber-950/60 border border-amber-800/60 flex items-center justify-center mx-auto text-amber-400">
            <Search className="w-6 h-6" />
          </div>
          <h3 className="text-base font-semibold text-neutral-200">Ask My Journal (Grounded RAG)</h3>
          <p className="text-sm text-neutral-400 max-w-md mx-auto leading-relaxed">
            Ask natural language questions about decisions and ideas you recorded in the past. Answers are strictly grounded in your verified entries. Scheduled for Milestone 5.
          </p>
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-neutral-900 border border-neutral-800 text-xs text-neutral-400">
            <span>Pre-requisite: Milestone 5 Firestore Database</span>
          </div>
        </div>
      )}
    </div>
  );
}
