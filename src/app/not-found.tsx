import type { Metadata } from 'next';
import Link from 'next/link';
import { BrandLockup } from '@/components/brand/logo';
import { buttonClass } from '@/components/ui/button';

export const metadata: Metadata = { title: 'Page not found', robots: { index: false, follow: false } };

/** Replaces the framework's default 404, whose inline styles the CSP (correctly) blocks. */
export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex h-16 max-w-6xl items-center px-5">
          <Link href="/" aria-label="RingPortal home" className="text-ink">
            <BrandLockup className="h-5 w-auto text-ink" />
          </Link>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-5 py-16">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted">Error 404</p>
        <h1 className="rp-display mt-3 text-5xl text-ink">Page not found</h1>
        <p className="mt-4 text-muted">The page may have moved, or the link may be out of date. If you followed a link to a club, boxer or proposal, it may no longer be shared with your club.</p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/dashboard" className={buttonClass('primary')}>Go to your dashboard</Link>
          <Link href="/" className={buttonClass('secondary')}>RingPortal home</Link>
        </div>
      </main>
    </div>
  );
}
