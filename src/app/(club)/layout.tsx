import type { ReactNode } from 'react';
import { AppShell } from '@/components/shell/app-shell';
import type { NavItem } from '@/components/shell/sidebar';
import { requireClubPage } from '@/server/auth/guards';
import { CLUB_STATUS } from '@/lib/club-status';

const NAV: NavItem[] = [
  { href: '/dashboard', label: 'Overview', icon: 'overview', exact: true },
  { href: '/boxers', label: 'My boxers', icon: 'boxers' },
  { href: '/matchmaking', label: 'Matchmaking', icon: 'search' },
  { href: '/clubs', label: 'Club directory', icon: 'directory' },
  { href: '/proposals', label: 'Bout proposals', icon: 'proposals', badge: 'proposals' },
  { href: '/shows', label: 'Shows', icon: 'calendar' },
  { href: '/sparring', label: 'Sparring', icon: 'sparring' },
  { href: '/messages', label: 'Messages', icon: 'messages', badge: 'messages' },
  { href: '/club-profile', label: 'Club profile', icon: 'clubs' },
  { href: '/account', label: 'Account security', icon: 'shield' },
];

export default async function ClubLayout({ children }: { children: ReactNode }) {
  const session = await requireClubPage();
  const status = CLUB_STATUS[session.clubStatus];
  return (
    <AppShell
      variant="club"
      items={NAV}
      identity={{
        title: session.clubName,
        subtitle: session.email,
        badge: session.isDemoClub ? { label: 'Demo data', tone: 'warning' } : session.clubStatus !== 'approved' ? { label: status.label, tone: 'neutral' } : undefined,
      }}
    >
      {children}
    </AppShell>
  );
}
