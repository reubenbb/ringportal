import { afterAll, describe, expect, it } from 'vitest';
import { POST as login } from '@/app/api/auth/login/route';
import { POST as openApi } from '@/app/api/conversations/route';
import { POST as sendApi } from '@/app/api/conversations/[id]/messages/route';
import { POST as reportApi } from '@/app/api/conversations/[id]/report/route';
import { POST as resolveApi } from '@/app/api/admin/reports/[id]/route';
import { getReportForAdmin, listReports, resolveReport } from '@/server/reports/service';
import { closeDb } from '@/server/db/client';
import type { AdminSession } from '@/server/auth/session';
import { PASSWORD, cookieFrom, createClubWithUser, createPlatformUser, ctx, idCtx, json, owner, req } from './helpers';

afterAll(async () => {
  await closeDb();
});

async function club() {
  const { club, user } = await createClubWithUser();
  const cookie = cookieFrom(await login(req('POST', '/api/auth/login', { body: { email: user.email, password: PASSWORD } }), ctx), 'rp_session')!;
  return { club, cookie };
}

describe('reporting a conversation', () => {
  it('a party can report once; an admin reads it through the report (audited) and resolves it', async () => {
    const a = await club();
    const b = await club();
    const c = await club();
    const { id } = await json<{ id: string }>(await openApi(req('POST', '/api/conversations', { cookies: { rp_session: a.cookie }, body: { kind: 'general', clubId: b.club.id } }), ctx));
    await sendApi(req('POST', `/api/conversations/${id}/messages`, { cookies: { rp_session: a.cookie }, body: { body: 'Unwelcome message' } }), idCtx(id));
    const report = (cookie: string | null, reason = 'This message was abusive towards our coach.') =>
      reportApi(req('POST', `/api/conversations/${id}/report`, { cookies: cookie ? { rp_session: cookie } : undefined, body: { reason } }), idCtx(id));
    expect((await report(null)).status).toBe(401);
    expect((await report(c.cookie)).status).toBe(404); // not a party
    expect((await report(b.cookie, 'short')).status).toBe(422);
    expect((await report(b.cookie)).status).toBe(201);
    expect((await report(b.cookie)).status).toBe(409);

    const row = (await listReports('open')).find((r) => r.reporterClub === b.club.name)!;
    expect(row).toMatchObject({ otherClub: a.club.name });
    const u = await createPlatformUser();
    const admin: AdminSession = { sessionId: '', platformUserId: u.id, email: u.email, displayName: 'Admin', role: 'admin' };
    const detail = (await getReportForAdmin(admin, row.id, { ipHash: 't' }))!;
    expect(detail.messages.map((m) => [m.fromReporter, m.body])).toEqual([[false, 'Unwelcome message']]);
    const viewed = await owner.query(`select actor_id from audit_log where action = 'report.conversation_viewed' and target_id = $1`, [row.id]);
    expect(viewed.rows).toEqual([{ actor_id: u.id }]);
    const created = await owner.query(`select metadata, reason from audit_log where action = 'report.created' and target_id = $1`, [row.id]);
    expect(JSON.stringify(created.rows[0])).not.toMatch(/abusive/);

    // A club login cannot resolve reports.
    expect((await resolveApi(req('POST', `/api/admin/reports/${row.id}`, { cookies: { rp_session: b.cookie, rp_admin: b.cookie }, body: { resolution: 'Self-resolved' } }), idCtx(row.id))).status).toBe(401);
    await resolveReport(admin, row.id, 'Spoke to the club; warning recorded.', { ipHash: 't' });
    await expect(resolveReport(admin, row.id, 'Again, already done.', { ipHash: 't' })).rejects.toMatchObject({ code: 'conflict' });
    expect((await listReports('closed')).some((r) => r.id === row.id)).toBe(true);
    expect((await report(b.cookie)).status).toBe(201); // can report again after resolution
  });
});
