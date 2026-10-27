import Link from 'next/link';
import { platformApi } from '@/lib/platform';
import type { PlatformOverview } from '@/lib/platform';

const box =
  'block rounded-2xl border border-slate-200/80 bg-white/80 px-4 py-4 shadow-sm backdrop-blur transition dark:border-white/10 dark:bg-white/5';

function Card({ label, value, href, danger }: { label: string; value: number; href?: string; danger?: boolean }) {
  const body = (
    <>
      <span className="block text-xs font-medium tracking-wide text-slate-500 uppercase dark:text-slate-400">{label}</span>
      <span className={`mt-1 block text-3xl font-semibold tracking-tight ${danger && value > 0 ? 'text-red-600 dark:text-red-400' : ''}`}>{value}</span>
    </>
  );
  return href ? (
    <Link href={href} className={`${box} hover:-translate-y-0.5 hover:border-indigo-400 hover:shadow-lg hover:shadow-indigo-500/10`}>
      {body}
    </Link>
  ) : (
    <div className={box}>{body}</div>
  );
}

export default async function PlatformOverviewPage() {
  const o = await platformApi<PlatformOverview>('/overview');
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Platform overview</h1>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card label="Organisations" value={o.organizations} href="/platform/organizations" />
        <Card label="Suspended" value={o.suspended} danger />
        <Card label="New this week" value={o.newThisWeek} />
        <Card label="Active users" value={o.users} />
        <Card label="Tickets" value={o.tickets} />
        <Card label="Open tickets" value={o.openTickets} />
        <Card label="SLA breached" value={o.breachedTickets} danger />
        <Card label="Failed events" value={o.failedEvents} danger />
      </div>
    </div>
  );
}
