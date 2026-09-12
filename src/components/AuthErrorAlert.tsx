/**
 * Dismissible Error Alert for Authentication Issues
 */

import { AlertCircle, X } from 'lucide-react';

interface AuthErrorAlertProps {
  error: string | null;
  onDismiss: () => void;
}

export function AuthErrorAlert({ error, onDismiss }: AuthErrorAlertProps) {
  if (!error) return null;

  return (
    <div 
      id="auth-error-alert"
      className="rounded-xl border border-red-900/60 bg-red-950/40 p-4 text-red-200 shadow-lg backdrop-blur-sm transition-all"
      role="alert"
    >
      <div className="flex items-start gap-3">
        <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
        <div className="flex-1 text-sm leading-relaxed">
          <p className="font-medium text-red-300">Authentication Alert</p>
          <p className="mt-0.5 text-neutral-300">{error}</p>
        </div>
        <button
          id="dismiss-auth-error-btn"
          onClick={onDismiss}
          className="shrink-0 p-1 text-neutral-400 hover:text-neutral-100 rounded-md hover:bg-neutral-800 transition-colors"
          aria-label="Dismiss error"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
