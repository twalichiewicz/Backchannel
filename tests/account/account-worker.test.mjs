import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { convertV4MiniflareOptions, Miniflare } from 'miniflare';
import { chromium } from 'playwright';
import { launchApp, waitFor } from '../comment-capture/harness.mjs';
import accountApp from '../../worker.js';

const origin = 'http://localhost:3119';
const fixtureVerifier = 'A'.repeat(43);
const fixtureEnvelope = 'A'.repeat(80);
const root = new URL('../../', import.meta.url);
const config = JSON.parse(await readFile(new URL('wrangler.jsonc', root), 'utf8'));

const { outputFiles: [workerScript] } = await build({
  entryPoints: [fileURLToPath(new URL('worker.js', root))], bundle: true, write: false, format: 'esm', platform: 'browser',
});

const { outputFiles: [mailWorkerScript] } = await build({
  stdin: {
    contents: `import worker from './worker.js';
      export default { fetch(request, env, ctx) {
        const ACCOUNT_EMAIL = { async send(message) {
          const response = await env.TEST_MAIL.fetch('https://mail.test', { method: 'POST', body: JSON.stringify(message) });
          if (!response.ok) throw new Error('Mail delivery failed');
          return response.json();
        }};
        return worker.fetch(request, { ...env, ACCOUNT_EMAIL }, ctx);
      }};`,
    resolveDir: fileURLToPath(root),
  },
  bundle: true, write: false, format: 'esm', platform: 'browser',
});

function createWorker(t, { database = false, limit, mail, deliver, sender = 'accounts@backchnnl.app', hourlyLimit = 120 } = {}) {
  const worker = new Miniflare(convertV4MiniflareOptions({
    modules: true, script: (mail ? mailWorkerScript : workerScript).text, compatibilityDate: config.compatibility_date,
    assets: { ...config.assets, directory: fileURLToPath(new URL('site', root)), routerConfig: { has_user_worker: true } },
    ...(database ? { d1Databases: { ACCOUNTS_DB: 'account-test' } } : {}),
    ...(limit ? { ratelimits: { ACCOUNT_RATE_LIMIT: { namespace_id: '1', simple: { limit, period: 60 } } } } : {}),
    ...(mail ? {
      bindings: { ACCOUNT_EMAIL_FROM: sender, ACCOUNT_EMAIL_CODE_SECRET: 'email-code-test-secret', ACCOUNT_EMAIL_HOURLY_LIMIT: String(hourlyLimit) },
      serviceBindings: { TEST_MAIL: async request => {
        const message = await request.json();
        mail.push(message);
        await deliver?.(message);
        return Response.json({ messageId: String(mail.length) });
      } },
    } : {}),
  }));
  t.after(() => worker.dispose());
  return worker;
}

async function request(worker, path, { method = 'GET', token, body, headers = {}, base = origin } = {}) {
  if (token) headers.Authorization = 'Bearer ' + token;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  return worker.dispatchFetch(base + path, { method, body: JSON.stringify(body), headers, redirect: 'manual' });
}

async function readSnapshot(worker, { token }) {
  const response = await request(worker, '/account/snapshot', { token });
  assert.equal(response.status, 200);
  return response.json();
}

function snapshotProof({ account, token }, revision, restore, ciphertext) {
  const tokenHash = createHash('sha256').update(token).digest('base64url');
  const message = JSON.stringify(['backchannel-snapshot-write', 1, account, tokenHash, revision, restore, ciphertext]);
  return createHmac('sha256', Buffer.from(fixtureVerifier, 'base64url')).update(message).digest('base64url');
}

function writeSnapshot(worker, session, revision, ciphertext, { restore = null, proof = snapshotProof(session, revision, restore, ciphertext) } = {}) {
  const headers = { 'If-Match': JSON.stringify(String(revision)) };
  if (proof) headers['X-Backchannel-Sync-Proof'] = proof;
  if (restore !== null) headers['X-Backchannel-Restore-Revision'] = String(restore);
  return request(worker, '/account/snapshot', {
    method: 'PUT', token: session.token, headers, body: { ciphertext },
  });
}

async function applySchema(worker, ...migrations) {
  const db = await worker.getD1Database('ACCOUNTS_DB');
  const selected = new Set(['0001_account.sql', ...migrations, '0006_passkey_key_envelopes.sql', '0007_account_sync_access.sql', '0008_pending_account_signups.sql', '0010_snapshot_history.sql']);
  if (selected.has('0002_recovery_email.sql')) {
    selected.add('0005_email_resend_limits.sql');
    selected.add('0009_email_hourly_budget.sql');
  }
  for (const filename of [...selected].sort()) {
    await applyMigration(db, filename);
  }
  return db;
}

async function applyMigration(db, filename) {
  const schema = await readFile(new URL('account/migrations/' + filename, root), 'utf8');
  await db.batch(schema.split(';').map(statement => statement.trim()).filter(Boolean).map(statement => db.prepare(statement)));
}

function emailCode(message) {
  const match = message.text.match(/(?:^[A-Za-z0-9_-]{22}$|\bYour Backchannel verification code is ([0-9]{6})\b)/m);
  return match[1] || match[0];
}

async function enrollmentProof(device, { ceremony, options }) {
  const credential = await device.getCredential(options, true);
  const assertion = await device.getCredential({
    challenge: options.challenge, rpId: options.rp.id, userVerification: 'required',
    allowCredentials: [{ type:'public-key', id:credential.id }],
  });
  return { ceremony, credential, assertion, envelope:fixtureEnvelope, syncKeyVerifier:fixtureVerifier };
}

async function completeRegistration(post, proof) {
  const pending = await post('/register/verify', proof);
  assert.equal(pending.status, 202);
  const { signup } = await pending.json();
  return post('/register/complete', {signup});
}

async function registerWithEmail(worker, device, mail, email) {
  const post = (path, body) => request(worker, '/account' + path, { method: 'POST', body });
  assert.equal((await post('/email/register/start', { email })).status, 200);
  const start = await post('/register/options', { email, code: emailCode(mail.at(-1)) });
  assert.equal(start.status, 200);
  const proof = await enrollmentProof(device, await start.json());
  const registered = await completeRegistration(post, proof);
  assert.equal(registered.status, 201);
  return { session: await registered.json(), proof };
}

test('passkey registration cannot create a session without a sync key', {timeout:15000}, async t => {
  const mail = [];
  const worker = createWorker(t, {database:true, limit:20, mail});
  const db = await applySchema(worker, '0002_recovery_email.sql');
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const device = await createDevice(browser, worker);
  const post = (path, body) => request(worker, '/account' + path, {method:'POST', body});
  const email = 'no-sync@example.test';
  assert.equal((await post('/email/register/start', {email})).status, 200);
  const challenge = await (await post('/register/options', {email, code:emailCode(mail[0])})).json();
  const credential = await device.getCredential(challenge.options, true);
  const response = await post('/register/verify', {ceremony:challenge.ceremony, credential});
  assert.equal(response.status, 400);
  assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM accounts').first('count')),0);
  assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM sessions').first('count')),0);
});

test('abandoned signup phases expire without creating accounts', {timeout:15000}, async t => {
  const mail = [];
  const worker = createWorker(t, {database:true, limit:20, mail});
  const db = await applySchema(worker, '0002_recovery_email.sql');
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const device = await createDevice(browser, worker);
  const post = (path, body) => request(worker, '/account' + path, {method:'POST', body});
  const email = 'abandoned@example.test';
  const now = Date.now();
  await post('/email/register/start', {email});
  const challenge = await (await post('/register/options', {email, code:emailCode(mail.at(-1))})).json();
  assert(challenge.expiresAt >= now + 15 * 60_000);
  const staged = await post('/register/verify', await enrollmentProof(device, challenge));
  assert.equal(staged.status,202);
  const pending = await staged.json();
  assert(pending.expiresAt >= now + 15 * 60_000);
  for (const table of ['accounts', 'passkeys', 'sessions']) {
    assert.equal(await db.prepare('SELECT COUNT(*) AS count FROM ' + table).first('count'),0);
  }
  await post('/email/register/start', {email:'code-not-entered@example.test'});
  const expiredCode = createHash('sha256').update(emailCode(mail.at(-1))).digest('base64url');
  await post('/email/register/start', {email:'passkey-not-created@example.test'});
  await post('/register/options', {email:'passkey-not-created@example.test', code:emailCode(mail.at(-1))});
  await post('/email/register/start', {email:'still-trying@example.test'});
  await db.batch([
    db.prepare('UPDATE account_email_codes SET expires_at = 0 WHERE code_hash = ?').bind(expiredCode),
    db.prepare('UPDATE ceremonies SET expires_at = 0'),
    db.prepare('UPDATE account_signups SET expires_at = 0'),
  ]);
  const cleanup = [];
  accountApp.scheduled({}, {ACCOUNTS_DB:db}, {waitUntil:task => cleanup.push(task)});
  await Promise.all(cleanup);
  assert.equal(await db.prepare('SELECT COUNT(*) AS count FROM account_email_codes').first('count'),1);
  assert.equal(await db.prepare('SELECT COUNT(*) AS count FROM ceremonies').first('count'),0);
  assert.equal(await db.prepare('SELECT COUNT(*) AS count FROM account_signups').first('count'),0);
  const expired = await post('/register/complete', {signup:pending.signup});
  assert.equal(expired.status,401);
  assert.deepEqual(await expired.json(),{error:'signup-expired'});
});

