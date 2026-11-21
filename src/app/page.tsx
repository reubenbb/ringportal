import Link from 'next/link';
import { LegalLinks } from '@/components/legal/legal-links';
import { BrandLockup } from '@/components/brand/logo';
import { buttonClass } from '@/components/ui/button';
import { getClubSession } from '@/server/auth/guards';

export default async function Home() {
  const session = await getClubSession();
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
          <BrandLockup className="h-5 w-auto text-ink" />
          <Link href={session ? '/dashboard' : '/login'} className={buttonClass('secondary', 'min-h-10 py-2')}>
            {session ? 'Open dashboard' : 'Club sign in'}
          </Link>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col justify-center px-5 py-16">
        <p className="rp-eyebrow">Amateur boxing matchmaking</p>
        <h1 className="rp-display mt-3 max-w-3xl text-6xl text-ink sm:text-7xl">
          Club-to-club matchmaking, <span className="text-electric">built for competition secretaries.</span>
        </h1>
        <p className="mt-6 max-w-xl text-base text-muted">
          RingPortal helps manually verified England Boxing clubs find suitable opponents, agree bouts and manage show requirements.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href={session ? '/dashboard' : '/login'} className={buttonClass('primary')}>
            {session ? 'Go to your dashboard' : 'Sign in to your club'}
          </Link>
          {session ? null : (
            <Link href="/register" className={buttonClass('secondary')}>
              Register your club
            </Link>
          )}
          <Link href="/calendar" className={buttonClass('ghost')}>
            Show calendar
          </Link>
        </div>
      </main>
      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-6 text-xs text-muted"><span>© RingPortal. Club access is manually verified.</span><LegalLinks /></div>
      </footer>
    </div>
  );
}
