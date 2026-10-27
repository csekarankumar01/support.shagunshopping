import Link from 'next/link';
import { Suspense } from 'react';
import { AuthCard } from '@/components/auth-card';
import { VerifyEmailForm } from '@/components/forms';

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

// searchParams is read per request, so it sits behind <Suspense> and the rest of the page stays static.
async function Verify({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const org = typeof params.org === 'string' ? params.org.slice(0, 40) : '';
  const email = typeof params.email === 'string' ? params.email.slice(0, 254) : '';
  if (!org || !email) {
    return (
      <p className="text-sm">
        Nothing to verify here.{' '}
        <Link href="/register" className="text-indigo-600 underline underline-offset-2 dark:text-indigo-400">
          Start again
        </Link>
      </p>
    );
  }
  return (
    <>
      <p className="text-sm text-neutral-600 dark:text-neutral-400">
        We emailed a 6-digit code to <strong className="text-foreground [overflow-wrap:anywhere]">{email}</strong>. Enter it to create{' '}
        <strong className="text-foreground">{org}</strong>. The code works for 10 minutes.
      </p>
      <VerifyEmailForm orgSlug={org} email={email} />
      <p className="text-sm">
        Wrong address?{' '}
        <Link href="/register" className="text-indigo-600 underline underline-offset-2 dark:text-indigo-400">
          Start again
        </Link>
      </p>
    </>
  );
}

export default function VerifyEmailPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <AuthCard title="Check your email">
      <Suspense>
        <Verify searchParams={searchParams} />
      </Suspense>
    </AuthCard>
  );
}
