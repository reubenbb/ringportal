import 'server-only';
import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { withAdmin, withClub } from '@/server/db/client';
import { clubLogos } from '@/server/db/schema';
import { audit } from '@/server/audit';
import { ApiError } from '@/server/http';
import { hit, LIMITS } from '@/server/auth/rate-limit';
import type { ClubSession } from '@/server/auth/session';

type Meta = { ipHash: string };

export const MAX_LOGO_UPLOAD_BYTES = 1024 * 1024;
const OUTPUT_PX = 256;

/** Detect the real format from the file's first bytes; the name and declared type are ignored. */
export function sniffImage(buf: Buffer): 'png' | 'jpeg' | 'webp' | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

/**
 * Decode and re-encode: first frame only, orientation applied, fitted inside 256×256, metadata
 * (EXIF/GPS, ICC, XMP) dropped. Decoding is capped at 25 megapixels to stop decompression bombs.
 */
export async function normaliseLogo(input: Buffer): Promise<{ image: Buffer; width: number; height: number }> {
  if (input.length === 0) throw new ApiError('validation_failed', 'Choose an image', { logo: 'Choose an image' });
  if (input.length > MAX_LOGO_UPLOAD_BYTES) throw new ApiError('validation_failed', 'Image too large', { logo: 'Use an image of 1 MB or less' });
  if (!sniffImage(input)) throw new ApiError('validation_failed', 'Unsupported image', { logo: 'Use a PNG, JPEG or WebP image' });
  try {
    const { data, info } = await sharp(input, { limitInputPixels: 25_000_000, animated: false, failOn: 'error' })
      .rotate()
      .resize(OUTPUT_PX, OUTPUT_PX, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 85 })
      .toBuffer({ resolveWithObject: true });
    return { image: data, width: info.width, height: info.height };
  } catch {
    throw new ApiError('validation_failed', 'Unreadable image', { logo: 'This image could not be read. Try exporting it again as PNG or JPEG.' });
  }
}

export async function setOwnLogo(session: ClubSession, input: Buffer, meta: Meta): Promise<{ sha256: string }> {
  const { image, width, height } = await normaliseLogo(input);
  const sha256 = createHash('sha256').update(image).digest('hex');
  await withClub(session.clubId, async (tx) => {
    const r = await hit(tx, LIMITS.sensitiveAction, `logo:${session.clubId}`);
    if (!r.allowed) throw new ApiError('rate_limited', 'Too many changes. Please wait a few minutes.', undefined, r.retryAfterSeconds);
    await tx
      .insert(clubLogos)
      .values({ clubId: session.clubId, image, width, height, sha256 })
      .onConflictDoUpdate({ target: clubLogos.clubId, set: { image, width, height, sha256 } });
    await audit(tx, { actorType: 'club_user', actorId: session.clubUserId, clubId: session.clubId, action: 'club.logo_updated', targetType: 'club', targetId: session.clubId, metadata: { bytes: image.length }, ipHash: meta.ipHash });
  });
  return { sha256 };
}

export async function removeOwnLogo(session: ClubSession, meta: Meta): Promise<void> {
  await withClub(session.clubId, async (tx) => {
    const removed = await tx.delete(clubLogos).where(eq(clubLogos.clubId, session.clubId)).returning({ id: clubLogos.clubId });
    if (removed.length) await audit(tx, { actorType: 'club_user', actorId: session.clubUserId, clubId: session.clubId, action: 'club.logo_removed', targetType: 'club', targetId: session.clubId, ipHash: meta.ipHash });
  });
}

export type LogoFile = { image: Buffer; sha256: string };

/** Row-level security decides visibility: own club, approved clubs viewing approved clubs, or admins. */
export async function getLogo(viewer: { kind: 'club'; session: ClubSession } | { kind: 'admin' }, clubId: string): Promise<LogoFile | null> {
  const read = async (tx: Parameters<Parameters<typeof withAdmin>[0]>[0]) => {
    const [row] = await tx.select({ image: clubLogos.image, sha256: clubLogos.sha256 }).from(clubLogos).where(eq(clubLogos.clubId, clubId));
    return row ?? null;
  };
  return viewer.kind === 'admin' ? withAdmin(read) : withClub(viewer.session.clubId, read);
}

/** Version token for cache-busting image URLs; null when the club has no logo visible to this viewer. */
export async function logoVersion(session: ClubSession, clubId: string): Promise<string | null> {
  return withClub(session.clubId, async (tx) => {
    const [row] = await tx.select({ sha256: clubLogos.sha256 }).from(clubLogos).where(eq(clubLogos.clubId, clubId));
    return row ? row.sha256.slice(0, 16) : null;
  });
}
