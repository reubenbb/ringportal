import type { NextConfig } from 'next';
import { PRIVATE_PATH_PREFIXES } from './src/lib/indexing';

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ['@node-rs/argon2', 'pg'],
  // The bundled directory file must ship with the import function.
  outputFileTracingIncludes: { '/api/admin/directory/import': ['./data/england-boxing-directory.csv.br'] },
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      { source: '/api/:path*', headers: [{ key: 'Cache-Control', value: 'no-store' }] },
      // Private pages are never indexed, even when SITE_INDEXING is enabled for public pages.
      ...PRIVATE_PATH_PREFIXES.map((prefix) => ({
        source: `${prefix}/:path*`,
        headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }],
      })),
    ];
  },
};

export default nextConfig;
