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
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold tracking-tight">Organisations</h1>
      <form action="/platform/organizations" className="flex gap-2">
        <input
          name="q"
          defaultValue={q}
          placeholder="Search name or slug…"
          aria-label="Search organisations"
          className="w-64 rounded-lg border border-slate-300 bg-white/70 px-3 py-1.5 text-sm shadow-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/25 dark:border-white/15 dark:bg-white/5"
        />
        <button type="submit" className="rounded-lg border border-slate-300 bg-white/70 px-3 py-1.5 text-sm shadow-sm transition hover:bg-white dark:border-white/15 dark:bg-white/5">
          Search
        </button>
      </form>
      {orgs.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-300 px-4 py-10 text-center text-sm text-neutral-600 dark:border-neutral-700 dark:text-neutral-400">No organisations match.</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200/80 bg-white/80 shadow-sm backdrop-blur dark:border-white/10 dark:bg-white/5">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50/80 text-xs tracking-wide text-slate-500 uppercase dark:bg-white/5 dark:text-slate-400">
              <tr>
                <th className="px-4 py-2 font-medium">Organisation</th>
                <th className="px-4 py-2 font-medium">Plan</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">People</th>
                <th className="px-4 py-2 font-medium">Tickets (open)</th>
                <th className="px-4 py-2 font-medium">Registered</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-white/10 [&_tr]:transition-colors [&_tr:hover]:bg-indigo-50/60 dark:[&_tr:hover]:bg-white/5">
              {orgs.map((org) => (
                <tr key={org.id}>
                  <td className="px-4 py-2 [overflow-wrap:anywhere]">
                    <Link href={`/platform/organizations/${org.id}`} className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">
                      {org.name}
                    </Link>
                    <span className="block text-xs text-slate-500 dark:text-slate-400">{org.slug}</span>
                  </td>
                  <td className="px-4 py-2">{org.plan}</td>
                  <td className="px-4 py-2">
                    <span
                      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${org.status === 'ACTIVE' ? 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300' : 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300'}`}
                    >
                      {org.status}
                    </span>
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap">
                    {org.admins} admin · {org.agents} agent · {org.customers} customer
                  </td>
                  <td className="px-4 py-2">
                    {org.tickets} ({org.openTickets})
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap">
                    <LocalTime iso={org.createdAt} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
