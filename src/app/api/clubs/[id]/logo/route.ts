import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireClubApi } from '@/server/auth/guards';
import { getLogo } from '@/server/clubs/logo';
import { ApiError, route } from '@/server/http';

/** Serves a club logo to signed-in clubs allowed to see it. Bytes are always our own re-encoded WebP. */
export const GET = route<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const session = await requireClubApi(req);
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) throw new ApiError('not_found', 'Logo not found');
  const logo = await getLogo({ kind: 'club', session }, id.data);
  if (!logo) throw new ApiError('not_found', 'Logo not found');
  const etag = `"${logo.sha256.slice(0, 32)}"`;
  if (req.headers.get('if-none-match') === etag) return new NextResponse(null, { status: 304, headers: { ETag: etag } });
  return new NextResponse(new Uint8Array(logo.image), {
    headers: {
      'Content-Type': 'image/webp',
      'Content-Length': String(logo.image.length),
      'Content-Disposition': 'inline',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'X-Content-Type-Options': 'nosniff',
      ETag: etag,
    },
  });
});
