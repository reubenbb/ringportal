import Link from 'next/link';
import type { ReactNode } from 'react';
import { LegalLinks } from '@/components/legal/legal-links';
import { BrandLockup } from '@/components/brand/logo';

/** Split layout for sign-in and recovery screens. Imagery is equipment only — no identifiable people. */
export function AuthLayout({ eyebrow, title, intro, children, footer, admin = false }: { eyebrow: string; title: string; intro?: ReactNode; children: ReactNode; footer?: ReactNode; admin?: boolean }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <div className="relative hidden overflow-hidden bg-[#0a0e15] lg:block">
        {/* Plain <img>: next/image injects inline style attributes, which the strict CSP blocks. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/ring-corner.webp" alt="" fetchPriority="high" className="absolute inset-0 size-full object-cover opacity-70" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#0a0e15] via-[#0a0e15]/40 to-transparent" />
        <div className="absolute inset-x-10 bottom-12 text-white">
          <p className="rp-eyebrow !text-[#c9a76d]">{admin ? 'Platform administration' : 'Verified clubs only'}</p>
          <p className="rp-display mt-3 text-5xl leading-none">
            Find the right bout.
            <br />
            <span className="text-[#087cff]">Club to club.</span>
          </p>
          <p className="mt-4 max-w-sm text-sm text-white/75">Amateur boxing matchmaking for competition secretaries and coaches at England Boxing clubs.</p>
        </div>
      </div>
      <div className="flex flex-col px-5 py-8 sm:px-10">
        <Link href="/" className="text-ink" aria-label="RingPortal home">
          <BrandLockup className="h-5 w-auto" aria-hidden="true" />
        </Link>
        <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10">
          <p className="rp-eyebrow">{eyebrow}</p>
          <h1 className="rp-display mt-2 text-4xl text-ink">{title}</h1>
          {intro ? <div className="mt-3 text-sm text-muted">{intro}</div> : null}
          <div className="mt-8">{children}</div>
          {footer ? <div className="mt-8 border-t border-line pt-6 text-sm text-muted">{footer}</div> : null}
          <LegalLinks className="mt-8" />
        </main>
      </div>
    </div>
  );
}
