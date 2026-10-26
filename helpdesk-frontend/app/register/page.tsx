import Link from 'next/link';
import { AuthCard } from '@/components/auth-card';
import { RegisterForm } from '@/components/forms';

export default function RegisterPage() {
  return (
    <AuthCard title="Create your organisation">
      <RegisterForm />
      <p className="text-sm">
        Already registered?{' '}
        <Link href="/login" className="text-blue-600 hover:underline">
          Sign in
        </Link>
      </p>
    </AuthCard>
  );
}
