import Link from 'next/link';
import { Suspense } from 'react';
import { LiveRefresh } from '@/components/live-refresh';
import { api } from '@/lib/api';
import { requireRole } from '@/lib/auth';
import type { Stats, TicketPage } from '@/lib/types';

export default function DashboardPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent dark:border-indigo-400" />
        </div>
      }
    >
      <Dashboard />
    </Suspense>
  );
}

const formatDuration = (seconds: number | null) => {
  if (seconds === null) return 'No replies yet';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  return `${(seconds / 3600).toFixed(1)} hrs`;
};

const formatDate = (iso: string) => {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
};

const statusStyles: Record<string, { bg: string; text: string; dot: string; label: string }> = {
  OPEN: {
    bg: 'bg-sky-50 dark:bg-sky-500/10 border-sky-200 dark:border-sky-500/20',
    text: 'text-sky-700 dark:text-sky-300',
    dot: 'bg-sky-500',
    label: 'Open',
  },
  IN_PROGRESS: {
    bg: 'bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/20',
    text: 'text-amber-700 dark:text-amber-300',
    dot: 'bg-amber-500',
    label: 'In Progress',
  },
  RESOLVED: {
    bg: 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/20',
    text: 'text-emerald-700 dark:text-emerald-300',
    dot: 'bg-emerald-500',
    label: 'Resolved',
  },
  CLOSED: {
    bg: 'bg-slate-50 dark:bg-slate-500/10 border-slate-200 dark:border-slate-500/20',
    text: 'text-slate-700 dark:text-slate-300',
    dot: 'bg-slate-400',
    label: 'Closed',
  },
};

const priorityStyles: Record<string, { badge: string; text: string; iconBg: string }> = {
  URGENT: {
    badge: 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300',
    text: 'text-red-600 dark:text-red-400',
    iconBg: 'bg-red-500/10 text-red-600 dark:text-red-400',
  },
  HIGH: {
    badge: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
    text: 'text-amber-600 dark:text-amber-400',
    iconBg: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  },
  MEDIUM: {
    badge: 'border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300',
    text: 'text-blue-600 dark:text-blue-400',
    iconBg: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  },
  LOW: {
    badge: 'border-slate-500/30 bg-slate-500/10 text-slate-700 dark:text-slate-300',
    text: 'text-slate-600 dark:text-slate-400',
    iconBg: 'bg-slate-500/10 text-slate-600 dark:text-slate-400',
  },
};

