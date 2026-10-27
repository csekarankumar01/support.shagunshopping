import Link from 'next/link';
import { Suspense } from 'react';
import { LocalTime } from '@/components/local-time';
import { api } from '@/lib/api';
import { requireRole } from '@/lib/auth';
import type { NotificationRecord } from '@/lib/types';

export default function NotificationsPage() {
  return (
    <Suspense fallback={<p className="text-sm text-neutral-600 dark:text-neutral-400">Loading…</p>}>
      <Notifications />
    </Suspense>
  );
}

const kindLabel = { TICKET_RECEIPT: 'Receipt to customer', SLA_BREACH_ALERT: 'SLA breach alert' } as const;
const statusStyle = {
  SENT: 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300',
  PENDING: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  FAILED: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
} as const;

// Admins only: the emails the system sent (receipts, SLA alerts) and whether they got through.
async function Notifications() {
  await requireRole('ADMIN');
  const items = await api<NotificationRecord[]>('/api/v1/notifications');
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Email log</h1>
      {items.length === 0 ? (
        <p className="text-sm text-neutral-600 dark:text-neutral-400">No emails yet. They appear when tickets are created or breach their SLA.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-neutral-200 dark:border-neutral-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-neutral-50 text-xs uppercase text-neutral-600 dark:text-neutral-400 dark:bg-neutral-900">
              <tr>
                <th className="px-4 py-2 font-medium">Type</th>
                <th className="px-4 py-2 font-medium">To</th>
                <th className="px-4 py-2 font-medium">Subject</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">When</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800">
              {items.map((item) => (
                <tr key={item.id}>
                  <td className="px-4 py-2 whitespace-nowrap">{kindLabel[item.kind]}</td>
                  <td className="px-4 py-2 [overflow-wrap:anywhere]">{item.recipientEmail}</td>
                  <td className="px-4 py-2 [overflow-wrap:anywhere]">
                    <Link href={`/tickets/${item.ticketId}`} className="text-blue-600 dark:text-blue-400 hover:underline">
                      {item.subject}
                    </Link>
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap">
                    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${statusStyle[item.status]}`}>{item.status}</span>
                    {item.status !== 'SENT' && item.lastError && <span className="ml-2 text-xs text-neutral-600 dark:text-neutral-400">{item.lastError}</span>}
                  </td>
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
