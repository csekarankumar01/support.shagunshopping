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
            Submit a support ticket to Shagun Shopping customer care. Our Meerut store team responds in real time.
          </p>
        </div>

        <div className="mb-6 grid grid-cols-2 gap-2.5 rounded-xl border border-pink-100/80 bg-pink-50/50 p-3.5 text-xs text-slate-700 dark:border-pink-900/20 dark:bg-pink-950/20 dark:text-slate-300 sm:grid-cols-4">
          <div>
            <span className="font-semibold text-rose-600 dark:text-rose-400">Urgent</span>
            <p className="mt-0.5 text-[11px] text-slate-500">Damaged parcel or broken cosmetic bottle</p>
          </div>
          <div>
            <span className="font-semibold text-orange-600 dark:text-orange-400">High</span>
            <p className="mt-0.5 text-[11px] text-slate-500">Courier delayed past delivery date</p>
          </div>
          <div>
            <span className="font-semibold text-blue-600 dark:text-blue-400">Medium</span>
            <p className="mt-0.5 text-[11px] text-slate-500">Return / exchange & GST invoice</p>
          </div>
          <div>
            <span className="font-semibold text-slate-600 dark:text-slate-400">Low</span>
            <p className="mt-0.5 text-[11px] text-slate-500">Beauty routine or cosmetic shade advice</p>
          </div>
        </div>

        <NewTicketForm />
      </div>
    </div>
  );
}
