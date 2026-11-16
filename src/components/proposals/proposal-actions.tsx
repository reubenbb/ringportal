'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { api, useSubmit } from '@/lib/api-client';
import { formatKg } from '@/lib/boxers';
import { MESSAGE_MAX } from '@/lib/messaging';
import { ACTION_LABEL, BOUT_TYPE_LABEL, formatProposalDate, type ProposalAction, type ProposalStatus, type Terms } from '@/lib/proposals';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { refreshNotificationCounts } from '@/components/shell/notification-counts';
import { TermsFields, readTerms } from './terms-fields';

type Props = {
  proposalId: string;
  version: number;
  status: ProposalStatus;
  actions: ProposalAction[];
  current: Terms;
  otherClubName: string;
};

type DialogAction = Exclude<ProposalAction, 'revise'>;

export function TermsList({ terms }: { terms: Terms }) {
  return (
    <dl className="grid grid-cols-[minmax(0,8rem)_1fr] gap-x-4 gap-y-2 text-sm">
      <dt className="text-muted">Date</dt>
      <dd className="text-ink">{formatProposalDate(terms.proposedDate)}</dd>
      <dt className="text-muted">Weight</dt>
      <dd className="tabular-nums text-ink">{formatKg(terms.weightKg)}</dd>
      <dt className="text-muted">Bout type</dt>
      <dd className="text-ink">{BOUT_TYPE_LABEL[terms.boutType]}</dd>
      <dt className="text-muted">Travel</dt>
      <dd className="whitespace-pre-wrap text-ink">{terms.travel ?? <span className="text-muted">Not specified</span>}</dd>
      <dt className="text-muted">Other terms</dt>
      <dd className="whitespace-pre-wrap text-ink">{terms.terms ?? <span className="text-muted">None</span>}</dd>
    </dl>
  );
}

function ActionDialog({
  open,
  onClose,
  title,
  children,
  confirmLabel,
  tone,
  withMessage,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  tone: 'primary' | 'danger';
  withMessage: boolean;
  onConfirm: (message: string) => Promise<string | null>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const msgId = useId();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      setError(null);
      d.showModal();
    }
    if (!open && d.open) d.close();
  }, [open]);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const err = await onConfirm(String(new FormData(e.currentTarget).get('message') ?? ''));
    setPending(false);
    if (err) setError(err);
  }

  return (
    <dialog ref={ref} aria-labelledby={titleId} onClose={onClose} className="rp-dialog">
      <form onSubmit={submit} className="flex flex-col gap-4 p-5">
        <h2 id={titleId} className="text-lg font-semibold text-ink">
          {title}
        </h2>
        <div className="text-sm text-ink">{children}</div>
        {withMessage ? (
          <div className="flex flex-col gap-1.5">
            <label htmlFor={msgId} className="text-sm font-semibold text-ink">
              Message (optional)
            </label>
            <textarea id={msgId} name="message" rows={3} maxLength={MESSAGE_MAX} className="rp-input" />
          </div>
        ) : null}
        {error ? (
          <Alert tone="danger" live>
            {error}
          </Alert>
        ) : null}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={() => ref.current?.close()}>
            Cancel
          </Button>
          <Button type="submit" variant={tone} pending={pending}>
            {confirmLabel}
          </Button>
        </div>
      </form>
    </dialog>
  );
}

