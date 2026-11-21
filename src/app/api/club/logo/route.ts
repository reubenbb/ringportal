import { requireClubApi } from '@/server/auth/guards';
import { MAX_LOGO_UPLOAD_BYTES, removeOwnLogo, setOwnLogo } from '@/server/clubs/logo';
import { ApiError, ipHash, ok, route } from '@/server/http';

/** Multipart upload with one field, "logo". CSRF is checked by route() like every unsafe method. */
export const POST = route(async (req) => {
  const session = await requireClubApi(req);
  const declared = Number(req.headers.get('content-length') ?? '0');
  if (declared > MAX_LOGO_UPLOAD_BYTES + 16_384) throw new ApiError('validation_failed', 'Image too large', { logo: 'Use an image of 1 MB or less' });
  if (!(req.headers.get('content-type') ?? '').toLowerCase().startsWith('multipart/form-data')) throw new ApiError('bad_request', 'Expected multipart/form-data');
  let file: FormDataEntryValue | null;
  try {
    file = (await req.formData()).get('logo');
  } catch {
    throw new ApiError('bad_request', 'Malformed upload');
  }
  if (!file || typeof file === 'string') throw new ApiError('validation_failed', 'Choose an image', { logo: 'Choose an image' });
  if (file.size > MAX_LOGO_UPLOAD_BYTES) throw new ApiError('validation_failed', 'Image too large', { logo: 'Use an image of 1 MB or less' });
  const { sha256 } = await setOwnLogo(session, Buffer.from(await file.arrayBuffer()), { ipHash: ipHash(req) });
  return ok({ version: sha256.slice(0, 16) });
});

export const DELETE = route(async (req) => {
  const session = await requireClubApi(req);
  await removeOwnLogo(session, { ipHash: ipHash(req) });
  return ok();
});
