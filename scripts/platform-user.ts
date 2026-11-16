/**
 * Platform admin account management from a trusted terminal. There is no HTTP
 * bootstrap endpoint: the first owner is created here.
 *
 *   npm run admin -- create --email you@example.com --name "Your Name" --role owner
 *   npm run admin -- reset-mfa --email you@example.com --reason "Lost phone and recovery codes"
 *   npm run admin -- disable --email you@example.com --reason "Left the team"
 *
 * Passwords are typed at a hidden prompt, never passed as arguments.
 */
import { parseArgs } from 'node:util';
import { createInterface } from 'node:readline';
import { eq } from 'drizzle-orm';
import { withAuth, closeDb } from '@/server/db/client';
import { platformRecoveryCodes, platformUsers } from '@/server/db/schema';
import { audit } from '@/server/audit';
import { emailSchema, hashPassword, passwordSchema } from '@/server/auth/password';
import { revokeAllAdminSessions } from '@/server/auth/session';

const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
const lines: string[] = [];
const waiters: Array<(line: string) => void> = [];
rl.on('line', (line) => (waiters.length ? waiters.shift()!(line) : lines.push(line)));
let muted = false;
if (process.stdin.isTTY) {
  const out = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
  out._writeToOutput = (s: string) => {
    if (!muted) out.output.write(s);
  };
}

/** Hidden prompt on a terminal; also accepts piped input (one line per answer). */
async function hiddenPrompt(question: string): Promise<string> {
  process.stdout.write(question);
  muted = true;
  const answer = lines.length ? lines.shift()! : await new Promise<string>((resolve, reject) => {
    waiters.push(resolve);
    rl.once('close', () => reject(new Error('Input closed before an answer was given')));
  });
  muted = false;
  process.stdout.write('\n');
  return answer;
}

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { email: { type: 'string' }, name: { type: 'string' }, role: { type: 'string', default: 'admin' }, reason: { type: 'string' } },
});
const command = positionals[0];
const email = emailSchema.parse(values.email ?? '');

async function main() {
  if (command === 'create') {
    const role = values.role === 'owner' ? 'owner' : 'admin';
    const name = (values.name ?? '').trim();
    if (name.length < 2) throw new Error('--name is required');
    const password = await hiddenPrompt('Password (12+ characters): ');
    passwordSchema.parse(password);
    if (password !== (await hiddenPrompt('Confirm password: '))) throw new Error('Passwords do not match');
    const passwordHash = await hashPassword(password);
    await withAuth(async (tx) => {
      const [u] = await tx.insert(platformUsers).values({ email, displayName: name, passwordHash, role }).returning({ id: platformUsers.id });
      await audit(tx, { actorType: 'system', action: 'admin.account_created', targetType: 'platform_user', targetId: u!.id, metadata: { role, via: 'cli' } });
    });
    console.log(`Created ${role} ${email}. Two-factor setup is required at first sign-in (/admin/login).`);
  } else if (command === 'reset-mfa' || command === 'disable') {
    const reason = (values.reason ?? '').trim();
    if (reason.length < 5) throw new Error('--reason is required');
    await withAuth(async (tx) => {
      const [u] = await tx.select({ id: platformUsers.id }).from(platformUsers).where(eq(platformUsers.email, email));
      if (!u) throw new Error('No admin with that email');
      if (command === 'reset-mfa') {
        await tx.update(platformUsers).set({ mfaSecretEnc: null, mfaPendingSecretEnc: null, mfaEnabledAt: null, mfaLastStep: null }).where(eq(platformUsers.id, u.id));
        await tx.delete(platformRecoveryCodes).where(eq(platformRecoveryCodes.platformUserId, u.id));
      } else {
        await tx.update(platformUsers).set({ status: 'disabled' }).where(eq(platformUsers.id, u.id));
      }
      const revoked = await revokeAllAdminSessions(tx, u.id);
      await audit(tx, { actorType: 'system', action: command === 'reset-mfa' ? 'admin.mfa_reset' : 'admin.account_disabled', targetType: 'platform_user', targetId: u.id, reason, metadata: { revokedSessions: revoked, via: 'cli' } });
    });
    console.log(command === 'reset-mfa' ? 'MFA cleared; the admin must enrol again at next sign-in.' : 'Account disabled and signed out.');
  } else {
    throw new Error('Usage: create | reset-mfa | disable');
  }
}

main()
  .catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(async () => {
    rl.close();
    await closeDb();
  });
