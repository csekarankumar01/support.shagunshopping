import Link from 'next/link';
import { AuthCard } from '@/components/auth-card';
import { RegisterForm } from '@/components/forms';

export default function RegisterPage() {
  return (
    <AuthCard title="Create your organisation">
      <RegisterForm />
      <p className="text-sm">
        Already registered?{' '}
        <Link href="/login" className="text-indigo-600 underline underline-offset-2 dark:text-indigo-400">
          Sign in
        </Link>
      </p>
    </AuthCard>
  );
}
