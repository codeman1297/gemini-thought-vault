/**
 * Protected Dashboard View for Gemini ThoughtVault
 * Milestone 5: Persistent Cloud Firestore Storage, Authoritative History, & Retry Save
 * 
 * Production Security Rules:
 * 1. Accessible ONLY when user is authenticated.
 * 2. All thread and interaction operations are scoped strictly to the authenticated user's UID.
 * 3. Authoritative conversation history is loaded server-side from Cloud Firestore.
 * 4. Zero client-side API keys or privileged service credentials.
 * 5. Explicit persistence error handling & non-destructive "Retry Save" flow.
 * 6. Idempotency tokens protect against duplicate database writes.
 */

import { useState, useEffect, useCallback } from 'react';
import { 
  ShieldCheck, 
  Lock, 
  BookOpen, 
  Compass, 
  Search, 
  LogOut, 
  Sparkles, 
  Key, 
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
  Plus,
  Database,
  CloudCheck,
  CheckCircle2,
  AlertTriangle,
  FileText,
  ListChecks
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { 
  listJournalThreads, 
  getJournalThread, 
  sendJournalReflection, 
  retrySaveInteraction 
} from '../lib/api';
import type { 
  JournalThread, 
  JournalInteraction, 
  PendingPersistenceRecord 
} from '../types';
import { ThoughtEvolutionView } from './ThoughtEvolutionView';
import { PersonalInsightsView } from './PersonalInsightsView';

export function Dashboard() {
  const { user, logout } = useAuth();
  const [activeTab, setActiveTab] = useState<'journal' | 'evolution' | 'ask' | 'insights'>('journal');
  const [reflectionInput, setReflectionInput] = useState('');
  const [showFullUid, setShowFullUid] = useState(false);
  
  // Persistent Firestore Thread State
  const [threads, setThreads] = useState<JournalThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [activeThread, setActiveThread] = useState<JournalThread | null>(null);
  const [activeInteractions, setActiveInteractions] = useState<JournalInteraction[]>([]);
  const [isLoadingThreads, setIsLoadingThreads] = useState(false);
  const [isLoadingThreadDetails, setIsLoadingThreadDetails] = useState(false);

  // Interaction & Persistence State
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [pendingSaveRecord, setPendingSaveRecord] = useState<PendingPersistenceRecord | null>(null);
  const [isRetryingSave, setIsRetryingSave] = useState(false);
  const [lastAttemptedPrompt, setLastAttemptedPrompt] = useState<string | null>(null);

  if (!user) {
    return null; // Route guarded by parent
  }

  // Load user's threads from Firestore
  const loadThreads = useCallback(async (selectThreadId?: string) => {
    setIsLoadingThreads(true);
    try {
      const userThreads = await listJournalThreads();
      setThreads(userThreads);

      // Determine active thread
      const targetId = selectThreadId || (userThreads.length > 0 ? userThreads[0].id : null);
      if (targetId) {
        setActiveThreadId(targetId);
      }
    } catch (err) {
      console.error('[CLIENT ERROR] Failed to load threads:', err);
    } finally {
      setIsLoadingThreads(false);
    }
  }, []);

  // Initial load of threads on mount
  useEffect(() => {
    loadThreads();
  }, [loadThreads]);

  // Load interactions when activeThreadId changes
  useEffect(() => {
    if (!activeThreadId) {
      setActiveThread(null);
      setActiveInteractions([]);
      return;
    }

    let isMounted = true;
    setIsLoadingThreadDetails(true);
    getJournalThread(activeThreadId)
      .then(({ thread, interactions }) => {
        if (isMounted) {
          setActiveThread(thread);
          setActiveInteractions(interactions);
        }
      })
      .catch((err) => {
        if (isMounted) {
          console.error('[CLIENT ERROR] Failed to fetch thread details:', err);
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsLoadingThreadDetails(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [activeThreadId]);

  // Handler to start a new blank thread
  const handleStartNewThread = () => {
    setActiveThreadId(null);
    setActiveThread(null);
    setActiveInteractions([]);
    setSubmissionError(null);
    setPendingSaveRecord(null);
    setReflectionInput('');
  };

  // Handler to submit a reflection prompt
  const handleGenerateReflection = async () => {
    const trimmed = reflectionInput.trim();
    if (!trimmed || isSubmitting) return;

    setIsSubmitting(true);
    setSubmissionError(null);
    setPendingSaveRecord(null);
    setLastAttemptedPrompt(trimmed);

    // Generate unique client idempotency token
    const clientInteractionId = `int_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    try {
      const reflectionData = await sendJournalReflection({
        threadId: activeThreadId || undefined,
        prompt: trimmed,
        clientInteractionId,
      });

      // Construct interaction from verified response
      const newInteraction: JournalInteraction = {
        id: reflectionData.interactionId,
        threadId: reflectionData.threadId,
        userId: user.uid,
        turnIndex: reflectionData.turnIndex,
        userPrompt: reflectionData.userPrompt,
        geminiResponse: reflectionData.geminiResponse,
        insights: reflectionData.insights,
        modelMetadata: reflectionData.modelMetadata,
        clientInteractionId,
        createdAt: reflectionData.timestamp,
      };

      setActiveInteractions((prev) => [...prev, newInteraction]);
      setActiveThreadId(reflectionData.threadId);
      setReflectionInput(''); // Clear ONLY on confirmed success
      setLastAttemptedPrompt(null);

      // Refresh threads list in background to update snippets and counts
      loadThreads(reflectionData.threadId);
    } catch (err: unknown) {
      const customErr = err as { code?: string; pendingRecord?: PendingPersistenceRecord; message?: string };
      
      if (customErr.code === 'DATABASE_PERSISTENCE_FAILED' && customErr.pendingRecord) {
        // Specific Persistence Failure: AI response succeeded, but DB write failed
        setPendingSaveRecord(customErr.pendingRecord);
        setSubmissionError(customErr.message || 'Saving to your ThoughtVault failed. Your reflection is held in memory.');
      } else {
        // AI Generation or Network Error
        setSubmissionError(customErr.message || 'Failed to generate reflection. Your draft has been preserved.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handler for "Retry Save"
  const handleRetrySave = async () => {
    if (!pendingSaveRecord || isRetryingSave) return;

    setIsRetryingSave(true);
    try {
      const result = await retrySaveInteraction(pendingSaveRecord);
      
      setActiveInteractions((prev) => [...prev, result.interaction]);
      setPendingSaveRecord(null);
      setSubmissionError(null);
      setReflectionInput('');
      setLastAttemptedPrompt(null);

      // Refresh threads
      loadThreads(pendingSaveRecord.threadId);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Retry save failed.';
      setSubmissionError(msg);
    } finally {
      setIsRetryingSave(false);
    }
  };

  // Collect all discovered session themes in active thread
  const activeThemes = Array.from(
    new Set(activeInteractions.flatMap((item) => item.insights.coreThemes))
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
                  Authenticated Private ThoughtVault
                </h1>
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-950/80 border border-emerald-800/80 text-emerald-300">
                  <UserCheck className="w-3 h-3" />
                  Verified Identity
                </span>
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-indigo-950/80 border border-indigo-800/80 text-indigo-300">
                  <Database className="w-3 h-3" />
                  Cloud Firestore Active
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
                <span className="text-neutral-500">Authoritative History Loaded</span>
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
            <span>Path: <code className="font-mono text-neutral-300">/users/{user.uid.slice(0, 8)}.../threads</code> &bull; Owner-bound security rules enforced</span>
          </div>
          <span className="text-neutral-500">Zero client-supplied UID trust &bull; Idempotent transactions</span>
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
          <span>Journal & Persistent Threads</span>
          {threads.length > 0 && (
            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-indigo-900/60 text-indigo-300 font-mono">
              {threads.length}
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
          <span className="px-1.5 py-0.2 rounded text-[10px] bg-neutral-800 text-neutral-400">Milestone 6</span>
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
          <span className="px-1.5 py-0.2 rounded text-[10px] bg-neutral-800 text-neutral-400">Milestone 6</span>
        </button>

        <button
          id="tab-insights"
          onClick={() => setActiveTab('insights')}
          className={`flex items-center gap-2 pb-3.5 px-3 text-sm font-medium border-b-2 transition-all whitespace-nowrap cursor-pointer ${
            activeTab === 'insights'
              ? 'border-indigo-500 text-neutral-100'
              : 'border-transparent text-neutral-400 hover:text-neutral-200'
          }`}
        >
          <Sparkles className="w-4 h-4 text-indigo-400" />
          <span>Personal Insights</span>
          <span className="px-1.5 py-0.2 rounded text-[10px] bg-indigo-950 text-indigo-300 border border-indigo-800/50 font-mono">
            M10.6
          </span>
        </button>
      </div>

      {/* Tab 1: Journal Workspace with Persistent Threads */}
      {activeTab === 'journal' && (
        <div id="journal-workspace" className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* Left Column (4 cols): User's Persistent Threads List */}
          <aside className="lg:col-span-4 space-y-4">
            <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Database className="w-4 h-4 text-indigo-400" />
                  <h2 className="text-sm font-semibold text-neutral-200">
                    Thought Threads
                  </h2>
                </div>
                <button
                  id="new-thread-btn"
                  onClick={handleStartNewThread}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white transition-colors cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>New Thread</span>
                </button>
              </div>

              {/* Thread List */}
              <div className="space-y-2 max-h-[600px] overflow-y-auto pr-1">
                {isLoadingThreads ? (
                  <div className="py-8 text-center text-xs text-neutral-500 space-y-2">
                    <RefreshCw className="w-4 h-4 animate-spin mx-auto text-neutral-400" />
                    <p>Loading your private threads...</p>
                  </div>
                ) : threads.length === 0 ? (
                  <div className="py-8 text-center rounded-xl border border-dashed border-neutral-800 p-4 space-y-2">
                    <BookOpen className="w-5 h-5 mx-auto text-neutral-500" />
                    <p className="text-xs text-neutral-400 font-medium">No threads yet</p>
                    <p className="text-[11px] text-neutral-500 leading-relaxed">
                      Write your first thought on the right to start an encrypted, owner-bound journal thread.
                    </p>
                  </div>
                ) : (
                  threads.map((t) => {
                    const isSelected = t.id === activeThreadId;
                    return (
                      <button
                        key={t.id}
                        id={`thread-item-${t.id}`}
                        onClick={() => setActiveThreadId(t.id)}
                        className={`w-full text-left p-3 rounded-xl border transition-all cursor-pointer ${
                          isSelected
                            ? 'border-indigo-500/80 bg-indigo-950/20'
                            : 'border-neutral-800/80 bg-neutral-950/40 hover:bg-neutral-850 hover:border-neutral-700'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <h4 className="text-xs font-semibold text-neutral-200 truncate">
                            {t.title}
                          </h4>
                          <span className="px-1.5 py-0.2 rounded text-[10px] bg-neutral-800 text-neutral-400 font-mono shrink-0">
                            {t.turnCount} {t.turnCount === 1 ? 'turn' : 'turns'}
                          </span>
                        </div>
                        {(t.lastSummary || t.previewSnippet) && (
                          <p className="text-[11px] text-neutral-400 line-clamp-2 leading-relaxed mb-1.5">
                            {t.lastSummary || t.previewSnippet}
                          </p>
                        )}
                        <div className="flex items-center justify-between text-[10px] text-neutral-500">
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3 h-3" />
                            {new Date(t.updatedAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                          </span>
                          {t.coreThemes.length > 0 && (
                            <span className="text-indigo-400 truncate max-w-[120px]">
                              {t.coreThemes[0]}
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            {/* Discovered Themes in Active Thread */}
            <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-400 flex items-center gap-1.5">
                  <Tag className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Thread Themes</span>
                </h3>
                <span className="text-[11px] text-neutral-500 font-mono">
                  {activeThemes.length} identified
                </span>
              </div>

              {activeThemes.length === 0 ? (
                <p className="text-xs text-neutral-500 leading-relaxed">
                  Themes discovered by Gemini across this thread will be organized here.
                </p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {activeThemes.map((theme, i) => (
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

            {/* Security Guarantee Box */}
            <div className="rounded-2xl border border-neutral-800/80 bg-neutral-900/20 p-4 text-[11px] text-neutral-400 space-y-2">
              <div className="flex items-center gap-1.5 text-neutral-300 font-medium">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <span>Zero-Trust Storage Architecture</span>
              </div>
              <p className="leading-relaxed text-neutral-500">
                Firestore rules block any read or write where <code className="text-neutral-300 font-mono">request.auth.uid != userId</code>. No collection-group queries exist.
              </p>
            </div>
          </aside>

          {/* Right Column (8 cols): Active Thread Conversation & Input Canvas */}
          <main className="lg:col-span-8 space-y-6">
            {/* Thread Header Banner */}
            <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-indigo-950/80 border border-indigo-800/60 flex items-center justify-center text-indigo-400">
                  <BookOpen className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-neutral-100">
                    {activeThread ? activeThread.title : 'New Thought Thread'}
                  </h3>
                  <p className="text-[11px] text-neutral-500">
                    {activeThread ? `Updated ${new Date(activeThread.updatedAt).toLocaleString()}` : 'Ready to record thoughts'}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-mono bg-neutral-950 border border-neutral-800 text-emerald-400">
                  <CloudCheck className="w-3.5 h-3.5" />
                  <span>Firestore Persistent</span>
                </span>
              </div>
            </div>

            {/* Conversation Stream */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-400 flex items-center gap-2">
                  <MessageSquare className="w-3.5 h-3.5" />
                  <span>Authoritative Thread History</span>
                </h3>
                {activeInteractions.length > 0 && (
                  <span className="text-[11px] text-neutral-500 font-mono">
                    {activeInteractions.length} {activeInteractions.length === 1 ? 'interaction' : 'interactions'}
                  </span>
                )}
              </div>

              {isLoadingThreadDetails ? (
                <div className="py-12 text-center text-xs text-neutral-500 space-y-2">
                  <RefreshCw className="w-4 h-4 animate-spin mx-auto text-neutral-400" />
                  <p>Loading authoritative history from Firestore...</p>
                </div>
              ) : activeInteractions.length === 0 ? (
                <div 
                  id="empty-journal-thread"
                  className="rounded-2xl border border-dashed border-neutral-800 bg-neutral-950/40 p-8 text-center space-y-3"
                >
                  <div className="w-10 h-10 rounded-xl bg-neutral-900 border border-neutral-800 flex items-center justify-center mx-auto text-neutral-500">
                    <BookOpen className="w-5 h-5" />
                  </div>
                  <h4 className="text-sm font-medium text-neutral-300">No reflections in this thread yet</h4>
                  <p className="text-xs text-neutral-500 max-w-md mx-auto leading-relaxed">
                    Write your thoughts in the reflection canvas below. Your prompt and Gemini's insights will be authoritatively saved to Cloud Firestore.
                  </p>
                </div>
              ) : (
                <div id="journal-interactions-list" className="space-y-6">
                  {activeInteractions.map((interaction, index) => (
                    <article
                      key={interaction.id || index}
                      id={`interaction-turn-${index}`}
                      className="rounded-2xl border border-neutral-800 bg-neutral-900/30 overflow-hidden"
                    >
                      {/* User Thought */}
                      <div className="p-5 border-b border-neutral-800/60 bg-neutral-900/20">
                        <div className="flex items-center justify-between text-xs text-neutral-400 mb-2">
                          <span className="font-medium text-neutral-300 flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-indigo-400"></span>
                            Your Thought &bull; Turn {interaction.turnIndex + 1}
                          </span>
                          <span className="text-neutral-500 font-mono text-[11px]">
                            {new Date(interaction.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        <p className="text-sm text-neutral-200 whitespace-pre-wrap leading-relaxed font-sans">
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

                        {/* 1. Reflection Summary */}
                        {interaction.insights.summary && (
                          <div className="p-3 rounded-xl bg-indigo-950/20 border border-indigo-900/40 text-xs text-indigo-200/90 leading-relaxed flex items-start gap-2.5">
                            <FileText className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
                            <div className="space-y-0.5">
                              <span className="font-semibold text-indigo-300 block text-[11px] uppercase tracking-wider">Reflection Summary</span>
                              <p className="text-neutral-300">{interaction.insights.summary}</p>
                            </div>
                          </div>
                        )}

                        {/* 2. Conversational Reflection Content */}
                        <div className="text-sm text-neutral-300 whitespace-pre-wrap leading-relaxed pl-3 border-l-2 border-indigo-500/40">
                          {interaction.geminiResponse}
                        </div>

                        {/* 3. Extracted Core Themes */}
                        {((interaction.insights.themes && interaction.insights.themes.length > 0) || (interaction.insights.coreThemes && interaction.insights.coreThemes.length > 0)) && (
                          <div className="pt-2">
                            <p className="text-[11px] font-medium text-neutral-400 flex items-center gap-1 mb-2">
                              <Tag className="w-3 h-3 text-indigo-400" />
                              Identified Themes
                            </p>
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {(interaction.insights.themes && interaction.insights.themes.length > 0 ? interaction.insights.themes : interaction.insights.coreThemes).map((theme, i) => (
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

                        {/* 4. Action Items & Self-Directed Exploration */}
                        {interaction.insights.actionItems && interaction.insights.actionItems.length > 0 && (
                          <div className="pt-2 border-t border-neutral-800/60">
                            <p className="text-[11px] font-medium text-neutral-400 flex items-center gap-1 mb-2">
                              <ListChecks className="w-3.5 h-3.5 text-emerald-400" />
                              Possible Action Items & Exploration
                            </p>
                            <ul className="space-y-1.5 text-xs text-neutral-300">
                              {interaction.insights.actionItems.map((action, i) => (
                                <li key={i} className="flex items-start gap-2">
                                  <span className="text-emerald-400 font-bold select-none">&bull;</span>
                                  <span>{action}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {/* 5. Open Questions to Contemplate */}
                        {interaction.insights.openQuestions.length > 0 && (
                          <div className="pt-2 border-t border-neutral-800/60">
                            <p className="text-[11px] font-medium text-neutral-400 flex items-center gap-1 mb-2">
                              <HelpCircle className="w-3 h-3 text-indigo-400" />
                              Open Questions to Contemplate
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

                        {/* Persistence Stamp */}
                        <div className="pt-2 border-t border-neutral-800/40 flex items-center justify-between text-[10px] text-neutral-500">
                          <span className="flex items-center gap-1 text-emerald-500/80">
                            <CloudCheck className="w-3 h-3" />
                            <span>Persisted to Cloud Firestore</span>
                          </span>
                          <span className="font-mono">
                            Doc: {interaction.id.slice(0, 14)}...
                          </span>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>

            {/* Input Canvas */}
            <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-indigo-400" />
                  <h2 className="text-sm font-semibold text-neutral-200">
                    {activeInteractions.length === 0 ? 'Start a New Thought Reflection' : 'Continue Reflection'}
                  </h2>
                </div>
                <div className="flex items-center gap-2 text-xs text-neutral-500 font-mono">
                  <span>Authoritative Context Active</span>
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

              {/* Persistence Failure Alert with Non-Destructive "Retry Save" Action */}
              {pendingSaveRecord && (
                <div 
                  id="persistence-error-banner"
                  className="rounded-xl border border-amber-800/80 bg-amber-950/40 p-4 text-xs text-amber-200 space-y-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-2.5">
                      <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                      <div>
                        <p className="font-semibold text-amber-100">AI Generated, But Firestore Save Failed</p>
                        <p className="text-amber-300/80 mt-1 leading-relaxed">
                          Gemini successfully generated your reflection, but storing it to your personal Cloud Firestore namespace failed. Your prompt and reflection are safely held in memory.
                        </p>
                      </div>
                    </div>
                    <button
                      id="retry-save-btn"
                      onClick={handleRetrySave}
                      disabled={isRetryingSave}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-medium shrink-0 transition-colors cursor-pointer disabled:opacity-50 shadow-sm"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isRetryingSave ? 'animate-spin' : ''}`} />
                      <span>{isRetryingSave ? 'Saving...' : 'Retry Save'}</span>
                    </button>
                  </div>
                </div>
              )}

              {/* General Submission / AI Generation Error */}
              {submissionError && !pendingSaveRecord && (
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
                  {lastAttemptedPrompt && (
                    <button
                      id="retry-reflection-btn"
                      onClick={() => handleGenerateReflection()}
                      disabled={isSubmitting}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-900/80 hover:bg-rose-800 text-rose-100 font-medium shrink-0 transition-colors cursor-pointer disabled:opacity-50"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isSubmitting ? 'animate-spin' : ''}`} />
                      <span>Retry</span>
                    </button>
                  )}
                </div>
              )}

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
                <div className="flex items-center gap-3 text-xs text-neutral-500">
                  <span>{reflectionInput.length} / 10,000 characters</span>
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
                        <span>Reflect & Persist</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </main>
        </div>
      )}

      {/* Tab 2: Thought Evolution Engine (Milestone 9) */}
      {activeTab === 'evolution' && (
        <ThoughtEvolutionView onNavigateToJournal={() => setActiveTab('journal')} />
      )}

      {/* Tab 3: Ask My Journal Scaffold */}
      {activeTab === 'ask' && (
        <div id="ask-scaffold" className="rounded-2xl border border-neutral-800 bg-neutral-900/30 p-8 text-center space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-amber-950/60 border border-amber-800/60 flex items-center justify-center mx-auto text-amber-400">
            <Search className="w-6 h-6" />
          </div>
          <h3 className="text-base font-semibold text-neutral-200">Ask My Journal (Grounded RAG)</h3>
          <p className="text-sm text-neutral-400 max-w-md mx-auto leading-relaxed">
            Ask natural language questions about decisions and ideas you recorded in the past. Answers are strictly grounded in your verified entries.
          </p>
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-neutral-900 border border-neutral-800 text-xs text-neutral-400">
            <span>Scheduled for Milestone 6</span>
          </div>
        </div>
      )}

      {/* Tab 4: Personal Journal Insights (Milestone 10.6) */}
      {activeTab === 'insights' && (
        <PersonalInsightsView
          onNavigateToJournal={() => setActiveTab('journal')}
          onStartReflectionWithPrompt={(prompt) => {
            setReflectionInput(prompt);
            setActiveTab('journal');
          }}
        />
      )}
    </div>
  );
}
