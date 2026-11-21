import type { Metadata } from 'next';
import { LegalPage } from '@/components/legal/legal-page';

export const metadata: Metadata = { title: 'Cookies', description: 'The cookies RingPortal uses.' };

const COOKIES = [
  ['rp_session', 'Keeps a club signed in.', 'Up to 14 days; ends after 3 days without use, or when you sign out.'],
  ['rp_admin', 'Keeps a RingPortal administrator signed in.', 'Up to 12 hours; ends after 30 minutes without use.'],
  ['rp_admin_mfa', 'Remembers that an administrator is part-way through two-factor sign-in.', '5 minutes.'],
  ['rp_theme', 'Remembers the light or dark theme you chose.', '1 year.'],
  ['rp_nav', 'Remembers whether you collapsed the side menu.', '1 year.'],
] as const;

export default function CookiesPage() {
  return (
    <LegalPage title="Cookies">
      <p>
        RingPortal uses only the cookies below. They are needed for signing in or to remember a setting you chose, so they do not need your consent. We do not use advertising,
        analytics or tracking cookies, and we do not let third parties set cookies on RingPortal.
      </p>
      <table>
        <thead>
          <tr><th>Cookie</th><th>What it does</th><th>How long it lasts</th></tr>
        </thead>
        <tbody>
          {COOKIES.map(([name, what, how]) => (
            <tr key={name}>
              <td className="font-mono text-xs">{name}</td>
              <td>{what}</td>
              <td>{how}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        Your browser may also keep a setting for whether you turned on RingPortal notifications. That setting stays on your device and is never sent to us. You can clear cookies
        in your browser settings at any time; you will then need to sign in again.
      </p>
      <p>If we ever add analytics, we will ask for your consent first and update this page.</p>
    </LegalPage>
  );
}
