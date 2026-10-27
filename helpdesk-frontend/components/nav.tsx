import { NavLink } from '@/components/nav-link';
import { logout } from '@/app/actions/auth';
import { StaffLive } from '@/components/staff-live';
import { getCurrentUser } from '@/lib/auth';
import { isStaff } from '@/lib/constants';

/** Reads the login cookie (through getCurrentUser), so the layout must render it inside <Suspense>. */
export async function Nav() {
  const user = await getCurrentUser();
  const staff = isStaff(user.role);
  const linkClass = 'rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-indigo-50 hover:text-indigo-700 dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-white';
  return (
    <header className="sticky top-0 z-40 border-b border-slate-200/70 bg-white/75 backdrop-blur-lg dark:border-white/10 dark:bg-[#0b1020]/70">
      <nav className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-1 gap-y-2 px-4 py-2.5">
        <span className="mr-3 flex items-center gap-2 font-semibold tracking-tight">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-indigo-600 to-violet-600 text-sm text-white shadow-md shadow-indigo-600/30">H</span>
          Helpdesk
        </span>
        {staff && (
          <NavLink href="/dashboard">
            Dashboard
          </NavLink>
        )}
        <NavLink href="/tickets">
          {staff ? 'Queue' : 'My tickets'}
        </NavLink>
        {user.role === 'CUSTOMER' && (
          <NavLink href="/tickets/new">
            New ticket
          </NavLink>
        )}
        {staff && (
          <NavLink href="/canned">
            Canned responses
          </NavLink>
        )}
        {user.role === 'ADMIN' && (
          <>
            <NavLink href="/team">
              Team
            </NavLink>
            <NavLink href="/notifications">
              Emails
            </NavLink>
          </>
        )}
        <NavLink href="/account">
          Account
        </NavLink>
        <span className="ml-auto rounded-full bg-indigo-100 px-2.5 py-0.5 text-xs font-semibold tracking-wide text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300">{user.role}</span>
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
    <header className="border-b border-slate-200/70 bg-white/75 dark:border-white/10">
      <div className="mx-auto max-w-6xl px-4 py-3 font-semibold">Helpdesk</div>
    </header>
  );
}