export function ProposalActions({ proposalId, version, status, actions, current, otherClubName }: Props) {
  const router = useRouter();
  const [dialog, setDialog] = useState<DialogAction | null>(null);
  const [revising, setRevising] = useState(false);
  const [stale, setStale] = useState(false);
  const revise = useSubmit<{ status: ProposalStatus; version: number }>();

  if (!actions.length) return null;

  const done = () => {
    setDialog(null);
    setRevising(false);
    setStale(false);
    refreshNotificationCounts();
    router.refresh();
  };

  async function run(action: DialogAction, message: string): Promise<string | null> {
    const res = await api('POST', `/api/proposals/${proposalId}`, { action, expectedVersion: version, ...(action === 'decline' || action === 'withdraw' ? { message } : {}) });
    if (res.ok) {
      done();
      return null;
    }
    if (res.error.code === 'conflict') setStale(true);
    return res.error.message;
  }

  async function submitRevision(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const data = await revise.submit('POST', `/api/proposals/${proposalId}`, {
      action: 'revise',
      expectedVersion: version,
      terms: readTerms(f),
      message: String(f.get('message') ?? ''),
    });
    if (data) done();
  }

  const confirmed = status === 'confirmed';
  const dialogs: Record<DialogAction, { title: string; body: ReactNode; label: string; tone: 'primary' | 'danger'; message: boolean }> = {
    accept: {
      title: `Accept version ${version} in principle?`,
      body: (
        <>
          <p>This tells {otherClubName} that these terms are acceptable to your club.</p>
          <p className="mt-2 text-muted">It is not a confirmed bout. Both clubs then give final confirmation of the same version.</p>
          <div className="mt-3 rounded-md border border-line p-3">
            <TermsList terms={current} />
          </div>
        </>
      ),
      label: 'Accept in principle',
      tone: 'primary',
      message: false,
    },
    confirm: {
      title: `Give final confirmation of version ${version}?`,
      body: (
        <>
          <div className="rounded-md border border-line p-3">
            <TermsList terms={current} />
          </div>
          <p className="mt-3">The bout is confirmed only when {otherClubName} also confirms this exact version.</p>
          <p className="mt-2 text-muted">If either club later changes a term, both confirmations are reset and the new version must be confirmed again.</p>
        </>
      ),
      label: 'Give final confirmation',
      tone: 'primary',
      message: false,
    },
    decline: {
      title: 'Decline this proposal?',
      body: <p>The proposal will be closed for both clubs. You can explain why below.</p>,
      label: 'Decline proposal',
      tone: 'danger',
      message: true,
    },
    withdraw: {
      title: confirmed ? 'Withdraw from this confirmed bout?' : 'Withdraw this proposal?',
      body: confirmed ? (
        <p>This cancels the confirmed bout for both clubs. {otherClubName} will see that your club withdrew. Please explain why below.</p>
      ) : (
        <p>The proposal will be closed for both clubs.</p>
      ),
      label: confirmed ? 'Withdraw from bout' : 'Withdraw proposal',
      tone: 'danger',
      message: true,
    },
  };

  const primary = actions.filter((a) => a === 'accept' || a === 'confirm');
  const secondary = actions.filter((a) => a !== 'accept' && a !== 'confirm');

  return (
    <div className="flex flex-col gap-4">
      {stale ? (
        <Alert tone="warning" title="This proposal has changed" live>
          <p>The other club acted while you had this page open.</p>
          <button type="button" className="mt-1 font-semibold text-link underline" onClick={() => done()}>
            Show the latest version
          </button>
        </Alert>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {primary.map((a) => (
          <Button key={a} onClick={() => setDialog(a as DialogAction)}>
            {ACTION_LABEL[a]}
          </Button>
        ))}
        {secondary.map((a) =>
          a === 'revise' ? (
            <Button key={a} variant="secondary" aria-expanded={revising} onClick={() => setRevising((r) => !r)}>
              {ACTION_LABEL.revise}
            </Button>
          ) : (
            <Button key={a} variant="danger" onClick={() => setDialog(a as DialogAction)}>
              {ACTION_LABEL[a]}
            </Button>
          ),
        )}
      </div>

      {revising ? (
        <form onSubmit={submitRevision} className="flex flex-col gap-5 rounded-md border border-line p-4">
          <div>
            <h3 className="text-base font-semibold text-ink">Propose changes to version {version}</h3>
            <p className="text-sm text-muted">
              This creates version {version + 1}. {confirmed || status === 'accepted_in_principle' || status === 'awaiting_confirmation' ? 'Acceptance and both final confirmations will be reset.' : `${otherClubName} will be asked to respond.`}
            </p>
          </div>
          {revise.formError ? (
            <Alert tone="danger" live>
              {revise.formError}
            </Alert>
          ) : null}
          <TermsFields initial={current} fieldErrors={revise.fieldErrors} clearField={revise.clearField} errorPrefix="terms." />
          <div className="flex flex-col gap-1.5">
            <label htmlFor="revise-message" className="text-sm font-semibold text-ink">
              Message (optional)
            </label>
            <textarea id="revise-message" name="message" rows={2} maxLength={MESSAGE_MAX} className="rp-input" placeholder="Explain the change" />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" pending={revise.pending}>
              Send version {version + 1}
            </Button>
            <Button variant="ghost" onClick={() => setRevising(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}

      {(Object.keys(dialogs) as DialogAction[]).map((a) =>
        actions.includes(a) ? (
          <ActionDialog
            key={a}
            open={dialog === a}
            onClose={() => setDialog((d) => (d === a ? null : d))}
            title={dialogs[a].title}
            confirmLabel={dialogs[a].label}
            tone={dialogs[a].tone}
            withMessage={dialogs[a].message}
            onConfirm={(m) => run(a, m)}
          >
            {dialogs[a].body}
          </ActionDialog>
        ) : null,
      )}
    </div>
  );
}
