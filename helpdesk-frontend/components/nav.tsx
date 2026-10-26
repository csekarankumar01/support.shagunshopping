import Link from 'next/link';
import { logout } from '@/app/actions/auth';
import { StaffLive } from '@/components/staff-live';
import { getCurrentUser } from '@/lib/auth';
import { isStaff } from '@/lib/constants';

/** Reads the login cookie (through getCurrentUser), so the layout must render it inside <Suspense>. */
export async function Nav() {
  const user = await getCurrentUser();
  const staff = isStaff(user.role);
  const linkClass = 'text-sm hover:underline';
  return (
    <header className="border-b border-neutral-200 dark:border-neutral-800">
      <nav className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3">
        <span className="font-semibold">Helpdesk</span>
        {staff && (
          <Link href="/dashboard" className={linkClass}>
            Dashboard
          </Link>
        )}
        <Link href="/tickets" className={linkClass}>
          {staff ? 'Queue' : 'My tickets'}
        </Link>
        {user.role === 'CUSTOMER' && (
          <Link href="/tickets/new" className={linkClass}>
            New ticket
          </Link>
        )}
        {staff && (
          <Link href="/canned" className={linkClass}>
            Canned responses
          </Link>
        )}
        {user.role === 'ADMIN' && (
          <>
            <Link href="/team" className={linkClass}>
              Team
            </Link>
            <Link href="/notifications" className={linkClass}>
              Emails
            </Link>
          </>
        )}
        <span className="ml-auto rounded-full bg-neutral-100 px-2 py-0.5 text-xs dark:bg-neutral-800">{user.role}</span>
        <form action={logout}>
          <button type="submit" className={linkClass}>
            Sign out
          </button>
        </form>
      </nav>
      {staff && <StaffLive />}
    </header>
  );
}

export function NavFallback() {
  return (
    <header className="border-b border-neutral-200 dark:border-neutral-800">
      <div className="mx-auto max-w-5xl px-4 py-3 font-semibold">Helpdesk</div>
    </header>
  );
}