test('scheduled cleanup removes expired sessions and unlock grants while keeping active ones', async t => {
  const worker = createWorker(t, { database: true, limit: 20 });
  const db = await applySchema(worker, '0002_recovery_email.sql');
  const later = Date.now() + 60_000;
  await db.batch([
    db.prepare("INSERT INTO accounts (id) VALUES ('reader')"),
    db.prepare("INSERT INTO passkeys (id, account_id, public_key, counter) VALUES ('device', 'reader', 'test-public-key', 0)"),
    db.prepare("INSERT INTO sessions (token_hash, account_id, expires_at) VALUES ('expired', 'reader', 0), ('active', 'reader', ?)").bind(later),
    db.prepare("INSERT INTO account_unlocks (token_hash, credential_id, expires_at) VALUES ('expired', 'device', 0), ('active', 'device', ?)").bind(later),
  ]);
  const tasks = [];
  accountApp.scheduled({}, { ACCOUNTS_DB:db }, { waitUntil: task => tasks.push(task) });
  await Promise.all(tasks);
  assert.deepEqual((await db.prepare('SELECT token_hash FROM sessions').all()).results, [{ token_hash:'active' }]);
  assert.deepEqual((await db.prepare('SELECT token_hash FROM account_unlocks').all()).results, [{ token_hash:'active' }]);
});

async function createDevice(browser, worker) {
  const context = await browser.newContext();
  await context.route('**/*', route => {
    const { origin: hostname, pathname: path } = new URL(route.request().url());
    if (hostname !== origin) return route.abort();
    if (path === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Account sync test</title>' });
    return route.abort();
  });

  const page = await context.newPage();
  const devtools = await context.newCDPSession(page);
  await devtools.send('WebAuthn.enable');
  const { authenticatorId } = await devtools.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
  await page.goto(origin);

  async function signIn() {
    const challenge = await (await request(worker, '/account/login/options', {method:'POST'})).json();
    const verified = await request(worker, '/account/login/verify', {
      method:'POST', body:{ceremony:challenge.ceremony, credential:await getCredential(challenge.options)},
    });
    const proof = await verified.json();
    if (!verified.ok) throw new Error(proof.error);
    const finished = await request(worker, '/account/login/complete', {
      method:'POST', body:{unlock:proof.unlock, syncKeyVerifier:fixtureVerifier},
    });
    const session = await finished.json();
    if (!finished.ok) throw new Error(session.error);
    return session;
  }

  async function verifyForDeletion(session) {
    const response = await request(worker, '/account/delete/options', { method: 'POST', token: session.token });
    assert.equal(response.status, 200);
    const { ceremony, options } = await response.json();
    return { ceremony, credential: await getCredential(options) };
  }

  async function getCredential(options, create = false) {
    return page.evaluate(async ({ options, create }) => {
      const credential = create
        ? await navigator.credentials.create({ publicKey: PublicKeyCredential.parseCreationOptionsFromJSON(options) })
        : await navigator.credentials.get({ publicKey: PublicKeyCredential.parseRequestOptionsFromJSON(options) });
      return credential.toJSON();
    }, { options, create });
  }

  return { devtools, authenticatorId, signIn, verifyForDeletion, getCredential };
}

test('account routes are JSON on the primary host and localhost when disabled', async t => {
  const worker = createWorker(t);
  for (const base of [origin, 'https://backchnnl.app']) {
    const status = await request(worker, '/account/status', { base });
    assert.equal(status.status, 200);
    assert.deepEqual(await status.json(), { available: false });
    assert.equal(status.headers.get('Cache-Control'), 'no-store');
    const disabled = await request(worker, '/account/snapshot', { base });
    assert.equal(disabled.status, 503);
    assert.deepEqual(await disabled.json(), { error: 'account-sync-unavailable' });
  }
  const alias = await request(worker, '/account/status', { base: 'https://other-host.example' });
  assert.equal(alias.status, 301);
  assert.equal(alias.headers.get('location'), 'https://backchnnl.app/account/status');
  const preview = await request(worker, '/account/status', { base: 'https://test-backchannel.example' });
  assert.equal(preview.status, 302);
  assert.equal(preview.headers.get('location'), 'https://test-backchannel.example/');
  assert.equal((await request(worker, '/favicon.ico', { base: 'https://backchnnl.app' })).status, 200);
});

test('a bound database alone does not enable public registration', async t => {
  const worker = createWorker(t, { database: true });
  const status = await request(worker, '/account/status');
  assert.deepEqual(await status.json(), { available: false });
  assert.equal((await request(worker, '/account/register/options', { method: 'POST' })).status, 503);
});

test('an email binding without a sender cannot bypass registration verification', async t => {
  const worker = createWorker(t, { database: true, limit: 20, mail: [], sender: '' });
  await applySchema(worker);
  assert.equal((await request(worker, '/account/register/options', { method: 'POST' })).status, 503);
  assert.equal((await request(worker, '/account/login/options', { method: 'POST' })).status, 200);
});

test('an unavailable email service blocks enrollment and preserves existing account access', async t => {
  const worker = createWorker(t, { database: true, limit: 20 });
  const db = await applySchema(worker, '0002_recovery_email.sql');
  const token = 'A'.repeat(43);
  const tokenHash = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))).toString('base64url');
  await db.batch([
    db.prepare("INSERT INTO accounts (id) VALUES ('legacy')"),
    db.prepare("INSERT INTO sessions (token_hash, account_id, expires_at) VALUES (?, 'legacy', ?)").bind(tokenHash, Date.now() + 60000),
    db.prepare("INSERT INTO snapshots (account_id, revision, ciphertext) VALUES ('legacy', 1, 'test-snapshot')"),
  ]);
  for (const path of ['/account/register/options', '/account/register/verify']) {
    const response = await request(worker, path, { method: 'POST', body: {} });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: 'email-unavailable' });
  }
  assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM ceremonies').first()).count, 0);
  assert.equal((await request(worker, '/account/login/options', { method: 'POST' })).status, 200);
  assert.deepEqual(await (await request(worker, '/account/email', { token })).json(), { email: null });
  assert.deepEqual(await (await request(worker, '/account/snapshot', { token })).json(), { revision: 1, ciphertext: 'test-snapshot' });
});

test('the binding rate-limits repeated registration attempts before storing ceremonies', async t => {
  const mail = [];
  const worker = createWorker(t, { database: true, limit: 2, mail });
  const db = await applySchema(worker, '0002_recovery_email.sql');
  for (const expected of [200, 200, 429]) {
    const index = mail.length + 1;
    const email = `reader${index}@example.test`;
    const sent = await request(worker, '/account/email/register/start', {
      method: 'POST', body: { email }, headers: { 'CF-Connecting-IP': `192.0.2.${index}` },
    });
    assert.equal(sent.status, 200);
    assert.equal((await request(worker, '/account/register/options', {
      method: 'POST', body: { email, code: emailCode(mail.at(-1)) },
    })).status, expected);
  }
  assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM ceremonies').first()).count, 2);
});

