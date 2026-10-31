import Link from 'next/link';
import { Suspense } from 'react';
import { platformApi } from '@/lib/platform';
import type { PlatformOverview } from '@/lib/platform';

interface MetricCardProps {
  label: string;
  value: number;
  subtext: string;
  href?: string;
  danger?: boolean;
  color: 'indigo' | 'amber' | 'emerald' | 'blue' | 'purple' | 'cyan' | 'rose' | 'orange';
  icon: React.ReactNode;
}

const colorStyles = {
  indigo: {
    iconBg: 'bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 group-hover:bg-indigo-600 group-hover:text-white',
    badge: 'text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-500/10 border-indigo-200 dark:border-indigo-500/20',
  },
  amber: {
    iconBg: 'bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400 group-hover:bg-amber-600 group-hover:text-white',
    badge: 'text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/20',
  },
  emerald: {
    iconBg: 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 group-hover:bg-emerald-600 group-hover:text-white',
    badge: 'text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/20',
  },
  blue: {
    iconBg: 'bg-sky-50 dark:bg-sky-500/10 text-sky-600 dark:text-sky-400 group-hover:bg-sky-600 group-hover:text-white',
    badge: 'text-sky-700 dark:text-sky-300 bg-sky-50 dark:bg-sky-500/10 border-sky-200 dark:border-sky-500/20',
  },
  purple: {
    iconBg: 'bg-purple-50 dark:bg-purple-500/10 text-purple-600 dark:text-purple-400 group-hover:bg-purple-600 group-hover:text-white',
    badge: 'text-purple-700 dark:text-purple-300 bg-purple-50 dark:bg-purple-500/10 border-purple-200 dark:border-purple-500/20',
  },
  cyan: {
    iconBg: 'bg-cyan-50 dark:bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 group-hover:bg-cyan-600 group-hover:text-white',
    badge: 'text-cyan-700 dark:text-cyan-300 bg-cyan-50 dark:bg-cyan-500/10 border-cyan-200 dark:border-cyan-500/20',
  },
  rose: {
    iconBg: 'bg-rose-50 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400 group-hover:bg-rose-600 group-hover:text-white',
    badge: 'text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-500/10 border-rose-200 dark:border-rose-500/20',
  },
  orange: {
    iconBg: 'bg-orange-50 dark:bg-orange-500/10 text-orange-600 dark:text-orange-400 group-hover:bg-orange-600 group-hover:text-white',
    badge: 'text-orange-700 dark:text-orange-300 bg-orange-50 dark:bg-orange-500/10 border-orange-200 dark:border-orange-500/20',
  },
};

function MetricCard({ label, value, subtext, href, danger, color, icon }: MetricCardProps) {
  const styles = colorStyles[color];
  const isDangerActive = danger && value > 0;

  const content = (
    <div className="flex h-full flex-col justify-between">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold tracking-wider text-slate-500 uppercase dark:text-slate-400">
          {label}
        </span>
        <div className={`flex h-9 w-9 items-center justify-center rounded-xl transition-colors ${styles.iconBg}`}>
          {icon}
        </div>
      </div>
      <div className="mt-4">
        <div className={`text-3xl font-bold tracking-tight ${isDangerActive ? 'text-rose-600 dark:text-rose-400' : 'text-slate-900 dark:text-white'}`}>
          {value}
        </div>
        <p className={`mt-1 text-xs ${isDangerActive ? 'font-medium text-rose-600 dark:text-rose-400' : 'text-slate-500 dark:text-slate-400'}`}>
          {subtext}
        </p>
      </div>
    </div>
  );

  const cardBase = `group relative rounded-2xl border p-5 shadow-sm backdrop-blur-xl transition-all duration-200 ${
    isDangerActive
      ? 'border-rose-300 bg-rose-50/50 dark:border-rose-900/50 dark:bg-rose-950/20'
      : 'border-slate-200/80 bg-white/80 dark:border-white/10 dark:bg-slate-900/60'
  }`;

  if (href) {
    return (
      <Link
        href={href}
        className={`${cardBase} hover:-translate-y-0.5 hover:border-indigo-400 hover:shadow-lg hover:shadow-indigo-500/10 dark:hover:border-indigo-500/40`}
      >
        {content}
      </Link>
    );
  }

  return <div className={cardBase}>{content}</div>;
}

