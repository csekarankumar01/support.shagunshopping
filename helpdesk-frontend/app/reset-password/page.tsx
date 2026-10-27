import Link from 'next/link';
import { Suspense } from 'react';
import { AuthCard } from '@/components/auth-card';
import { ResetPasswordForm } from '@/components/forms';

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

export default function ResetPasswordPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <AuthCard title="Choose a new password">
      <Suspense>
        <ResetForm searchParams={searchParams} />
      </Suspense>
    </AuthCard>
  );
}

// The token comes from the link in the email; it is handed to the form as a hidden field.
async function ResetForm({ searchParams }: { searchParams: SearchParams }) {
  const raw = (await searchParams).token;
  const token = Array.isArray(raw) ? raw[0] : raw;
  if (!token) {
    return (
      <>
        <p role="alert" className="text-sm text-red-700 dark:text-red-300">
          This page needs the link from your email.
        </p>
        <Link href="/forgot-password" className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline">
          Request a new link
        </Link>
      </>
    );
  }
  return <ResetPasswordForm token={token} />;
}
