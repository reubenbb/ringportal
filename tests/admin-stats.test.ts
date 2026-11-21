import { afterAll, describe, expect, it } from 'vitest';
import { weeklyActivity } from '@/server/admin/queries';
import { closeDb } from '@/server/db/client';
import { createClub, owner } from './helpers';

afterAll(async () => {
  await closeDb();
});

describe('admin weekly activity', () => {
  it('counts real clubs per week, newest first, and ignores demo clubs', async () => {
    const before = (await weeklyActivity(8))[0]!;
    await createClub({});
    await createClub({ isDemo: true });
    const real = await createClub({});
    // A registration from three weeks ago lands in that week, not this one.
    await owner.query(`update clubs set created_at = now() - interval '21 days' where id = $1`, [real.id]);
    const weeks = await weeklyActivity(8);
    expect(weeks).toHaveLength(8);
    expect(weeks.map((w) => w.weekStart)).toEqual([...weeks.map((w) => w.weekStart)].sort().reverse());
    expect(new Date(`${weeks[0]!.weekStart}T12:00:00Z`).getUTCDay()).toBe(1); // weeks start on Monday
    expect(weeks[0]!.registrations).toBe(before.registrations + 1);
    expect(weeks[3]!.registrations).toBeGreaterThanOrEqual(1);
    expect(Object.keys(weeks[0]!).sort()).toEqual(['approvals', 'confirmedBouts', 'messages', 'proposals', 'registrations', 'transfers', 'weekStart']);
    expect((await weeklyActivity(500)).length).toBe(26); // capped
  });
});
