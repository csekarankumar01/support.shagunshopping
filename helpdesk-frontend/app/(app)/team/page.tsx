import { Suspense } from 'react';
import { InviteForm } from '@/components/forms';
import { requireRole } from '@/lib/auth';

export default function TeamPage() {
  return (
    <Suspense fallback={<p className="text-sm text-neutral-500">Loading…</p>}>
      <Team />
    </Suspense>
  );
}

// The only way to add agents and customers to an organisation (POST /auth/invite, ADMIN only).
async function Team() {
  await requireRole('ADMIN');
  return (
    <div className="max-w-lg space-y-5">
      <h1 className="text-xl font-semibold">Invite someone to your organisation</h1>
      <InviteForm />
    </div>
  );
}
