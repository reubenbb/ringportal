export type ClubStatus = 'draft' | 'submitted' | 'under_review' | 'approved' | 'rejected' | 'suspended' | 'reverification_required';

export const CLUB_STATUS: Record<ClubStatus, { label: string; tone: 'neutral' | 'blue' | 'success' | 'warning' | 'danger'; explain: string }> = {
  draft: { label: 'Draft', tone: 'neutral', explain: 'Your registration is not yet complete.' },
  submitted: { label: 'Submitted', tone: 'blue', explain: 'Your registration has been submitted and is waiting for review.' },
  under_review: { label: 'Under review', tone: 'blue', explain: 'An administrator is checking your club and affiliation details.' },
  approved: { label: 'Approved', tone: 'success', explain: 'Your club is approved to use verified club features.' },
  rejected: { label: 'Not approved', tone: 'danger', explain: 'Your registration was not approved.' },
  suspended: { label: 'Suspended', tone: 'danger', explain: 'Access to verified club features is suspended.' },
  reverification_required: { label: 'Re-verification required', tone: 'warning', explain: 'Your affiliation needs to be verified again before verified features are available.' },
};

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/London' }).format(new Date(iso));
}

export function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' }).format(new Date(iso));
}
