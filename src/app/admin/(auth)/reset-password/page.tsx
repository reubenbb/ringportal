import type { Metadata } from 'next';
import { AuthLayout } from '@/components/auth/auth-layout';
import { ResetForm } from '@/components/auth/reset-form';

export const metadata: Metadata = { title: 'Admin new password' };

export default function AdminResetPage() {
  return (
    <AuthLayout admin eyebrow="Admin recovery" title="New password">
      <ResetForm signInHref="/admin/login" forgotHref="/admin/forgot-password" />
    </AuthLayout>
  );
}
