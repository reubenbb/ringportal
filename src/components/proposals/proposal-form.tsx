'use client';
import { useRouter } from 'next/navigation';
import { useId, useMemo, useState } from 'react';
import { useSubmit } from '@/lib/api-client';
import { AVAILABILITY_LABEL, formatKg, recordLabel } from '@/lib/boxers';
import { MESSAGE_MAX } from '@/lib/messaging';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { refreshNotificationCounts } from '@/components/shell/notification-counts';
import type { BoxerCard } from '@/server/cross-club';
import { BoxerSummary, matchNotes } from './boxer-summary';
import { TermsFields, readTerms } from './terms-fields';

const UNAVAILABLE = new Set(['injured_medical', 'inactive']);

export function ProposalForm({ opponent, opponentClubName, ownBoxers }: { opponent: BoxerCard; opponentClubName: string; ownBoxers: BoxerCard[] }) {
  const router = useRouter();
  const id = useId();
  const { pending, fieldErrors, formError, submit, clearField } = useSubmit<{ id: string }>();
  // Same sex category and same junior/adult category as the opponent (the server enforces both).
  const eligible = ownBoxers.filter((b) => b.sex === opponent.sex && b.isJunior === opponent.isJunior);
  const firstReady = eligible.find((b) => !UNAVAILABLE.has(b.availability));
  const [mine, setMine] = useState<string>(firstReady?.id ?? '');
  const [weight, setWeight] = useState<number | undefined>(opponent.weightKg);
  const selected = ownBoxers.find((b) => b.id === mine) ?? null;
  const notes = useMemo(() => matchNotes(selected, opponent, weight), [selected, opponent, weight]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const data = await submit('POST', '/api/proposals', {
      proposingBoxerId: mine,
      receivingBoxerId: opponent.id,
      ...readTerms(f),
      message: String(f.get('message') ?? ''),
    });
    if (data) {
      refreshNotificationCounts();
      router.push(`/proposals/${data.id}?sent=1`);
      router.refresh();
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate={false} className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="flex flex-col gap-6">
        {formError ? (
          <Alert tone="danger" title="The proposal was not sent" live>
            {formError}
          </Alert>
        ) : null}

        <fieldset className="flex flex-col gap-2" aria-describedby={fieldErrors.proposingBoxerId ? `${id}-mine-err` : undefined}>
          <legend className="text-sm font-semibold text-ink">Your boxer</legend>
          {eligible.length === 0 ? (
            <p className="text-sm text-muted">
              You have no active {opponent.sex} {opponent.isJunior ? 'under-18' : 'adult'} boxers to match against {opponent.displayName}. Add one under My boxers first.
            </p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {eligible.map((b) => {
                const unavailable = UNAVAILABLE.has(b.availability);
                return (
                  <label
                    key={b.id}
                    className={`flex cursor-pointer gap-3 rounded-md border p-3 text-sm has-[:checked]:border-electric has-[:checked]:bg-nav-active ${unavailable ? 'cursor-not-allowed border-line opacity-60' : 'border-line-strong'}`}
                  >
                    <input
                      type="radio"
                      name="proposingBoxerId"
                      value={b.id}
                      checked={mine === b.id}
                      disabled={unavailable}
                      onChange={() => {
                        setMine(b.id);
                        clearField('proposingBoxerId');
                      }}
                      className="mt-1"
                    />
                    <span>
                      <span className="block font-semibold text-ink">{b.displayName}</span>
                      <span className="block text-muted">
                        {b.ageYears} yrs · {formatKg(b.weightKg)} · {recordLabel(b.competitiveWins, b.competitiveLosses, b.competitiveDraws)} · {b.skillsBouts} skills
                      </span>
                      {unavailable ? <span className="block text-xs text-muted">{AVAILABILITY_LABEL[b.availability]}: cannot be proposed</span> : null}
                    </span>
                  </label>
                );
              })}
            </div>
          )}
          {fieldErrors.proposingBoxerId ? (
            <p id={`${id}-mine-err`} className="text-sm font-medium text-danger">
              ✕ {fieldErrors.proposingBoxerId}
            </p>
          ) : null}
          {fieldErrors.receivingBoxerId ? <p className="text-sm font-medium text-danger">✕ {fieldErrors.receivingBoxerId}</p> : null}
        </fieldset>

        <TermsFields initial={{ weightKg: opponent.weightKg, boutType: 'competitive' }} fieldErrors={fieldErrors} clearField={clearField} onWeightChange={setWeight} />

        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-msg`} className="text-sm font-semibold text-ink">
            Message to {opponentClubName}
          </label>
          <textarea
            id={`${id}-msg`}
            name="message"
            rows={4}
            maxLength={MESSAGE_MAX}
            className="rp-input"
            defaultValue="We are looking for a suitable bout. Please let us know if the proposed date and weight work for your boxer."
            aria-describedby={`${id}-msg-hint`}
          />
          <p id={`${id}-msg-hint`} className="text-xs text-muted">
            Starts the conversation attached to this proposal. Keep it club-to-club: no personal or medical details.
          </p>
        </div>

        {notes.length ? (
          <Alert tone="warning" title="Check before sending">
            <ul className="list-disc pl-4">
              {notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
            <p className="mt-1">RingPortal does not decide eligibility. Both clubs must check the bout against England Boxing’s rules.</p>
          </Alert>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" pending={pending} disabled={!mine}>
            Send proposal
          </Button>
          <p className="text-xs text-muted">Sending is not a confirmed bout. Both clubs must give final confirmation of the same terms.</p>
        </div>
      </div>

      <aside className="flex flex-col gap-4">
        <BoxerSummary boxer={opponent} clubName={opponentClubName} label="Opponent" />
        {selected ? <BoxerSummary boxer={selected} clubName="Your club" label="Your boxer" /> : null}
      </aside>
    </form>
  );
}
