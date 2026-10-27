import { Suspense } from 'react';
import { CannedForm, DeleteCannedForm } from '@/components/forms';
import { api } from '@/lib/api';
import { requireRole } from '@/lib/auth';
import type { CannedResponse } from '@/lib/types';

export default function CannedPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-16 text-sm text-slate-500 dark:text-slate-400">
          <div className="flex items-center gap-2">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
            Loading canned responses…
          </div>
        </div>
      }
    >
      <Canned />
    </Suspense>
  );
}

// Reusable replies for the organisation's staff. They appear in the reply box on every ticket.
async function Canned() {
  await requireRole('ADMIN', 'AGENT');
  const responses = await api<CannedResponse[]>('/api/v1/canned-responses');

  return (
    <div className="space-y-6">
      {/* Header bar */}
      <div>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">Canned responses</h1>
          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-700 dark:bg-white/10 dark:text-slate-300">
            {responses.length} {responses.length === 1 ? 'template' : 'templates'}
          </span>
        </div>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Saved macros and quick replies that any staff member can insert into ticket conversations.
        </p>
      </div>

      <div className="grid gap-8 lg:grid-cols-5">
        {/* Left: Saved Responses List (3 columns on lg) */}
        <section className="space-y-4 lg:col-span-3">
          <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-5 shadow-sm backdrop-blur-md dark:border-white/10 dark:bg-white/5">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Saved Templates ({responses.length})
            </h2>

            {responses.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300/80 bg-white/40 px-6 py-12 text-center dark:border-white/10 dark:bg-white/5">
                <span className="text-2xl">📝</span>
                <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">None yet. Add your first one.</p>
              </div>
            ) : (
              <ul className="space-y-3.5">
                {responses.map((response) => (
                  <li
                    key={response.id}
                    className="group rounded-xl border border-slate-200/70 bg-white/60 p-4 shadow-xs transition hover:border-slate-300 dark:border-white/10 dark:bg-white/[0.03] dark:hover:border-white/20"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <span className="grid h-6 w-6 place-items-center rounded-md bg-indigo-50 text-xs text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-400">
                          💬
                        </span>
                        <h2 className="font-semibold text-slate-900 [overflow-wrap:anywhere] dark:text-slate-100">
                          {response.title}
                        </h2>
                      </div>
                      <DeleteCannedForm id={response.id} title={response.title} />
                    </div>

                    <div className="mt-2.5 rounded-lg border border-slate-100 bg-slate-50/70 p-3 dark:border-white/5 dark:bg-white/[0.02]">
                      <p className="text-sm whitespace-pre-wrap text-slate-600 [overflow-wrap:anywhere] dark:text-slate-300">
                        {response.body}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {/* Right: New Canned Response Form (2 columns on lg) */}
        <section className="space-y-4 lg:col-span-2">
          <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-6 shadow-sm backdrop-blur-md dark:border-white/10 dark:bg-white/5">
            <div className="mb-4">
              <h2 className="text-lg font-bold tracking-tight text-slate-900 dark:text-white">New canned response</h2>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Give your template a short title and write the response body.
              </p>
            </div>

            <div className="mb-5 rounded-xl border border-indigo-100 bg-indigo-50/60 p-3 text-xs text-indigo-900 dark:border-indigo-900/40 dark:bg-indigo-950/30 dark:text-indigo-200">
              <div className="flex items-start gap-2">
                <span className="text-sm">⚡</span>
                <span>
                  Tip: Staff can quickly insert this response from the dropdown in any ticket conversation.
                </span>
              </div>
            </div>

            <CannedForm />
          </div>
        </section>
      </div>
    </div>
  );
}
