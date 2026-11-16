import { z } from 'zod';
import { requireApprovedClubApi } from '@/server/auth/guards';
import { actOnProposal, proposalActionSchema } from '@/server/proposals/service';
import { ApiError, ipHash, ok, readJson, route } from '@/server/http';

/** One endpoint for every lifecycle action: { action: 'accept' | 'confirm' | 'decline' | 'withdraw' | 'revise', ... }. */
export const POST = route<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const session = await requireApprovedClubApi(req);
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) throw new ApiError('not_found', 'Proposal not found');
  const input = await readJson(req, proposalActionSchema);
  return ok(await actOnProposal(session, id.data, input, { ipHash: ipHash(req) }));
});
