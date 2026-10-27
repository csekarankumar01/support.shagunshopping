import Link from 'next/link';
import { Suspense } from 'react';
import { NewTicketForm } from '@/components/forms';
import { requireRole } from '@/lib/auth';

export default function NewTicketPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-16 text-sm text-slate-500 dark:text-slate-400">
          <div className="flex items-center gap-2">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
            Loading…
          </div>
        </div>
      }
    >
      <NewTicket />
    </Suspense>
  );
}

// Only customers raise tickets (the API enforces it too); everyone else is sent back to the list.
async function NewTicket() {
  await requireRole('CUSTOMER');
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <Link
          href="/tickets"
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-indigo-600 transition hover:text-indigo-700 hover:underline dark:text-indigo-400 dark:hover:text-indigo-300"
        >
          ← Back to my tickets
        </Link>
      </div>

      <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-6 shadow-sm backdrop-blur-md dark:border-white/10 dark:bg-white/5 sm:p-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">New ticket</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Submit a support request to our engineering team. All tickets are tracked in real time against strict SLA deadlines.
          </p>
        </div>

        <div className="mb-6 grid grid-cols-2 gap-2.5 rounded-xl border border-slate-100 bg-slate-50/70 p-3.5 text-xs text-slate-600 dark:border-white/5 dark:bg-white/[0.02] dark:text-slate-300 sm:grid-cols-4">
          <div>
            <span className="font-semibold text-rose-600 dark:text-rose-400">Urgent</span>
            <p className="mt-0.5 text-[11px] text-slate-500">Service completely down</p>
          </div>
          <div>
            <span className="font-semibold text-orange-600 dark:text-orange-400">High</span>
            <p className="mt-0.5 text-[11px] text-slate-500">Major functionality impacted</p>
          </div>
          <div>
            <span className="font-semibold text-blue-600 dark:text-blue-400">Medium</span>
            <p className="mt-0.5 text-[11px] text-slate-500">General inquiry or issue</p>
          </div>
          <div>
            <span className="font-semibold text-slate-600 dark:text-slate-400">Low</span>
            <p className="mt-0.5 text-[11px] text-slate-500">Minor enhancement or question</p>
          </div>
        </div>

        <NewTicketForm />
      </div>
    </div>
  );
}
