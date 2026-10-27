import Link from 'next/link';
import { AuthCard } from '@/components/auth-card';
import { ForgotPasswordForm } from '@/components/forms';

export default function ForgotPasswordPage() {
  return (
    <AuthCard title="Forgot your password?">
      <p className="text-sm text-neutral-600 dark:text-neutral-400">
        Enter your organisation and email. If the account exists we will email you a link to choose a new password.
      </p>
      <ForgotPasswordForm />
      <p className="text-sm">
        <Link href="/login" className="text-blue-600 dark:text-blue-400 hover:underline">
          Back to sign in
        </Link>
      </p>
    </AuthCard>
  );
}