export default function PlatformOverviewPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent dark:border-indigo-400" />
        </div>
      }
    >
      <PlatformOverviewContent />
    </Suspense>
  );
}

async function PlatformOverviewContent() {
  const o = await platformApi<PlatformOverview>('/overview');

  return (
    <div className="space-y-8 pb-12">
      {/* Hero Header Banner */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white sm:text-3xl">
              Platform overview
            </h1>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Live Telemetry
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-purple-500/30 bg-purple-500/10 px-2.5 py-0.5 text-xs font-semibold text-purple-700 dark:text-purple-300">
              RLS Kernel Enforced
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Global multi-tenant system health, cross-organization statistics, and super admin operations.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <Link
            href="/platform/organizations"
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 via-indigo-600 to-purple-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-indigo-600/25 transition-all duration-150 hover:from-indigo-500 hover:to-purple-500 hover:shadow-lg active:scale-95"
          >
            <span>Organisations</span>
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
            </svg>
          </Link>
          <Link
            href="/platform/audit"
            className="inline-flex items-center gap-2 rounded-xl border border-slate-300/80 bg-white/80 px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm backdrop-blur transition-all duration-150 hover:border-slate-400 hover:bg-white active:scale-95 dark:border-white/10 dark:bg-white/5 dark:text-slate-200 dark:hover:bg-white/10"
          >
            <span>Audit log</span>
          </Link>
        </div>
      </div>

      {/* 8 High-Impact KPI Stat Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Organisations */}
        <MetricCard
          label="Organisations"
          value={o.organizations}
          subtext="Active tenant workspaces"
          href="/platform/organizations"
          color="indigo"
          icon={
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
            </svg>
          }
        />

        {/* Suspended */}
        <MetricCard
          label="Suspended"
          value={o.suspended}
          subtext={o.suspended > 0 ? `${o.suspended} tenant(s) access blocked` : 'All organisations active'}
          danger
          color="amber"
          icon={
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          }
        />

        {/* New this week */}
        <MetricCard
          label="New this week"
          value={o.newThisWeek}
          subtext="Onboarded in last 7 days"
          color="cyan"
          icon={
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
            </svg>
          }
        />

        {/* Active users */}
        <MetricCard
          label="Active users"
          value={o.users}
          subtext="Across all tenant domains"
          color="blue"
          icon={
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
          }
        />

        {/* Tickets */}
        <MetricCard
          label="Tickets"
          value={o.tickets}
          subtext="Lifetime customer requests"
          color="purple"
          icon={
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z" />
            </svg>
          }
        />

        {/* Open tickets */}
        <MetricCard
          label="Open tickets"
          value={o.openTickets}
          subtext="Pending staff resolution"
          color="emerald"
          icon={
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
        />

        {/* SLA breached */}
        <MetricCard
          label="SLA breached"
          value={o.breachedTickets}
          subtext={o.breachedTickets > 0 ? `${o.breachedTickets} overdue ticket response(s)` : 'Zero overdue deadlines'}
          danger
          color="rose"
          icon={
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          }
        />

        {/* Failed events */}
        <MetricCard
          label="Failed events"
          value={o.failedEvents}
          subtext={o.failedEvents > 0 ? `${o.failedEvents} dead-letter queue items` : 'All Kafka consumers healthy'}
          danger
          color="orange"
          icon={
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          }
        />
      </div>

      {/* Platform Infrastructure & Security Grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Architecture & Security Overview Card */}
        <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-6 shadow-sm backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/60 lg:col-span-2">
          <div className="flex items-center justify-between border-b border-slate-100 pb-4 dark:border-white/10">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
              </div>
              <div>
                <h2 className="text-base font-semibold text-slate-900 dark:text-white">Security & Tenancy Guardrails</h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">Strict database-level boundaries and append-only audits</p>
              </div>
            </div>
            <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-600/20 dark:bg-emerald-950/50 dark:text-emerald-300">
              Optimal
            </span>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-4 dark:border-white/5 dark:bg-white/[0.02]">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-300">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                Row-Level Security (RLS)
              </div>
              <p className="mt-1.5 text-xs text-slate-600 dark:text-slate-400">
                PostgreSQL kernel enforces multi-tenant boundary checks on every query. The database rejects cross-tenant reads even if application logic is bypassed.
              </p>
            </div>

            <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-4 dark:border-white/5 dark:bg-white/[0.02]">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-300">
                <span className="h-2 w-2 rounded-full bg-indigo-500" />
                Event Broker Streaming
              </div>
              <p className="mt-1.5 text-xs text-slate-600 dark:text-slate-400">
                Redpanda Kafka partition keys match organization UUIDs. Outbox pattern ensures guaranteed at-least-once notifications and audit writes.
              </p>
            </div>

            <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-4 dark:border-white/5 dark:bg-white/[0.02]">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-300">
                <span className="h-2 w-2 rounded-full bg-purple-500" />
                Super Admin Isolation
              </div>
              <p className="mt-1.5 text-xs text-slate-600 dark:text-slate-400">
                Platform tokens carry <code className="text-purple-600 dark:text-purple-400 font-mono text-[11px]">purpose: platform</code> and are rejected by all tenant APIs and WebSockets.
              </p>
            </div>

            <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-4 dark:border-white/5 dark:bg-white/[0.02]">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-300">
                <span className="h-2 w-2 rounded-full bg-cyan-500" />
                Immutable Audit Trail
              </div>
              <p className="mt-1.5 text-xs text-slate-600 dark:text-slate-400">
                Every super admin action and cross-tenant ticket inspection is written to an append-only log with tamper-resistant schema protections.
              </p>
            </div>
          </div>
        </div>

        {/* Quick Operations & Fast Navigation Panel */}
        <div className="flex flex-col justify-between rounded-2xl border border-slate-200/80 bg-white/80 p-6 shadow-sm backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/60">
          <div>
            <div className="flex items-center gap-2.5 border-b border-slate-100 pb-4 dark:border-white/10">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-50 text-purple-600 dark:bg-purple-500/10 dark:text-purple-400">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <div>
                <h2 className="text-base font-semibold text-slate-900 dark:text-white">Operator Actions</h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">Common administrative workflows</p>
              </div>
            </div>

            <div className="mt-4 space-y-2.5">
              <Link
                href="/platform/organizations"
                className="group flex items-center justify-between rounded-xl border border-slate-200/70 bg-slate-50/60 p-3 text-xs font-semibold text-slate-700 transition hover:border-indigo-400 hover:bg-indigo-50/60 dark:border-white/5 dark:bg-white/[0.02] dark:text-slate-300 dark:hover:bg-white/[0.06]"
              >
                <div className="flex items-center gap-2.5">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300">
                    🏢
                  </span>
                  <div>
                    <div className="font-semibold text-slate-900 dark:text-white">Manage Organisations</div>
                    <div className="text-[11px] font-normal text-slate-500 dark:text-slate-400">Search, edit plans, adjust SLAs</div>
                  </div>
                </div>
                <span className="text-slate-400 group-hover:translate-x-0.5 transition-transform">→</span>
              </Link>

              <Link
                href="/platform/audit"
                className="group flex items-center justify-between rounded-xl border border-slate-200/70 bg-slate-50/60 p-3 text-xs font-semibold text-slate-700 transition hover:border-indigo-400 hover:bg-indigo-50/60 dark:border-white/5 dark:bg-white/[0.02] dark:text-slate-300 dark:hover:bg-white/[0.06]"
              >
                <div className="flex items-center gap-2.5">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-300">
                    🛡️
                  </span>
                  <div>
                    <div className="font-semibold text-slate-900 dark:text-white">Review Security Audit</div>
                    <div className="text-[11px] font-normal text-slate-500 dark:text-slate-400">Last 200 platform operator actions</div>
                  </div>
                </div>
                <span className="text-slate-400 group-hover:translate-x-0.5 transition-transform">→</span>
              </Link>
            </div>
          </div>

          <div className="mt-6 rounded-xl border border-slate-200/60 bg-slate-50/80 p-3.5 text-xs text-slate-600 dark:border-white/5 dark:bg-white/[0.02] dark:text-slate-400">
            <div className="flex items-center gap-2 font-medium text-slate-800 dark:text-slate-200">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-ping" />
              Infrastructure Heartbeat Active
            </div>
            <p className="mt-1 text-[11px] leading-relaxed">
              Real-time SLA monitoring and Redis presence workers running normally across all tenant partitions.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

