'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useSubmit } from '@/lib/api-client';
import { CLUB_ACTIONS, type ClubAction } from '@/lib/club-admin';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';

export function ClubDecision({ clubId, actions, hasPendingClaim, claimBlocked, affiliationExpiresOn }: { clubId: string; actions: ClubAction[]; hasPendingClaim: boolean; claimBlocked: boolean; affiliationExpiresOn: string | null }) {
  const router = useRouter();
  const [action, setAction] = useState<ClubAction | null>(null);
  const { pending, fieldErrors, formError, submit, clearField } = useSubmit<{ status: string }>();
  if (!actions.length) return <p className="text-sm text-muted">No decisions are available for this status.</p>;
  const spec = action ? CLUB_ACTIONS[action] : null;

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!action) return;
    const f = new FormData(e.currentTarget);
    const data = await submit('POST', `/api/admin/clubs/${clubId}`, {
      action,
      reason: String(f.get('reason') ?? ''),
      affiliationExpiresOn: String(f.get('affiliationExpiresOn') ?? ''),
      rejectClaim: f.get('rejectClaim') === 'on',
    });
    if (data) {
      setAction(null);
      router.refresh();
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        {actions.map((a) => (
          <Button key={a} variant={CLUB_ACTIONS[a].tone} aria-pressed={action === a} onClick={() => setAction(action === a ? null : a)}>
            {CLUB_ACTIONS[a].label}
          </Button>
        ))}
      </div>
      {action && spec ? (
        <form onSubmit={onSubmit} className="flex flex-col gap-4 rounded-md border border-line p-4">
          <h3 className="text-base font-semibold text-ink">{spec.label}</h3>
          {formError ? (
            <Alert tone="danger" live>
              {formError}
            </Alert>
          ) : null}
          {action === 'approve' ? (
            <>
              <p className="text-sm text-muted">Approve only after checking the club’s affiliation with England Boxing. Approval opens matchmaking, proposals and messaging to this club.</p>
              <Field label="Affiliation expires on" name="affiliationExpiresOn" type="date" defaultValue={affiliationExpiresOn ?? ''} hint="Optional. Used to flag the club for re-verification." error={fieldErrors.affiliationExpiresOn} onChange={() => clearField('affiliationExpiresOn')} />
              {hasPendingClaim ? (
                <label className="flex items-start gap-2 text-sm text-ink">
                  <input type="checkbox" name="rejectClaim" defaultChecked={claimBlocked} className="mt-1" />
                  <span>Approve the club but turn down its directory claim{claimBlocked ? ' (the record is already linked to another club)' : ''}.</span>
                </label>
              ) : null}
            </>
          ) : null}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="decision-reason" className="text-sm font-semibold text-ink">
              {spec.reasonRequired ? 'Reason' : 'Note (optional)'}
            </label>
            <textarea id="decision-reason" name="reason" rows={3} maxLength={500} required={spec.reasonRequired} className="rp-input" aria-invalid={fieldErrors.reason ? true : undefined} aria-describedby="decision-reason-hint" onChange={() => clearField('reason')} />
            <p id="decision-reason-hint" className="text-xs text-muted">Shown to the club on its overview page and recorded in the audit log. Do not include personal details.</p>
            {fieldErrors.reason ? <p className="text-sm font-medium text-danger">✕ {fieldErrors.reason}</p> : null}
          </div>
          <div className="flex gap-2">
            <Button type="submit" variant={spec.tone === 'danger' ? 'danger' : 'primary'} pending={pending}>
              Confirm: {spec.label.toLowerCase()}
            </Button>
            <Button variant="ghost" onClick={() => setAction(null)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
