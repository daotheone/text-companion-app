import assert from 'node:assert/strict';
import { chromium } from 'playwright';

// Run Vite with VITE_SUPABASE_URL=https://test.supabase.co/rest/v1/ and a mock public key.
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const invalidPath = 'Invalid path specified in request URL';
const requests = [];
await page.route('https://test.supabase.co/**', async route => {
  const request = route.request();
  if (request.method() === 'OPTIONS') {
    await route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    return;
  }
  const url = new URL(request.url());
  requests.push(url.pathname);
  const valid = url.pathname === '/auth/v1/signup';
  const body = valid
    ? { id: '33333333-3333-4333-8333-333333333333', email: 'new@example.com', identities: [] }
    : { code: 'PGRST125', details: null, hint: null, message: invalidPath };
  console.log(`${request.method()} ${url.origin}${url.pathname}: ${valid ? 200 : 404} ${JSON.stringify(body)}`);
  await route.fulfill({ status: valid ? 200 : 404, json: body, headers: { 'access-control-allow-origin': '*' } });
});
try {
  await page.goto(process.env.APP_URL || 'http://127.0.0.1:5177');
  await page.getByRole('button', { name: '[Create account]', exact: true }).click();
  await page.getByLabel('Email', { exact: true }).fill('new@example.com');
  await page.getByLabel('Password', { exact: true }).fill('test-password');
  await page.getByRole('button', { name: '[Create account]', exact: true }).click();
  await page.getByRole('button', { name: '[Create account]', exact: true }).waitFor();
  assert.equal(await page.getByRole('alert').filter({ hasText: invalidPath }).count(), 0, invalidPath);
  await page.getByRole('status').filter({ hasText: 'Check your email to confirm your account, then log in.' }).waitFor();
  assert.deepEqual(requests, ['/auth/v1/signup']);
  console.log('Signup: Data API URL reaches Auth without invalid-path error.');
} finally {
  await browser.close();
}
