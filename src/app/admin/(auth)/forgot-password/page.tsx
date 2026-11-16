import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthLayout } from '@/components/auth/auth-layout';
import { ForgotForm } from '@/components/auth/forgot-form';

export const metadata: Metadata = { title: 'Admin password reset' };

export default function AdminForgotPage() {
  return (
    <AuthLayout admin eyebrow="Admin recovery" title="Reset password" intro="Resetting your password does not remove two-factor authentication." footer={<Link href="/admin/login">← Back to admin sign in</Link>}>
      <ForgotForm audience="admin" />
    </AuthLayout>
  );
}
