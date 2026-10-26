import Link from 'next/link';
import { Suspense } from 'react';
import { AuthCard } from '@/components/auth-card';
import { LoginForm } from '@/components/forms';

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

// searchParams is read per request, so it sits behind <Suspense> and the rest of the page stays static.
async function ExpiredNotice({ searchParams }: { searchParams: SearchParams }) {
  if ((await searchParams).expired !== '1') return null;
  return (
    <p role="status" className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-300">
      Your session has ended. Please sign in again.
    </p>
  );
}

export default function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <AuthCard title="Sign in">
      <Suspense>
        <ExpiredNotice searchParams={searchParams} />
      </Suspense>
      <LoginForm />
      <p className="text-sm">
        New organisation?{' '}
        <Link href="/register" className="text-blue-600 hover:underline">
          Create one
        </Link>
      </p>
    </AuthCard>
  );
}
