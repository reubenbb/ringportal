import type { Metadata, Viewport } from 'next';
import { cookies } from 'next/headers';
import '@fontsource-variable/inter';
import '@fontsource/barlow-condensed/600.css';
import '@fontsource/barlow-condensed/700.css';
import '@fontsource/barlow-condensed/700-italic.css';
import './globals.css';
import { THEME_COOKIE, colorSchemeMeta, parseTheme } from '@/lib/preferences';

export const metadata: Metadata = {
  title: { default: 'RingPortal — Amateur Boxing Matchmaking', template: '%s · RingPortal' },
  description: 'Club-to-club amateur boxing matchmaking for verified England Boxing clubs.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f5f7fa' },
    { media: '(prefers-color-scheme: dark)', color: '#0a0e15' },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <html lang="en-GB" data-theme-choice={theme}>
      <head>
        <meta name="color-scheme" content={colorSchemeMeta(theme)} />
      </head>
      <body>{children}</body>
    </html>
  );
}
