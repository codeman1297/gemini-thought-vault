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
  EyeOff
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export function Dashboard() {
  const { user, logout } = useAuth();
  const [activeTab, setActiveTab] = useState<'journal' | 'evolution' | 'ask'>('journal');
  const [mockDraft, setMockDraft] = useState('');
  const [showFullUid, setShowFullUid] = useState(false);

  if (!user) {
    return null; // Route guarded by parent
  }

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
                    className="text-neutral-500 hover:text-neutral-300 ml-0.5 transition-colors"
                    title={showFullUid ? "Mask UID" : "Reveal full UID"}
                    aria-label={showFullUid ? "Mask UID" : "Reveal full UID"}
                  >
                    {showFullUid ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                  </button>
                </span>
                <span>&bull;</span>
                <span>{user.email}</span>
                <span>&bull;</span>
                <span className="text-neutral-500">Owner-Bound Namespace Active</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              id="dashboard-logout-btn"
              onClick={logout}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-medium bg-neutral-800 hover:bg-neutral-700 text-neutral-200 transition-colors"
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
            <span>Database isolation: <code className="font-mono text-neutral-300">/users/{user.uid}/*</code></span>
          </div>
          <span className="text-neutral-500">Cross-user querying is cryptographically rejected.</span>
        </div>
      </section>

      {/* Navigation Tabs for Application Modules */}
      <div className="flex border-b border-neutral-800 gap-2 sm:gap-4 mb-8 overflow-x-auto">
        <button
          id="tab-journal"
          onClick={() => setActiveTab('journal')}
          className={`flex items-center gap-2 pb-3.5 px-3 text-sm font-medium border-b-2 transition-all whitespace-nowrap ${
            activeTab === 'journal'
              ? 'border-indigo-500 text-neutral-100'
              : 'border-transparent text-neutral-400 hover:text-neutral-200'
          }`}
        >
          <BookOpen className="w-4 h-4" />
          <span>Journal & Reflection</span>
        </button>

        <button
          id="tab-evolution"
          onClick={() => setActiveTab('evolution')}
          className={`flex items-center gap-2 pb-3.5 px-3 text-sm font-medium border-b-2 transition-all whitespace-nowrap ${
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
          className={`flex items-center gap-2 pb-3.5 px-3 text-sm font-medium border-b-2 transition-all whitespace-nowrap ${
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

      {/* Tab 1: Journal Workspace Scaffold */}
      {activeTab === 'journal' && (
        <div id="journal-workspace" className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* Left Column: Input Canvas Scaffold */}
          <div className="lg:col-span-7 space-y-6">
            <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-indigo-400" />
                  <h2 className="text-sm font-semibold text-neutral-200">New Journal Reflection</h2>
                </div>
                <div className="flex items-center gap-2 text-xs text-neutral-500">
                  <Calendar className="w-3.5 h-3.5" />
                  <span>Today</span>
                </div>
              </div>

              <div className="space-y-2">
                <label htmlFor="journal-prompt-input" className="sr-only">
                  Your thoughts or reflection
                </label>
                <textarea
                  id="journal-prompt-input"
                  rows={6}
                  value={mockDraft}
                  onChange={(e) => setMockDraft(e.target.value)}
                  placeholder="What is on your mind today? Write freely. In Milestone 4, submitting will generate an AI reflection via the server-side Gemini fallback ladder and persist directly to your private Firestore collection."
                  className="w-full rounded-xl border border-neutral-800 bg-neutral-950 p-4 text-sm text-neutral-200 placeholder-neutral-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-colors resize-y font-sans leading-relaxed"
                />
              </div>

              <div className="flex items-center justify-between pt-2">
                <span className="text-xs text-neutral-500">
                  {mockDraft.length} characters &bull; Max 20,000
                </span>
                <div className="flex items-center gap-3">
                  <span className="inline-flex items-center px-2 py-1 rounded text-xs bg-indigo-950/60 border border-indigo-800/60 text-indigo-300">
                    Milestone 4 Pending: Gemini Integration
                  </span>
                  <button
                    id="submit-journal-scaffold-btn"
                    disabled={true}
                    className="px-4 py-2 rounded-xl text-xs font-medium bg-neutral-800 text-neutral-400 cursor-not-allowed border border-neutral-700/50"
                    title="Gemini integration and Firestore persistence will be activated in Milestone 4"
                  >
                    Generate Reflection
                  </button>
                </div>
              </div>
            </div>

            {/* Architecture Preview Box */}
            <div className="rounded-2xl border border-neutral-800/70 bg-neutral-900/20 p-5 text-xs text-neutral-400 space-y-2">
              <p className="font-medium text-neutral-300 flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5 text-indigo-400" />
                Security Pipeline Ready
              </p>
              <p className="leading-relaxed">
                When you submit a thought in Milestone 4, your request will be authenticated via your Firebase ID Token, verified server-side, passed to the Gemini fallback ladder, and saved to{' '}
                <code className="text-neutral-300 font-mono">/users/{user.uid}/interactions</code>.
              </p>
            </div>
          </div>

          {/* Right Column: Timeline & Reflection History Placeholder */}
          <div className="lg:col-span-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-neutral-200 flex items-center gap-2">
                <Clock className="w-4 h-4 text-neutral-400" />
                <span>Recent Reflections</span>
              </h3>
              <span className="text-xs text-neutral-500">Isolated to your UID</span>
            </div>

            <div 
              id="empty-journal-timeline"
              className="rounded-2xl border border-dashed border-neutral-800 bg-neutral-950/50 p-8 text-center space-y-3"
            >
              <div className="w-12 h-12 rounded-2xl bg-neutral-900 border border-neutral-800 flex items-center justify-center mx-auto text-neutral-500">
                <BookOpen className="w-6 h-6" />
              </div>
              <h4 className="text-sm font-medium text-neutral-300">No Journal Entries Yet</h4>
              <p className="text-xs text-neutral-500 max-w-xs mx-auto leading-relaxed">
                Your authenticated session is active and verified. In Milestone 4, your entries and Gemini reflections will appear here in chronological sequence.
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
            <span>Pre-requisite: Milestone 4 Journal Persistence</span>
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
            <span>Pre-requisite: Milestone 4 Journal Persistence</span>
          </div>
        </div>
      )}
    </div>
  );
}
