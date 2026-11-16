import { cookies } from 'next/headers';
import type { ReactNode } from 'react';
import { NAV_COOKIE, THEME_COOKIE, parseNav, parseTheme } from '@/lib/preferences';
import { Badge } from '@/components/ui/card';
import { Sidebar, type NavItem } from './sidebar';
import { SignOutButton } from './sign-out-button';
import { ThemeToggle } from './theme-toggle';

type Props = {
  variant: 'club' | 'admin';
  items: NavItem[];
  identity: { title: string; subtitle: string; badge?: { label: string; tone: 'blue' | 'gold' | 'warning' | 'neutral' } };
  children: ReactNode;
};

const CONTENT_ID = 'rp-content';

/** Shared authenticated shell for club and admin areas. Server component; reads UI preferences from cookies. */
export async function AppShell({ variant, items, identity, children }: Props) {
  const jar = await cookies();
  const theme = parseTheme(jar.get(THEME_COOKIE)?.value);
  const nav = parseNav(jar.get(NAV_COOKIE)?.value);
  const homeHref = variant === 'admin' ? '/admin' : '/dashboard';
  const signOut = variant === 'admin' ? { endpoint: '/api/admin/auth/logout', redirectTo: '/admin/login' } : { endpoint: '/api/auth/logout', redirectTo: '/login' };

  return (
    <div className="min-h-dvh lg:flex">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2">
        Skip to content
      </a>
      <Sidebar
        items={items}
        initialNav={nav}
        homeHref={homeHref}
        sectionLabel={variant === 'admin' ? 'Admin navigation' : 'Club navigation'}
        contentId={CONTENT_ID}
      />
      <div id={CONTENT_ID} className="flex min-w-0 flex-1 flex-col">
        <header className="flex min-h-16 flex-wrap items-center gap-3 border-b border-line bg-surface px-4 py-2 sm:px-6">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="truncate text-sm font-semibold text-ink">{identity.title}</p>
              {identity.badge ? <Badge tone={identity.badge.tone}>{identity.badge.label}</Badge> : null}
            </div>
            <p className="truncate text-xs text-muted">{identity.subtitle}</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle initial={theme} />
            <SignOutButton {...signOut} compact />
          </div>
        </header>
        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 lg:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
