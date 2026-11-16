import { requireApprovedClubApi } from '@/server/auth/guards';
import { createProposal, createProposalSchema } from '@/server/proposals/service';
import { ipHash, ok, readJson, route } from '@/server/http';

export const POST = route(async (req) => {
  const session = await requireApprovedClubApi(req);
  const input = await readJson(req, createProposalSchema);
  return ok(await createProposal(session, input, { ipHash: ipHash(req) }), { status: 201 });
});
