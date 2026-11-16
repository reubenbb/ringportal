import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AuthLayout } from '@/components/auth/auth-layout';
import { RegisterForm } from '@/components/clubs/register-form';
import { getClubSession } from '@/server/auth/guards';
import { listGoverningBodiesPublic, listRegionsPublic } from '@/server/clubs/registration';

export const metadata: Metadata = { title: 'Register your club' };

export default async function RegisterPage() {
  if (await getClubSession()) redirect('/dashboard');
  return (
    <AuthLayout
      eyebrow="Join RingPortal"
      title="Register your club"
      intro="Every club is checked by an administrator before it can see other clubs’ boxers, message or propose bouts."
    >
      <RegisterForm bodies={await listGoverningBodiesPublic()} regions={await listRegionsPublic()} />
    </AuthLayout>
  );
}
