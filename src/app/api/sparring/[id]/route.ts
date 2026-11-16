import { z } from 'zod';
import { requireApprovedClubApi } from '@/server/auth/guards';
import { offerPartner, setSparringRequestStatus, sparringOfferSchema } from '@/server/sparring/service';
import { ApiError, ipHash, ok, readJson, route } from '@/server/http';

const body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('close') }),
  z.object({ action: z.literal('reopen') }),
  sparringOfferSchema.extend({ action: z.literal('offer') }),
]);

export const POST = route<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const session = await requireApprovedClubApi(req);
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) throw new ApiError('not_found', 'Sparring request not found');
  const input = await readJson(req, body);
  const meta = { ipHash: ipHash(req) };
  if (input.action === 'offer') return ok(await offerPartner(session, id.data, input, meta), { status: 201 });
  await setSparringRequestStatus(session, id.data, input.action === 'close' ? 'closed' : 'open', meta);
  return ok();
});
