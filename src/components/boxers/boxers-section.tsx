import Link from 'next/link';
import { Card } from '@/components/ui/card';
import type { RosterBoxer } from '@/server/boxers/service';
import { RosterTable } from './roster-table';

/**
 * "Boxers" section for any club profile. Boxers are only ever added by their own
 * club, so a directory profile that has not been claimed has none to show.
 */
export function BoxersSection({
  roster,
  clubName,
  linkedProfileHref,
  showActions = false,
}: {
  /** null = this club is not (yet) an approved RingPortal club. */
  roster: RosterBoxer[] | null;
  clubName: string;
  linkedProfileHref?: string;
  /** Propose/message actions, for another approved club's roster. */
  showActions?: boolean;
}) {
  return (
    <Card
      title="Boxers"
      description={roster ? `${roster.length} active ${roster.length === 1 ? 'boxer' : 'boxers'}` : undefined}
      className="mt-6"
      actions={linkedProfileHref ? <Link href={linkedProfileHref} className="text-sm font-semibold">Open RingPortal profile →</Link> : undefined}
    >
      {roster ? (
        <RosterTable boxers={roster} emptyText={`${clubName} has not added any boxers yet.`} showActions={showActions} />
      ) : (
        <div className="py-4 text-sm text-muted">
          <p className="font-semibold text-ink">No boxers listed</p>
          <p className="mt-1 max-w-xl">
            Boxers are added by their own club once it has joined RingPortal and been verified. {clubName} has not claimed this profile yet, so no boxers are shown. RingPortal does not import or create boxer records on a club’s behalf.
          </p>
        </div>
      )}
    </Card>
  );
}
