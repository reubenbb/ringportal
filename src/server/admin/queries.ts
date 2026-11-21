import 'server-only';
import { and, count, desc, eq, lt, sql, type SQL } from 'drizzle-orm';
import { withAdmin } from '@/server/db/client';
import { auditLog, clubs, platformUsers } from '@/server/db/schema';

export type AuditRow = {
  id: number;
  occurredAt: string;
  actorType: string;
  actorId: string | null;
  actorLabel: string | null;
  clubId: string | null;
  clubName: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  reason: string | null;
  metadata: Record<string, unknown>;
};

export async function listAudit(opts: { before?: number; limit?: number; action?: string; clubId?: string }): Promise<{ rows: AuditRow[]; nextBefore: number | null }> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);
  const filters: SQL[] = [];
  if (opts.before) filters.push(lt(auditLog.id, opts.before));
  if (opts.action) filters.push(sql`${auditLog.action} like ${opts.action.replace(/[%_\\]/g, '\\$&') + '%'}`);
  if (opts.clubId) filters.push(eq(auditLog.clubId, opts.clubId));
  return withAdmin(async (tx) => {
    const rows = await tx
      .select({
        id: auditLog.id,
        occurredAt: auditLog.occurredAt,
        actorType: auditLog.actorType,
        actorId: auditLog.actorId,
        adminEmail: platformUsers.email,
        clubId: auditLog.clubId,
        clubName: clubs.name,
        action: auditLog.action,
        targetType: auditLog.targetType,
        targetId: auditLog.targetId,
        reason: auditLog.reason,
        metadata: auditLog.metadata,
      })
      .from(auditLog)
      .leftJoin(clubs, eq(clubs.id, auditLog.clubId))
      .leftJoin(platformUsers, and(eq(auditLog.actorType, 'platform_user'), eq(platformUsers.id, auditLog.actorId)))
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(desc(auditLog.id))
      .limit(limit + 1);
    const page = rows.slice(0, limit);
    return {
      rows: page.map((r) => ({
        id: r.id,
        occurredAt: r.occurredAt.toISOString(),
        actorType: r.actorType,
        actorId: r.actorId,
        actorLabel: r.adminEmail,
        clubId: r.clubId,
        clubName: r.clubName,
        action: r.action,
        targetType: r.targetType,
        targetId: r.targetId,
        reason: r.reason,
        metadata: r.metadata,
      })),
      nextBefore: rows.length > limit ? (page.at(-1)?.id ?? null) : null,
    };
  });
}

export type Overview = { clubsByStatus: Record<string, number>; totalClubs: number; demoClubs: number; activeAdmins: number; auditEvents24h: number };

export async function platformOverview(): Promise<Overview> {
  return withAdmin(async (tx) => {
    const byStatus = await tx.select({ status: clubs.status, n: count() }).from(clubs).groupBy(clubs.status);
    const [demo] = await tx.select({ n: count() }).from(clubs).where(eq(clubs.isDemo, true));
    const [admins] = await tx.select({ n: count() }).from(platformUsers).where(eq(platformUsers.status, 'active'));
    const [events] = await tx.select({ n: count() }).from(auditLog).where(sql`${auditLog.occurredAt} > now() - interval '24 hours'`);
    const clubsByStatus = Object.fromEntries(byStatus.map((r) => [r.status, Number(r.n)]));
    return {
      clubsByStatus,
      totalClubs: Object.values(clubsByStatus).reduce((a, b) => a + b, 0),
      demoClubs: Number(demo?.n ?? 0),
      activeAdmins: Number(admins?.n ?? 0),
      auditEvents24h: Number(events?.n ?? 0),
    };
  });
}

export type WeekActivity = {
  /** Monday of the week (Europe/London), YYYY-MM-DD. */
  weekStart: string;
  registrations: number;
  approvals: number;
  proposals: number;
  confirmedBouts: number;
  messages: number;
  transfers: number;
};

/**
 * Activity per week for the last `weeks` weeks, newest first. Demo clubs are excluded so the
 * numbers reflect real use. Counts only: no club names or content.
 */
export async function weeklyActivity(weeks = 8): Promise<WeekActivity[]> {
  const n = Math.min(Math.max(Math.trunc(weeks), 1), 26);
  return withAdmin(async (tx) => {
    const res = await tx.execute<{ week: string; registrations: number; approvals: number; proposals: number; confirmed: number; messages: number; transfers: number }>(sql`
      with weeks as (
        select (date_trunc('week', (now() at time zone 'Europe/London')) - make_interval(weeks => g))::date as week
        from generate_series(0, ${n - 1}) g
      ),
      real_clubs as (select id from clubs where not is_demo)
      select w.week::text as week,
        (select count(*) from clubs c where not c.is_demo and (date_trunc('week', c.created_at at time zone 'Europe/London'))::date = w.week)::int as registrations,
        (select count(*) from audit_log a where a.action = 'club.approve' and a.club_id in (select id from real_clubs)
           and (date_trunc('week', a.occurred_at at time zone 'Europe/London'))::date = w.week)::int as approvals,
        (select count(*) from bout_proposals p where p.proposing_club_id in (select id from real_clubs)
           and (date_trunc('week', p.created_at at time zone 'Europe/London'))::date = w.week)::int as proposals,
        (select count(*) from bout_proposal_events e where e.event = 'bout_confirmed' and e.club_id in (select id from real_clubs)
           and (date_trunc('week', e.occurred_at at time zone 'Europe/London'))::date = w.week)::int as confirmed,
        (select count(*) from messages m where m.sender_club_id in (select id from real_clubs)
           and (date_trunc('week', m.created_at at time zone 'Europe/London'))::date = w.week)::int as messages,
        (select count(*) from boxer_transfers t where t.status = 'approved' and t.to_club_id in (select id from real_clubs)
           and (date_trunc('week', t.decided_at at time zone 'Europe/London'))::date = w.week)::int as transfers
      from weeks w
      order by w.week desc`);
    return res.rows.map((r) => ({
      weekStart: r.week,
      registrations: Number(r.registrations),
      approvals: Number(r.approvals),
      proposals: Number(r.proposals),
      confirmedBouts: Number(r.confirmed),
      messages: Number(r.messages),
      transfers: Number(r.transfers),
    }));
  });
}
