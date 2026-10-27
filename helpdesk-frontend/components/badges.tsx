import type { TicketPriority, TicketStatus } from '@/lib/constants';

const base = 'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ring-black/5 dark:ring-white/10';
const dot = <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />;

const statusStyle: Record<TicketStatus, string> = {
  OPEN: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300',
  IN_PROGRESS: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  RESOLVED: 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300',
  CLOSED: 'bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300',
};

const priorityStyle: Record<TicketPriority, string> = {
  LOW: 'bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300',
  MEDIUM: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300',
  HIGH: 'bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300',
  URGENT: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
};

export const StatusBadge = ({ status }: { status: TicketStatus }) => (
  <span className={`${base} ${statusStyle[status]}`}>{dot}{status.replace('_', ' ')}</span>
);

export const PriorityBadge = ({ priority }: { priority: TicketPriority }) => (
  <span className={`${base} ${priorityStyle[priority]}`}>{dot}{priority}</span>
);
