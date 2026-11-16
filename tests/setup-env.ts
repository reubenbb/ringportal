import { randomBytes } from 'node:crypto';
import { TEST_APP_URL, TEST_ORIGIN } from './test-config';

const env = process.env as Record<string, string | undefined>;
env.NODE_ENV = 'test';
env.DATABASE_URL = TEST_APP_URL;
env.APP_ORIGIN = TEST_ORIGIN;
env.MFA_ENCRYPTION_KEY ??= randomBytes(32).toString('base64');
env.LOG_HASH_KEY ??= randomBytes(32).toString('base64');
env.MAIL_TRANSPORT = 'console';
