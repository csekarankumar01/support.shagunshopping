import { Suspense } from 'react';
import { Nav, NavFallback } from '@/components/nav';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Suspense fallback={<NavFallback />}>
        <Nav />
      </Suspense>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">{children}</main>
    </>
  );
}