test('the database enforces a shared email budget for concurrent requests', async t => {
  const mail = [];
  const worker = createWorker(t, { database: true, limit: 20, mail, hourlyLimit: 2 });
  const db = await applySchema(worker, '0002_recovery_email.sql');
  const send = async email => {
    const response = await request(worker, '/account/email/register/start', { method:'POST', body:{ email } });
    return {status:response.status,retryAfterHeader:response.headers.get('Retry-After'),body:await response.json()};
  };
  const responses = await Promise.all([
    send('one@example.test'), send('two@example.test'), send('three@example.test'), send('four@example.test'),
  ]);
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 200, 429, 429]);
  assert.equal(mail.length, 2);
  assert.equal(await db.prepare('SELECT COUNT(*) AS count FROM account_email_codes').first('count'), 2);
  for (const response of responses.filter(response => response.status === 429)) {
    const { error, retryAfter } = response.body;
    assert.equal(error, 'rate-limited');
    assert(Number.isInteger(retryAfter) && retryAfter > 0 && retryAfter <= 3600);
    assert.equal(response.retryAfterHeader, String(retryAfter));
  }
  await db.prepare('UPDATE account_email_budget SET window_start = 0').run();
  assert.equal((await send('new-window@example.test')).status, 200);
  assert.equal(mail.length, 3);
});

test('Account responses block cross-origin browser contexts and opt out of caching', async t => {
  const worker = createWorker(t);
  const status = await request(worker, '/account/status', { headers:{ 'Sec-Fetch-Site':'same-origin' } });
  assert.equal(status.status, 200);
  assert.equal(status.headers.get('Cache-Control'), 'no-store');
  assert.equal(status.headers.get('Cross-Origin-Resource-Policy'), 'same-origin');
  assert.equal(status.headers.get('Referrer-Policy'), 'no-referrer');
  for (const site of ['same-site', 'cross-site']) {
    const response = await request(worker, '/account/status', { headers:{ 'Sec-Fetch-Site':site } });
    assert.equal(response.status, 403);
  }
  for (const rejectedOrigin of ['null', 'https://example.test']) {
    const response = await request(worker, '/account/login/options', {
      method:'POST', headers:{ Origin:rejectedOrigin, 'Sec-Fetch-Site':'same-origin' },
    });
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), {error:'invalid-origin'});
  }
});

test('the Worker accepts only bounded diagnostics without account or article identifiers', async () => {
  const points = [];
  let allowed = true;
  const env = {
    ACCOUNT_RATE_LIMIT: { limit: async () => ({success:allowed}) },
    BACKCHANNEL_DIAGNOSTICS: { writeDataPoint: point => points.push(point) },
  };
  const report = {operation:'thread',source:'reddit',outcome:'timeout',duration:30000,version:'1.6.19-alpha'};
  const send = (body, headers = {}, query = '') => accountApp.fetch(new Request('https://backchnnl.app/account/diagnostics' + query, {
    method:'POST', headers:{'Content-Type':'application/json',Origin:'https://backchnnl.app',...headers}, body:JSON.stringify(body),
  }), env, {});
  assert.equal((await send(report)).status,204);
  for (const body of [{...report,url:'https://example.test/reading'}, {...report,source:'r/private'}, {...report,duration:3721}]) {
    assert.equal((await send(body)).status,400);
  }
  assert.equal((await send(report, {Authorization:'Bearer fixture'})).status,400);
  assert.equal((await send(report, {}, '?url=article')).status,400);
  assert.equal((await send(report, {'Sec-Fetch-Site':'cross-site'})).status,403);
  assert.equal((await send({...report, url:'a'.repeat(400)})).status,413);
  allowed = false;
  assert.equal((await send(report)).status,429);
  assert.deepEqual(points,[{
    blobs:['thread','reddit','timeout','1.6.19-alpha'], doubles:[30000], indexes:['thread:reddit'],
  }]);
});

test('Reader Account POSTs reach the Worker with a same-origin browser request', async t => {
  const worker = createWorker(t, { database:true, limit:10 });
  await applySchema(worker);
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage();
  const local = new URL(await worker.ready);
  local.hostname = 'localhost';
  const reader = new URL('/?fixture=private', local).href;
  await page.route(reader, route => route.fulfill({contentType:'text/html', body:'<!doctype html><title>Reader fixture</title>'}));
  await page.goto(reader);
  const source = await readFile(new URL('HNewhere.user.js', root), 'utf8');
  const client = source.slice(source.indexOf('async function accountRequest('), source.indexOf('function accountPasskeysSupported('));
  const incoming = page.waitForResponse(new URL('/account/login/options', local).href);
  const challenge = await page.evaluate(`(async () => {
    const START_PAGE_ORIGIN = location.origin;
    const onStartPage = () => true;
    ${client}
    return accountRequest('/login/options', {method:'POST'});
  })()`);
  assert.equal(challenge.options.rpId, 'localhost');
  const headers = await (await incoming).request().allHeaders();
  assert.equal(headers.origin, local.origin);
  assert.equal(headers.referer, local.origin + '/');
});

test('six-digit email codes are tied to their request and stop accepting guesses after five misses', async t => {
  const mail = [];
  const worker = createWorker(t, { database: true, limit: 100, mail });
  await applySchema(worker, '0002_recovery_email.sql', '0004_email_code_attempts.sql');
  const post = (path, body) => request(worker, '/account' + path, { method: 'POST', body });
  const begin = async email => {
    const request = await post('/email/register/start', { email, codeFormat: 'numeric' });
    assert.equal(request.status, 200);
    const { verificationId } = await request.json();
    assert.match(verificationId, /^[\w-]{22}$/);
    const code = emailCode(mail.at(-1));
    assert.match(code, /^[0-9]{6}$/);
    return { email, code, verificationId };
  };
  const blocked = await begin('blocked@example.test');
  const valid = await begin('valid@example.test');
  assert.equal((await post('/register/options', { ...valid, verificationId: blocked.verificationId })).status, 401);
  assert.equal((await post('/register/options', { email: valid.email, code: valid.code })).status, 401);
  const guess = blocked.code === '000000' ? '111111' : '000000';
  for (let attempt = 0; attempt < 5; attempt++) assert.equal((await post('/register/options', { ...blocked, code: guess })).status, 401);
  assert.equal((await post('/register/options', blocked)).status, 401);
  assert.equal((await post('/register/options', valid)).status, 200);
  assert.equal((await post('/register/options', valid)).status, 401);
});

test('verification allows three resends per window, with an atomic cooldown', async t => {
  const mail = [];
  const worker = createWorker(t, { database: true, limit: 100, mail });
  const db = await applySchema(worker, '0002_recovery_email.sql', '0004_email_code_attempts.sql');
  const send = () => request(worker, '/account/email/register/start', { method:'POST', body:{ email:'resend@example.test', codeFormat:'numeric' } });
  const initial = await send();
  assert.equal(initial.status, 200);
  assert.equal((await initial.json()).remainingResends, 3);
  const cooldown = await send();
  assert.equal(cooldown.status, 429);
  assert((await cooldown.json()).retryAfter > 0);
  for (let remaining = 2; remaining >= 0; remaining--) {
    await db.prepare('UPDATE account_email_sends SET expires_at = 0').run();
    const responses = await Promise.all([send(), send()]);
    assert.deepEqual(responses.map(response => response.status).sort(),[200,429]);
    const accepted = responses.find(response => response.ok);
    assert.equal((await accepted.json()).remainingResends, remaining);
  }
  await db.prepare('UPDATE account_email_sends SET expires_at = 0').run();
  const blocked = await send();
  assert.equal(blocked.status, 429);
  assert.equal((await blocked.json()).remainingResends, 0);
  assert.equal(mail.length, 4);
  await db.prepare('UPDATE account_email_sends SET window_expires_at = 0').run();
  assert.equal((await (await send()).json()).remainingResends, 3);
});

