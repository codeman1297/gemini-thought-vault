/**
 * Authentication Context and State Management for Gemini ThoughtVault
 * 
 * Enforces Security Invariant:
 * The authenticated user's Firebase UID is the sole authoritative identity.
 * Client cannot spoof, override, or alter this identity.
 */

import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import { 
  onAuthStateChanged, 
  signInWithPopup, 
  signOut, 
  type User 
} from 'firebase/auth';
import { auth, googleProvider, isFirebaseConfigured } from '../lib/firebase';
import type { AuthenticatedUser, AuthContextType } from '../types/auth';

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [loading, setLoading] = useState<boolean>(isFirebaseConfigured);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isFirebaseConfigured || !auth) {
      setLoading(false);
      return;
    }

    // Subscribe to Firebase Auth state transitions
    const unsubscribe = onAuthStateChanged(
      auth,
      (firebaseUser: User | null) => {
        if (firebaseUser) {
          // Authoritative UID extracted directly from verified Firebase User object
          setUser({
            uid: firebaseUser.uid,
            email: firebaseUser.email,
            displayName: firebaseUser.displayName,
            photoURL: firebaseUser.photoURL,
            emailVerified: firebaseUser.emailVerified,
          });
        } else {
          setUser(null);
        }
        setLoading(false);
      },
      (authError) => {
        console.error('Firebase Auth state change error:', authError);
        setError('Authentication session error: ' + authError.message);
        setUser(null);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, []);

  const signInWithGoogle = useCallback(async () => {
    setError(null);

    if (!isFirebaseConfigured || !auth || !googleProvider) {
      setError(
        'Firebase configuration is missing. Please set VITE_FIREBASE_* environment variables in your .env file or project settings.'
      );
      return;
    }

    setLoading(true);
    try {
      await signInWithPopup(auth, googleProvider);
      // onAuthStateChanged listener handles updating the user and resetting loading
    } catch (err: unknown) {
      setLoading(false);
      const authError = err as { code?: string; message?: string };
      
      if (authError.code === 'auth/popup-closed-by-user') {
        setError('Sign-in cancelled: The authentication popup was closed before completing.');
      } else if (authError.code === 'auth/cancelled-popup-request') {
        setError('Sign-in cancelled: Another authentication popup was opened.');
      } else if (authError.code === 'auth/unauthorized-domain') {
        setError(
          'Unauthorized domain: Please add this application domain to the Authorized Domains list in Firebase Console > Authentication > Settings.'
        );
      } else if (authError.code === 'auth/popup-blocked') {
        setError('Pop-up blocked by browser: Please allow popups for this site to sign in with Google.');
      } else {
        setError(authError.message || 'Failed to authenticate with Google. Please try again.');
      }
    }
  }, []);

  const logout = useCallback(async () => {
    setError(null);
    try {
      if (auth) {
        await signOut(auth);
      }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Error signing out';
      console.error('Sign-out error:', errorMsg);
      setError('Failed to sign out from server: ' + errorMsg);
    } finally {
      // Fail-closed invariant: Local in-memory identity is unconditionally purged
      setUser(null);
    }
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const value = useMemo<AuthContextType>(() => ({
    user,
    loading,
    error,
    isFirebaseConfigured,
    signInWithGoogle,
    logout,
    clearError,
  }), [user, loading, error, signInWithGoogle, logout, clearError]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
