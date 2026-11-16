import type { ReactNode } from 'react';
import { Badge, Card } from '@/components/ui/card';
import { formatDate } from '@/lib/club-status';
import { displayUrl, parseSocial } from '@/lib/social';
import type { DirectoryProfile } from '@/server/directory/profiles';

const SOURCE_LABEL = 'England Boxing club directory';

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 text-ink">{children}</dd>
    </>
  );
}

export function AddressStatusBadges({ p }: { p: Pick<DirectoryProfile, 'address' | 'addressStatus' | 'addressFlag'> }) {
  if (!p.address) return <Badge tone="neutral">No address</Badge>;
  return (
    <span className="inline-flex flex-wrap gap-1.5">
      <Badge tone={p.addressStatus === 'verified' ? 'success' : 'warning'}>{p.addressStatus === 'verified' ? 'Verified' : 'Unverified'}</Badge>
      {p.addressFlag === 'differs_from_map' && p.addressStatus === 'unverified' ? <Badge tone="danger">Differs from map</Badge> : null}
    </span>
  );
}

/** Directory club profile. Every value is shown as imported; nothing is inferred. */
export function ProfileView({ p, addressAction }: { p: DirectoryProfile; addressAction?: ReactNode }) {
  const social = parseSocial(p.socialReference);
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Card title="Venue address" description="Where the club trains, as listed in the directory." actions={<AddressStatusBadges p={p} />}>
        {p.address ? (
          <address className="not-italic text-ink">
            {p.address}
            {p.postcode ? <span className="mt-1 block font-semibold">{p.postcode}</span> : null}
          </address>
        ) : (
          <p className="text-sm text-muted">The directory has no address for this club.</p>
        )}
        {p.address && p.addressStatus === 'unverified' ? (
          <p className="mt-3 text-sm text-muted">
            Not yet checked by RingPortal.
            {p.addressFlag === 'differs_from_map' ? ' This address may not match the venue’s map location.' : ''} Confirm the venue with the club before travelling.
          </p>
        ) : null}
        {p.addressStatus === 'verified' && p.addressVerifiedAt ? <p className="mt-3 text-sm text-muted">Checked by RingPortal on {formatDate(p.addressVerifiedAt)}.</p> : null}
        {addressAction ? <div className="mt-4 border-t border-line pt-4">{addressAction}</div> : null}
      </Card>

      <Card title="Club details">
        <dl className="grid grid-cols-[minmax(0,9rem)_1fr] gap-x-4 gap-y-3 text-sm">
          <Row label="Region">{p.region ?? '—'}</Row>
          <Row label="Governing body">{p.governingBody}</Row>
          <Row label="Membership">{p.membershipType ?? '—'}</Row>
          <Row label="Listing">{p.listedStatus ?? '—'}</Row>
          <Row label="Website">
            {p.website ? (
              <a href={p.website} target="_blank" rel="noopener noreferrer nofollow" className="break-all">
                {displayUrl(p.website)}
              </a>
            ) : (
              '—'
            )}
          </Row>
          <Row label="Social">
            {social.length ? (
              <ul className="flex flex-col gap-1">
                {social.map((s, i) => (
                  <li key={i} className="break-words">
                    {s.network ? <span className="text-muted">{s.network}: </span> : null}
                    {s.href ? (
                      <a href={s.href} target="_blank" rel="noopener noreferrer nofollow">
                        {s.text}
                      </a>
                    ) : (
                      s.text
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              '—'
            )}
          </Row>
          <Row label="On RingPortal">{p.claimStatus === 'claimed' ? 'Yes — claimed by the club' : 'Not yet — this profile has not been claimed'}</Row>
        </dl>
      </Card>

      <Card title="Source" className="lg:col-span-2">
        <p className="text-sm text-ink">
          Imported from the{' '}
          <a href={p.sourceUrl} target="_blank" rel="noopener noreferrer nofollow">
            {SOURCE_LABEL}
          </a>{' '}
          · England Boxing ID {p.sourceRef} · last refreshed {formatDate(p.lastImportedAt)}.
        </p>
        <p className="mt-1 text-xs text-muted">Directory profiles are reference information. They are not RingPortal accounts and are not verified clubs.</p>
      </Card>
    </div>
  );
}
