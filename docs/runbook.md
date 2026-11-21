# RingPortal operations runbook

Neon project `long-wave-35846460`, database `ringportal`.
Branches: `production` (root/default, `br-falling-scene-zaq14bkj`), `staging` (`br-late-breeze-zayh3jxk`, child of production).

## 1. Before any production migration

1. Record row counts and migration count:
   ```sql
   select (select count(*) from drizzle.__drizzle_migrations) migrations,
          (select count(*) from clubs) clubs, (select count(*) from boxers) boxers,
          (select count(*) from audit_log) audit, now();
   ```
2. Take a manual snapshot of `production` (snapshots are only allowed on the root branch).
   Name it `prod-pre-<migrations>-<yyyymmdd>` and give it an expiry of 90 days or more.
   The current plan allows **one** manual snapshot. Once real data exists, delete the older one first
   (with the owner's OK), or upgrade the plan. Until then, record the exact time before migrating so
   point-in-time restore (6 h history) can be used.
3. Apply the migration to `staging` first, deploy, and verify. Then apply it to production.
4. Afterwards, confirm production, staging and a locally migrated database have identical schemas with `docs/schema-fingerprint.sql` (owner role names are excluded, so all three compare directly).
   Run it on both branches; the `fp` values must match.

## 2. Restore options

| Situation | Method | Data loss |
|---|---|---|
| Bad migration or bad data on production, snapshot exists | Restore the snapshot to a new branch, verify it, then finalize | Writes since the snapshot |
| Need state at an exact time (within history retention, currently 6 h) | Neon console → Branches → production → Restore → point in time (or create a branch "from a point in time") | Writes after that time |
| Staging broken | Create a branch from staging and compare; reset staging from production only if staging data is disposable | Staging only |

### Restore from snapshot (tested 2026-11-21)

1. Restore the snapshot into a **new branch** with `finalize = false`. Production keeps running untouched.
2. Verify the restored branch:
   ```sql
   select (select count(*) from drizzle.__drizzle_migrations) migrations,
          (select count(*) from pg_policies where schemaname='public') policies,
          (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
             where n.nspname='public' and c.relkind='r' and c.relforcerowsecurity) forced_rls,
          (select count(*) from pg_roles where rolname='ringportal_app') app_role;
   ```
   Compare the counts with the figures recorded in step 1.1.
3. Only when an operator explicitly approves: finalize the restore. Neon moves production's computes onto
   the restored branch and keeps the old branch under a new name, so it can be reversed. Connection strings
   do not change.
4. Re-run the smoke checks (§4). Write an audit note in the incident log.
5. Delete the old branch only after the incident has been closed.

### Test record — 2026-11-21

- Production had 7 migrations and no tenant data. At 08:15:05Z snapshot `snap-misty-cherry-zap4v3p8`
  (`prod-pre-0007-0020-20261121`, expires 2027-02-21) was taken.
- The snapshot was restored to branch `restore-test-prod-snapshot` (`br-wispy-mouse-za40qfcb`, not finalized).
  The restored branch showed 7 migrations, 25 policies, 14 tables with forced RLS, and `ringportal_app` present.
  This matches the pre-migration state.
- Production was then migrated to 21 migrations. The restored branch stayed at 7, which proves it is an
  independent point-in-time copy.
- A branch copy of staging was also made (`restore-test-20261121`, `br-tiny-wave-zaknqx9s`). It showed
  21 migrations, 1043 directory clubs, 2 clubs, 6 boxers and 12 audit rows, all identical to staging.
- Not tested: point-in-time restore of a non-root branch, which needs the Neon console because the tooling
  cannot snapshot a child branch. Finalize was not run, because it would replace production.

Both test branches can be deleted once this record has been reviewed.

## 3. Rollback of a deploy (no schema change)

In Vercel → Deployments, promote the previous READY production deployment ("Instant Rollback").
If the deploy included a migration that changed function signatures (e.g. `match_candidates`), the previous
code will not work against the new schema. In that case, roll forward with a fix, or restore the database as
in §2 **and** roll back the deploy together.

## 4. Smoke checks after a deploy or restore

- `GET /` and `/login` return 200 and carry a CSP header with a nonce.
- `GET /api/cron/affiliation-expiry` without a token returns 401 (403 if `CRON_SECRET` is not set).
- Vercel runtime errors for the last hour are empty.
- Admin dashboard loads and the club review queue renders.

## 5. Scheduled job

`/api/cron/affiliation-expiry` runs daily at 05:17 UTC (`vercel.json`). It needs `CRON_SECRET`, which is stored
as a sensitive Vercel env var (production and preview). Rotate it by upserting a new random value of at least
32 characters and redeploying. It moves approved clubs past their affiliation expiry (London date) to
`reverification_required` and writes a system audit entry.

## 6. Email (Resend)

Code is ready; email stays off (`MAIL_TRANSPORT=disabled`) until these are done:

1. Create a Resend account and add a sending subdomain of the production domain (e.g. `mail.<domain>`).
2. Add the SPF, DKIM and (recommended) DMARC DNS records Resend shows; wait for "Verified".
3. Create an API key with **sending access only**, restricted to that domain.
4. In Vercel (production environment only), set as *sensitive* variables:
   `MAIL_TRANSPORT=resend`, `RESEND_API_KEY=<key>`, `MAIL_FROM=RingPortal <no-reply@mail.<domain>>`.
   The app refuses to start if the key or sender is missing or malformed.
5. Redeploy and request a password reset for a test account; check it arrives and the link works.

Logs record only the subject, HTTP status and Resend error name: never the recipient, body or key.

## 7. Monitoring

- **Uptime:** `GET /api/health` returns `200 {"status":"ok","database":"ok"}`, or `503` if the database
  is unreachable. It needs no sign-in and reveals only up/down and the commit. While Vercel login
  protection is on, an external monitor (e.g. UptimeRobot or Better Stack, every 5 minutes) must send the
  project's *Protection Bypass for Automation* secret as the `x-vercel-protection-bypass` header.
  After launch on the custom domain, protection is lifted and the header is no longer needed.
- **Errors:** check Vercel → Observability → Errors after each deploy. Unhandled API errors are logged
  as `[api] unhandled error` with the path and error name only.
- **Scheduled job:** each run logs `[cron] affiliation-expiry {"moved": n}`. If no line appears for a day,
  check Vercel → Cron Jobs.
- **Database:** Neon console → Monitoring for connections and storage. The plan's storage limit applies.

## 8. Production environment

- Vercel project `ringportal-production` (separate from the staging project `ringportal`). It deploys
  only on request (no Git auto-deploy). Vercel login protection is on for all URLs until launch.
- Its production env vars are `MFA_ENCRYPTION_KEY`, `LOG_HASH_KEY` and `CRON_SECRET` (new values, not
  the staging ones), plus `MAIL_TRANSPORT=disabled`. `DATABASE_URL` is set by the owner (see below).
- `DATABASE_URL` uses the least-privilege role `ringportal_app_login` (no BYPASSRLS). It was first set
  on 2026-11-21 through the build chat, so **rotate it before real club data**: in the Neon SQL editor
  (branch `production`, database `ringportal`) run
  `ALTER ROLE ringportal_app_login PASSWORD '<new random password, 32+ letters and digits>';`
  then update `DATABASE_URL` in Vercel → ringportal-production → Settings → Environment Variables
  (Sensitive, Production only) and redeploy.
- The owner admin account exists on production. Two-factor setup is forced at first sign-in.
- Import the England Boxing directory: sign in as the owner, then Admin → Directory →
  "Import England Boxing directory" (one click; uses the file bundled with the app).
