/**
 * Pure normalisation for directory imports. Values are cleaned, never invented:
 * anything that cannot be validated is dropped (null), not guessed.
 */

export const DIRECTORY_SOURCE_LABEL = 'England Boxing club directory';
const ALLOWED_SOURCE_HOSTS = ['englandboxing.sport80.com', 'www.englandboxing.co.uk', 'englandboxing.co.uk'];
/** Third-party platform references that must never be stored or displayed. */
const BLOCKED_REFERENCE = /warriorboxing\./i;

export type RawDirectoryRow = Record<string, string | undefined>;

export type DirectoryRecord = {
  sourceRef: string;
  sourceUrl: string;
  name: string;
  region: string | null;
  membershipType: string | null;
  listedStatus: string | null;
  address: string | null;
  postcode: string | null;
  addressFlag: 'missing' | 'differs_from_map' | null;
  website: string | null;
  socialReference: string | null;
};

export type ParseResult = { ok: true; record: DirectoryRecord } | { ok: false; reason: string };

const clean = (v: string | undefined, max = 300): string | null => {
  const t = (v ?? '').replace(/\s+/g, ' ').trim();
  if (!t || BLOCKED_REFERENCE.test(t)) return null;
  return t.slice(0, max);
};

const UK_POSTCODE = /^([A-Z]{1,2}\d[A-Z\d]?)(\d[A-Z]{2})$/;

/**
 * Formats a valid UK postcode as "OUTWARD INWARD". Other short codes (e.g. Irish
 * Eircodes) are kept as supplied, upper-cased. Anything longer is not a postcode
 * and is dropped rather than truncated.
 */
export function normalisePostcode(v: string | undefined): string | null {
  const raw = clean(v, 64);
  if (!raw) return null;
  const compact = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const m = compact.match(UK_POSTCODE);
  if (m) return `${m[1]} ${m[2]}`;
  return compact.length >= 2 && compact.length <= 8 ? raw.toUpperCase().replace(/\s+/g, ' ') : null;
}

export function normaliseWebsite(v: string | undefined): string | null {
  const raw = clean(v, 500);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (BLOCKED_REFERENCE.test(url.hostname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** Strips tracking query strings from any URLs inside free-text social references. */
export function normaliseSocial(v: string | undefined): string | null {
  const raw = clean(v, 500);
  if (!raw) return null;
  return raw.replace(/https?:\/\/[^\s|]+/g, (u) => {
    try {
      const url = new URL(u);
      url.search = '';
      url.hash = '';
      return url.toString();
    } catch {
      return u;
    }
  });
}

export function isAttributableSource(url: string | undefined): boolean {
  try {
    const u = new URL((url ?? '').trim());
    return u.protocol === 'https:' && ALLOWED_SOURCE_HOSTS.includes(u.hostname);
  } catch {
    return false;
  }
}

export function slugify(name: string): string {
  return (
    name
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80)
      .replace(/-+$/g, '') || 'club'
  );
}

export function parseDirectoryRow(row: RawDirectoryRow): ParseResult {
  const sourceRef = clean(row.official_id, 32);
  if (!sourceRef || !/^[A-Za-z0-9-]+$/.test(sourceRef)) return { ok: false, reason: 'missing_or_invalid_official_id' };
  const name = clean(row.name, 160);
  if (!name || name.length < 2) return { ok: false, reason: 'missing_name' };
  if (!isAttributableSource(row.source_url)) return { ok: false, reason: 'source_not_england_boxing' };
  const address = clean(row.address, 300);
  const flag = !address || row.address_missing === '1' ? 'missing' : row.address_discrepancy === '1' ? 'differs_from_map' : null;
  return {
    ok: true,
    record: {
      sourceRef,
      sourceUrl: new URL(row.source_url!.trim()).toString(),
      name,
      region: clean(row.region, 120),
      membershipType: clean(row.membership_type, 80),
      listedStatus: clean(row.listed_status, 40),
      address,
      postcode: normalisePostcode(row.postcode),
      addressFlag: flag,
      website: normaliseWebsite(row.website),
      socialReference: normaliseSocial(row.social_reference),
    },
  };
}
