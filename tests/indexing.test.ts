import { describe, expect, it } from 'vitest';
import nextConfig from '../next.config';
import { PRIVATE_PATH_PREFIXES, isIndexingEnabled, pageRobots, robotsFile } from '@/lib/indexing';
import robots from '@/app/robots';

describe('search-engine indexing', () => {
  it('is off unless SITE_INDEXING is exactly "enabled"', () => {
    for (const value of [undefined, '', 'true', '1', 'ENABLED', 'disabled']) {
      expect(isIndexingEnabled({ SITE_INDEXING: value })).toBe(false);
      expect(pageRobots({ SITE_INDEXING: value })).toEqual({ index: false, follow: false });
      expect(robotsFile({ SITE_INDEXING: value })).toEqual({ rules: { userAgent: '*', disallow: '/' } });
    }
  });

  it('allows public pages but still blocks every private path when enabled', () => {
    const env = { SITE_INDEXING: 'enabled' };
    expect(pageRobots(env)).toEqual({ index: true, follow: true });
    const file = robotsFile(env);
    const rules = (Array.isArray(file.rules) ? file.rules[0] : file.rules)!;
    expect(rules.allow).toBe('/');
    expect(rules.disallow).toEqual([...PRIVATE_PATH_PREFIXES]);
    for (const p of ['/admin', '/api', '/dashboard', '/messages', '/proposals', '/reset-password']) {
      expect(rules.disallow).toContain(p);
    }
    for (const p of ['/register', '/login', '/calendar', '/privacy', '/terms', '/cookies']) {
      expect((rules.disallow as string[]).some((d) => p.startsWith(d))).toBe(false);
    }
  });

  it('robots.txt follows the deployment env and defaults to blocking everything', () => {
    const env = process.env as Record<string, string | undefined>;
    const saved = env.SITE_INDEXING;
    try {
      delete env.SITE_INDEXING;
      expect(robots()).toEqual({ rules: { userAgent: '*', disallow: '/' } });
      env.SITE_INDEXING = 'enabled';
      expect(robots()).toEqual(robotsFile({ SITE_INDEXING: 'enabled' }));
    } finally {
      if (saved === undefined) delete env.SITE_INDEXING;
      else env.SITE_INDEXING = saved;
    }
  });

  it('sends X-Robots-Tag noindex on every private path regardless of env', async () => {
    const headers = await nextConfig.headers!();
    for (const prefix of PRIVATE_PATH_PREFIXES) {
      const applied = headers.filter((h) => h.source === `${prefix}/:path*`).flatMap((h) => h.headers);
      expect(applied).toContainEqual({ key: 'X-Robots-Tag', value: 'noindex, nofollow' });
    }
    // Security headers are unchanged.
    expect(headers.find((h) => h.source === '/:path*')?.headers.map((h) => h.key)).toContain('Strict-Transport-Security');
  });
});
