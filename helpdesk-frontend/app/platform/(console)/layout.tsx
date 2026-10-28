import { Suspense } from 'react';
import { platformLogout } from '@/app/actions/platform';
import { NavLink } from '@/components/nav-link';
import { ThemeToggle } from '@/components/theme-toggle';
import { platformApi } from '@/lib/platform';

export const metadata = { title: 'Platform console' };

async function Header() {
  const admin = await platformApi<{ email: string }>('/me');
  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-slate-950/80 backdrop-blur-xl text-white">
      <nav className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-2.5 sm:px-6">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-2.5 font-bold tracking-tight text-white">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-tr from-purple-600 via-indigo-600 to-cyan-500 shadow-md shadow-indigo-500/20 ring-1 ring-white/20">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
              </svg>
            </span>
            <span className="text-base font-semibold tracking-tight text-white">Platform console</span>
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-purple-500/30 bg-purple-500/10 px-2.5 py-0.5 text-xs font-semibold text-purple-300">
            <span className="h-1.5 w-1.5 rounded-full bg-purple-400 animate-pulse" />
            SUPERADMIN
          </span>
        </div>

        <div className="flex items-center gap-1">
          <NavLink dark href="/platform">Overview</NavLink>
          <NavLink dark href="/platform/organizations">Organisations</NavLink>
          <NavLink dark href="/platform/audit">Audit log</NavLink>
        </div>

        <div className="flex items-center gap-3">
          <ThemeToggle />
          <div className="hidden sm:flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-slate-300">
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
            <span className="font-medium text-slate-200">{admin.email}</span>
          </div>
          <form action={platformLogout}>
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-200 shadow-sm transition hover:bg-white/15 hover:text-white active:scale-95"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              <span>Sign out</span>
            </button>
          </form>
        </div>
      </nav>
    </header>
  );
}

export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Suspense fallback={<header className="border-b border-white/10 bg-slate-950 px-4 py-3 font-semibold text-white">Platform console</header>}>
        <Header />
      </Suspense>
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6">
        <Suspense fallback={<p className="text-sm text-neutral-600 dark:text-neutral-400">Loading…</p>}>{children}</Suspense>
      </main>
    </>
  );
}

