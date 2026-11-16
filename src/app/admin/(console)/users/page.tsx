import type { Metadata } from 'next';
import { AdminUserActions, CreateAdminForm } from '@/components/admin/admin-users';
import { Alert } from '@/components/ui/alert';
import { Badge, Card, PageHeader } from '@/components/ui/card';
import { formatDateTime } from '@/lib/club-status';
import { requireAdminPage } from '@/server/auth/guards';
import { listAdminUsers } from '@/server/admin/users';

export const metadata: Metadata = { title: 'Administrators' };

export default async function AdminUsersPage() {
  const admin = await requireAdminPage();
  if (admin.role !== 'owner') {
    return (
      <>
        <PageHeader eyebrow="Platform administration" title="Administrators" />
        <Alert tone="info" title="Platform owner only">Only a platform owner can view or manage administrator accounts.</Alert>
      </>
    );
  }
  const users = await listAdminUsers(admin);
  return (
    <>
      <PageHeader eyebrow="Platform administration" title="Administrators" description="Accounts with access to this admin area. Every account must use two-factor authentication. All changes here are recorded in the audit log." />
      <div className="flex flex-col gap-6">
        <Card title="Add an administrator" description="Administrators can review clubs, claims, the directory and reports. Owners can also manage administrators.">
          <CreateAdminForm />
        </Card>
        <Card title="Accounts">
          <ul className="-mx-5 -my-4 divide-y divide-line">
            {users.map((u) => (
              <li key={u.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-3.5 text-sm">
                <div>
                  <p className="flex flex-wrap items-center gap-2 font-semibold text-ink">
                    {u.displayName}
                    <Badge tone="gold">{u.role === 'owner' ? 'Platform owner' : 'Administrator'}</Badge>
                    {u.status === 'disabled' ? <Badge tone="danger">Disabled</Badge> : null}
                    {u.mfaEnabled ? null : <Badge tone="warning">Two-factor not set up</Badge>}
                    {u.isYou ? <Badge tone="blue">You</Badge> : null}
                  </p>
                  <p className="break-all text-muted">{u.email} · last sign-in {u.lastLoginAt ? formatDateTime(u.lastLoginAt) : 'never'}</p>
                </div>
                {u.isYou ? null : <AdminUserActions userId={u.id} status={u.status} mfaEnabled={u.mfaEnabled} />}
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
