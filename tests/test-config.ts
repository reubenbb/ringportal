export const TEST_DB = 'ringportal_test';
export const TEST_ADMIN_URL = process.env.TEST_PG_ADMIN_URL ?? 'postgres://postgres:localdevpw@127.0.0.1:5432/postgres';
export const TEST_APP_ROLE = 'rp_app_test';
export const TEST_APP_PASSWORD = 'rp-app-test-only';
export const TEST_OWNER_URL = TEST_ADMIN_URL.replace(/\/[^/]*$/, `/${TEST_DB}`);
export const TEST_APP_URL = `postgres://${TEST_APP_ROLE}:${TEST_APP_PASSWORD}@127.0.0.1:5432/${TEST_DB}`;
export const TEST_ORIGIN = 'http://localhost:3000';
