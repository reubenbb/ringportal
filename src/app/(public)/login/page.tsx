import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AuthLayout } from '@/components/auth/auth-layout';
import { LoginForm } from '@/components/auth/login-form';
import { getClubSession, safeNext } from '@/server/auth/guards';

export const metadata: Metadata = { title: 'Club sign in' };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNext((await searchParams).next, '/dashboard');
  if (await getClubSession()) redirect(next);
  return (
    <AuthLayout eyebrow="Club sign in" title="Welcome back" intro="Sign in with your club's RingPortal login.">
      <LoginForm endpoint="/api/auth/login" next={next} forgotHref="/forgot-password" />
    </AuthLayout>
  );
}
