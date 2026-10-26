import { Suspense } from 'react';
import { InviteForm } from '@/components/forms';
import { LocalTime } from '@/components/local-time';
import { api } from '@/lib/api';
import { requireRole } from '@/lib/auth';
import type { TeamMember } from '@/lib/types';

export default function TeamPage() {
  return (
    <Suspense fallback={<p className="text-sm text-neutral-500">Loading…</p>}>
      <Team />
    </Suspense>
  );
}

// Admins only: everyone in the organisation, and the way to add agents and customers (POST /auth/invite).
async function Team() {
  await requireRole('ADMIN');
  const members = await api<TeamMember[]>('/api/v1/team');
  return (
    <div className="grid gap-8 md:grid-cols-2">
      <section className="space-y-4">
        <h1 className="text-xl font-semibold">Team</h1>
        <ul className="divide-y divide-neutral-200 rounded-md border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
          {members.map((member) => (
            <li key={member.userId} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
              <span className="[overflow-wrap:anywhere]">{member.email}</span>
              <span className="flex shrink-0 items-center gap-3 text-xs text-neutral-500">
                <span className="rounded-full bg-neutral-100 px-2 py-0.5 dark:bg-neutral-800">{member.role}</span>
                <LocalTime iso={member.createdAt} />
              </span>
            </li>
          ))}
        </ul>
      </section>
      <section className="space-y-4">
        <h2 className="text-xl font-semibold">Invite someone</h2>
        <InviteForm />
      </section>
    </div>
  );
}
