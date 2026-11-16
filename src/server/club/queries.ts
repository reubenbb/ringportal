import 'server-only';
import { eq } from 'drizzle-orm';
import { withClub } from '@/server/db/client';
import { clubs, governingBodies } from '@/server/db/schema';
import type { ClubSession } from '@/server/auth/session';

export type ClubOverview = {
  name: string;
  status: (typeof clubs.$inferSelect)['status'];
  statusReason: string | null;
  statusChangedAt: string;
  governingBody: string;
  affiliationNumber: string | null;
  affiliationExpiresOn: string | null;
  isDemo: boolean;
};

/** Reads through the club's own RLS context: it cannot return another club's row. */
export async function getClubOverview(session: ClubSession): Promise<ClubOverview | null> {
  return withClub(session.clubId, async (tx) => {
    const [row] = await tx
      .select({
        name: clubs.name,
        status: clubs.status,
        statusReason: clubs.statusReason,
        statusChangedAt: clubs.statusChangedAt,
        governingBody: governingBodies.name,
        affiliationNumber: clubs.affiliationNumber,
        affiliationExpiresOn: clubs.affiliationExpiresOn,
        isDemo: clubs.isDemo,
      })
      .from(clubs)
      .innerJoin(governingBodies, eq(governingBodies.id, clubs.governingBodyId))
      .where(eq(clubs.id, session.clubId));
    return row ? { ...row, statusChangedAt: row.statusChangedAt.toISOString() } : null;
  });
}
