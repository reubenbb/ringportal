# RingPortal security review pack

Prepared 2026-11-21 for an independent reviewer. It describes what RingPortal protects, how, where
the code is, and what has and has not been tested. Every claim here should be checked, not trusted.

## 1. What RingPortal is

A club-to-club matchmaking service for amateur boxing clubs registered with England Boxing. Each club
has one shared login. Clubs list their boxers, search other clubs' boxers, message each other, propose
bouts, arrange sparring, list shows and transfer boxers. Platform administrators verify clubs and handle
reports.

**Most sensitive data:** boxers' dates of birth, medical/eligibility status and club notes, including
for under-18s. Then messages between clubs, and administrator credentials.

## 2. Architecture

- Next.js 16 (App Router) on Vercel, region `lhr1`. Code: private GitHub repo `reubenbb/ringportal`.
- Postgres on Neon (London). ORM: Drizzle. Migrations in `drizzle/` (0000–0025).
- No third-party scripts, analytics, fonts or image hosts. Email (Resend) is built but switched off.
- Environments: staging (`ringportal.vercel.app`, demo data) and production (`ringportal.co.uk`), separate
  Vercel projects, separate database branches, separate keys. Both are behind Vercel login today.

## 3. Trust boundaries and the main control

The application connects as `ringportal_app_login`, a role with no superuser, CREATEROLE or BYPASSRLS
rights. Every table has **forced row-level security**. Every request runs in one transaction that sets
`app.context` (`club`, `admin` or `auth`) and, for clubs, `app.club_id`. Policies key off those settings.
There is no unscoped database export in the code: see `src/server/db/client.ts` (`withClub`, `withAdmin`,
`withAuth`).

Cross-club reads go only through `SECURITY DEFINER` functions that return a reduced view (for example
`club_boxer_roster`, `boxer_cards`, `match_candidates`, `club_names`, `club_public_profile`). These
compute age from date of birth without returning it, never return medical status or notes, and reduce
under-18 names to first name plus surname initial. State changes that cross clubs (boxer transfers) also
go through definer functions that check the caller's club (`drizzle/0022_boxer_transfers_security.sql`).

**The reviewer's first question should be:** can club A ever read or change club B's private data, by any
route? Suggested starting points:

| Area | Where |
|---|---|
| RLS policies and definer functions | `drizzle/*_security.sql`, `drizzle/0005`, `0008`, `0010`, `0012`, `0020`, `0022`, `0023`, `0025` |
| Context setting | `src/server/db/client.ts` |
| Definer functions' `search_path` and EXECUTE grants | every `CREATE FUNCTION` sets `search_path = public, pg_temp`; PUBLIC is revoked |
| Append-only tables | `audit_log`, proposal versions/confirmations/events, `messages` (triggers) |
| Guard triggers on identity columns | proposals, conversations, sparring offers |

## 4. Authentication and sessions

- Passwords: Argon2id (19 MiB, t=2, p=1), minimum 12 characters. `src/server/auth/password.ts`.
- Sessions: random token in an `HttpOnly`, `SameSite=Lax`, `Secure` cookie; only its SHA-256 is stored.
  Clubs: 14 days absolute, 3 days idle. Admins: 12 hours absolute, 30 minutes idle. `src/server/auth/session.ts`.
- Administrators: mandatory TOTP two-factor with recovery codes; secrets encrypted at rest with
  AES-256-GCM (`MFA_ENCRYPTION_KEY`); replay of a used code is rejected. `src/server/auth/mfa.ts`.
- Password reset: single-use token delivered in the URL fragment, 30-minute life, rate limited, same
  response whether or not the account exists. `src/server/auth/password-reset.ts`.
- Login timing is equalised for unknown accounts.
- Rate limits are stored in Postgres with pseudonymised subjects. `src/server/auth/rate-limit.ts`.

## 5. Request handling

- CSRF: every unsafe method requires a matching `Origin` and `Sec-Fetch-Site: same-origin`; bodies are
  JSON only, except the logo upload (multipart, same checks). `src/server/http.ts`.
- CSP with a per-request nonce, `strict-dynamic`, no inline styles or scripts, `frame-ancestors 'none'`,
  `object-src 'none'`. Also HSTS (preload), `nosniff`, `Referrer-Policy`, `Permissions-Policy`. `src/proxy.ts`.
- Input validation with zod at every API boundary; consistent error shape; unhandled errors are logged
  with path and error name only.
- Logo upload: type detected from file bytes, 1 MB cap, 25-megapixel decode cap, re-encoded to WebP with
  metadata removed, stored in Postgres under RLS, served with `nosniff` and a sandbox CSP.
  `src/server/clubs/logo.ts`.
- Scheduled job: bearer secret compared in constant time. `src/app/api/cron/affiliation-expiry/route.ts`.

## 6. Logging and audit

- `audit_log` is append-only. Metadata never includes free text, passwords or tokens.
- IP addresses are stored only as keyed hashes (`LOG_HASH_KEY`).
- Administrator views of reported conversations are themselves audited.

## 7. Test evidence

169 automated tests in 19 files (Vitest, against a real Postgres with the least-privilege role). The
security-relevant ones:

| File | What it checks |
|---|---|
| `tests/rls.test.ts` | Direct SQL as the app role: cross-club reads and writes are refused |
| `tests/boxers.test.ts` | Private fields never leave the owning club; junior name masking |
| `tests/transfers.test.ts` | Only the right club can decide; direct table writes refused; user spoofing refused |
| `tests/blocks-profile-expiry.test.ts` | Blocks enforced in the database, both ways |
| `tests/club-auth.test.ts`, `tests/admin-auth.test.ts` | Sessions, rate limits, CSRF, MFA, replay |
| `tests/password-reset.test.ts` | Token single use, expiry, enumeration resistance |
| `tests/logo.test.ts` | Disguised files, oversize, pixel bombs, cross-site upload, visibility |
| `tests/admin-extras.test.ts` | Owner-only actions; last-owner race |

Run with `npm test` (needs a local Postgres; see `README.md`).

## 8. Known gaps and things not done

- **No independent review or penetration test has been done.** All testing so far was written by the
  same author as the code.
- The two-club flow has been exercised in a browser locally, not yet on the hosted staging site.
- No real-device testing (iOS Safari, Android).
- Monitoring is a health endpoint only; no alerting is connected yet.
- No automatic data retention or deletion. Periods in the privacy notice are placeholders.
- No per-person accounts: each club shares one login, so actions are attributable to a club, not a person.
- Club logins have no two-factor option.
- The production database password and the owner's first admin password passed through the build chat
  and must be rotated before real data (runbook §8).
- `npm audit`: 0 vulnerabilities in production dependencies. 11 moderate advisories in development-only
  tooling (an old esbuild inside drizzle-kit), which is not deployed.
- Vercel login protection currently hides the whole site; the public surface (landing page, calendar,
  legal pages, login, registration, password reset, health check) has not been exposed to the internet yet.
- Matchmaking rules are RingPortal defaults, not England Boxing rules; this is a safety-of-sport gap
  rather than a data-security one.

## 9. Suggested review scope

1. Tenant isolation: RLS policies and every `SECURITY DEFINER` function.
2. Authentication, session handling and the admin MFA flow.
3. The unauthenticated surface: registration, directory lookup, password reset, public calendar, health.
4. File upload.
5. Secrets handling and environment separation (Vercel and Neon settings).
6. Privacy: what another club, and an administrator, can see about an under-18.