async function Dashboard() {
  await requireRole('ADMIN', 'AGENT');

  const [stats, recentTickets, presence] = await Promise.all([
    api<Stats>('/api/v1/tickets/stats'),
    api<TicketPage>('/api/v1/tickets?limit=5').catch(() => ({ items: [], total: 0, page: 1, limit: 5 })),
    api<{ userId: string; email: string }[]>('/api/v1/presence').catch(() => []),
  ]);

  const activeQueueCount = stats.open + stats.inProgress;
  const totalCompleted = stats.resolved + stats.closed;
  const totalTracked = stats.total || (activeQueueCount + totalCompleted) || 1;

  // Segment widths for the pipeline progress bar
  const openPct = Math.round((stats.open / totalTracked) * 100);
  const inProgressPct = Math.round((stats.inProgress / totalTracked) * 100);
  const resolvedPct = Math.round((stats.resolved / totalTracked) * 100);
  const closedPct = Math.round((stats.closed / totalTracked) * 100);

  return (
    <div className="space-y-8 pb-12">
      <LiveRefresh />

      {/* Hero Header Banner */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white sm:text-3xl">
              Operations Dashboard
            </h1>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Live Sync
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Real-time queue analytics, SLA performance, and active workload distribution.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Link
            href="/tickets"
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-indigo-600/25 transition-all duration-150 hover:from-indigo-500 hover:to-violet-500 hover:shadow-lg active:scale-95"
          >
            <span>Open Ticket Queue</span>
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
            </svg>
          </Link>
        </div>
      </div>

      {/* Top KPI Cards (4 High-Impact Stat Tiles) */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Active Queue Card */}
        <Link
          href="/tickets?status=OPEN"
          className="group relative overflow-hidden rounded-2xl border border-slate-200/80 bg-white/80 p-5 shadow-sm backdrop-blur-md transition-all duration-200 hover:-translate-y-1 hover:border-indigo-400 hover:shadow-lg hover:shadow-indigo-500/10 dark:border-white/10 dark:bg-white/5"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Active Queue
            </span>
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 transition-colors group-hover:bg-indigo-600 group-hover:text-white dark:bg-indigo-500/10 dark:text-indigo-400">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
              </svg>
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">
              {activeQueueCount}
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400">tickets</span>
          </div>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            <strong className="text-slate-700 dark:text-slate-300">{stats.open}</strong> open ·{' '}
            <strong className="text-slate-700 dark:text-slate-300">{stats.inProgress}</strong> in progress
          </p>
        </Link>

        {/* SLA Health Card */}
        <Link
          href="/tickets?breached=true"
          className="group relative overflow-hidden rounded-2xl border border-slate-200/80 bg-white/80 p-5 shadow-sm backdrop-blur-md transition-all duration-200 hover:-translate-y-1 hover:border-indigo-400 hover:shadow-lg hover:shadow-indigo-500/10 dark:border-white/10 dark:bg-white/5"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              SLA Health
            </span>
            <div
              className={`flex h-9 w-9 items-center justify-center rounded-xl transition-colors ${
                stats.breached > 0
                  ? 'bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-400 group-hover:bg-rose-600 group-hover:text-white'
                  : 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400 group-hover:bg-emerald-600 group-hover:text-white'
              }`}
            >
              {stats.breached > 0 ? (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
              )}
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span
              className={`text-3xl font-extrabold tracking-tight ${
                stats.breached > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-900 dark:text-white'
              }`}
            >
              {stats.breached}
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400">breached</span>
          </div>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {stats.breached > 0 ? (
              <span className="font-semibold text-rose-600 dark:text-rose-400">Requires immediate attention</span>
            ) : (
              <span className="font-semibold text-emerald-600 dark:text-emerald-400">100% SLA deadlines met</span>
            )}
          </p>
        </Link>

        {/* Assigned & Intake Card */}
        <Link
          href="/tickets?assigned=unassigned"
          className="group relative overflow-hidden rounded-2xl border border-slate-200/80 bg-white/80 p-5 shadow-sm backdrop-blur-md transition-all duration-200 hover:-translate-y-1 hover:border-indigo-400 hover:shadow-lg hover:shadow-indigo-500/10 dark:border-white/10 dark:bg-white/5"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Unassigned Pool
            </span>
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-50 text-amber-600 transition-colors group-hover:bg-amber-600 group-hover:text-white dark:bg-amber-500/10 dark:text-amber-400">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
              </svg>
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">
              {stats.unassigned}
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400">awaiting agent</span>
          </div>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            <strong className="text-slate-700 dark:text-slate-300">{stats.assignedToMe}</strong> assigned to you
          </p>
        </Link>

        {/* Response Performance Card */}
        <div className="group relative overflow-hidden rounded-2xl border border-slate-200/80 bg-white/80 p-5 shadow-sm backdrop-blur-md dark:border-white/10 dark:bg-white/5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Avg First Reply
            </span>
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-cyan-50 text-cyan-600 dark:bg-cyan-500/10 dark:text-cyan-400">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-extrabold tracking-tight text-slate-900 dark:text-white truncate">
              {formatDuration(stats.avgFirstResponseSeconds)}
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            <strong className="text-slate-700 dark:text-slate-300">{stats.createdLast24h}</strong> created in last 24h
          </p>
        </div>
      </div>

      {/* Queue Status Pipeline Section */}
      <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-6 shadow-sm backdrop-blur-md dark:border-white/10 dark:bg-white/5">
        <div className="flex items-center justify-between pb-4">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-white">Ticket Pipeline by Status</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Current progress across {totalTracked} total recorded tickets
            </p>
          </div>
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Total Tickets: <strong className="text-slate-900 dark:text-white">{stats.total}</strong>
          </span>
        </div>

        {/* Visual Multi-Segment Progress Bar */}
        <div className="h-3 w-full overflow-hidden rounded-full bg-slate-100 flex dark:bg-white/10">
          <div style={{ width: `${Math.max(stats.open > 0 ? 5 : 0, openPct)}%` }} className="bg-sky-500 transition-all duration-300" title={`Open: ${stats.open}`} />
          <div style={{ width: `${Math.max(stats.inProgress > 0 ? 5 : 0, inProgressPct)}%` }} className="bg-amber-500 transition-all duration-300" title={`In Progress: ${stats.inProgress}`} />
          <div style={{ width: `${Math.max(stats.resolved > 0 ? 5 : 0, resolvedPct)}%` }} className="bg-emerald-500 transition-all duration-300" title={`Resolved: ${stats.resolved}`} />
          <div style={{ width: `${Math.max(stats.closed > 0 ? 5 : 0, closedPct)}%` }} className="bg-indigo-400 dark:bg-indigo-600 transition-all duration-300" title={`Closed: ${stats.closed}`} />
        </div>

        {/* Status Breakdown Grid */}
        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Link
            href="/tickets?status=OPEN"
            className="flex items-center justify-between rounded-xl border border-slate-200/60 bg-white/60 p-3.5 transition-all hover:border-sky-400 hover:bg-sky-50/50 dark:border-white/5 dark:bg-white/[0.02] dark:hover:bg-sky-950/20"
          >
            <div className="flex items-center gap-2.5">
              <span className="h-2.5 w-2.5 rounded-full bg-sky-500" />
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Open</span>
            </div>
            <span className="text-lg font-bold text-slate-900 dark:text-white">{stats.open}</span>
          </Link>

          <Link
            href="/tickets?status=IN_PROGRESS"
            className="flex items-center justify-between rounded-xl border border-slate-200/60 bg-white/60 p-3.5 transition-all hover:border-amber-400 hover:bg-amber-50/50 dark:border-white/5 dark:bg-white/[0.02] dark:hover:bg-amber-950/20"
          >
            <div className="flex items-center gap-2.5">
              <span className="h-2.5 w-2.5 rounded-full bg-amber-500" />
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">In Progress</span>
            </div>
            <span className="text-lg font-bold text-slate-900 dark:text-white">{stats.inProgress}</span>
          </Link>

          <Link
            href="/tickets?status=RESOLVED"
            className="flex items-center justify-between rounded-xl border border-slate-200/60 bg-white/60 p-3.5 transition-all hover:border-emerald-400 hover:bg-emerald-50/50 dark:border-white/5 dark:bg-white/[0.02] dark:hover:bg-emerald-950/20"
          >
            <div className="flex items-center gap-2.5">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Resolved</span>
            </div>
            <span className="text-lg font-bold text-slate-900 dark:text-white">{stats.resolved}</span>
          </Link>

          <Link
            href="/tickets?status=CLOSED"
            className="flex items-center justify-between rounded-xl border border-slate-200/60 bg-white/60 p-3.5 transition-all hover:border-indigo-400 hover:bg-indigo-50/50 dark:border-white/5 dark:bg-white/[0.02] dark:hover:bg-indigo-950/20"
          >
            <div className="flex items-center gap-2.5">
              <span className="h-2.5 w-2.5 rounded-full bg-slate-400 dark:bg-indigo-400" />
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Closed</span>
            </div>
            <span className="text-lg font-bold text-slate-900 dark:text-white">{stats.closed}</span>
          </Link>
        </div>
      </div>

      {/* Grid: Priority Matrix & Active Staff */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Active Tickets by Priority (2 cols) */}
        <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-6 shadow-sm backdrop-blur-md dark:border-white/10 dark:bg-white/5 lg:col-span-2">
          <div className="flex items-center justify-between pb-4 border-b border-slate-200/70 dark:border-white/10">
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white">Active Tickets by Priority</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">Urgency classification of unresolved tickets</p>
            </div>
            <span className="text-xs font-semibold text-slate-600 dark:text-slate-400">
              {stats.activeUrgent + stats.activeHigh + stats.activeMedium + stats.activeLow} active
            </span>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {/* Urgent */}
            <Link
              href="/tickets?priority=URGENT"
              className="group flex flex-col justify-between rounded-xl border border-red-200/60 bg-red-50/40 p-4 transition-all hover:-translate-y-0.5 hover:shadow-md hover:shadow-red-500/10 dark:border-red-500/20 dark:bg-red-950/20"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-red-600 dark:text-red-400">Urgent</span>
                <span className="h-2 w-2 rounded-full bg-red-500" />
              </div>
              <span className="mt-3 text-2xl font-black text-red-700 dark:text-red-300">{stats.activeUrgent}</span>
            </Link>

            {/* High */}
            <Link
              href="/tickets?priority=HIGH"
              className="group flex flex-col justify-between rounded-xl border border-amber-200/60 bg-amber-50/40 p-4 transition-all hover:-translate-y-0.5 hover:shadow-md hover:shadow-amber-500/10 dark:border-amber-500/20 dark:bg-amber-950/20"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400">High</span>
                <span className="h-2 w-2 rounded-full bg-amber-500" />
              </div>
              <span className="mt-3 text-2xl font-black text-amber-700 dark:text-amber-300">{stats.activeHigh}</span>
            </Link>

            {/* Medium */}
            <Link
              href="/tickets?priority=MEDIUM"
              className="group flex flex-col justify-between rounded-xl border border-blue-200/60 bg-blue-50/40 p-4 transition-all hover:-translate-y-0.5 hover:shadow-md hover:shadow-blue-500/10 dark:border-blue-500/20 dark:bg-blue-950/20"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400">Medium</span>
                <span className="h-2 w-2 rounded-full bg-blue-500" />
              </div>
              <span className="mt-3 text-2xl font-black text-blue-700 dark:text-blue-300">{stats.activeMedium}</span>
            </Link>

            {/* Low */}
            <Link
              href="/tickets?priority=LOW"
              className="group flex flex-col justify-between rounded-xl border border-slate-200/60 bg-slate-50/60 p-4 transition-all hover:-translate-y-0.5 hover:shadow-md dark:border-white/10 dark:bg-white/[0.02]"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400">Low</span>
                <span className="h-2 w-2 rounded-full bg-slate-400" />
              </div>
              <span className="mt-3 text-2xl font-black text-slate-800 dark:text-slate-200">{stats.activeLow}</span>
            </Link>
          </div>
        </div>

        {/* Staff Presence Card (1 col) */}
        <div className="flex flex-col justify-between rounded-2xl border border-slate-200/80 bg-white/80 p-6 shadow-sm backdrop-blur-md dark:border-white/10 dark:bg-white/5">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-slate-200/70 dark:border-white/10">
              <h2 className="text-base font-bold text-slate-900 dark:text-white">Active Staff</h2>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                {presence.length} online
              </span>
            </div>

            <div className="mt-4 space-y-2">
              {presence.length > 0 ? (
                presence.map((p) => (
                  <div key={p.userId} className="flex items-center justify-between rounded-xl bg-white/60 p-2.5 text-xs dark:bg-white/5">
                    <span className="font-medium text-slate-800 dark:text-slate-200 truncate" title={p.email}>
                      {p.email}
                    </span>
                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                      Online
                    </span>
                  </div>
                ))
              ) : (
                <div className="py-6 text-center text-xs text-slate-500 dark:text-slate-400">
                  <p>No other staff currently active.</p>
                  <p className="mt-1">Presence updates in real time.</p>
                </div>
              )}
            </div>
          </div>

          <Link
            href="/team"
            className="mt-4 block text-center rounded-xl border border-slate-200/80 bg-white/50 py-2 text-xs font-semibold text-indigo-600 hover:bg-white dark:border-white/10 dark:bg-white/5 dark:text-indigo-400 dark:hover:bg-white/10"
          >
            Manage Team Members →
          </Link>
        </div>
      </div>

      {/* Recent Tickets Table Section */}
      <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white/80 shadow-sm backdrop-blur-md dark:border-white/10 dark:bg-white/5">
        <div className="flex items-center justify-between border-b border-slate-200/70 p-5 dark:border-white/10">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-white">Recent Tickets</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">Most recently created support tickets</p>
          </div>
          <Link
            href="/tickets"
            className="text-xs font-semibold text-indigo-600 hover:underline dark:text-indigo-400"
          >
            View full queue ({stats.total}) →
          </Link>
        </div>

        {recentTickets.items && recentTickets.items.length > 0 ? (
          <div className="divide-y divide-slate-200/70 dark:divide-white/10">
            {recentTickets.items.map((ticket) => {
              const statusCfg = statusStyles[ticket.status] || statusStyles.OPEN;
              const priorityCfg = priorityStyles[ticket.priority] || priorityStyles.MEDIUM;
              return (
                <Link
                  key={ticket.id}
                  href={`/tickets/${ticket.id}`}
                  className="group flex flex-col gap-2 p-4 transition-colors hover:bg-slate-50/70 dark:hover:bg-white/5 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-slate-900 group-hover:text-indigo-600 dark:text-white dark:group-hover:text-indigo-400 transition-colors">
                      {ticket.subject}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Created on {formatDate(ticket.createdAt)}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${statusCfg.bg} ${statusCfg.text}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${statusCfg.dot}`} />
                      {statusCfg.label}
                    </span>

                    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${priorityCfg.badge}`}>
                      {ticket.priority}
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        ) : (
          <div className="py-12 text-center text-sm text-slate-500 dark:text-slate-400">
            No tickets found in the queue.
          </div>
        )}
      </div>
    </div>
  );
}
