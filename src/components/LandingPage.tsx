/**
 * Public Landing Page for Gemini ThoughtVault
 * Features Google Sign-In, Security Guarantees, and Configuration Guidance
 */

import { 
  ShieldCheck, 
  Lock, 
  Sparkles, 
  Compass, 
  Search, 
  Database,
  ArrowRight,
  Info
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { AuthErrorAlert } from './AuthErrorAlert';

export function LandingPage() {
  const { signInWithGoogle, loading, error, clearError, isFirebaseConfigured } = useAuth();

  return (
    <div id="landing-page" className="min-h-[calc(100vh-4rem)] flex flex-col justify-between">
      <main className="flex-1 max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12 md:py-16 w-full">
        {/* Error Alert Display */}
        {error && (
          <div className="mb-8">
            <AuthErrorAlert error={error} onDismiss={clearError} />
          </div>
        )}

        {/* Configuration Notice if Firebase Keys Not Set */}
        {!isFirebaseConfigured && (
          <div 
            id="firebase-setup-notice"
            className="mb-8 rounded-2xl border border-amber-900/50 bg-amber-950/30 p-5 text-amber-200"
          >
            <div className="flex items-start gap-3.5">
              <Info className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
              <div className="space-y-2 text-sm">
                <p className="font-medium text-amber-200">
                  Firebase Client Configuration Required for Live Google Sign-In
                </p>
                <p className="text-neutral-300 leading-relaxed">
                  To authenticate users with Google, supply your public Firebase Web App credentials in{' '}
                  <code className="px-1.5 py-0.5 rounded bg-neutral-900 border border-neutral-800 font-mono text-xs text-amber-300">
                    .env
                  </code>{' '}
                  or in your Cloud environment variables:
                </p>
                <div className="bg-neutral-950/80 rounded-xl p-3 border border-neutral-800 font-mono text-xs text-neutral-300 overflow-x-auto space-y-1">
                  <div>VITE_FIREBASE_API_KEY=&quot;AIzaSy...&quot;</div>
                  <div>VITE_FIREBASE_AUTH_DOMAIN=&quot;your-project.firebaseapp.com&quot;</div>
                  <div>VITE_FIREBASE_PROJECT_ID=&quot;your-project-id&quot;</div>
                  <div>VITE_FIREBASE_APP_ID=&quot;1:123456789:web:...&quot;</div>
                </div>
                <p className="text-xs text-neutral-400">
                  Tip: Enable &quot;Google&quot; under Firebase Console &gt; Authentication &gt; Sign-in method, and ensure this domain is added to Authorized Domains.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Hero Section */}
        <div className="text-center max-w-3xl mx-auto space-y-6">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-neutral-900 border border-neutral-800 text-xs font-medium text-neutral-300">
            <Lock className="w-3.5 h-3.5 text-indigo-400" />
            <span>Encrypted & Owner-Isolated Personal Journal</span>
          </div>

          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-neutral-100">
            Converse with Gemini. <br className="hidden sm:inline" />
            <span className="text-indigo-400">Track Your Evolution.</span>
          </h1>

          <p className="text-base sm:text-lg text-neutral-400 leading-relaxed max-w-2xl mx-auto">
            A private space to record reflections, discover recurring patterns across your thoughts, 
            and query your historical mind without compromising data isolation.
          </p>

          {/* Primary Authentication Action */}
          <div className="pt-4 flex flex-col sm:flex-row items-center justify-center gap-4">
            <button
              id="google-signin-btn"
              onClick={signInWithGoogle}
              disabled={loading}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-3 px-6 py-3.5 rounded-xl font-medium text-sm bg-neutral-100 hover:bg-white text-neutral-900 shadow-md hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-neutral-950"
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-neutral-900 border-t-transparent rounded-full animate-spin" />
              ) : (
                /* Google Official 'G' Icon */
                <svg className="w-5 h-5" viewBox="0 0 24 24">
                  <path
                    fill="#4285F4"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                  />
                </svg>
              )}
              <span>{loading ? 'Opening Google Sign-In...' : 'Sign in with Google'}</span>
            </button>
          </div>

          <p className="text-xs text-neutral-500">
            Protected by Firebase Authentication. No custom passwords. Zero tracking.
          </p>
        </div>

        {/* Value Propositions & Security Guarantees */}
        <div className="mt-16 sm:mt-20 grid grid-cols-1 md:grid-cols-3 gap-6">
          <div 
            id="feature-card-privacy"
            className="rounded-2xl border border-neutral-800 bg-neutral-900/60 p-6 space-y-3"
          >
            <div className="w-10 h-10 rounded-xl bg-emerald-950/80 border border-emerald-800/60 flex items-center justify-center text-emerald-400">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <h3 className="text-base font-semibold text-neutral-100">Absolute User Isolation</h3>
            <p className="text-sm text-neutral-400 leading-relaxed">
              Every journal entry is tied directly to your verified Firebase UID. No cross-user querying, no data leakage, and zero data selling.
            </p>
          </div>

          <div 
            id="feature-card-evolution"
            className="rounded-2xl border border-neutral-800 bg-neutral-900/60 p-6 space-y-3"
          >
            <div className="w-10 h-10 rounded-xl bg-indigo-950/80 border border-indigo-800/60 flex items-center justify-center text-indigo-400">
              <Compass className="w-5 h-5" />
            </div>
            <h3 className="text-base font-semibold text-neutral-100">Thought Evolution</h3>
            <p className="text-sm text-neutral-400 leading-relaxed">
              Discover emerging patterns, unresolved questions, and revisit forgotten breakthroughs as your ideas naturally mature over weeks and months.
            </p>
          </div>

          <div 
            id="feature-card-ask"
            className="rounded-2xl border border-neutral-800 bg-neutral-900/60 p-6 space-y-3"
          >
            <div className="w-10 h-10 rounded-xl bg-amber-950/80 border border-amber-800/60 flex items-center justify-center text-amber-400">
              <Search className="w-5 h-5" />
            </div>
            <h3 className="text-base font-semibold text-neutral-100">Ask My Journal</h3>
            <p className="text-sm text-neutral-400 leading-relaxed">
              Query your personal past using grounded AI synthesis. The model answers strictly from your authorized entries and never speculates.
            </p>
          </div>
        </div>

        {/* Security Architecture Transparency Box */}
        <div className="mt-12 rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6 sm:p-8">
          <div className="flex items-center gap-2 mb-4 text-xs font-semibold uppercase tracking-wider text-neutral-400">
            <Database className="w-4 h-4 text-indigo-400" />
            <span>Architecture & Security Constitution</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
            <div className="p-3.5 rounded-xl bg-neutral-950/80 border border-neutral-800/80">
              <span className="text-neutral-200 font-semibold block mb-1">Fail-Closed Security</span>
              <span className="text-neutral-400">Unauthenticated access is completely blocked at both the router and database layers.</span>
            </div>
            <div className="p-3.5 rounded-xl bg-neutral-950/80 border border-neutral-800/80">
              <span className="text-neutral-200 font-semibold block mb-1">Server-Side AI</span>
              <span className="text-neutral-400">Gemini API keys remain server-side in Secret Manager; zero secrets exposed to browser.</span>
            </div>
            <div className="p-3.5 rounded-xl bg-neutral-950/80 border border-neutral-800/80">
              <span className="text-neutral-200 font-semibold block mb-1">Grounded Synthesis</span>
              <span className="text-neutral-400">AI analysis is restricted strictly to your historical entries with explicit citations.</span>
            </div>
            <div className="p-3.5 rounded-xl bg-neutral-950/80 border border-neutral-800/80">
              <span className="text-neutral-200 font-semibold block mb-1">No Custom Passwords</span>
              <span className="text-neutral-400">Direct integration with Google Sign-In guarantees modern OAuth 2.0 credential isolation.</span>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-neutral-900 py-6 text-center text-xs text-neutral-500">
        <p>Gemini ThoughtVault &bull; Production Security Constitution Verified &bull; Milestone 3 Active</p>
      </footer>
    </div>
  );
}
