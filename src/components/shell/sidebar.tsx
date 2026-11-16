'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { BrandLockup, BrandMark } from '@/components/brand/logo';
import { NAV_COOKIE, writePreferenceCookie, type NavState } from '@/lib/preferences';
import { Icon, type IconName } from './icons';

export type NavItem = { href: string; label: string; icon: IconName; exact?: boolean };

function isActive(pathname: string, item: NavItem): boolean {
  return item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
}

function NavLinks({ items, collapsed, onNavigate }: { items: NavItem[]; collapsed: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <ul className="flex flex-col gap-1">
      {items.map((item) => {
        const active = isActive(pathname, item);
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? 'page' : undefined}
              aria-label={collapsed ? item.label : undefined}
              className={`rp-nav-link relative flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-semibold transition-colors ${
                active ? 'bg-nav-active text-link' : 'text-muted hover:bg-surface-2 hover:text-ink'
              } ${collapsed ? 'justify-center px-0' : ''}`}
            >
              {active ? <span aria-hidden="true" className="absolute inset-y-2 left-0 w-[3px] rounded-r bg-electric" /> : null}
              <Icon name={item.icon} className="shrink-0" />
              {collapsed ? <span className="rp-nav-tip" aria-hidden="true">{item.label}</span> : <span className="truncate">{item.label}</span>}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

type Props = {
  items: NavItem[];
  initialNav: NavState;
  homeHref: string;
  sectionLabel: string;
  contentId: string;
};

export function Sidebar({ items, initialNav, homeHref, sectionLabel, contentId }: Props) {
  const [nav, setNav] = useState<NavState>(initialNav);
  const collapsed = nav === 'collapsed';
  const drawerRef = useRef<HTMLDivElement>(null);
  const openBtnRef = useRef<HTMLButtonElement>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  function toggleNav() {
    const next: NavState = collapsed ? 'expanded' : 'collapsed';
    setNav(next);
    writePreferenceCookie(NAV_COOKIE, next);
  }

  // Mobile drawer: popover=manual, so modality is implemented here (inert page, aria-modal, Escape, focus return).
  const openDrawer = useCallback(() => {
    const drawer = drawerRef.current;
    if (!drawer) return;
    drawer.showPopover();
    drawer.setAttribute('aria-modal', 'true');
    const content = document.getElementById(contentId);
    if (content) content.inert = true;
    setDrawerOpen(true);
    drawer.querySelector<HTMLElement>('a, button')?.focus();
  }, [contentId]);

  const closeDrawer = useCallback(() => {
    const drawer = drawerRef.current;
    if (!drawer || !drawer.hasAttribute('aria-modal')) return;
    drawer.hidePopover();
    drawer.removeAttribute('aria-modal');
    const content = document.getElementById(contentId);
    if (content) content.inert = false;
    setDrawerOpen(false);
    openBtnRef.current?.focus();
  }, [contentId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeDrawer();
    };
    const mq = window.matchMedia('(min-width: 1024px)');
    const onResize = () => {
      if (mq.matches) closeDrawer();
    };
    document.addEventListener('keydown', onKey);
    mq.addEventListener('change', onResize);
    return () => {
      document.removeEventListener('keydown', onKey);
      mq.removeEventListener('change', onResize);
    };
  }, [closeDrawer]);

  return (
    <>
      {/* Desktop and tablet-landscape sidebar */}
      <aside
        data-nav={nav}
        aria-label={sectionLabel}
        className={`sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-line bg-surface transition-[width] duration-200 lg:flex ${
          collapsed ? 'w-[var(--rp-sidebar-collapsed)]' : 'w-[var(--rp-sidebar-expanded)]'
        }`}
      >
        <div className={`flex h-16 items-center border-b border-line ${collapsed ? 'justify-center' : 'px-4'}`}>
          <Link href={homeHref} className="flex items-center text-ink" aria-label="RingPortal home">
            {collapsed ? <BrandMark className="h-6 w-auto" aria-hidden="true" /> : <BrandLockup className="h-5 w-auto" aria-hidden="true" />}
          </Link>
        </div>
        {/* Collapsed: overflow stays visible so tooltips are not clipped (few items, no scrolling needed). */}
        <nav className={`flex-1 px-2.5 py-4 ${collapsed ? '' : 'overflow-y-auto'}`}>
          <NavLinks items={items} collapsed={collapsed} />
        </nav>
        <div className="border-t border-line p-2.5">
          <button
            type="button"
            onClick={toggleNav}
            aria-expanded={!collapsed}
            className={`rp-nav-link relative flex min-h-10 w-full items-center gap-3 rounded-md px-3 text-sm font-semibold text-muted hover:bg-surface-2 hover:text-ink ${
              collapsed ? 'justify-center px-0' : ''
            }`}
          >
            <Icon name={collapsed ? 'expand' : 'collapse'} />
            {collapsed ? (
              <>
                <span className="sr-only">Expand navigation</span>
                <span className="rp-nav-tip" aria-hidden="true">
                  Expand
                </span>
              </>
            ) : (
              <span>Collapse</span>
            )}
          </button>
        </div>
      </aside>

      {/* Mobile top bar trigger */}
      <div className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-surface px-3 lg:hidden">
        <button
          ref={openBtnRef}
          type="button"
          onClick={openDrawer}
          aria-expanded={drawerOpen}
          aria-controls="rp-drawer"
          className="flex size-11 items-center justify-center rounded-md text-ink hover:bg-surface-2"
        >
          <Icon name="menu" />
          <span className="sr-only">Open navigation</span>
        </button>
        <Link href={homeHref} className="text-ink" aria-label="RingPortal home">
          <BrandLockup className="h-4 w-auto" aria-hidden="true" />
        </Link>
      </div>

      <div
        ref={drawerRef}
        id="rp-drawer"
        popover="manual"
        role="dialog"
        aria-label={sectionLabel}
        className="rp-drawer"
        onClick={(e) => {
          if (e.target === e.currentTarget) closeDrawer();
        }}
      >
        <div className="flex h-full flex-col">
          <div className="flex h-14 items-center justify-between border-b border-line px-4">
            <BrandLockup className="h-4 w-auto text-ink" aria-hidden="true" />
            <button type="button" onClick={closeDrawer} className="flex size-11 items-center justify-center rounded-md text-ink hover:bg-surface-2">
              <Icon name="close" />
              <span className="sr-only">Close navigation</span>
            </button>
          </div>
          <nav className="flex-1 overflow-y-auto px-3 py-4" aria-label={sectionLabel}>
            <NavLinks items={items} collapsed={false} onNavigate={closeDrawer} />
          </nav>
        </div>
      </div>
    </>
  );
}
