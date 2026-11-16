/**
 * Bout proposal lifecycle, shared by the server (which enforces it) and the UI
 * (which only offers what the server will accept).
 *
 * sent / negotiating        → the club that did NOT write the current version must respond
 * accepted_in_principle     → both clubs must give final confirmation of the current version
 * awaiting_confirmation     → one club has confirmed; the other must confirm the same version
 * confirmed                 → both confirmed the same version
 * declined / withdrawn      → closed
 *
 * Any new version (a revision of material terms) resets acceptance and both
 * confirmations, because acceptance and confirmation always apply to one version.
 */

export const PROPOSAL_STATUS = ['sent', 'negotiating', 'accepted_in_principle', 'awaiting_confirmation', 'confirmed', 'declined', 'withdrawn'] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUS)[number];

export const OPEN_STATUSES: readonly ProposalStatus[] = ['sent', 'negotiating', 'accepted_in_principle', 'awaiting_confirmation'];
export const CLOSED_STATUSES: readonly ProposalStatus[] = ['declined', 'withdrawn'];

export const STATUS_LABEL: Record<ProposalStatus, string> = {
  sent: 'Awaiting response',
  negotiating: 'Negotiating',
  accepted_in_principle: 'Accepted in principle',
  awaiting_confirmation: 'Awaiting final confirmation',
  confirmed: 'Confirmed bout',
  declined: 'Declined',
  withdrawn: 'Withdrawn',
};

export const STATUS_TONE: Record<ProposalStatus, 'neutral' | 'blue' | 'success' | 'warning' | 'danger' | 'gold'> = {
  sent: 'blue',
  negotiating: 'warning',
  accepted_in_principle: 'gold',
  awaiting_confirmation: 'gold',
  confirmed: 'success',
  declined: 'danger',
  withdrawn: 'neutral',
};

export const BOUT_TYPES = ['competitive', 'skills'] as const;
export type BoutType = (typeof BOUT_TYPES)[number];
export const BOUT_TYPE_LABEL: Record<BoutType, string> = { competitive: 'Competitive', skills: 'Skills bout' };

export type ProposalAction = 'accept' | 'revise' | 'confirm' | 'decline' | 'withdraw';

export const ACTION_LABEL: Record<ProposalAction, string> = {
  accept: 'Accept in principle',
  revise: 'Propose changes',
  confirm: 'Give final confirmation',
  decline: 'Decline',
  withdraw: 'Withdraw',
};

export type LifecycleState = {
  status: ProposalStatus;
  proposingClubId: string;
  receivingClubId: string;
  /** Author of the current version. */
  currentAuthorClubId: string;
  /** Clubs that have confirmed the current version. */
  confirmedClubIds: readonly string[];
};

/** Clubs that need to act next. Empty when nobody does (confirmed or closed). */
export function waitingOn(s: LifecycleState): string[] {
  const parties = [s.proposingClubId, s.receivingClubId];
  switch (s.status) {
    case 'sent':
    case 'negotiating':
      return parties.filter((c) => c !== s.currentAuthorClubId);
    case 'accepted_in_principle':
    case 'awaiting_confirmation':
      return parties.filter((c) => !s.confirmedClubIds.includes(c));
    default:
      return [];
  }
}

export function availableActions(s: LifecycleState, viewerClubId: string): ProposalAction[] {
  if (viewerClubId !== s.proposingClubId && viewerClubId !== s.receivingClubId) return [];
  const isAuthor = viewerClubId === s.currentAuthorClubId;
  switch (s.status) {
    case 'sent':
    case 'negotiating':
      return isAuthor ? ['revise', 'withdraw'] : ['accept', 'revise', 'decline'];
    case 'accepted_in_principle':
    case 'awaiting_confirmation':
      return s.confirmedClubIds.includes(viewerClubId) ? ['revise', 'withdraw'] : ['confirm', 'revise', 'withdraw'];
    case 'confirmed':
      return ['revise', 'withdraw'];
    default:
      return [];
  }
}

export function needsAction(s: LifecycleState, viewerClubId: string): boolean {
  return waitingOn(s).includes(viewerClubId);
}

/** Material terms: a change to any of these creates a new version and resets acceptance and confirmations. */
export type Terms = {
  proposedDate: string | null;
  weightKg: number;
  boutType: BoutType;
  travel: string | null;
  terms: string | null;
};

export const TERM_LABEL: Record<keyof Terms, string> = {
  proposedDate: 'Date',
  weightKg: 'Weight',
  boutType: 'Bout type',
  travel: 'Travel',
  terms: 'Other terms',
};

export const TERM_KEYS = Object.keys(TERM_LABEL) as (keyof Terms)[];

export function changedTerms(a: Terms, b: Terms): (keyof Terms)[] {
  return TERM_KEYS.filter((k) => (k === 'weightKg' ? Math.round(a.weightKg * 100) !== Math.round(b.weightKg * 100) : (a[k] ?? null) !== (b[k] ?? null)));
}

export function formatProposalDate(d: string | null): string {
  if (!d) return 'To be agreed';
  return new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`));
}

/** Today's date in the UK, as YYYY-MM-DD. */
export function ukToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
