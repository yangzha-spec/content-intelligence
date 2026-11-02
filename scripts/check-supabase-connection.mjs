import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Public-key-only integration check; does not register users or mutate data.
const config = Object.fromEntries((await readFile(new URL('../.env.local', import.meta.url), 'utf8'))
  .split(/\r?\n/).filter((line) => line.includes('=') && !line.trimStart().startsWith('#'))
  .map((line) => { const at = line.indexOf('='); return [line.slice(0, at).trim(), line.slice(at + 1).trim()]; }));
const base = config.NEXT_PUBLIC_SUPABASE_URL;
const key = config.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
assert.ok(base?.startsWith('https://') && key?.startsWith('sb_publishable_'), 'Configure URL and publishable key in .env.local');
const headers = { apikey: key };
const settings = await fetch(`${base}/auth/v1/settings`, { headers, signal: AbortSignal.timeout(20000) });
assert.equal(settings.status, 200, `Auth endpoint returned ${settings.status}`);
console.log('PASS: Auth API accepts the configured publishable key.');

const business = await fetch(`${base}/rest/v1/content_posts?select=id&limit=1`, {
  headers, signal: AbortSignal.timeout(20000),
});
const error = await business.json();
assert.ok([401, 403].includes(business.status), `Expected anonymous access denial, received ${business.status}`);
assert.equal(error.code, '42501', 'Expected a database permission denial');
console.log('PASS: Data API rejects anonymous access to content_posts.');
