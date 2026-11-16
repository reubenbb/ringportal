import type { Metadata } from 'next';
import { ChangePasswordForm } from '@/components/account/change-password-form';
import { SessionsList } from '@/components/account/sessions-list';
import { Card, PageHeader } from '@/components/ui/card';

export const metadata: Metadata = { title: 'Account security' };

export default function AccountPage() {
  return (
    <>
      <PageHeader eyebrow="Club account" title="Account security" description="Your club login is shared by authorised staff. Change the password whenever someone leaves the club." />
      <div className="flex flex-col gap-6">
        <Card title="Change password" description="Changing the password signs out every other device.">
          <ChangePasswordForm endpoint="/api/account/password" />
        </Card>
        <Card title="Signed-in devices" description="Sign out any device you do not recognise.">
          <SessionsList />
        </Card>
      </div>
    </>
  );
}
