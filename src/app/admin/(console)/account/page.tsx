import type { Metadata } from 'next';
import { ChangePasswordForm } from '@/components/account/change-password-form';
import { RegenerateRecoveryCodes, RotateAuthenticator } from '@/components/admin/admin-security';
import { Card, PageHeader } from '@/components/ui/card';
import { formatDate } from '@/lib/club-status';
import { adminSecuritySummary } from '@/server/auth/admin-auth';
import { requireAdminPage } from '@/server/auth/guards';

export const metadata: Metadata = { title: 'Admin account security' };

export default async function AdminAccountPage() {
  const admin = await requireAdminPage();
  const summary = await adminSecuritySummary(admin);
  return (
    <>
      <PageHeader
        eyebrow="Your admin account"
        title="Account security"
        description={summary.mfaEnabledAt ? `Two-factor authentication on since ${formatDate(summary.mfaEnabledAt)}.` : undefined}
      />
      <div className="flex flex-col gap-6">
        <Card title="Change password" description="Other admin sessions for this account are signed out.">
          <ChangePasswordForm endpoint="/api/admin/account/password" />
        </Card>
        <Card title="Recovery codes" description="Single-use codes for signing in without your authenticator.">
          <RegenerateRecoveryCodes remaining={summary.recoveryCodesRemaining} />
        </Card>
        <Card title="Authenticator app" description="Move two-factor authentication to a new device.">
          <RotateAuthenticator />
        </Card>
      </div>
    </>
  );
}