test('verified recovery email gates registration and can replace a passkey on the same account', { timeout: 30_000 }, async t => {
  const mail = [];
  const mailDelivery = Promise.withResolvers();
  const worker = createWorker(t, {
    database: true, limit: 100, mail,
    deliver: message => message.subject === 'Backchannel passkey recovery' ? mailDelivery.promise : undefined,
  });
  const post = (path, body, token) => request(worker, '/account' + path, { method: 'POST', body, token });
  const status = await request(worker, '/account/status');
  assert.deepEqual(await status.json(), { available: true, emailAvailable: true });
  const db = await applySchema(worker, '0002_recovery_email.sql');
  assert.equal((await post('/register/options', {})).status, 401);
  assert.equal((await post('/email/register/start', { email: 'x@example.test\r\nBcc:y@example.test' })).status, 400);
  assert.equal((await post('/email/register/start', { email: 'reader\n@example.test' })).status, 400);
  assert.equal((await post('/email/register/start', { email: 'Reader@Example.test' })).status, 200);
  assert.equal((await post('/email/register/start', { email: 'reader@example.test' })).status, 429);
  assert.equal(mail[0].from, 'accounts@backchnnl.app');
  assert.equal(mail[0].to, 'reader@example.test');
  const code = emailCode(mail[0]);
  const email = 'reader@example.test';
  assert.equal((await post('/recover/options', { email, code })).status, 401);

  const browser = await chromium.launch();
  t.after(() => browser.close());
  const first = await createDevice(browser, worker);
  const reg = await post('/register/options', { email, code });
  assert.equal(reg.status, 200);
  const { ceremony, options } = await reg.json();
  assert.equal(options.user.name, email);
  assert.match(Buffer.from(options.user.id, 'base64url').toString(), /^[0-9a-f-]{36}$/);
  assert.equal((await post('/register/options', { email, code })).status, 401);
  const registered = await completeRegistration(post, await enrollmentProof(first, {ceremony, options}));
  assert.equal(registered.status, 201);
  const session = await registered.json();
  assert.deepEqual(await (await request(worker, '/account/email', { token: session.token })).json(), { email });
  const oldSession = await first.signIn();
  const ciphertext = 'B'.repeat(64);
  const snapshot = await writeSnapshot(worker, session, 0, ciphertext);
  assert.equal(snapshot.status, 200);
  assert.deepEqual(await snapshot.json(), { revision: 1 });

  const unknown = await post('/email/recover/start', { email: 'unregistered@example.test' });
  const knownResponse = post('/email/recover/start', { email });
  let known;
  let timeout;
  try {
    known = await Promise.race([knownResponse, new Promise(resolve => { timeout = setTimeout(resolve, 2_000); })]);
  } finally {
    clearTimeout(timeout);
    mailDelivery.resolve();
  }
  assert(known, 'the recovery response waited for email delivery');
  assert.equal(known.status, 200);
  assert.equal(unknown.status, known.status);
  assert.deepEqual(await unknown.json(), await known.json());
  assert(await waitFor(() => mail.length === 2));
  assert.equal(mail[1].to, email);
  const recoveryCode = emailCode(mail[1]);
  assert.deepEqual(
    await (await post('/recover/options', { email: 'unregistered@example.test', code: recoveryCode })).json(),
    await (await post('/recover/options', { email, code })).json(),
  );
  const recovering = await post('/recover/options', { email, code: recoveryCode, syncKeyVerifier:fixtureVerifier });
  assert.equal(recovering.status, 200);
  const recovery = await recovering.json();
  assert.equal(recovery.options.user.name, email);
  assert.equal(recovery.options.user.id, options.user.id);
  assert.equal((await post('/recover/options', { email, code: recoveryCode })).status, 401);
  const second = await createDevice(browser, worker);
  const proof = await enrollmentProof(second, recovery);
  const recovered = await post('/recover/verify', proof);
  assert.equal(recovered.status, 200);
  const next = await recovered.json();
  assert.deepEqual(Object.keys(next).sort(), ['account', 'expiresAt', 'token']);
  assert.equal(next.account, session.account);
  for (const token of [session.token, oldSession.token]) {
    assert.equal((await request(worker, '/account/snapshot', { token })).status, 401);
  }
  await assert.rejects(first.signIn(), /invalid-credential/);
  assert.equal((await post('/recover/verify', proof)).status, 401);
  assert.deepEqual(await readSnapshot(worker, next), { revision: 1, ciphertext });

  const expiringAddress = 'expiring@example.test';
  assert.equal((await post('/email/register/start', { email: expiringAddress })).status, 200);
  const expiredCode = emailCode(mail[2]);
  await db.prepare("UPDATE account_email_codes SET expires_at = 0 WHERE kind = 'register'").run();
  assert.equal((await post('/register/options', { email: expiringAddress, code: expiredCode })).status, 401);
});

test('an existing account can enroll or change an address with fresh passkey confirmation', { timeout: 30_000 }, async t => {
  const mail = [];
  const worker = createWorker(t, { database: true, limit: 100, mail });
  const post = (path, body, token) => request(worker, '/account' + path, { method: 'POST', body, token });
  const read = token => request(worker, '/account/email', { token });
  const db = await applySchema(worker, '0002_recovery_email.sql');
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const device = await createDevice(browser, worker);
  const { session: { account, token }, proof: registrationProof } = await registerWithEmail(worker, device, mail, 'old@example.test');
  mail.length = 0;
  await db.batch([
    db.prepare('UPDATE accounts SET recovery_email = NULL WHERE id = ?').bind(account),
    db.prepare("INSERT INTO snapshots (account_id, revision, ciphertext) VALUES (?, 1, 'test-snapshot')").bind(account),
  ]);

  assert.equal((await read()).status, 401);
  assert.deepEqual(await (await read(token)).json(), { email: null });
  const email = 'first@example.test';
  const secondSession = await device.signIn();
  for (const method of ['GET', 'PUT']) {
    const snapshot = await request(worker, '/account/snapshot', { method, token: secondSession.token });
    assert.equal(snapshot.status, 409);
    assert.deepEqual(await snapshot.json(), { error: 'email-required' });
  }
  const start = await post('/email/options', {}, token);
  const fresh = await start.json();
  assert.equal((await post('/email/start', { email, ...registrationProof }, token)).status, 401);
  const proof = { email, ceremony: fresh.ceremony, credential: await device.getCredential({ ...fresh.options, allowCredentials: [] }) };
  assert.equal((await post('/email/start', proof, secondSession.token)).status, 401);
  assert.equal((await post('/email/start', proof, token)).status, 200);
  assert.equal((await post('/email/start', proof, token)).status, 401);
  const emailProof = { email, code: emailCode(mail[0]) };
  assert.equal((await post('/email/verify', emailProof, secondSession.token)).status, 401);
  assert.equal((await post('/register/options', emailProof)).status, 401);
  assert.deepEqual(await (await post('/email/verify', emailProof, token)).json(), { email });
  assert.equal((await post('/email/verify', emailProof, token)).status, 401);
  assert.deepEqual(await (await read(secondSession.token)).json(), { email });
  assert.deepEqual(await (await request(worker, '/account/snapshot', { token: secondSession.token })).json(), { revision: 1, ciphertext: 'test-snapshot' });

  await post('/email/recover/start', { email });
  assert(await waitFor(() => mail.length === 2));
  const recovering = await post('/recover/options', { email, code: emailCode(mail[1]), syncKeyVerifier:fixtureVerifier });
  assert.equal(recovering.status, 200);
  const recover = await recovering.json();
  const other = await createDevice(browser, worker);
  const stale = await enrollmentProof(other, recover);

  const address = 'second@example.test';
  const change = await (await post('/email/options', {}, token)).json();
  const confirm = { email: address, ceremony: change.ceremony, credential: await device.getCredential(change.options) };
  assert.equal((await post('/email/start', confirm, token)).status, 200);
  assert.equal((await post('/email/verify', { email: address, code: emailCode(mail[2]) }, token)).status, 200);
  assert.deepEqual(await (await read(token)).json(), { email: address });
  assert.equal((await post('/recover/verify', stale)).status, 401);
  assert.ok((await device.signIn()).token);

  await post('/email/register/start', { email: address });
  assert.equal((await post('/register/options', { email: address, code: emailCode(mail[3]) })).status, 409);
  await db.prepare("UPDATE account_email_sends SET expires_at = 0 WHERE kind = 'register'").run();
  await post('/email/register/start', { email: address });
  const sameEmail = await post('/register/options', { email: address, code: emailCode(mail[4]), flow: 'continue' });
  assert.equal(sameEmail.status, 200);
  const login = await sameEmail.json();
  assert.equal(login.mode, 'login');
  const returned = await post('/login/verify', { ceremony: login.ceremony, credential: await device.getCredential(login.options) });
  assert.equal(returned.status, 200);
  assert.equal((await returned.json()).account, account);

  const directLogin = await (await post('/login/options')).json();
  assert.equal((await post('/recover/options', { signInCeremony: directLogin.ceremony, syncKeyVerifier:fixtureVerifier })).status, 401);
  await db.prepare("UPDATE account_email_sends SET expires_at = 0 WHERE kind = 'register'").run();
  assert.equal((await post('/email/register/start', { email: address })).status, 200);
  const eligible = await (await post('/register/options', { email: address, code: emailCode(mail.at(-1)), flow: 'continue' })).json();
  const invalidKey = await post('/recover/options', {signInCeremony:eligible.ceremony, syncKeyVerifier:'B'.repeat(43)});
  assert.equal(invalidKey.status, 400);
  assert.equal((await invalidKey.json()).error, 'incorrect-recovery-key');
  assert.deepEqual(await (await request(worker, '/account/snapshot', {token})).json(), {revision:1,ciphertext:'test-snapshot'});
  const recoveryFromSignIn = await post('/recover/options', { signInCeremony: eligible.ceremony, syncKeyVerifier:fixtureVerifier });
  assert.equal(recoveryFromSignIn.status, 200);
  const renewed = await recoveryFromSignIn.json();
  assert.equal(renewed.mode, 'recover');
  assert.equal(renewed.options.user.name, address);
  assert.equal((await post('/recover/options', { signInCeremony: eligible.ceremony, syncKeyVerifier:fixtureVerifier })).status, 401);
  const replacement = await post('/recover/verify', await enrollmentProof(other, renewed));
  assert.equal(replacement.status, 200);
  const newSession = await replacement.json();
  assert.equal(newSession.account, account);
  assert.equal((await read(token)).status, 401);
  assert.deepEqual(await (await read(newSession.token)).json(), { email: address });
  assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM accounts').first()).count, 1);
});

