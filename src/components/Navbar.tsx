/**
 * Responsive Application Navigation Bar with Security Status
 */

import { ShieldCheck, LogOut, Lock, User as UserIcon } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export function Navbar() {
  const { user, logout, isFirebaseConfigured } = useAuth();

  return (
    <header 
      id="main-navbar"
      className="sticky top-0 z-50 w-full border-b border-neutral-800 bg-neutral-950/80 backdrop-blur-md"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* Brand & Security Anchor */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-950/80 border border-indigo-800/60 flex items-center justify-center text-indigo-400 shadow-inner">
            <Lock className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold tracking-tight text-neutral-100 text-base">
                Gemini ThoughtVault
              </span>
              <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-950/70 border border-emerald-800/60 text-emerald-300">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                Isolated
              </span>
            </div>
            <p className="text-xs text-neutral-400 hidden sm:block">
              Personal AI Journal & Thought Evolution
            </p>
          </div>
        </div>

        {/* User Profile & Actions */}
        <div className="flex items-center gap-3">
          {user ? (
            <div className="flex items-center gap-3">
              {/* Authenticated User Pill */}
              <div 
                id="user-profile-badge"
                className="flex items-center gap-2.5 px-3 py-1.5 rounded-xl bg-neutral-900 border border-neutral-800"
                title={`Authoritative Firebase UID: ${user.uid}`}
              >
                {user.photoURL ? (
                  <img
                    id="user-avatar-image"
                    src={user.photoURL}
                    alt={user.displayName || 'User Avatar'}
                    className="w-7 h-7 rounded-full object-cover ring-1 ring-neutral-700"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="w-7 h-7 rounded-full bg-indigo-900/60 border border-indigo-700/50 flex items-center justify-center text-xs font-medium text-indigo-200">
                    {user.displayName ? user.displayName.charAt(0).toUpperCase() : <UserIcon className="w-3.5 h-3.5" />}
                  </div>
                )}
                <div className="text-left hidden md:block">
                  <p className="text-xs font-medium text-neutral-200 leading-tight">
                    {user.displayName || 'Journal Owner'}
                  </p>
                  <p className="text-[10px] text-neutral-400 font-mono leading-tight truncate max-w-[120px]">
                    {user.email}
                  </p>
                </div>
              </div>

              {/* Sign Out Button */}
              <button
                id="sign-out-btn"
                onClick={logout}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-neutral-800 bg-neutral-900 hover:bg-neutral-800 text-neutral-300 hover:text-neutral-100 text-xs font-medium transition-colors"
                title="Sign out of your private session"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Sign Out</span>
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              {!isFirebaseConfigured && (
                <span 
                  id="firebase-unconfigured-badge"
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-amber-950/60 border border-amber-800/60 text-amber-300"
                >
                  Config Required
                </span>
              )}
              <div className="flex items-center gap-1.5 text-xs text-neutral-400 border border-neutral-800 rounded-lg px-2.5 py-1">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                <span>Zero-Data Sharing</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
