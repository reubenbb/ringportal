import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthLayout } from '@/components/auth/auth-layout';
import { ForgotForm } from '@/components/auth/forgot-form';

export const metadata: Metadata = { title: 'Reset password' };

export default function ForgotPage() {
  return (
    <AuthLayout
      eyebrow="Account recovery"
      title="Reset password"
      intro="Enter your club login email. If it matches an account, we will email a reset link."
      footer={<Link href="/login">← Back to sign in</Link>}
    >
      <ForgotForm audience="club" />
    </AuthLayout>
  );
}
