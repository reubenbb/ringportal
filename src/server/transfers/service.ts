import 'server-only';
import { desc, eq, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { withClub } from '@/server/db/client';
import { boxerTransfers } from '@/server/db/schema';
import { audit } from '@/server/audit';
import { ApiError, type ApiErrorCode } from '@/server/http';
import { hit, LIMITS } from '@/server/auth/rate-limit';
import type { ClubSession } from '@/server/auth/session';
import { boxerCards, clubNames, isUniqueViolation } from '@/server/cross-club';
import type { TransferStatus } from '@/lib/transfers';

type Meta = { ipHash: string };

export const transferRequestSchema = z.object({
  boxerId: z.uuid(),
  note: z.string().trim().max(500, 'Keep the note to 500 characters or fewer').optional().default(''),
});

const REQUEST_ERRORS: Record<string, [ApiErrorCode, string]> = {
  not_approved: ['forbidden', 'Your club must be approved before it can request transfers.'],
  not_found: ['not_found', 'Boxer not found'],
  own_boxer: ['conflict', 'This boxer is already at your club.'],
  blocked: ['conflict', 'You cannot contact this club.'],
  pending_exists: ['conflict', 'A transfer request for this boxer is already waiting for a decision.'],
};

const DECIDE_ERRORS: Record<string, [ApiErrorCode, string]> = {
  not_found: ['not_found', 'Transfer request not found'],
  not_pending: ['conflict', 'This request has already been decided.'],
  moved: ['conflict', 'This boxer is no longer at your club.'],
  archived: ['conflict', 'Restore this boxer before approving the transfer.'],
  other_not_approved: ['conflict', 'The requesting club is not currently approved, so the transfer cannot go ahead.'],
  blocked: ['conflict', 'You cannot transfer a boxer to this club.'],
  busy_bout: ['conflict', 'This boxer has a confirmed bout. Complete or withdraw it before approving the transfer.'],
  busy_proposal: ['conflict', 'This boxer has an open bout proposal. Decline or withdraw it before approving the transfer.'],
  busy_sparring: ['conflict', 'This boxer has open or arranged sparring. Close it before approving the transfer.'],
  busy_request: ['conflict', 'This boxer is named in an open opponent request. Close it before approving the transfer.'],
};

function fail(map: Record<string, [ApiErrorCode, string]>, result: string): never {
  const [code, message] = map[result] ?? ['conflict' as ApiErrorCode, 'This transfer could not be completed.'];
  throw new ApiError(code, message);
}

export async function requestTransfer(session: ClubSession, input: z.infer<typeof transferRequestSchema>, meta: Meta): Promise<{ id: string }> {
  try {
    return await withClub(session.clubId, async (tx) => {
      const r = await hit(tx, LIMITS.sensitiveAction, `transfer:${session.clubId}`);
      if (!r.allowed) throw new ApiError('rate_limited', 'Too many requests. Please wait a few minutes.', undefined, r.retryAfterSeconds);
      const res = await tx.execute<{ result: string; transfer_id: string | null }>(
        sql`select * from request_boxer_transfer(${input.boxerId}::uuid, ${session.clubUserId}::uuid, ${input.note})`,
      );
      const row = res.rows[0];
      if (!row || row.result !== 'requested' || !row.transfer_id) fail(REQUEST_ERRORS, row?.result ?? '');
      // The note is free text and is not copied into the audit log.
      await audit(tx, { actorType: 'club_user', actorId: session.clubUserId, clubId: session.clubId, action: 'transfer.requested', targetType: 'boxer_transfer', targetId: row.transfer_id, metadata: { boxerId: input.boxerId }, ipHash: meta.ipHash });
      return { id: row.transfer_id };
    });
  } catch (err) {
    if (isUniqueViolation(err, 'boxer_transfers_pending_uq')) fail(REQUEST_ERRORS, 'pending_exists');
    throw err;
  }
}

export type TransferAction = 'approve' | 'decline' | 'cancel';

export async function actOnTransfer(session: ClubSession, id: string, action: TransferAction, meta: Meta): Promise<{ status: TransferStatus }> {
  return withClub(session.clubId, async (tx) => {
    const r = await hit(tx, LIMITS.sensitiveAction, `transfer:${session.clubId}`);
    if (!r.allowed) throw new ApiError('rate_limited', 'Too many requests. Please wait a few minutes.', undefined, r.retryAfterSeconds);
    const res =
      action === 'cancel'
        ? await tx.execute<{ r: string }>(sql`select cancel_boxer_transfer(${id}::uuid, ${session.clubUserId}::uuid) as r`)
        : await tx.execute<{ r: string }>(sql`select decide_boxer_transfer(${id}::uuid, ${session.clubUserId}::uuid, ${action === 'approve'}) as r`);
    const result = res.rows[0]?.r ?? '';
    const done: Record<TransferAction, TransferStatus> = { approve: 'approved', decline: 'declined', cancel: 'cancelled' };
    if (result !== done[action]) fail(DECIDE_ERRORS, result);
    const [t] = await tx.select({ boxerId: boxerTransfers.boxerId }).from(boxerTransfers).where(eq(boxerTransfers.id, id));
    await audit(tx, { actorType: 'club_user', actorId: session.clubUserId, clubId: session.clubId, action: `transfer.${done[action]}`, targetType: 'boxer_transfer', targetId: id, metadata: { boxerId: t?.boxerId ?? null }, ipHash: meta.ipHash });
    return { status: done[action] };
  });
}

export type TransferRow = {
  id: string;
  direction: 'incoming' | 'outgoing';
  status: TransferStatus;
  boxerId: string;
  boxerName: string | null;
  otherClub: { id: string; name: string; slug: string } | null;
  note: string | null;
  createdAt: string;
  decidedAt: string | null;
};

/** 'incoming' = another club wants one of our boxers; 'outgoing' = we asked for another club's boxer. */
export async function listTransfers(session: ClubSession): Promise<TransferRow[]> {
  return withClub(session.clubId, async (tx) => {
    const rows = await tx
      .select()
      .from(boxerTransfers)
      .where(or(eq(boxerTransfers.fromClubId, session.clubId), eq(boxerTransfers.toClubId, session.clubId)))
      .orderBy(desc(boxerTransfers.createdAt))
      .limit(200);
    const cards = await boxerCards(tx, rows.map((r) => r.boxerId));
    const names = await clubNames(tx, rows.map((r) => (r.fromClubId === session.clubId ? r.toClubId : r.fromClubId)));
    return rows.map((r) => {
      const incoming = r.fromClubId === session.clubId;
      const other = names.get(incoming ? r.toClubId : r.fromClubId);
      return {
        id: r.id,
        direction: incoming ? 'incoming' : 'outgoing',
        status: r.status,
        boxerId: r.boxerId,
        boxerName: cards.get(r.boxerId)?.displayName ?? null,
        otherClub: other ? { id: other.id, name: other.name, slug: other.slug } : null,
        note: r.note,
        createdAt: r.createdAt.toISOString(),
        decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
      } satisfies TransferRow;
    });
  });
}

export async function countIncomingPendingTransfers(session: ClubSession): Promise<number> {
  return withClub(session.clubId, async (tx) => {
    const res = await tx.execute<{ n: number }>(
      sql`select count(*)::int as n from boxer_transfers where from_club_id = ${session.clubId}::uuid and status = 'pending'`,
    );
    return Number(res.rows[0]?.n ?? 0);
  });
}

/** Pending outgoing request for each of these boxers, so roster cards can show "Requested". */
export async function pendingOutgoingFor(session: ClubSession, boxerIds: string[]): Promise<Set<string>> {
  if (!boxerIds.length) return new Set();
  return withClub(session.clubId, async (tx) => {
    const res = await tx.execute<{ boxer_id: string }>(
      sql`select boxer_id from boxer_transfers where to_club_id = ${session.clubId}::uuid and status = 'pending' and boxer_id = any(${sql.param(boxerIds)}::uuid[])`,
    );
    return new Set(res.rows.map((r) => r.boxer_id));
  });
}
