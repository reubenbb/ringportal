import type { ClubStatus } from './club-status';

/** Administrator decisions on a club and the statuses each may be taken from. Enforced on the server. */
export const CLUB_ACTIONS = {
  review: { label: 'Start review', from: ['submitted'], to: 'under_review', reasonRequired: false, tone: 'secondary' },
  approve: { label: 'Approve club', from: ['submitted', 'under_review', 'reverification_required', 'rejected'], to: 'approved', reasonRequired: false, tone: 'primary' },
  reject: { label: 'Reject', from: ['submitted', 'under_review'], to: 'rejected', reasonRequired: true, tone: 'danger' },
  require_reverification: { label: 'Require re-verification', from: ['approved'], to: 'reverification_required', reasonRequired: true, tone: 'secondary' },
  suspend: { label: 'Suspend', from: ['approved', 'reverification_required'], to: 'suspended', reasonRequired: true, tone: 'danger' },
  reinstate: { label: 'Reinstate', from: ['suspended'], to: 'approved', reasonRequired: true, tone: 'primary' },
} as const satisfies Record<string, { label: string; from: readonly ClubStatus[]; to: ClubStatus; reasonRequired: boolean; tone: 'primary' | 'secondary' | 'danger' }>;

export type ClubAction = keyof typeof CLUB_ACTIONS;

export function actionsFor(status: ClubStatus): ClubAction[] {
  return (Object.keys(CLUB_ACTIONS) as ClubAction[]).filter((a) => (CLUB_ACTIONS[a].from as readonly ClubStatus[]).includes(status));
}
