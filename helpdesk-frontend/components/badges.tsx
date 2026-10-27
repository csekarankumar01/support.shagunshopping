import type { TicketPriority, TicketStatus } from '@/lib/constants';

const base = 'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ring-black/5 dark:ring-white/10 transition-colors shadow-xs';
const dot = <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current opacity-75 shrink-0" />;

const statusStyle: Record<TicketStatus, string> = {
  OPEN: 'bg-sky-50 text-sky-700 border border-sky-200/80 dark:bg-sky-950/60 dark:text-sky-300 dark:border-sky-800/60',
  IN_PROGRESS: 'bg-amber-50 text-amber-700 border border-amber-200/80 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800/60',
  RESOLVED: 'bg-emerald-50 text-emerald-700 border border-emerald-200/80 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800/60',
  CLOSED: 'bg-slate-100 text-slate-700 border border-slate-200 dark:bg-slate-800/60 dark:text-slate-300 dark:border-slate-700',
};

const priorityStyle: Record<TicketPriority, string> = {
  LOW: 'bg-slate-100 text-slate-700 border border-slate-200 dark:bg-slate-800/60 dark:text-slate-300 dark:border-slate-700',
  MEDIUM: 'bg-blue-50 text-blue-700 border border-blue-200/80 dark:bg-blue-950/60 dark:text-blue-300 dark:border-blue-800/60',
  HIGH: 'bg-orange-50 text-orange-700 border border-orange-200/80 dark:bg-orange-950/60 dark:text-orange-300 dark:border-orange-800/60',
  URGENT: 'bg-rose-50 text-rose-700 border border-rose-200/80 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800/60',
};

export const StatusBadge = ({ status }: { status: TicketStatus }) => (
  <span className={`${base} ${statusStyle[status]}`}>{dot}{status.replace('_', ' ')}</span>
);

export const PriorityBadge = ({ priority }: { priority: TicketPriority }) => (
  <span className={`${base} ${priorityStyle[priority]}`}>{dot}{priority}</span>
);
