import 'server-only';
import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { withAdmin, withClub } from '@/server/db/client';
import { clubs, conversations, messages, reports } from '@/server/db/schema';
import { audit } from '@/server/audit';
import { ApiError } from '@/server/http';
import { hit, LIMITS } from '@/server/auth/rate-limit';
import type { AdminSession, ClubSession } from '@/server/auth/session';
import { isUniqueViolation } from '@/server/cross-club';

type Meta = { ipHash: string };

export const reportSchema = z.object({ reason: z.string().trim().min(10, 'Describe the problem (at least 10 characters)').max(1000) });

export async function reportConversation(session: ClubSession, conversationId: string, reason: string, meta: Meta): Promise<void> {
  try {
    const ok = await withClub(session.clubId, async (tx) => {
      const r = await hit(tx, LIMITS.sensitiveAction, `report:${session.clubId}`);
      if (!r.allowed) throw new ApiError('rate_limited', 'Too many reports. Please wait a few minutes.', undefined, r.retryAfterSeconds);
      const [c] = await tx.select({ id: conversations.id }).from(conversations).where(eq(conversations.id, conversationId));
      if (!c) return false;
      const [rep] = await tx.insert(reports).values({ reporterClubId: session.clubId, conversationId, reason }).returning({ id: reports.id });
      // The reason is free text and may describe people, so it is not copied into the audit log.
      await audit(tx, { actorType: 'club_user', actorId: session.clubUserId, clubId: session.clubId, action: 'report.created', targetType: 'report', targetId: rep!.id, ipHash: meta.ipHash });
      return true;
    });
    if (!ok) throw new ApiError('not_found', 'Conversation not found');
  } catch (err) {
    if (isUniqueViolation(err, 'reports_open_uq')) throw new ApiError('conflict', 'You have already reported this conversation. An administrator will review it.');
    throw err;
  }
}

export type ReportRow = { id: string; status: 'open' | 'closed'; createdAt: string; reporterClub: string; otherClub: string; reason: string };

export async function listReports(status: 'open' | 'closed'): Promise<ReportRow[]> {
  return withAdmin(async (tx) => {
    const res = await tx.execute<{ id: string; status: 'open' | 'closed'; created_at: Date; reporter: string; other: string; reason: string }>(sql`
      select r.id, r.status, r.created_at, rc.name as reporter, oc.name as other, r.reason
      from reports r
      join clubs rc on rc.id = r.reporter_club_id
      join conversations c on c.id = r.conversation_id
      join clubs oc on oc.id = case when c.club_low_id = r.reporter_club_id then c.club_high_id else c.club_low_id end
      where r.status = ${status}
      order by r.created_at desc limit 200`);
    return res.rows.map((r) => ({ id: r.id, status: r.status, createdAt: new Date(r.created_at).toISOString(), reporterClub: r.reporter, otherClub: r.other, reason: r.reason }));
  });
}

export async function countOpenReports(): Promise<number> {
  return withAdmin(async (tx) => Number((await tx.select({ n: sql<number>`count(*)::int` }).from(reports).where(eq(reports.status, 'open')))[0]?.n ?? 0));
}

export type ReportDetail = {
  id: string; status: 'open' | 'closed'; reason: string; resolution: string | null; createdAt: string; resolvedAt: string | null;
  reporter: { id: string; name: string }; other: { id: string; name: string }; kind: string;
  messages: { id: number; fromReporter: boolean; body: string; createdAt: string }[];
};

/** Opening a report shows the reported conversation; every view is recorded in the audit log. */
export async function getReportForAdmin(admin: AdminSession, id: string, meta: Meta): Promise<ReportDetail | null> {
  return withAdmin(async (tx) => {
    const [r] = await tx.select().from(reports).where(eq(reports.id, id));
    if (!r) return null;
    const [c] = await tx.select().from(conversations).where(eq(conversations.id, r.conversationId));
    const otherId = c!.clubLowId === r.reporterClubId ? c!.clubHighId : c!.clubLowId;
    const names = await tx.select({ id: clubs.id, name: clubs.name }).from(clubs).where(sql`${clubs.id} in (${r.reporterClubId}::uuid, ${otherId}::uuid)`);
    const name = (cid: string) => ({ id: cid, name: names.find((n) => n.id === cid)?.name ?? 'Unknown club' });
    const msgs = await tx.select().from(messages).where(eq(messages.conversationId, r.conversationId)).orderBy(desc(messages.id)).limit(200);
    await audit(tx, { actorType: 'platform_user', actorId: admin.platformUserId, action: 'report.conversation_viewed', targetType: 'report', targetId: id, metadata: { conversationId: r.conversationId }, ipHash: meta.ipHash });
    return {
      id: r.id, status: r.status, reason: r.reason, resolution: r.resolution, createdAt: r.createdAt.toISOString(), resolvedAt: r.resolvedAt?.toISOString() ?? null,
      reporter: name(r.reporterClubId), other: name(otherId), kind: c!.kind,
      messages: msgs.reverse().map((m) => ({ id: m.id, fromReporter: m.senderClubId === r.reporterClubId, body: m.body, createdAt: m.createdAt.toISOString() })),
    };
  });
}

export const resolveSchema = z.object({ resolution: z.string().trim().min(5, 'Say what was done (at least 5 characters)').max(1000) });

export async function resolveReport(admin: AdminSession, id: string, resolution: string, meta: Meta): Promise<void> {
  const ok = await withAdmin(async (tx) => {
    const res = await tx.update(reports).set({ status: 'closed', resolution, resolvedBy: admin.platformUserId, resolvedAt: new Date() }).where(and(eq(reports.id, id), eq(reports.status, 'open'))).returning({ id: reports.id });
    if (!res.length) return false;
    await audit(tx, { actorType: 'platform_user', actorId: admin.platformUserId, action: 'report.resolved', targetType: 'report', targetId: id, reason: resolution, ipHash: meta.ipHash });
    return true;
  });
  if (!ok) throw new ApiError('conflict', 'This report was not found or is already resolved.');
}

