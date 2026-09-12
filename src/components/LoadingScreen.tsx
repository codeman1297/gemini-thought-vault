/**
 * Accessible Loading Screen for Auth State Resolution
 */

import { ShieldCheck, Loader2 } from 'lucide-react';

export function LoadingScreen({ message = 'Verifying secure session...' }: { message?: string }) {
  return (
    <div 
      id="loading-screen"
      className="min-h-screen bg-neutral-950 text-neutral-100 flex flex-col items-center justify-center p-6"
    >
      <div className="flex flex-col items-center space-y-4 max-w-sm text-center">
        <div className="relative">
          <div className="w-16 h-16 rounded-2xl bg-neutral-900 border border-neutral-800 flex items-center justify-center shadow-xl">
            <ShieldCheck className="w-8 h-8 text-emerald-400" />
          </div>
          <div className="absolute -bottom-1 -right-1 bg-neutral-950 rounded-full p-1">
            <Loader2 className="w-5 h-5 text-indigo-400 animate-spin" />
          </div>
        </div>
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-neutral-100">Gemini ThoughtVault</h2>
          <p className="text-sm text-neutral-400 mt-1">{message}</p>
        </div>
      </div>
    </div>
  );
}
