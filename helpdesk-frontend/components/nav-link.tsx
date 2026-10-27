'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

const base = 'rounded-lg px-3 py-1.5 text-sm font-medium transition';
const idle = 'text-slate-600 hover:bg-indigo-50 hover:text-indigo-700 dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-white';
const active = 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-white';

/** A nav link that highlights itself on its own section (e.g. /tickets/123 keeps "Queue" lit). */
export function NavLink({ href, children }: { href: string; children: ReactNode }) {
  const pathname = usePathname();
  const on = pathname === href || (href !== '/' && pathname.startsWith(`${href}/`) && !(href === '/tickets' && pathname === '/tickets/new'));
  return (
    <Link href={href} aria-current={on ? 'page' : undefined} className={`${base} ${on ? active : idle}`}>
      {children}
    </Link>
  );
}
