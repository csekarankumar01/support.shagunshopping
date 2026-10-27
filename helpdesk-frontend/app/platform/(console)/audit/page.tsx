import { LocalTime } from '@/components/local-time';
import { platformApi } from '@/lib/platform';
import type { PlatformAuditEntry } from '@/lib/platform';

export default async function PlatformAuditPage() {
  const entries = await platformApi<PlatformAuditEntry[]>('/audit');
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Audit log</h1>
      <p className="text-sm text-neutral-600 dark:text-neutral-400">Everything platform admins did, newest first (last 200). It cannot be edited or deleted from the app.</p>
      <div className="overflow-x-auto rounded-2xl border border-slate-200/80 bg-white/80 shadow-sm backdrop-blur dark:border-white/10 dark:bg-white/5">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50/80 text-xs tracking-wide text-slate-500 uppercase dark:bg-white/5 dark:text-slate-400">
            <tr>
              <th className="px-4 py-2 font-medium">When</th>
              <th className="px-4 py-2 font-medium">Admin</th>
              <th className="px-4 py-2 font-medium">Action</th>
              <th className="px-4 py-2 font-medium">Details</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-white/10">
            {entries.map((entry) => (
              <tr key={entry.id}>
                <td className="px-4 py-2 whitespace-nowrap">
                  <LocalTime iso={entry.createdAt} />
                </td>
                <td className="px-4 py-2 [overflow-wrap:anywhere]">{entry.adminEmail}</td>
                <td className="px-4 py-2 whitespace-nowrap">{entry.action}</td>
                <td className="px-4 py-2 text-xs [overflow-wrap:anywhere] text-slate-500 dark:text-slate-400">
                  {entry.targetType ? `${entry.targetType} ${entry.targetId ?? ''} ` : ''}
                  {Object.keys(entry.details).length ? JSON.stringify(entry.details) : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
