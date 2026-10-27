import { Suspense } from 'react';
import { LocalTime } from '@/components/local-time';
import { api } from '@/lib/api';
import { requireRole } from '@/lib/auth';
import type { DeadLetterRecord } from '@/lib/types';

export default function FailedEventsPage() {
  return (
    <Suspense fallback={<p className="text-sm text-neutral-600 dark:text-neutral-400">Loading…</p>}>
      <FailedEvents />
    </Suspense>
  );
}

// Admins only: background events (emails, audit, SLA timers) that still failed after several retries.
async function FailedEvents() {
  await requireRole('ADMIN');
  const items = await api<DeadLetterRecord[]>('/api/v1/dead-letters');
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Failed events</h1>
      <p className="text-sm text-neutral-600 dark:text-neutral-400">
        Background jobs that failed even after retrying. Nothing is lost: each is also kept on its dead-letter topic.
      </p>
      {items.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-300 px-4 py-10 text-center text-sm text-neutral-600 dark:text-neutral-400 dark:border-neutral-700">
          Nothing has failed. Healthy.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200/80 bg-white/80 shadow-sm backdrop-blur dark:border-white/10 dark:bg-white/5">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50/80 text-xs tracking-wide uppercase text-slate-500 dark:text-slate-400 dark:bg-white/5">
              <tr>
                <th className="px-4 py-2 font-medium">Event</th>
                <th className="px-4 py-2 font-medium">Job</th>
                <th className="px-4 py-2 font-medium">Error</th>
                <th className="px-4 py-2 font-medium">Tries</th>
                <th className="px-4 py-2 font-medium">When</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-white/10">
              {items.map((item) => (
                <tr key={item.id}>
                  <td className="px-4 py-2 whitespace-nowrap">{item.eventType}</td>
                  <td className="px-4 py-2 whitespace-nowrap">{item.consumer}</td>
                  <td className="px-4 py-2 [overflow-wrap:anywhere]">{item.error}</td>
                  <td className="px-4 py-2">{item.attempts}</td>
                  <td className="px-4 py-2 whitespace-nowrap">
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
