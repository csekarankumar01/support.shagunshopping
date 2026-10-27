import { Suspense } from 'react';
import { NewTicketForm } from '@/components/forms';
import { requireRole } from '@/lib/auth';

export default function NewTicketPage() {
  return (
    <Suspense fallback={<p className="text-sm text-neutral-600 dark:text-neutral-400">Loading…</p>}>
      <NewTicket />
    </Suspense>
  );
}

// Only customers raise tickets (the API enforces it too); everyone else is sent back to the list.
async function NewTicket() {
  await requireRole('CUSTOMER');
  return (
    <div className="max-w-lg space-y-5">
      <h1 className="text-xl font-semibold">New ticket</h1>
      <NewTicketForm />
    </div>
  );
}
