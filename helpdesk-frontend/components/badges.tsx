import type { TicketPriority, TicketStatus } from '@/lib/constants';

const base = 'inline-block rounded-full px-2 py-0.5 text-xs font-medium';

const statusStyle: Record<TicketStatus, string> = {
  OPEN: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300',
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
  <span className={`${base} ${statusStyle[status]}`}>{status.replace('_', ' ')}</span>
);

export const PriorityBadge = ({ priority }: { priority: TicketPriority }) => (
  <span className={`${base} ${priorityStyle[priority]}`}>{priority}</span>
);
