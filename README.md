# RingPortal

Club-to-club amateur boxing matchmaking for verified clubs in the UK and Ireland.

**Status: Stage 1 (foundation) + directory import from Stage 2. Local verification only. Not deployed. Not production-ready.**

## Stack

- Next.js 16 (App Router), strict TypeScript, Tailwind CSS v4
- PostgreSQL (Neon in production, Postgres 16+ locally), Drizzle ORM and migrations
- Vercel hosting (not yet connected)

## Security model

| Concern | Implementation |
|---|---|
| Passwords | Argon2id (OWASP parameters), timing-equalised for unknown accounts |
| Sessions | Random 256-bit token in an `HttpOnly`, `Secure`, `SameSite` cookie (`__Host-` prefix in production); only a SHA-256 hash is stored; idle and absolute expiry; server-side revocation |
| CSRF | Origin / `Sec-Fetch-Site` verification on every state-changing API call, JSON-only bodies, SameSite cookies |
| Rate limits | Postgres-backed fixed windows per IP and per account (login, reset, MFA, password change) |
| Admin MFA | Mandatory TOTP, enforced before any admin session exists; AES-256-GCM encrypted secrets; replay protection; 10 single-use recovery codes; rotation; CLI recovery by owner |
| Tenant isolation | Club identity comes only from the session. Every query runs in a transaction with a request context; **forced row-level security** on tenant and platform tables; app connects as a least-privilege role (no BYPASSRLS, no DDL, no ownership) |
| Audit | Append-only `audit_log` (no UPDATE/DELETE grant + triggers that block even the owner) |
| Headers | Nonce-based CSP (no inline scripts/styles), HSTS, frame denial, nosniff, no-store on APIs |
| Password reset | 30-minute single-use token in the URL **fragment**; only newest link valid; all sessions revoked; never bypasses admin MFA |

## Local development

```bash
npm install
cp .env.example .env.local      # fill in values; generate keys as described in the file
npm run db:migrate              # as the owner role (DATABASE_MIGRATION_URL)
# create the least-privilege app login role once:
#   CREATE ROLE ringportal_app_login LOGIN PASSWORD '…' NOBYPASSRLS IN ROLE ringportal_app;
npm run dev:seed                # two clearly labelled DEMO clubs (localhost only)
npm run admin -- create --email you@example.com --name "Your Name" --role owner
npm run dev
```

Admin console: `/admin/login` (two-factor setup is forced at first sign-in). Club sign-in: `/login`.

## Tests

```bash
npm test          # needs a local Postgres; see tests/test-config.ts (TEST_PG_ADMIN_URL)
npm run typecheck && npm run lint && npm run build
```

The suite creates a fresh database, migrates it as the owner and runs as a separate least-privilege login, so RLS is exercised exactly as in production.

## Club directory

`data/england-boxing-directory.csv` holds 1,043 club records. Every record is attributed to the **England Boxing club
directory** (`source = england_boxing_directory`, with its England Boxing source URL and official ID). Third-party
platform references have been removed from the file and are rejected by the importer.

```bash
npm run directory:import -- --file data/england-boxing-directory.csv   # idempotent
```

- Every imported address is **unverified**. Only an administrator can mark one verified (Admin → Club directory),
  and must record how it was checked; the change is audited.
- Addresses that differ from the map (70) or are missing (255) are flagged.
- Re-imports never overwrite a verified address; differences are counted and audited.
- Directory profiles are not accounts: they cannot sign in or act as a club.

## Admin account operations (trusted terminal only)

```bash
npm run admin -- create    --email … --name "…" --role owner|admin
npm run admin -- reset-mfa --email … --reason "…"   # lost authenticator and recovery codes
npm run admin -- disable   --email … --reason "…"
```

There is no HTTP bootstrap endpoint and no shared owner key.

## Neon

Project `ringportal` (`long-wave-35846460`), region `aws-eu-west-2` (London), Postgres 17.
Branches: `production` (default) and `staging`; migrations 0000–0003 applied to both. The directory data
has not yet been imported into Neon (run `directory:import` against each branch at deployment). Role `ringportal_app_login` exists **without login**; enable it at deployment:

```sql
ALTER ROLE ringportal_app_login LOGIN PASSWORD '<generated>';
```

Use that role's pooled connection string as `DATABASE_URL`. Never give the app the owner role.

## Rollback

Drizzle migrations are forward-only. Rollback is via a pre-migration Neon snapshot or point-in-time
restore (history retention is currently 6 hours on this plan) plus a compensating migration.
The tested procedure is in [docs/runbook.md](docs/runbook.md).
