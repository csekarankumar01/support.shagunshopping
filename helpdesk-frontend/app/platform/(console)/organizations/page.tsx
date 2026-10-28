import Link from 'next/link';
import { LocalTime } from '@/components/local-time';
import { platformApi } from '@/lib/platform';
import type { PlatformOrg } from '@/lib/platform';

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

export default async function OrganizationsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const q = typeof params.q === 'string' ? params.q.trim().slice(0, 100) : '';
  const orgs = await platformApi<PlatformOrg[]>(`/organizations${q ? `?q=${encodeURIComponent(q)}` : ''}`);

  return (
    <div className="space-y-6 pb-12">
      {/* Page Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white sm:text-3xl">
              Organisations
            </h1>
            <span className="rounded-full border border-slate-200 bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-700 dark:border-white/10 dark:bg-white/10 dark:text-slate-300">
              {orgs.length} total
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Directory of registered tenant workspaces, subscription tiers, member counts, and support volumes.
          </p>
        </div>

        {/* Search bar */}
        <form action="/platform/organizations" className="flex items-center gap-2">
          <div className="relative">
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <input
              name="q"
              defaultValue={q}
              placeholder="Search name or slug…"
              aria-label="Search organisations"
              className="w-64 rounded-xl border border-slate-300/80 bg-white/80 py-2 pl-9 pr-3 text-sm shadow-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/25 dark:border-white/10 dark:bg-slate-900/60 dark:text-white dark:focus:border-indigo-400"
            />
          </div>
          <button
            type="submit"
            className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:from-indigo-500 hover:to-purple-500 active:scale-95"
          >
            <span>Search</span>
          </button>
          {q && (
            <Link
              href="/platform/organizations"
              className="rounded-xl border border-slate-300/80 bg-white/80 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 dark:border-white/10 dark:bg-white/5 dark:text-slate-300 dark:hover:bg-white/10"
            >
              Clear
            </Link>
          )}
        </form>
      </div>

      {orgs.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white/40 p-12 text-center backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/40">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
            </svg>
          </div>
          <h3 className="mt-4 text-base font-semibold text-slate-900 dark:text-white">No organisations match</h3>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Try adjusting your search terms or clear filters.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200/80 bg-white/80 shadow-sm backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/60">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200/80 bg-slate-50/80 text-xs font-semibold tracking-wider text-slate-500 uppercase dark:border-white/10 dark:bg-white/5 dark:text-slate-400">
              <tr>
                <th className="px-5 py-3.5">Organisation</th>
                <th className="px-4 py-3.5">Plan</th>
                <th className="px-4 py-3.5">Status</th>
                <th className="px-4 py-3.5">People</th>
                <th className="px-4 py-3.5">Tickets (open)</th>
                <th className="px-5 py-3.5">Registered</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-white/5 [&_tr]:transition-colors [&_tr:hover]:bg-indigo-50/40 dark:[&_tr:hover]:bg-white/[0.03]">
              {orgs.map((org) => {
                const planColor =
                  org.plan === 'ENT'
                    ? 'border-purple-500/30 bg-purple-50 text-purple-700 dark:bg-purple-500/10 dark:text-purple-300'
                    : org.plan === 'PRO'
                    ? 'border-indigo-500/30 bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300'
                    : 'border-slate-300 bg-slate-50 text-slate-700 dark:border-white/10 dark:bg-white/5 dark:text-slate-300';

                return (
                  <tr key={org.id}>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500/10 to-purple-500/20 text-sm font-bold text-indigo-600 dark:from-indigo-500/20 dark:to-purple-500/30 dark:text-indigo-400">
                          {org.name.slice(0, 1).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <Link
                            href={`/platform/organizations/${org.id}`}
                            className="font-semibold text-slate-900 transition hover:text-indigo-600 dark:text-white dark:hover:text-indigo-400"
                          >
                            {org.name}
                          </Link>
                          <span className="block font-mono text-xs text-slate-500 dark:text-slate-400">
                            {org.slug}
                          </span>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3.5">
                      <span className={`inline-flex items-center rounded-lg border px-2.5 py-0.5 text-xs font-semibold ${planColor}`}>
                        {org.plan}
                      </span>
                    </td>
                    <td className="px-4 py-3.5">
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                          org.status === 'ACTIVE'
                            ? 'border border-emerald-500/30 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'
                            : 'border border-rose-500/30 bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300'
                        }`}
                      >
                        <span className={`h-1.5 w-1.5 rounded-full ${org.status === 'ACTIVE' ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                        {org.status}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 whitespace-nowrap text-xs text-slate-600 dark:text-slate-300">
                      <span className="font-medium text-slate-900 dark:text-white">{org.admins}</span> admin ·{' '}
                      <span className="font-medium text-slate-900 dark:text-white">{org.agents}</span> agent ·{' '}
                      <span className="font-medium text-slate-900 dark:text-white">{org.customers}</span> customer
                    </td>
                    <td className="px-4 py-3.5 text-xs">
                      <span className="font-semibold text-slate-900 dark:text-white">{org.tickets}</span>{' '}
                      <span className="text-slate-500 dark:text-slate-400">
                        ({org.openTickets} open)
                      </span>
                    </td>
                    <td className="px-5 py-3.5 whitespace-nowrap text-xs text-slate-500 dark:text-slate-400">
                      <LocalTime iso={org.createdAt} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

