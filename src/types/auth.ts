/**
 * Authentication and User Identity Types for Gemini ThoughtVault
 * Milestone 3: Authentication & Protected Dashboard
 */

export interface AuthenticatedUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  emailVerified: boolean;
}

export interface AuthContextType {
  user: AuthenticatedUser | null;
  loading: boolean;
  error: string | null;
  isFirebaseConfigured: boolean;
  signInWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
  clearError: () => void;
}
