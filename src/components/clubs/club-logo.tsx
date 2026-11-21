/** A club's logo (served only to clubs allowed to see it), or its initials as a fallback. */
/** Fixed size classes: the CSP forbids inline style attributes. */
const SIZE = { 40: 'size-10', 48: 'size-12', 64: 'size-16', 72: 'size-18' } as const;

export function ClubLogo({ clubId, name, version, size = 48 }: { clubId: string; name: string; version: string | null; size?: keyof typeof SIZE }) {
  const initials = name
    .replace(/\(.*?\)/g, '')
    .split(/\s+/)
    .filter((w) => /^[A-Za-z0-9]/.test(w))
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
  const box = SIZE[size];
  if (!version) {
    return (
      <span aria-hidden="true" className={`${box} inline-flex shrink-0 items-center justify-center rounded-md border border-line bg-surface-2 text-sm font-semibold text-muted`}>
        {initials || '?'}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- authenticated API image, not a static asset
    <img src={`/api/clubs/${clubId}/logo?v=${version}`} alt={`${name} logo`} width={size} height={size} className={`${box} shrink-0 rounded-md border border-line bg-white object-contain`} />
  );
}
