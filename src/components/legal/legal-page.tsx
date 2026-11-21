import Link from 'next/link';
import type { ReactNode } from 'react';
import { BrandLockup } from '@/components/brand/logo';
import { Alert } from '@/components/ui/alert';
import { buttonClass } from '@/components/ui/button';
import { LEGAL_IS_DRAFT, LEGAL_VERSION } from '@/lib/legal';
import { LegalLinks } from './legal-links';

export function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between px-5">
          <Link href="/" className="text-ink" aria-label="RingPortal home"><BrandLockup className="h-5 w-auto" aria-hidden="true" /></Link>
          <Link href="/login" className={buttonClass('secondary', 'min-h-10 py-2')}>Club sign in</Link>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-10">
        <p className="rp-eyebrow">Legal</p>
        <h1 className="rp-display mt-2 text-4xl text-ink">{title}</h1>
        <p className="mt-2 text-xs text-muted">Version {LEGAL_VERSION}</p>
        {LEGAL_IS_DRAFT ? (
          <div className="mt-6">
            <Alert tone="warning" title="Draft for review">
              This page is a draft and has not yet been reviewed by RingPortal’s owner or a solicitor. Items in [square brackets] still need to be confirmed.
            </Alert>
          </div>
        ) : null}
        <div className="rp-prose mt-8 space-y-4 text-sm leading-6 text-ink [&_h2]:mt-8 [&_h2]:text-lg [&_h2]:font-semibold [&_li]:ml-5 [&_li]:list-disc [&_table]:w-full [&_td]:border-t [&_td]:border-line [&_td]:py-2 [&_td]:pr-3 [&_td]:align-top [&_th]:py-2 [&_th]:pr-3 [&_th]:text-left [&_th]:text-xs [&_th]:text-muted">
          {children}
        </div>
      </main>
      <footer className="border-t border-line">
        <div className="mx-auto max-w-3xl px-5 py-6"><LegalLinks /></div>
      </footer>
    </div>
  );
}