test('two devices share snapshot revisions and delete the account with a fresh passkey', { timeout: 30_000 }, async t => {
  const mail = [];
  const worker = createWorker(t, { database: true, limit: 20, mail });
  const status = await request(worker, '/account/status');
  assert.deepEqual(await status.json(), { available: true, emailAvailable: true });
  const db = await applySchema(worker, '0002_recovery_email.sql', '0006_passkey_key_envelopes.sql');
  const browser = await chromium.launch();
  t.after(() => browser.close());
  assert.equal((await request(worker, '/account/snapshot')).status, 401);
  assert.equal((await request(worker, '/account/register/options', { method: 'POST', headers: { Origin: 'https://other.example' } })).status, 403);

  const first = await createDevice(browser, worker);
  const { session, proof: registrationProof } = await registerWithEmail(worker, first, mail, 'first@example.test');
  const start = await (await request(worker, '/account/login/options', {method:'POST'})).json();
  const verified = await request(worker, '/account/login/verify', {
    method:'POST', body:{ceremony:start.ceremony, credential:await first.getCredential(start.options)},
  });
  assert.equal(verified.status, 200);
  const unlock = await verified.json();
  assert.deepEqual(Object.keys(unlock).sort(), ['account','envelope','unlock']);
  assert.equal(unlock.envelope, fixtureEnvelope);
  assert.equal((await request(worker, '/account/snapshot', {token:unlock.unlock})).status, 401);
  for (const syncKeyVerifier of ['B'.repeat(43), fixtureVerifier]) {
    assert.equal((await request(worker, '/account/login/complete', {
      method:'POST', body:{unlock:unlock.unlock,syncKeyVerifier},
    })).status, 401, 'an incorrect proof consumes the unlock attempt');
  }
  assert.equal(await db.prepare('SELECT COUNT(*) AS count FROM sessions').first('count'),1);
  const crossOrigin = await request(worker, '/account/snapshot', {
    token: session.token, headers: { Origin: 'https://other.example' },
  });
  assert.equal(crossOrigin.status, 403);
  assert.equal(crossOrigin.headers.get('Access-Control-Allow-Origin'), null);
  assert.equal((await request(worker, '/account/register/verify', { method: 'POST', body: registrationProof })).status, 401);
  assert.notEqual((await db.prepare('SELECT token_hash FROM sessions').first()).token_hash, session.token);

  // The Worker stores opaque ciphertext. The Reader integration below exercises real encryption.
  const ciphertext = 'B'.repeat(64);
  const nextCiphertext = 'C'.repeat(64);
  assert.deepEqual(await readSnapshot(worker, session), { revision: 0, ciphertext: null });
  const unsigned = await writeSnapshot(worker, session, 0, ciphertext, { proof:null });
  assert.equal(unsigned.status, 428);
  assert.deepEqual(await unsigned.json(), { error:'snapshot-proof-required' });
  assert.equal((await writeSnapshot(worker, session, 0, ciphertext, { proof:snapshotProof(session, 0, null, nextCiphertext) })).status, 403);
  const write = await writeSnapshot(worker, session, 0, ciphertext);
  assert.equal(write.status, 200);
  assert.deepEqual(await write.json(), { revision: 1 });
  const snapshot = await db.prepare('SELECT ciphertext FROM snapshots WHERE account_id = ?').bind(session.account).first();
  assert.equal(snapshot.ciphertext, ciphertext);
  assert.equal((await writeSnapshot(worker, session, 1, nextCiphertext, {
    proof:snapshotProof(session, 0, null, nextCiphertext),
  })).status, 403);

  const { credentials } = await first.devtools.send('WebAuthn.getCredentials', { authenticatorId: first.authenticatorId });
  const second = await createDevice(browser, worker);
  await second.devtools.send('WebAuthn.addCredential', { authenticatorId: second.authenticatorId, credential: credentials[0] });
  const secondSession = await second.signIn();
  assert.equal(secondSession.account, session.account);
  assert.notEqual(secondSession.token, session.token);
  assert.deepEqual(await readSnapshot(worker, secondSession), { revision: 1, ciphertext });
  assert.equal((await writeSnapshot(worker, secondSession, 1, nextCiphertext, { proof:snapshotProof(session, 1, null, nextCiphertext) })).status, 403);
  assert.equal((await request(worker, '/account/snapshot/previous', { token:session.token })).status, 404);
  const concurrent = await Promise.all([session, secondSession].map(deviceSession =>
    writeSnapshot(worker, deviceSession, 1, nextCiphertext),
  ));
  assert.deepEqual(concurrent.map(response => response.status).sort(), [200, 409]);
  assert.deepEqual(await concurrent.find(response => response.status === 409).json(), { error: 'revision-conflict', revision: 2 });
  assert.deepEqual(await readSnapshot(worker, secondSession), { revision: 2, ciphertext: nextCiphertext });
  const previousPath = '/account/snapshot/previous';
  const prior = { revision:1, ciphertext };
  assert.deepEqual(await (await request(worker, previousPath, { token:session.token })).json(), prior);
  const restoredCiphertext = 'D'.repeat(64);
  assert.equal((await writeSnapshot(worker, session, 2, restoredCiphertext, {
    restore:1, proof:snapshotProof(session, 2, null, restoredCiphertext),
  })).status, 403);
  assert.deepEqual(await (await writeSnapshot(worker, session, 2, restoredCiphertext, { restore:1 })).json(), { revision:3 });
  assert.equal((await writeSnapshot(worker, session, 2, restoredCiphertext, { restore:1 })).status, 409);
  assert.deepEqual(await readSnapshot(worker, session), { revision:3, ciphertext:restoredCiphertext });
  assert.deepEqual(await (await request(worker, previousPath, { token:session.token })).json(), prior, 'restore retains the last readable backup');

  const third = await createDevice(browser, worker);
  const { session: other } = await registerWithEmail(worker, third, mail, 'third@example.test');
  assert.notEqual(other.account, session.account);
  assert.deepEqual(await readSnapshot(worker, other), { revision: 0, ciphertext: null });
  assert.equal((await request(worker, previousPath, { token:other.token })).status, 404);
  assert.equal((await request(worker, '/account', { method: 'DELETE', token: session.token, body: registrationProof })).status, 401);

  await db.prepare("UPDATE account_email_sends SET expires_at = 0 WHERE kind = 'register'").run();
  const ownerEmail = 'first@example.test';
  assert.equal((await request(worker, '/account/email/register/start', { method: 'POST', body: { email: ownerEmail } })).status, 200);
  const scoped = await (await request(worker, '/account/register/options', {
    method: 'POST', body: { email: ownerEmail, code: emailCode(mail.at(-1)), flow: 'continue' },
  })).json();
  assert.equal(scoped.mode, 'login');
  const signInWithWrongKey = await request(worker, '/account/login/verify', {
    method: 'POST', body: { ceremony: scoped.ceremony, credential: await third.getCredential(scoped.options) },
  });
  assert.equal(signInWithWrongKey.status, 401);

  const forOwner = await request(worker, '/account/delete/options', { method: 'POST', token: session.token });
  assert.equal(forOwner.status, 200);
  const wrongPasskey = await forOwner.json();
  const wrongProof = {
    ceremony: wrongPasskey.ceremony,
    credential: await third.getCredential({ ...wrongPasskey.options, allowCredentials: [] }),
  };
  const rejected = await request(worker, '/account', { method: 'DELETE', token: session.token, body: wrongProof });
  assert.equal(rejected.status, 401);
  assert.deepEqual(await rejected.json(), { error: 'invalid-credential' });

  const deletionProof = await second.verifyForDeletion(session);
  const deletion = token => request(worker, '/account', { method: 'DELETE', token, body: deletionProof });
  assert.equal((await deletion(secondSession.token)).status, 401);
  assert.equal((await deletion(other.token)).status, 401);
  assert.equal((await deletion(session.token)).status, 204);
  assert.equal((await deletion(session.token)).status, 401);
  assert.equal((await request(worker, '/account/snapshot', { token: secondSession.token })).status, 401);
  assert.equal(await db.prepare('SELECT id FROM accounts WHERE id = ?').bind(session.account).first(), null);
  assert.equal(await db.prepare('SELECT account_id FROM passkeys WHERE account_id = ?').bind(session.account).first(), null);
  assert.equal(await db.prepare('SELECT account_id FROM snapshots WHERE account_id = ?').bind(session.account).first(), null);
  assert.equal(await db.prepare('SELECT account_id FROM account_snapshot_history WHERE account_id = ?').bind(session.account).first(), null);
  assert.equal((await request(worker, previousPath, { token:secondSession.token })).status, 401);
  assert.equal(await db.prepare('SELECT credential_id FROM account_key_envelopes WHERE credential_id = ?').bind(registrationProof.credential.id).first(), null);
  assert.deepEqual(await readSnapshot(worker, other), { revision: 0, ciphertext: null });
  assert.equal((await request(worker, '/account/session', { method: 'DELETE', token: other.token })).status, 204);
  assert.equal((await request(worker, '/account/snapshot', { token: other.token })).status, 401);
});

