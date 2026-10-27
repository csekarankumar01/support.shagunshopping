import { Suspense } from 'react';
import { ChangePasswordForm, SignOutEverywhereForm } from '@/components/forms';
import { getCurrentUser } from '@/lib/auth';

export default function AccountPage() {
  return (
    <Suspense fallback={<p className="text-sm text-neutral-600 dark:text-neutral-400">Loading…</p>}>
      <Account />
    </Suspense>
  );
}

async function Account() {
  const user = await getCurrentUser();
  return (
    <div className="max-w-lg space-y-8">
      <h1 className="text-xl font-semibold">Your account</h1>
      <p className="text-sm text-neutral-600 dark:text-neutral-400">
        Signed in as a {user.role.toLowerCase()}.
      </p>
      <section className="space-y-4">
        <h2 className="font-medium">Change password</h2>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">Your other devices are signed out when you change it.</p>
        <ChangePasswordForm />
      </section>
      <section className="space-y-3">
        <h2 className="font-medium">Sessions</h2>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          Signed in somewhere you no longer trust? This ends every session at once, including this one.
        </p>
        <SignOutEverywhereForm />
      </section>
    </div>
  );
}
