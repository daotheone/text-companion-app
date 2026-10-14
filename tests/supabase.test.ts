import assert from 'node:assert/strict';
import { test } from 'node:test';
import { configure } from '../src/data/supabase.ts';

test('invalid project URL blocks auth and explains local and deployment setup', async () => {
  const requests: string[] = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    requests.push(String(input));
    return new Response('{}', { status: 400 });
  };
  try {
    for (const url of [
      undefined, '', 'not-a-url', 'ftp://test.supabase.co', 'http://test.supabase.co',
      'https://test.supabase.co/rest/v1/other', 'https://test.supabase.co/auth/v1',
      'https://test.supabase.co/?project=test', 'https://test.supabase.co/#setup',
      'https://user:password@test.supabase.co',
    ]) {
      const configured = configure(url, 'test-public-key');
      if (configured.client) await configured.client.auth.signUp({ email: 'new@example.com', password: 'test-password' });
      assert.deepEqual(requests, [], 'Invalid configuration must never send auth requests');
      assert.equal(configured.client, null);
      assert.match(configured.error, /VITE_SUPABASE_URL/);
      assert.match(configured.error, /https:\/\/<project-ref>\.supabase\.co/);
      assert.match(configured.error, /VITE_SUPABASE_PUBLISHABLE_KEY/);
      assert.match(configured.error, /restart Vite/);
      assert.match(configured.error, /redeploy/i);
      assert.equal(configured.error.includes('user:password'), false);
    }
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('empty public keys block auth instead of hiding a setup problem', async () => {
  const requests: string[] = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    requests.push(String(input));
    return new Response('{}', { status: 400 });
  };
  try {
    for (const key of [undefined, '', ' \n\t ']) {
      const configured = configure('https://test.supabase.co', key);
      if (configured.client) await configured.client.auth.signInWithPassword({ email: 'alice@example.com', password: 'test-password' });
      assert.deepEqual(requests, []);
      assert.equal(configured.client, null);
      assert.match(configured.error, /public key/);
    }
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('project origins and exact Data API suffixes reach Auth without Invalid path specified in request URL', async () => {
  const requests: string[] = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    requests.push(String(input));
    const valid = String(input).endsWith('/auth/v1/signup') && !String(input).includes('/rest/v1/');
    return Response.json(valid
      ? { id: '33333333-3333-4333-8333-333333333333', email: 'new@example.com', identities: [] }
      : { code: 'PGRST125', details: null, hint: null, message: 'Invalid path specified in request URL' }, { status: valid ? 200 : 404 });
  };
  try {
    for (const [url, expected] of [
      ['https://test.supabase.co', 'https://test.supabase.co/auth/v1/signup'],
      ['https://test.supabase.co/', 'https://test.supabase.co/auth/v1/signup'],
      ['https://test.supabase.co/rest/v1', 'https://test.supabase.co/auth/v1/signup'],
      [' https://test.supabase.co/rest/v1/ ', 'https://test.supabase.co/auth/v1/signup'],
      ['http://127.0.0.1:54321', 'http://127.0.0.1:54321/auth/v1/signup'],
      ['https://auth.example.com', 'https://auth.example.com/auth/v1/signup'],
    ]) {
      const { client, error } = configure(url, ' test-public-key ');
      assert.equal(error, '');
      assert.ok(client);
      const result = await client.auth.signUp({ email: 'new@example.com', password: 'test-password' });
      assert.equal(result.error, null, result.error?.message);
      assert.equal(result.data.session, null);
      assert.equal(requests.at(-1), expected);
    }
    assert.equal(requests.length, 6);
  } finally {
    globalThis.fetch = previousFetch;
  }
});
