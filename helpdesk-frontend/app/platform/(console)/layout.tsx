import { Suspense } from 'react';
import { platformLogout } from '@/app/actions/platform';
import { NavLink } from '@/components/nav-link';
import { platformApi } from '@/lib/platform';

export const metadata = { title: 'Platform console' };

async function Header() {
  const admin = await platformApi<{ email: string }>('/me');
  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-slate-900 text-white">
      <nav className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-1 gap-y-2 px-4 py-2.5">
        <span className="mr-3 flex items-center gap-2 font-semibold tracking-tight">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-500 text-sm">P</span>
          Platform console
        </span>
        <span className="flex flex-wrap gap-1">
          <NavLink dark href="/platform">Overview</NavLink>
          <NavLink dark href="/platform/organizations">Organisations</NavLink>
          <NavLink dark href="/platform/audit">Audit log</NavLink>
        </span>
        <span className="ml-auto text-xs text-slate-300">{admin.email}</span>
        <form action={platformLogout}>
          <button type="submit" className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-200 transition hover:bg-white/10 hover:text-white">
            Sign out
          </button>
        </form>
      </nav>
    </header>
  );
}

export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Suspense fallback={<header className="border-b border-white/10 bg-slate-900 px-4 py-3 font-semibold text-white">Platform console</header>}>
        <Header />
      </Suspense>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        <Suspense fallback={<p className="text-sm text-neutral-600 dark:text-neutral-400">Loading…</p>}>{children}</Suspense>
      </main>
    </>
  );
}
