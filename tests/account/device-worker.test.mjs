import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { convertV4MiniflareOptions, Miniflare } from 'miniflare';
import { handleAccountDevice, matchAccountDeviceRoute } from '../../account/devices.mjs';

const phone = '24e71e25-46c0-42a6-885b-c716f2a535d1';
const desktop = '7a330ce6-ac5c-4c1a-a9bd-2310ca59d3cd';
const auth = tokenHash => ({ account: 'reader', tokenHash });
const helpers = {
  readJSON: (request, limit) => {
    assert.equal(limit, 1024);
    return request.json();
  },
  reply: (body, status = 200) => Response.json(body, { status }),
  fail: (error, status) => Response.json({ error }, { status }),
  noContent: () => new Response(null, { status: 204 }),
};

async function createDB(t) {
  const worker = new Miniflare(convertV4MiniflareOptions({
    modules: true,
    script: 'export default { fetch: () => new Response() };',
    d1Databases: { ACCOUNTS_DB: 'device-test' },
  }));
  t.after(() => worker.dispose());
  const db = await worker.getD1Database('ACCOUNTS_DB');
  async function applyMigration(name) {
    const sql = await readFile(new URL('../../account/migrations/' + name, import.meta.url), 'utf8');
    const statements = sql.split(';').map(statement => statement.trim()).filter(Boolean);
    await db.batch(statements.map(statement => db.prepare(statement)));
  }
  await applyMigration('0001_account.sql');
  await db.batch(['reader', 'other'].map(id => db.prepare('INSERT INTO accounts (id) VALUES (?)').bind(id)));
  await db.prepare('INSERT INTO sessions (token_hash, account_id, expires_at) VALUES (?, ?, ?)')
    .bind('legacy', 'reader', Date.now() + 86_400_000).run();
  await applyMigration('0003_devices.sql');
  return db;
}

async function addSession(db, tokenHash, { account = 'reader', expiry = Date.now() + 86_400_000 } = {}) {
  await db.prepare('INSERT INTO sessions (token_hash, account_id, expires_at) VALUES (?, ?, ?)')
    .bind(tokenHash, account, expiry).run();
}

async function dispatch(db, auth, method, path, body) {
  const request = new Request('https://example.test' + path, {
    method, body: body === undefined ? undefined : JSON.stringify(body),
  });
  return handleAccountDevice(request, db, auth, matchAccountDeviceRoute(method, path), helpers);
}

const link = (db, session, id, name) => dispatch(db, session, 'PUT', '/account/devices/current', { id, name });
const list = (db, session) => dispatch(db, session, 'GET', '/account/devices');
const disconnect = (db, session, id) => dispatch(db, session, 'DELETE', '/account/devices/' + id);

test('legacy sessions can link on demand and keep a stable device id', async t => {
  const db = await createDB(t);
  const session = auth('legacy');
  assert.deepEqual(await (await list(db, session)).json(), { devices: [] });
  const before = Date.now();
  assert.equal((await link(db, session, phone.toUpperCase(), ' Safari on iPhone ')).status, 204);
  const { devices } = await (await list(db, session)).json();
  assert.deepEqual(devices, [{ id: phone, name: 'Safari on iPhone', current: true, lastSeenAt: devices[0].lastSeenAt }]);
  assert(devices[0].lastSeenAt >= before && devices[0].lastSeenAt <= Date.now());
  const conflict = await link(db, session, desktop, 'Firefox on Windows');
  assert.equal(conflict.status, 409);
  assert.deepEqual(await conflict.json(), { error: 'device-already-linked' });
});

test('device touches avoid repeat metadata writes but refresh stale activity and changed labels', async t => {
  const db = await createDB(t);
  const session = auth('legacy');
  const now = Date.now();
  const setSeen = value => db.prepare('UPDATE sessions SET device_seen_at = ? WHERE token_hash = ?').bind(value, 'legacy').run();
  const getSeen = async () => (await (await list(db, session)).json()).devices[0].lastSeenAt;
  assert.equal((await link(db, session, phone, 'Safari on iPhone')).status, 204);
  await setSeen(now - 60_000);
  assert.equal((await link(db, session, phone, 'Safari on iPhone')).status, 204);
  assert.equal(await getSeen(), now - 60_000);
  await setSeen(now - 3_600_000);
  assert.equal((await link(db, session, phone, 'Safari on iPhone')).status, 204);
  assert((await getSeen()) >= now);
  await setSeen(now - 60_000);
  assert.equal((await link(db, session, phone, 'Firefox on iPhone')).status, 204);
  assert((await getSeen()) >= now);
});

test('reauthentication groups a device, and disconnect scopes revocation to that account and device', async t => {
  const db = await createDB(t);
  await addSession(db, 'desktop');
  await addSession(db, 'phone-reauth');
  await addSession(db, 'other-phone', { account: 'other' });
  await link(db, auth('legacy'), phone, 'Safari on iPhone');
  await link(db, auth('phone-reauth'), phone, 'Safari on iPhone');
  await link(db, auth('desktop'), desktop, 'Firefox on Windows');
  await link(db, { account: 'other', tokenHash: 'other-phone' }, phone, 'Safari on iPhone');
  const { devices } = await (await list(db, auth('desktop'))).json();
  assert.deepEqual(devices.map(({ id, current }) => ({ id, current })), [{ id: desktop, current: true }, { id: phone, current: false }]);
  const rejected = await disconnect(db, auth('desktop'), desktop);
  assert.equal(rejected.status, 409);
  assert.deepEqual(await rejected.json(), { error: 'cannot-disconnect-current-device' });
  assert.equal((await disconnect(db, auth('desktop'), phone)).status, 204);
  assert.equal((await disconnect(db, auth('desktop'), phone)).status, 404);
  assert.equal((await list(db, auth('legacy'))).status, 401);
  assert.equal((await list(db, auth('phone-reauth'))).status, 401);
  assert.equal((await list(db, { account: 'other', tokenHash: 'other-phone' })).status, 200);
  assert.deepEqual((await (await list(db, auth('desktop'))).json()).devices.map(({ id }) => id), [desktop]);
});

test('invalid data and expired sessions cannot mutate devices', async t => {
  const db = await createDB(t);
  const session = auth('legacy');
  assert.equal((await link(db, session, 'a private client value', 'Safari on iPhone')).status, 400);
  assert.equal((await link(db, session, phone, 'Safari\non iPhone')).status, 400);
  assert.equal((await disconnect(db, session, phone)).status, 409);
  await db.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?').bind(Date.now() - 1, 'legacy').run();
  assert.equal((await list(db, session)).status, 401);
  assert.equal((await link(db, session, phone, 'Safari on iPhone')).status, 401);
  assert.equal((await disconnect(db, session, phone)).status, 401);
});
