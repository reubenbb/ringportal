import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { AuthLayout } from '@/components/auth/auth-layout';
import { FirstEnrolment } from '@/components/auth/mfa-enrol';
import { cookieName } from '@/server/auth/session';

export const metadata: Metadata = { title: 'Set up two-factor authentication' };

export default async function EnrolPage() {
  if (!(await cookies()).get(cookieName('admin_mfa'))) redirect('/admin/login');
  return (
    <AuthLayout admin eyebrow="Required setup" title="Set up two-factor" intro="Admin accounts must use an authenticator app before any admin access is granted.">
      <FirstEnrolment />
    </AuthLayout>
  );
}
