import type { Metadata } from 'next';
import { AuthLayout } from '@/components/auth/auth-layout';
import { ResetForm } from '@/components/auth/reset-form';

export const metadata: Metadata = { title: 'Choose a new password' };

export default function ResetPage() {
  return (
    <AuthLayout eyebrow="Account recovery" title="New password">
      <ResetForm signInHref="/login" forgotHref="/forgot-password" />
    </AuthLayout>
  );
}
