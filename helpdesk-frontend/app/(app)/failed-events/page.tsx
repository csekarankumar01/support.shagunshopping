import { Suspense } from 'react';
import { LocalTime } from '@/components/local-time';
import { api } from '@/lib/api';
import { requireRole } from '@/lib/auth';
import type { DeadLetterRecord } from '@/lib/types';

export default function FailedEventsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-16 text-sm text-slate-500 dark:text-slate-400">
          <div className="flex items-center gap-2">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
            Loading failed events…
          </div>
        </div>
      }
    >
      <FailedEvents />
    </Suspense>
  );
}

// Admins only: background events (emails, audit, SLA timers) that still failed after several retries.
async function FailedEvents() {
  await requireRole('ADMIN');
  const items = await api<DeadLetterRecord[]>('/api/v1/dead-letters');

  return (
    <div className="space-y-6">
      {/* Header bar */}
      <div>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">Failed events</h1>
          <span
            className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
              items.length === 0
                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                : 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300'
            }`}
          >
            {items.length} {items.length === 1 ? 'event' : 'events'}
          </span>
        </div>
        <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
          Background jobs that failed even after retrying. Nothing is lost: each is also kept on its dead-letter topic.
        </p>
      </div>

      {items.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-emerald-200/80 bg-emerald-50/40 px-6 py-16 text-center dark:border-emerald-900/40 dark:bg-emerald-950/10">
          <span className="text-3xl">🛡️</span>
          <p className="mt-3 text-sm font-semibold text-emerald-800 dark:text-emerald-300">
            Nothing has failed. Healthy.
          </p>
          <p className="mt-1 text-xs text-emerald-600/90 dark:text-emerald-400/80">
            All Kafka consumer queues, SLA watchers, and email dispatches are operating without faults.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200/80 bg-white/80 shadow-sm backdrop-blur dark:border-white/10 dark:bg-white/5">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200/80 bg-slate-50/80 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:border-white/10 dark:bg-white/5 dark:text-slate-400">
              <tr>
                <th className="px-5 py-3.5">Event</th>
                <th className="px-4 py-3.5">Job</th>
                <th className="px-4 py-3.5">Error</th>
                <th className="px-4 py-3.5">Tries</th>
                <th className="px-4 py-3.5">When</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-white/10 [&_tr]:transition-colors [&_tr:hover]:bg-rose-50/30 dark:[&_tr:hover]:bg-white/5">
              {items.map((item) => (
                <tr key={item.id}>
                  <td className="px-5 py-3.5 whitespace-nowrap">
                    <span className="font-mono text-xs font-semibold text-slate-800 dark:text-slate-200">
                      {item.eventType}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 whitespace-nowrap text-xs text-slate-600 dark:text-slate-400">
                    {item.consumer}
                  </td>
                  <td className="px-4 py-3.5 [overflow-wrap:anywhere]">
                    <span className="font-mono text-xs text-rose-600 dark:text-rose-400">{item.error}</span>
                  </td>
                  <td className="px-4 py-3.5 whitespace-nowrap text-xs">
                    <span className="rounded-md bg-rose-100 px-2 py-0.5 font-bold text-rose-700 dark:bg-rose-950 dark:text-rose-300">
                      {item.attempts}
                    </span>
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
