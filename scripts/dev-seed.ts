/**
 * LOCAL DEVELOPMENT ONLY. Creates two clearly labelled demo clubs with logins so
 * the two-club flows can be exercised. Refuses to run against production.
 */
import { randomBytes } from 'node:crypto';
import { withAuth, closeDb } from '@/server/db/client';
import { clubUsers, clubs } from '@/server/db/schema';
import { audit } from '@/server/audit';
import { hashPassword } from '@/server/auth/password';

const origin = process.env.APP_ORIGIN ?? '';
if (process.env.NODE_ENV === 'production' || !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
  console.error('Refusing to seed: dev-seed only runs with a localhost APP_ORIGIN outside production.');
  process.exit(1);
}

const demo = [
  { name: 'Demo Club A (sample data)', slug: 'demo-club-a', email: 'demo-a@ringportal.invalid' },
  { name: 'Demo Club B (sample data)', slug: 'demo-club-b', email: 'demo-b@ringportal.invalid' },
];

try {
  for (const d of demo) {
    const password = randomBytes(12).toString('base64url');
    await withAuth(async (tx) => {
      const [c] = await tx
        .insert(clubs)
        .values({ name: d.name, slug: d.slug, governingBodyId: 1, status: 'approved', isDemo: true, statusReason: 'Local demo data' })
        .onConflictDoNothing()
        .returning({ id: clubs.id });
      if (!c) {
        console.log(`${d.name} already exists; skipped.`);
        return;
      }
      await tx.insert(clubUsers).values({ clubId: c.id, email: d.email, passwordHash: await hashPassword(password) });
      await audit(tx, { actorType: 'system', action: 'dev.demo_club_seeded', clubId: c.id });
      console.log(`${d.name}\n  login: ${d.email}\n  password: ${password}`);
    });
  }
} finally {
  await closeDb();
}
