import Link from 'next/link';
import { PlatformLoginForm } from '@/components/platform-forms';

export const metadata = { title: 'Platform sign-in' };

export default function PlatformLoginPage() {
  return (
    <main className="relative flex min-h-[calc(100vh-4rem)] flex-1 items-center justify-center px-4 py-12">
      {/* Decorative background glow */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-[500px] w-[500px] rounded-full bg-gradient-to-tr from-purple-600/15 via-indigo-600/20 to-cyan-500/10 blur-[100px]" />
      </div>

      <div className="relative w-full max-w-md space-y-6 rounded-3xl border border-slate-200/80 bg-white/80 p-8 shadow-2xl backdrop-blur-2xl dark:border-white/10 dark:bg-slate-950/70 sm:p-10">
        <div className="space-y-2 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-tr from-purple-600 via-indigo-600 to-cyan-500 text-white shadow-lg shadow-indigo-500/25 ring-1 ring-white/20">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
            </svg>
          </div>
          <div className="inline-flex items-center gap-1.5 rounded-full border border-purple-500/30 bg-purple-500/10 px-3 py-0.5 text-xs font-semibold text-purple-700 dark:text-purple-300">
            <span className="h-1.5 w-1.5 rounded-full bg-purple-500" />
            PLATFORM CONSOLE
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white sm:text-3xl">
            Super admin sign-in
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Service operator console with multi-tenant oversight. Not for tenant organisation members.
          </p>
        </div>

        <PlatformLoginForm />

        <div className="border-t border-slate-100 pt-4 text-center dark:border-white/10">
          <Link
            href="/login"
            className="text-xs font-medium text-slate-500 transition hover:text-indigo-600 dark:text-slate-400 dark:hover:text-indigo-400"
          >
            ← Back to tenant organisation sign-in
          </Link>
        </div>
      </div>
    </main>
  );
}

