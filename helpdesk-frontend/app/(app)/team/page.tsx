import { Suspense } from 'react';
import { InviteForm, MemberControls } from '@/components/forms';
import { LocalTime } from '@/components/local-time';
import { api } from '@/lib/api';
import { requireRole } from '@/lib/auth';
import type { TeamMember } from '@/lib/types';

export default function TeamPage() {
  return (
    <Suspense fallback={<p className="text-sm text-neutral-600 dark:text-neutral-400">Loading…</p>}>
      <Team />
    </Suspense>
  );
}

// Admins only: everyone in the organisation, role and on/off controls, and the way to add agents and customers.
async function Team() {
  const me = await requireRole('ADMIN');
  const members = await api<TeamMember[]>('/api/v1/team');
  return (
    <div className="grid gap-8 md:grid-cols-2">
      <section className="space-y-4">
        <h1 className="text-xl font-semibold">Team</h1>
        <ul className="divide-y divide-neutral-200 rounded-md border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
          {members.map((member) => (
            <li key={member.userId} className="space-y-2 px-4 py-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className={`[overflow-wrap:anywhere] font-medium ${member.isActive ? '' : 'text-neutral-600 dark:text-neutral-400 line-through'}`}>{member.email}</span>
                <span className="flex shrink-0 items-center gap-3 text-xs text-neutral-600 dark:text-neutral-400">
                  {!member.isActive && <span className="rounded-full bg-red-100 px-2 py-0.5 text-red-800 dark:bg-red-950 dark:text-red-300">Deactivated</span>}
                  {(member.role === 'ADMIN' || member.userId === me.userId) && (
                    <span className="rounded-full bg-neutral-100 px-2.5 py-0.5 font-semibold text-neutral-800 dark:bg-neutral-800 dark:text-neutral-200">{member.role}</span>
                  )}
                  <LocalTime iso={member.createdAt} />
                </span>
              </div>
              {/* Admins (including you) cannot be changed here: the API refuses it too. */}
              {member.role !== 'ADMIN' && member.userId !== me.userId && <MemberControls member={member} />}
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
