import 'server-only';
import { sql } from 'drizzle-orm';
import { withAdmin } from '@/server/db/client';
import { audit } from '@/server/audit';

export const EXPIRY_REASON = 'The affiliation expiry date recorded for this club has passed. Your club’s England Boxing affiliation needs to be verified again.';

/**
 * Daily job: approved clubs whose recorded affiliation expiry date has passed (UK date)
 * move to "re-verification required". Their verified features close until an
 * administrator approves them again. Idempotent: a club is only moved once.
 */
export async function runAffiliationExpiry(): Promise<{ moved: string[] }> {
  return withAdmin(async (tx) => {
    const res = await tx.execute<{ id: string; expires: string }>(sql`
      update clubs
         set status = 'reverification_required', status_reason = ${EXPIRY_REASON}, status_changed_at = now()
       where status = 'approved'
         and affiliation_expires_on is not null
         and affiliation_expires_on < (now() at time zone 'Europe/London')::date
      returning id, affiliation_expires_on::text as expires`);
    for (const r of res.rows) {
      await audit(tx, { actorType: 'system', clubId: r.id, action: 'club.affiliation_expired', targetType: 'club', targetId: r.id, reason: EXPIRY_REASON, metadata: { expiredOn: r.expires, from: 'approved', to: 'reverification_required' } });
    }
    return { moved: res.rows.map((r) => r.id) };
  });
}
