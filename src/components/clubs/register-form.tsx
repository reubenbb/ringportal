'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';
import { api, useSubmit } from '@/lib/api-client';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';

type Found = { id: string; name: string; region: string | null };

export function RegisterForm({ bodies }: { bodies: { id: number; name: string }[] }) {
  const router = useRouter();
  const id = useId();
  const { pending, fieldErrors, formError, submit, clearField } = useSubmit<{ ok: boolean }>();
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<Found[]>([]);
  const [searched, setSearched] = useState(false);
  const [claim, setClaim] = useState<Found | null>(null);
  const seq = useRef(0);

  // Debounced lookup of unclaimed directory records.
  useEffect(() => {
    const q = query.trim();
    if (claim || q.length < 3) return;
    const mine = ++seq.current;
    const t = window.setTimeout(async () => {
      const res = await api<{ items: Found[] }>('GET', `/api/auth/register/directory?q=${encodeURIComponent(q)}`);
      if (mine !== seq.current) return;
      setFound(res.ok ? res.data.items : []);
      setSearched(true);
    }, 300);
    return () => window.clearTimeout(t);
  }, [query, claim]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const data = await submit('POST', '/api/auth/register', {
      clubName: f.get('clubName'),
      governingBodyId: f.get('governingBodyId'),
      affiliationNumber: f.get('affiliationNumber') ?? '',
      directoryClubId: claim?.id ?? null,
      email: f.get('email'),
      password: f.get('password'),
      authorised: f.get('authorised') === 'on',
    });
    if (data) {
      router.replace('/dashboard');
      router.refresh();
    }
  }

  const showResults = !claim && query.trim().length >= 3;

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      {formError ? (
        <Alert tone="danger" live>
          {formError}
        </Alert>
      ) : null}
      <Field label="Club name" name="clubName" required minLength={2} maxLength={160} autoComplete="organization" error={fieldErrors.clubName} onInput={() => clearField('clubName')} />
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-body`} className="text-sm font-semibold text-ink">Governing body</label>
        <select id={`${id}-body`} name="governingBodyId" required defaultValue="" className="rp-input" aria-invalid={fieldErrors.governingBodyId ? true : undefined} aria-describedby={fieldErrors.governingBodyId ? `${id}-body-err` : undefined} onChange={() => clearField('governingBodyId')}>
          <option value="" disabled>Choose</option>
          {bodies.map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
        {fieldErrors.governingBodyId ? <p id={`${id}-body-err`} className="text-sm font-medium text-danger">✕ {fieldErrors.governingBodyId}</p> : null}
      </div>
      <Field label="Affiliation number" name="affiliationNumber" maxLength={40} hint="Optional, but it speeds up verification." error={fieldErrors.affiliationNumber} onInput={() => clearField('affiliationNumber')} />

      <fieldset className="flex flex-col gap-2 rounded-md border border-line p-3">
        <legend className="px-1 text-sm font-semibold text-ink">Is your club in the England Boxing directory?</legend>
        {claim ? (
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="text-ink">
              Claiming <strong>{claim.name}</strong>
              {claim.region ? <span className="text-muted"> · {claim.region}</span> : null}
            </span>
            <button type="button" className="font-semibold text-link underline" onClick={() => { setClaim(null); clearField('directoryClubId'); }}>
              Remove
            </button>
          </div>
        ) : (
          <>
            <label htmlFor={`${id}-claim`} className="text-xs text-muted">Optional. Search by club name to claim its existing profile. An administrator checks every claim.</label>
            <input id={`${id}-claim`} type="search" value={query} onChange={(e) => { setQuery(e.target.value); setSearched(false); }} className="rp-input" placeholder="Start typing your club’s name" autoComplete="off" />
            <div role="status" className="text-sm">
              {showResults && searched && found.length === 0 ? <p className="text-muted">No unclaimed club found with that name. You can still register without claiming.</p> : null}
            </div>
            {showResults && found.length ? (
              <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto">
                {found.map((d) => (
                  <li key={d.id}>
                    <button type="button" className="flex min-h-10 w-full items-center justify-between gap-2 rounded-md border border-line px-3 text-left text-sm text-ink hover:bg-surface-2" onClick={() => { setClaim(d); setFound([]); setQuery(''); }}>
                      <span className="font-semibold">{d.name}</span>
                      <span className="text-xs text-muted">{d.region ?? ''}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        )}
        {fieldErrors.directoryClubId ? <p className="text-sm font-medium text-danger">✕ {fieldErrors.directoryClubId}</p> : null}
      </fieldset>

      <Field label="Club login email" name="email" type="email" required maxLength={254} autoComplete="username" hint="One shared login for your authorised club staff." error={fieldErrors.email} onInput={() => clearField('email')} />
      <Field label="Password" name="password" type="password" required minLength={12} maxLength={256} autoComplete="new-password" hint="At least 12 characters." error={fieldErrors.password} onInput={() => clearField('password')} />
      <div>
        <label className="flex items-start gap-2 text-sm text-ink">
          <input type="checkbox" name="authorised" required className="mt-1" aria-describedby={fieldErrors.authorised ? `${id}-auth-err` : undefined} onChange={() => clearField('authorised')} />
          <span>I am authorised to register this club (for example as its competition secretary or head coach).</span>
        </label>
        {fieldErrors.authorised ? <p id={`${id}-auth-err`} className="mt-1 text-sm font-medium text-danger">✕ {fieldErrors.authorised}</p> : null}
      </div>
      <Button type="submit" pending={pending}>
        {pending ? 'Registering…' : 'Register club'}
      </Button>
      <p className="text-sm text-muted">
        Already registered? <Link href="/login" className="font-semibold">Sign in</Link>
      </p>
    </form>
  );
}
