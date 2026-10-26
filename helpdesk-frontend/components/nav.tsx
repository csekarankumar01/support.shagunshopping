import Link from 'next/link';
import { logout } from '@/app/actions/auth';
import { getCurrentUser } from '@/lib/auth';
import { isStaff } from '@/lib/constants';

/** Reads the login cookie (through getCurrentUser), so the layout must render it inside <Suspense>. */
export async function Nav() {
  const user = await getCurrentUser();
  const linkClass = 'text-sm hover:underline';
  return (
    <header className="border-b border-neutral-200 dark:border-neutral-800">
      <nav className="mx-auto flex max-w-5xl items-center gap-5 px-4 py-3">
        <span className="font-semibold">Helpdesk</span>
        <Link href="/tickets" className={linkClass}>
          {isStaff(user.role) ? 'Queue' : 'My tickets'}
        </Link>
        {user.role === 'CUSTOMER' && (
          <Link href="/tickets/new" className={linkClass}>
            New ticket
          </Link>
        )}
        {user.role === 'ADMIN' && (
          <Link href="/team" className={linkClass}>
            Team
          </Link>
        )}
        <span className="ml-auto rounded-full bg-neutral-100 px-2 py-0.5 text-xs dark:bg-neutral-800">{user.role}</span>
        <form action={logout}>
          <button type="submit" className={linkClass}>
            Sign out
          </button>
        </form>
      </nav>
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