test('Reader settings verify account email, connect two devices, resolve edits, and delete the account', { timeout: 45_000 }, async t => {
  const mail = [];
  const diagnostics = [];
  const worker = createWorker(t, { database: true, limit: 100, mail });
  const db = await applySchema(worker, '0002_recovery_email.sql', '0003_devices.sql', '0004_email_code_attempts.sql', '0006_passkey_key_envelopes.sql');
  const sessionKey = 'HNewhere:account_sync';
  const notesKey = 'HNewhere:notes:url:example.com/private';
  const indexKey = 'HNewhere:notes_index';
  const url = 'https://example.com/private';
  const note = { id: 'fixture-a', text: 'Local note body', exact: 'Private quoted words', prefix:'before', suffix:'after', created: 10 };
  const index = { key: notesKey, kind:'url', id:'example.com/private', url, title:'Private page', count:1, updated:10000 };
  const ready = async (mobile = false) => {
    const app = await launchApp({
      engine: 'chromium', sharedStore: true, settings: mobile ? {} : { theme:'dark' },
      ...(mobile ? { viewport:{width:390,height:844}, hasTouch:true } : { values:{[notesKey]: {version:1,notes:[note]}, [indexKey]:[index]} }),
    });
    t.after(() => app.browser.close());
    await app.context.route('https://backchnnl.app/account**', async route => {
      const request = route.request();
      const {pathname} = new URL(request.url());
      if (pathname === '/account/diagnostics') {
        diagnostics.push({body:request.postDataJSON(), authorization:request.headers().authorization});
        return route.fulfill({status:204});
      }
      if (pathname.endsWith('/verify')) {
        const { credential, assertion } = request.postDataJSON() ?? {};
        for (const proof of [credential, assertion]) {
          assert(!Object.hasOwn(proof?.clientExtensionResults ?? {}, 'prf'));
        }
      }
      if (['/account/register/verify', '/account/register/options'].includes(pathname)) await new Promise(resolve => setTimeout(resolve,400));
      const response = await worker.dispatchFetch(request.url(), {
        method:request.method(), body:request.postDataBuffer() ?? undefined,
        headers:await request.allHeaders(), redirect:'manual',
      });
      await route.fulfill({status:response.status, headers:Object.fromEntries(response.headers), body:Buffer.from(await response.arrayBuffer())});
    });
    const devtools = await app.context.newCDPSession(app.page);
    await devtools.send('WebAuthn.enable');
    const { authenticatorId } = await devtools.send('WebAuthn.addVirtualAuthenticator', {
      options:{
        protocol:'ctap2', transport:'internal', hasResidentKey:true, hasUserVerification:true,
        isUserVerified:true, automaticPresenceSimulation:true,
        ctap2Version:'ctap2_1', hasPrf:true,
      },
    });
    await app.page.goto('https://backchnnl.app/#account-sync');
    const panel = app.page.locator('#settings-account-sync');
    await panel.waitFor();
    const button = name => panel.getByRole('button',{name,exact:true});
    const syncButton = name => button(name).click();
    return { ...app, devtools, authenticatorId, panel, syncButton,
      key:panel.getByLabel('Recovery key',{exact:true}), status:panel.getByRole('status'),
      async revision(expected) {
        const reached = await waitFor(() => app.store.get(sessionKey)?.revision === expected, 8000);
        if (!reached) assert.fail('expected revision ' + expected + ', status ' + await panel.locator('#account-status').textContent());
      },
    };
  };

  const first = await ready();
  const checkSignupStep = async (id, name) => {
    const step = first.panel.locator('#account-' + id);
    await step.getByRole('heading', {name,exact:true}).waitFor();
    const geometry = await step.evaluate(section => {
      const back = section.querySelector('.account-back');
      const heading = section.querySelector('h3').getBoundingClientRect();
      const arrow = back.getBoundingClientRect();
      return {
        text:back.textContent.trim(),
        radius:parseFloat(getComputedStyle(back).borderTopLeftRadius),
        circle:Math.abs(arrow.width - arrow.height) < .5,
        gap:heading.left - arrow.right,
        alignment:Math.abs(heading.y + heading.height / 2 - arrow.y - arrow.height / 2),
        heights:[...section.querySelectorAll('.settings-button--wide')].map(button => button.getBoundingClientRect().height),
        standard:parseFloat(getComputedStyle(section.getRootNode().getElementById('settings-update-check')).height),
      };
    });
    assert.equal(geometry.text,'');
    assert(geometry.circle && geometry.radius > 10 && geometry.gap >= 0 && geometry.gap <= 10 && geometry.alignment < 1, JSON.stringify(geometry));
    assert(geometry.heights.length && geometry.heights.every(height => Math.abs(height - geometry.standard) < .5), JSON.stringify(geometry));
  };
  await first.page.evaluate(() => {
    const get = navigator.credentials.get.bind(navigator.credentials);
    navigator.credentials.get = async options => {
      const credential = await get(options);
      const output = credential.getClientExtensionResults().prf?.results?.first;
      if (output) window.testPasskeyPRF = [...new Uint8Array(output)];
      return credential;
    };
  });
  let readerEmail = 'reader@example.test';
  const signInByEmail = async app => {
    const sent = mail.length;
    await db.prepare("UPDATE account_email_sends SET expires_at = 0, window_expires_at = 0 WHERE kind = 'register'").run();
    await app.panel.locator('#account-entry-email').fill(readerEmail);
    await app.syncButton('Continue');
    assert(await waitFor(() => mail.length === sent + 1));
    await app.page.getByLabel('Verification code', {exact:true}).fill(emailCode(mail.at(-1)));
    await app.syncButton('Verify email');
  };
  await first.panel.locator('#account-entry-email').fill('reader@example.test');
  await first.syncButton('Continue');
  assert(await waitFor(() => mail.length === 1));
  const code = emailCode(mail[0]);
  assert.match(code, /^[0-9]{6}$/);
  assert.match(mail[0].html, /Backchannel/);
  assert(mail[0].html.includes(code));
  await checkSignupStep('code-screen','Check your email');
  await first.page.getByLabel('Verification code', {exact:true}).fill(code);
  await first.syncButton('Verify email');
  const verifying = first.panel.getByRole('button',{name:'Verifying email…',exact:true});
  await verifying.waitFor();
  assert.equal(await verifying.locator('span').evaluate(el => getComputedStyle(el).animationName),'settings-update-glimmer');
  await checkSignupStep('passkey-register','Create a passkey');
  assert(await first.panel.getByText('Create and confirm a passkey to secure your account.',{exact:true}).isVisible());
  assert.equal(await first.panel.getByRole('heading',{name:'Create your birb'}).isVisible(), false);
  await first.syncButton('Create passkey');
  const creating = first.panel.getByRole('button',{name:'Creating passkey…',exact:true});
  await creating.waitFor();
  assert.equal(await creating.locator('span').evaluate(el => getComputedStyle(el).animationName),'settings-update-glimmer');
  await checkSignupStep('signup-birb','Create your birb');
  assert(await first.panel.locator('#account-profile-avatar').getAttribute('data-birb-shape'));
  await first.panel.getByRole('radio', {name:'Long bill',exact:true}).check();
  await first.panel.getByRole('radio', {name:'Plum',exact:true}).check();
  await first.panel.getByRole('radio', {name:'Lilac',exact:true}).check();
  await first.syncButton('Continue');
  const diagnosticsHeading = first.panel.getByRole('heading',{name:'Help improve Backchannel',exact:true});
  await checkSignupStep('signup-diagnostics','Help improve Backchannel');
  assert(await first.panel.getByText('You can help improve Backchannel by sharing anonymized diagnostics. These details help us develop new features and improve functionality for everyone. You can change your choice any time in Settings → Account → Manage account → Privacy',{exact:true}).isVisible());
  assert.equal(first.store.get('HNewhere:share_diagnostics'),undefined);
  await first.syncButton('Don’t share');
  await checkSignupStep('key-setup','Save your recovery key');
  await first.syncButton('Back');
  await diagnosticsHeading.waitFor();
  await first.syncButton('Share diagnostics');
  await first.panel.getByRole('heading', {name:'Save your recovery key'}).waitFor();
  assert.equal(await first.panel.locator('#account-profile-name').textContent(),'Create your account');
  await first.panel.getByRole('button',{name:'Sync now',exact:true}).waitFor({state:'hidden'});
  assert(await first.panel.locator('#account-profile').isVisible());
  assert.equal(await db.prepare('SELECT COUNT(*) AS count FROM accounts').first('count'),0);
  assert.equal(await db.prepare('SELECT COUNT(*) AS count FROM account_signups').first('count'),1);
  assert.equal(await db.prepare('SELECT COUNT(*) AS count FROM snapshots').first('count'),0);
  assert.equal(first.store.get('HNewhere:share_diagnostics'),undefined);
  assert.deepEqual(diagnostics,[]);
  const recovery = await first.panel.locator('#account-recovery-code').innerText();
  assert.match(recovery,/^[A-Za-z0-9_-]{43}$/);
  const recoveryStep = first.panel.locator('#account-key-setup');
  assert.equal(await recoveryStep.getByRole('button',{name:'Copy',exact:true}).count(),0);
  assert(await recoveryStep.getByText('Keep this key somewhere safe. It unlocks your account if you lose access to your passkey.',{exact:true}).isVisible());
  const recoverySave = recoveryStep.getByRole('button',{name:'Save',exact:true});
  assert(await recoverySave.evaluate(button => {
    const key = button.getRootNode().getElementById('account-recovery-code');
    const code = key.getBoundingClientRect(), save = button.getBoundingClientRect();
    return Math.abs(code.right - save.right) < 1 && save.top >= code.bottom && parseFloat(getComputedStyle(key).paddingTop) < 14;
  }));
  assert.equal(await recoverySave.evaluate(el => getComputedStyle(el).textDecorationStyle),'dotted');
  await first.page.evaluate(() => {
    const printDocument = document.implementation.createHTMLDocument();
    window.open = () => ({document:printDocument, addEventListener() {}, print() { window.printedKey = printDocument.querySelector('code').textContent; }});
  });
  await recoverySave.click();
  assert.equal(await first.page.evaluate(() => window.printedKey),recovery);
  await first.syncButton('Finish sign up');
  await first.revision(1);
  assert(await waitFor(() => diagnostics.some(({body}) => body.operation === 'account-sync')));
  assert(diagnostics.every(({body,authorization}) => !authorization && Object.keys(body).sort().join(',') === 'duration,operation,outcome,source,version'));
  await first.syncButton('Manage account');
  const managePrivacy = first.panel.getByRole('region',{name:'Privacy',exact:true});
  await managePrivacy.waitFor({timeout:3000});
  const manageSharing = managePrivacy.getByRole('checkbox',{name:'Share diagnostics',exact:true});
  assert(await waitFor(() => manageSharing.isChecked()));
  await manageSharing.uncheck();
  assert(await waitFor(() => first.store.get('HNewhere:share_diagnostics') === 0));
  await first.page.locator('[data-settings-section="general"]').click();
  const shareDiagnostics = first.page.locator('#settings-privacy').getByRole('checkbox',{name:'Share diagnostics',exact:true});
  assert.equal(await shareDiagnostics.count(),0);
  await first.page.getByRole('button',{name:'Account',exact:true}).click();
  await first.syncButton('Manage account');
  assert.equal(await manageSharing.isChecked(),false);
  await manageSharing.check();
  assert(await waitFor(() => first.store.get('HNewhere:share_diagnostics') > 0));
  await manageSharing.uncheck();
  assert(await waitFor(() => first.store.get('HNewhere:share_diagnostics') === 0));
  await first.syncButton('Back');
  await first.panel.locator('#account-email-value').filter({hasText:'reader@example.test'}).waitFor();
  assert.equal(await first.panel.locator('#account-profile-avatar').getAttribute('data-birb-shape'),'long-bill');
  assert.equal(await first.panel.getByRole('heading',{name:'Save your recovery key'}).isVisible(),false);
  const encrypted = (await db.prepare('SELECT ciphertext FROM snapshots').first()).ciphertext;
  assert(!encrypted.includes('Private quoted words') && !encrypted.includes(recovery));
  const wrappedKey = await db.prepare('SELECT envelope FROM account_key_envelopes').first('envelope');
  assert.match(wrappedKey, /^[A-Za-z0-9_-]{80}$/);
  assert(!wrappedKey.includes(recovery));
  readerEmail = 'updated-reader@example.test';
  const beforeChange = mail.length;
  await first.syncButton('Manage account');
  const manageAddress = first.panel.locator('#account-manage-page').getByLabel('Email address',{exact:true});
  await manageAddress.fill(readerEmail);
  await first.syncButton('Update');
  assert(await waitFor(() => mail.length === beforeChange + 1));
  assert.equal(mail.at(-1).to, readerEmail);
  await first.page.getByLabel('Verification code',{exact:true}).fill(emailCode(mail.at(-1)));
  await first.syncButton('Verify email');
  await first.page.locator('#toast.is-showing').filter({hasText:'Email updated.'}).waitFor();
  assert.equal(await manageAddress.getAttribute('placeholder'),readerEmail);
  assert.equal(await manageAddress.inputValue(),'');
  await first.syncButton('Back');
  const testPasskeyPRF = await first.page.evaluate(() => window.testPasskeyPRF);
  assert.equal(testPasskeyPRF.length,32);
  await first.syncButton('Sign out');
  await first.panel.locator('#account-login').waitFor();
  const checkpoint = 'HNewhere:account_sync_checkpoint';
  assert.equal(first.store.get(checkpoint)?.recoveryKey,undefined);
  await first.page.evaluate(() => {
    const get = navigator.credentials.get.bind(navigator.credentials);
    navigator.credentials.get = options => {
      navigator.credentials.get = get;
      const { prf, ...extensions } = options.publicKey.extensions;
      return get({...options, publicKey:{...options.publicKey, extensions}});
    };
  });
  await signInByEmail(first);
  await first.status.filter({hasText:'passkey provider can’t unlock sync'}).waitFor();
  assert.equal(first.store.get(sessionKey),undefined);
  assert.equal(await first.key.isVisible(), false);
  first.store.delete(checkpoint);
  first.store.delete(notesKey);
  first.store.delete(indexKey);
  await first.syncButton('Sign in with passkey');
  await first.revision(1);
  assert.equal(await first.key.isVisible(), false);
  assert.equal(first.store.get(notesKey).notes[0].exact, note.exact);
  const { credentials } = await first.devtools.send('WebAuthn.getCredentials', {authenticatorId:first.authenticatorId});

  const phone = await ready(true);
  await phone.devtools.send('WebAuthn.addCredential',{authenticatorId:phone.authenticatorId,credential:credentials[0]});
  const sharedCredentialId = Buffer.from(credentials[0].credentialId,'base64').toString('base64url');
  await phone.page.evaluate(({id, seed}) => {
    // CDP can import the credential, but does not export its PRF secret.
    const get = navigator.credentials.get.bind(navigator.credentials);
    navigator.credentials.get = async options => {
      if (window.cancelNextPasskey) {
        window.cancelNextPasskey = false;
        throw new DOMException('Cancelled in fixture','NotAllowedError');
      }
      const credential = await get(options);
      if (credential.id === id && options.publicKey.extensions?.prf) {
        Object.defineProperty(credential,'getClientExtensionResults',{
          value: () => ({prf:{results:{first:Uint8Array.from(seed).buffer}}}),
        });
      }
      return credential;
    };
  }, {id:sharedCredentialId,seed:testPasskeyPRF});
  await signInByEmail(phone);
  await phone.panel.locator('#account-signed-in').waitFor({timeout:3000});
  assert.equal(await phone.key.isVisible(), false);
  await phone.revision(1);
  assert.equal(phone.store.get('HNewhere:settings').theme,'dark');
  assert.equal(phone.store.get(notesKey).notes[0].exact, note.exact);
  await phone.panel.getByRole('button',{name:'Sync now',exact:true}).waitFor();
  assert.equal(await phone.panel.locator('#account-profile-avatar').getAttribute('data-birb-shape'),'long-bill');
  assert(await waitFor(() => phone.panel.locator('#account-device-list li').count().then(count => count === 2)));
  assert.equal(await phone.panel.locator('#account-device-list li').filter({hasText:'This device'}).count(),1);
  await phone.panel.locator('#account-last-sync time[datetime]').waitFor();

  first.store.set('HNewhere:settings', {...first.store.get('HNewhere:settings'), theme:'light'});
  first.store.set(notesKey,{version:1,notes:[{...note,text:'Edited on the first device',edited:20}]});
  phone.store.set('HNewhere:settings', {...phone.store.get('HNewhere:settings'), theme:'auto'});
  phone.store.set(notesKey,{version:1,notes:[note,{id:'fixture-b',text:'Added on the phone',created:30}]});
  await first.syncButton('Sync now');
  await first.revision(2);
  await phone.syncButton('Sync now');
  await phone.status.filter({hasText:'conflicting changes'}).waitFor();
  assert.equal(phone.store.get('HNewhere:settings').theme,'auto');
  assert.equal((await db.prepare('SELECT revision FROM snapshots').first()).revision,2);
  await phone.syncButton('Keep account changes');
  await phone.revision(3);
  assert.equal(phone.store.get('HNewhere:settings').theme,'light');
  assert.deepEqual(phone.store.get(notesKey).notes.map(n=>n.text),['Edited on the first device','Added on the phone']);

  await phone.syncButton('Sign out');
  await phone.page.locator('#toast.is-showing[data-kind="system"]').filter({hasText:'Signed out.'}).waitFor();
  assert(!await phone.panel.locator('#account-status').textContent());
  assert.equal(phone.store.get(sessionKey),undefined);
  assert.equal(phone.store.get(notesKey).notes.length,2);

  await first.syncButton('Sync now');
  await first.revision(3);
  first.store.set(notesKey,{version:1,notes:first.store.get(notesKey).notes.filter(n=>n.id==='fixture-b')});
  await first.syncButton('Sync now');
  await first.revision(4);

  await phone.syncButton('Sign in with passkey');
  await phone.revision(4);
  assert.equal(await phone.key.isVisible(), false);
  assert.deepEqual(phone.store.get(notesKey).notes.map(n=>n.id),['fixture-b']);
  const avatarKey = 'HNewhere:account_avatar:' + phone.store.get(sessionKey).account;
  phone.store.set(avatarKey,{shape:'long-bill',color:'plum',background:'lilac'});
  await phone.page.getByRole('button',{name:'General',exact:true}).click();
  await phone.page.getByRole('button',{name:'Account',exact:true}).click();
  const navAvatar = phone.page.locator('#account-nav-avatar');
  assert(await waitFor(async () => await navAvatar.getAttribute('data-birb-shape') === 'long-bill'));
  const snapshotBeforeRecovery = await db.prepare('SELECT ciphertext FROM snapshots').first('ciphertext');
  await phone.syncButton('Sign out');
  await phone.page.evaluate(() => { window.cancelNextPasskey = true; });
  await signInByEmail(phone);
  await phone.syncButton('Can’t use your passkey?');
  await phone.key.fill('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
  await phone.syncButton('Continue');
  await phone.status.filter({hasText:'That recovery key is incorrect'}).waitFor();
  assert.equal(await db.prepare('SELECT id FROM passkeys').first('id'),sharedCredentialId);
  assert.equal(await db.prepare('SELECT ciphertext FROM snapshots').first('ciphertext'),snapshotBeforeRecovery);
  assert.equal(phone.store.get(sessionKey),undefined);
  await phone.key.fill(recovery);
  await phone.syncButton('Continue');
  await phone.syncButton('Replace passkey');
  await phone.revision(4);
  assert(mail.every(message => !message.text.includes(recovery) && !message.html?.includes(recovery)));
  assert.equal(await db.prepare('SELECT ciphertext FROM snapshots').first('ciphertext'),snapshotBeforeRecovery);
  const retained = await db.prepare('SELECT revision, ciphertext FROM account_snapshot_history').first();
  assert.equal(retained.revision,3);
  const editedNote = { ...phone.store.get(notesKey).notes[0], text:'Local edit survives snapshot recovery', edited:40 };
  phone.store.set(notesKey, { version:1, notes:[editedNote] });
  const unreadable = 'A'.repeat(64);
  await db.prepare('UPDATE snapshots SET ciphertext = ?').bind(unreadable).run();
  await phone.syncButton('Sync now');
  const restore = phone.panel.getByRole('button',{name:'Restore previous version',exact:true});
  await restore.waitFor();
  assert.equal(await db.prepare('SELECT ciphertext FROM snapshots').first('ciphertext'),unreadable, 'Reader waits for confirmation before restoring');
  await restore.click();
  await phone.revision(5);
  await phone.page.locator('#toast.is-showing').filter({hasText:'Previous version restored.'}).waitFor();
  const restoredNotes = phone.store.get(notesKey).notes;
  assert.equal(restoredNotes.find(item => item.id === editedNote.id).text,editedNote.text);
  assert(restoredNotes.some(item => item.id === note.id), 'items from the previous revision can be recovered');
  assert.deepEqual(await db.prepare('SELECT revision, ciphertext FROM account_snapshot_history').first(),retained);
  const replacementId = await db.prepare('SELECT id FROM passkeys').first('id');
  assert.notEqual(replacementId,sharedCredentialId);
  const actualCredentials = await phone.devtools.send('WebAuthn.getCredentials', {authenticatorId:phone.authenticatorId});
  assert.deepEqual(actualCredentials.credentials.map(credential => Buffer.from(credential.credentialId, 'base64').toString('base64url')), [replacementId]);
  await phone.page.evaluate(() => {
    window.deletedPasskeys = [];
    Object.defineProperty(PublicKeyCredential, 'signalAllAcceptedCredentials', {value: async value => window.deletedPasskeys.push(value)});
  });
  const deletedAccount = phone.store.get(sessionKey).account;
  await phone.syncButton('Delete account…');
  await phone.syncButton('Delete account');
  await phone.panel.locator('#account-entry-email').waitFor();
  assert.deepEqual(await phone.page.evaluate(() => window.deletedPasskeys), [{rpId:'backchnnl.app', userId:Buffer.from(deletedAccount).toString('base64url'), allAcceptedCredentialIds:[]}]);
  assert.equal(await phone.panel.locator('#account-status').textContent(),'');
  assert.equal(await navAvatar.getAttribute('data-birb-shape'),null);
  assert(await navAvatar.evaluate(node=>getComputedStyle(node).backgroundImage.startsWith('url(')));
  assert.equal(phone.store.has(avatarKey),false);
  assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM snapshots').first()).count,0);
  assert.deepEqual(phone.store.get(notesKey).notes,restoredNotes);
  await phone.page.evaluate(() => {
    Object.defineProperty(PublicKeyCredential, 'signalUnknownCredential', {value: async value => window.deletedPasskeys.push(value)});
  });
  await phone.syncButton('Sign in with passkey');
  await phone.status.filter({hasText:'This passkey is no longer linked to Backchannel'}).waitFor();
  assert.deepEqual(await phone.page.evaluate(() => window.deletedPasskeys.at(-1)), {
    rpId:'backchnnl.app', credentialId:replacementId,
  });
  await first.syncButton('Sync now');
  await first.status.filter({hasText:'Sign in with your passkey'}).waitFor();
  assert.deepEqual([...first.errors,...phone.errors],[]);
});
