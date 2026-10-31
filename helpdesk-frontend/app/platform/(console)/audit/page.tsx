import { Suspense } from 'react';
import { LocalTime } from '@/components/local-time';
import { platformApi } from '@/lib/platform';
import type { PlatformAuditEntry } from '@/lib/platform';

function actionBadge(action: string) {
  if (action.includes('suspend')) {
    return 'border-rose-500/30 bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300';
  }
  if (action.includes('activate')) {
    return 'border-emerald-500/30 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300';
  }
  if (action.includes('view')) {
    return 'border-amber-500/30 bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300';
  }
  if (action.includes('update')) {
    return 'border-indigo-500/30 bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300';
  }
  return 'border-slate-300 bg-slate-50 text-slate-700 dark:border-white/10 dark:bg-white/5 dark:text-slate-300';
}

export default function PlatformAuditPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent dark:border-indigo-400" />
        </div>
      }
    >
      <PlatformAuditContent />
    </Suspense>
  );
}

async function PlatformAuditContent() {
  const entries = await platformApi<PlatformAuditEntry[]>('/audit');

  return (
    <div className="space-y-6 pb-12">
      {/* Header Banner */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white sm:text-3xl">
              Audit log
            </h1>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-purple-500/30 bg-purple-500/10 px-2.5 py-0.5 text-xs font-semibold text-purple-700 dark:text-purple-300">
              <span className="h-1.5 w-1.5 rounded-full bg-purple-500" />
              Append-Only Security Trail
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Chronological audit of all super admin operations (newest 200 events). Protected by append-only database policies.
          </p>
        </div>
        <div className="text-xs text-slate-500 dark:text-slate-400">
          Showing <span className="font-semibold text-slate-900 dark:text-white">{entries.length}</span> events
        </div>
      </div>

      {/* Audit Log Table */}
      {entries.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white/40 p-12 text-center backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/40 text-sm text-slate-500 dark:text-slate-400">
          No audit entries recorded yet.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200/80 bg-white/80 shadow-sm backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/60">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200/80 bg-slate-50/80 text-xs font-semibold tracking-wider text-slate-500 uppercase dark:border-white/10 dark:bg-white/5 dark:text-slate-400">
              <tr>
                <th className="px-5 py-3.5">When</th>
                <th className="px-4 py-3.5">Admin</th>
                <th className="px-4 py-3.5">Action</th>
                <th className="px-5 py-3.5">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-white/5 [&_tr]:transition-colors [&_tr:hover]:bg-indigo-50/40 dark:[&_tr:hover]:bg-white/[0.03]">
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td className="px-5 py-3.5 whitespace-nowrap text-xs text-slate-500 dark:text-slate-400">
                    <LocalTime iso={entry.createdAt} />
                  </td>
                  <td className="px-4 py-3.5 [overflow-wrap:anywhere]">
                    <div className="flex items-center gap-2">
                      <div className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-50 font-mono text-[10px] font-bold text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300">
                        {entry.adminEmail.slice(0, 1).toUpperCase()}
                      </div>
                      <span className="font-medium text-slate-900 dark:text-white text-xs">
                        {entry.adminEmail}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3.5 whitespace-nowrap">
                    <span className={`inline-flex items-center rounded-lg border px-2.5 py-0.5 text-xs font-semibold ${actionBadge(entry.action)}`}>
                      {entry.action}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-xs [overflow-wrap:anywhere] text-slate-600 dark:text-slate-300">
                    <div className="flex flex-wrap items-center gap-1.5 font-mono text-[11px]">
                      {entry.targetType && (
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-700 dark:bg-white/10 dark:text-slate-300">
                          {entry.targetType}: {entry.targetId?.slice(0, 8)}…
                        </span>
                      )}
                      {Object.keys(entry.details).length > 0 && (
                        <span className="text-slate-500 dark:text-slate-400">
                          {JSON.stringify(entry.details)}
                        </span>
                      )}
                    </div>
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

