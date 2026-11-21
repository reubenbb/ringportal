import type { MetadataRoute } from 'next';

/**
 * Search-engine indexing is opt-in per deployment. Only the production project
 * (ringportal.co.uk) sets SITE_INDEXING=enabled; staging and previews stay hidden.
 */
type Env = Readonly<Record<string, string | undefined>>;

/** Signed-in, admin, API and one-time-link pages. Never indexed, on any deployment. */
export const PRIVATE_PATH_PREFIXES = [
  '/admin',
  '/api',
  '/dashboard',
  '/boxers',
  '/transfers',
  '/matchmaking',
  '/clubs',
  '/proposals',
  '/shows',
  '/sparring',
  '/messages',
  '/club-profile',
  '/account',
  '/forgot-password',
  '/reset-password',
] as const;

export function isIndexingEnabled(env: Env = process.env): boolean {
  return env.SITE_INDEXING === 'enabled';
}

/** Default robots metadata for public pages. */
export function pageRobots(env: Env = process.env): { index: boolean; follow: boolean } {
  const on = isIndexingEnabled(env);
  return { index: on, follow: on };
}

export function robotsFile(env: Env = process.env): MetadataRoute.Robots {
  if (!isIndexingEnabled(env)) return { rules: { userAgent: '*', disallow: '/' } };
  // robots.txt rules are prefix matches, so '/admin' also covers '/admin/...'.
  return { rules: { userAgent: '*', allow: '/', disallow: [...PRIVATE_PATH_PREFIXES] } };
}
