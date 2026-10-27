import Link from 'next/link';
import { Suspense } from 'react';
import { LiveRefresh } from '@/components/live-refresh';
import { api } from '@/lib/api';
import { requireRole } from '@/lib/auth';
import type { Stats } from '@/lib/types';

export default function DashboardPage() {
  return (
    <Suspense fallback={<p className="text-sm text-neutral-600 dark:text-neutral-400">Loading dashboard…</p>}>
      <Dashboard />
    </Suspense>
  );
}

const duration = (seconds: number | null) => {
  if (seconds === null) return 'No replies yet';
  if (seconds < 90) return `${Math.round(seconds)} s`;
  if (seconds < 5400) return `${Math.round(seconds / 60)} min`;
  return `${(seconds / 3600).toFixed(1)} h`;
};

function Card({ label, value, href, tone = 'plain' }: { label: string; value: string | number; href?: string; tone?: 'plain' | 'danger' }) {
  const body = (
    <>
      <span className="block text-xs text-neutral-600 dark:text-neutral-400 uppercase">{label}</span>
      <span className={`block text-2xl font-semibold ${tone === 'danger' && Number(value) > 0 ? 'text-red-600 dark:text-red-400' : ''}`}>{value}</span>
    </>
  );
  const box = 'rounded-md border border-neutral-200 px-4 py-3 dark:border-neutral-800';
  return href ? (
    <Link href={href} className={`${box} hover:border-blue-500`}>
      {body}
    </Link>
  ) : (
    <div className={box}>{body}</div>
  );
}

// Staff only. Every number comes from one SQL query in the API, scoped to the organisation.
async function Dashboard() {
  await requireRole('ADMIN', 'AGENT');
  const stats = await api<Stats>('/api/v1/tickets/stats');
  return (
    <div className="space-y-6">
      <LiveRefresh />
      <h1 className="text-xl font-semibold">Dashboard</h1>

      <section aria-label="Tickets by status" className="space-y-2">
        <h2 className="text-sm font-medium text-neutral-600 dark:text-neutral-400">By status</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Card label="Open" value={stats.open} href="/tickets?status=OPEN" />
          <Card label="In progress" value={stats.inProgress} href="/tickets?status=IN_PROGRESS" />
          <Card label="Resolved" value={stats.resolved} href="/tickets?status=RESOLVED" />
          <Card label="Closed" value={stats.closed} href="/tickets?status=CLOSED" />
        </div>
      </section>

      <section aria-label="Needs attention" className="space-y-2">
        <h2 className="text-sm font-medium text-neutral-600 dark:text-neutral-400">Needs attention</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Card label="SLA breached" value={stats.breached} href="/tickets?breached=true" tone="danger" />
          <Card label="Unassigned (active)" value={stats.unassigned} href="/tickets?assigned=unassigned" />
          <Card label="Assigned to me" value={stats.assignedToMe} href="/tickets?assigned=me" />
          <Card label="Created, last 24 h" value={stats.createdLast24h} />
        </div>
      </section>

      <section aria-label="Active tickets by priority" className="space-y-2">
        <h2 className="text-sm font-medium text-neutral-600 dark:text-neutral-400">Active tickets by priority</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Card label="Urgent" value={stats.activeUrgent} href="/tickets?priority=URGENT" tone="danger" />
          <Card label="High" value={stats.activeHigh} href="/tickets?priority=HIGH" />
          <Card label="Medium" value={stats.activeMedium} href="/tickets?priority=MEDIUM" />
          <Card label="Low" value={stats.activeLow} href="/tickets?priority=LOW" />
        </div>
      </section>

      <section aria-label="Response time" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card label="All tickets" value={stats.total} href="/tickets" />
        <Card label="Average first reply" value={duration(stats.avgFirstResponseSeconds)} />
      </section>
    </div>
  );
}
