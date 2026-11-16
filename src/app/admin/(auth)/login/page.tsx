import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AuthLayout } from '@/components/auth/auth-layout';
import { LoginForm } from '@/components/auth/login-form';
import { getAdminSession } from '@/server/auth/guards';

export const metadata: Metadata = { title: 'Admin sign in' };

export default async function AdminLoginPage() {
  if (await getAdminSession()) redirect('/admin');
  return (
    <AuthLayout admin eyebrow="Platform administration" title="Admin sign in" intro="Two-factor authentication is required for every admin account.">
      <LoginForm endpoint="/api/admin/auth/login" next="/admin/verify" forgotHref="/admin/forgot-password" onNext={{ mfa: '/admin/verify', enrol: '/admin/enrol' }} />
    </AuthLayout>
  );
}
