/**
 * Gemini ThoughtVault - Root Application
 * Milestone 3: Authentication & Protected Dashboard
 * 
 * Enforces Security Invariant:
 * 1. Fail-closed: Unauthenticated sessions see ONLY the Public Landing Page.
 * 2. Authenticated sessions see the Protected Dashboard with their verified Firebase UID.
 * 3. No client-side UID spoofing or arbitrary path access.
 */

import { AuthProvider, useAuth } from './context/AuthContext';
import { Navbar } from './components/Navbar';
import { LandingPage } from './components/LandingPage';
import { Dashboard } from './components/Dashboard';
import { LoadingScreen } from './components/LoadingScreen';

function AppContent() {
  const { user, loading } = useAuth();

  if (loading) {
    return <LoadingScreen message="Resolving secure authentication session..." />;
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 flex flex-col font-sans selection:bg-indigo-500/30 selection:text-indigo-200">
      <Navbar />
      <div className="flex-1">
        {user ? <Dashboard /> : <LandingPage />}
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
