import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AuthLayout } from '@/components/auth/auth-layout';
import { MfaVerifyForm } from '@/components/auth/mfa-verify-form';
import { cookieName } from '@/server/auth/session';

export const metadata: Metadata = { title: 'Two-factor verification' };

export default async function VerifyPage() {
  if (!(await cookies()).get(cookieName('admin_mfa'))) redirect('/admin/login');
  return (
    <AuthLayout admin eyebrow="Step 2 of 2" title="Verify it's you" footer={<Link href="/admin/login">← Back to admin sign in</Link>}>
      <MfaVerifyForm />
    </AuthLayout>
  );
}
