import { Suspense } from 'react';
import { CannedForm, DeleteCannedForm } from '@/components/forms';
import { api } from '@/lib/api';
import { requireRole } from '@/lib/auth';
import type { CannedResponse } from '@/lib/types';

export default function CannedPage() {
  return (
    <Suspense fallback={<p className="text-sm text-neutral-600 dark:text-neutral-400">Loading…</p>}>
      <Canned />
    </Suspense>
  );
}

// Reusable replies for the organisation's staff. They appear in the reply box on every ticket.
async function Canned() {
  await requireRole('ADMIN', 'AGENT');
  const responses = await api<CannedResponse[]>('/api/v1/canned-responses');
  return (
    <div className="grid gap-8 md:grid-cols-2">
      <section className="space-y-4">
        <h1 className="text-xl font-semibold">Canned responses</h1>
        {responses.length === 0 ? (
          <p className="text-sm text-neutral-600 dark:text-neutral-400">None yet. Add your first one.</p>
        ) : (
          <ul className="space-y-3">
            {responses.map((response) => (
              <li key={response.id} className="space-y-1 rounded-md border border-neutral-200 px-4 py-3 dark:border-neutral-800">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="font-medium [overflow-wrap:anywhere]">{response.title}</h2>
                  <DeleteCannedForm id={response.id} title={response.title} />
                </div>
                <p className="text-sm whitespace-pre-wrap text-neutral-600 [overflow-wrap:anywhere] dark:text-neutral-400">{response.body}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="space-y-4">
        <h2 className="text-xl font-semibold">New canned response</h2>
        <CannedForm />
      </section>
    </div>
  );
}
