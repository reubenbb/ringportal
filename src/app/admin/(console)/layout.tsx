import type { ReactNode } from 'react';
import { AppShell } from '@/components/shell/app-shell';
import type { NavItem } from '@/components/shell/sidebar';
import { requireAdminPage } from '@/server/auth/guards';

const NAV: NavItem[] = [
  { href: '/admin', label: 'Overview', icon: 'overview', exact: true },
  { href: '/admin/clubs', label: 'Clubs', icon: 'clubs' },
  { href: '/admin/reports', label: 'Reports', icon: 'messages' },
  { href: '/admin/directory', label: 'Club directory', icon: 'directory' },
  { href: '/admin/users', label: 'Administrators', icon: 'boxers' },
  { href: '/admin/audit', label: 'Audit log', icon: 'audit' },
  { href: '/admin/account', label: 'Account security', icon: 'shield' },
];

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const admin = await requireAdminPage();
  return (
    <AppShell
      variant="admin"
      items={NAV}
      identity={{ title: admin.displayName, subtitle: admin.email, badge: { label: admin.role === 'owner' ? 'Platform owner' : 'Administrator', tone: 'gold' } }}
    >
      {children}
    </AppShell>
  );
}
