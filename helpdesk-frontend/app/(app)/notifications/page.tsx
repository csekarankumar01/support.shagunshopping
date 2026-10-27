import Link from 'next/link';
import { Suspense } from 'react';
import { LocalTime } from '@/components/local-time';
import { api } from '@/lib/api';
import { requireRole } from '@/lib/auth';
import type { NotificationRecord } from '@/lib/types';

export default function NotificationsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-16 text-sm text-slate-500 dark:text-slate-400">
          <div className="flex items-center gap-2">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
            Loading email logs…
          </div>
        </div>
      }
    >
      <Notifications />
    </Suspense>
  );
}

const kindLabel = { TICKET_RECEIPT: 'Receipt to customer', SLA_BREACH_ALERT: 'SLA breach alert' } as const;

const statusStyle = {
  SENT: 'bg-emerald-50 text-emerald-700 border border-emerald-200/80 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800/60',
  PENDING: 'bg-amber-50 text-amber-700 border border-amber-200/80 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800/60',
  FAILED: 'bg-rose-50 text-rose-700 border border-rose-200/80 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800/60',
} as const;

// Admins only: the emails the system sent (receipts, SLA alerts) and whether they got through.
async function Notifications() {
  await requireRole('ADMIN');
  const items = await api<NotificationRecord[]>('/api/v1/notifications');

  const sentCount = items.filter((i) => i.status === 'SENT').length;
  const pendingCount = items.filter((i) => i.status === 'PENDING').length;
  const failedCount = items.filter((i) => i.status === 'FAILED').length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">Email log</h1>
          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-700 dark:bg-white/10 dark:text-slate-300">
            {items.length} {items.length === 1 ? 'record' : 'records'}
          </span>
        </div>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Auditable dispatch log of automated customer receipts and team SLA escalation alerts via Resend.
        </p>
      </div>

      {/* Mini KPI summary */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded-xl border border-slate-200/80 bg-white/80 p-3.5 shadow-xs backdrop-blur-sm dark:border-white/10 dark:bg-white/5">
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Total Dispatched</span>
          <p className="mt-1 text-xl font-bold text-slate-900 dark:text-white">{items.length}</p>
        </div>
        <div className="rounded-xl border border-emerald-200/80 bg-emerald-50/50 p-3.5 shadow-xs backdrop-blur-sm dark:border-emerald-900/40 dark:bg-emerald-950/20">
          <span className="text-xs font-medium text-emerald-800 dark:text-emerald-300">Delivered</span>
          <p className="mt-1 text-xl font-bold text-emerald-700 dark:text-emerald-400">{sentCount}</p>
        </div>
        <div className="rounded-xl border border-amber-200/80 bg-amber-50/50 p-3.5 shadow-xs backdrop-blur-sm dark:border-amber-900/40 dark:bg-amber-950/20">
          <span className="text-xs font-medium text-amber-800 dark:text-amber-300">Pending</span>
          <p className="mt-1 text-xl font-bold text-amber-700 dark:text-amber-400">{pendingCount}</p>
        </div>
        <div className="rounded-xl border border-rose-200/80 bg-rose-50/50 p-3.5 shadow-xs backdrop-blur-sm dark:border-rose-900/40 dark:bg-rose-950/20">
          <span className="text-xs font-medium text-rose-800 dark:text-rose-300">Failed</span>
          <p className="mt-1 text-xl font-bold text-rose-700 dark:text-rose-400">{failedCount}</p>
        </div>
      </div>

      {/* Table Container */}
      {items.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300/80 bg-white/40 px-6 py-16 text-center dark:border-white/10 dark:bg-white/5">
          <span className="text-2xl">📬</span>
          <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
            No emails yet. They appear when tickets are created or breach their SLA.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200/80 bg-white/80 shadow-sm backdrop-blur dark:border-white/10 dark:bg-white/5">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200/80 bg-slate-50/80 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:border-white/10 dark:bg-white/5 dark:text-slate-400">
              <tr>
                <th className="px-5 py-3.5">Type</th>
                <th className="px-4 py-3.5">To</th>
                <th className="px-4 py-3.5">Subject</th>
                <th className="px-4 py-3.5">Status</th>
                <th className="px-4 py-3.5">When</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-white/10 [&_tr]:transition-colors [&_tr:hover]:bg-indigo-50/40 dark:[&_tr:hover]:bg-white/5">
              {items.map((item) => (
                <tr key={item.id} className="group">
                  <td className="px-5 py-3.5 whitespace-nowrap">
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                        item.kind === 'SLA_BREACH_ALERT'
                          ? 'bg-rose-50 text-rose-700 border border-rose-200/80 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800/60'
                          : 'bg-sky-50 text-sky-700 border border-sky-200/80 dark:bg-sky-950/60 dark:text-sky-300 dark:border-sky-800/60'
                      }`}
                    >
                      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-75" />
                      {kindLabel[item.kind]}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 text-xs font-medium text-slate-700 [overflow-wrap:anywhere] dark:text-slate-300">
                    {item.recipientEmail}
                  </td>
                  <td className="px-4 py-3.5 [overflow-wrap:anywhere]">
                    <Link
                      href={`/tickets/${item.ticketId}`}
                      className="font-semibold text-slate-900 transition hover:text-indigo-600 dark:text-slate-100 dark:hover:text-indigo-400"
                    >
                      {item.subject}
                    </Link>
                  </td>
                  <td className="px-4 py-3.5 whitespace-nowrap">
                    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusStyle[item.status]}`}>
                      {item.status}
                    </span>
                    {item.status !== 'SENT' && item.lastError && (
                      <span className="ml-2 block max-w-xs truncate text-xs text-rose-600 dark:text-rose-400" title={item.lastError}>
                        {item.lastError}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3.5 whitespace-nowrap text-xs text-slate-500 dark:text-slate-400">
                    <LocalTime iso={item.createdAt} />
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
