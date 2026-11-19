const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const activityInterval = 5 * 60 * 1000;

export function matchAccountDeviceRoute(method, pathname) {
  if (method === 'GET' && pathname === '/account/devices') return { action: 'list' };
  if (method === 'PUT' && pathname === '/account/devices/current') return { action: 'link' };
  const target = method === 'DELETE' && /^\/account\/devices\/([^/]+)$/.exec(pathname);
  return target ? { action: 'disconnect', id: target[1] } : null;
}

async function readDeviceSession(db, { account, tokenHash }) {
  return db.prepare(`
    SELECT device_id FROM sessions WHERE token_hash = ? AND account_id = ? AND expires_at > ?
  `).bind(tokenHash, account, Date.now()).first();
}

async function linkDevice(request, db, auth, { readJSON, fail, noContent }) {
  const body = await readJSON(request, 1024);
  if (typeof body?.id !== 'string' || !uuid.test(body.id)) return fail('invalid-device', 400);
  const id = body.id.toLowerCase();
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > 64 || /[\p{C}\p{Zl}\p{Zp}]/u.test(name)) return fail('invalid-device', 400);

  const now = Date.now();
  const linked = await db.prepare(`
    UPDATE sessions SET device_id = ?, device_name = ?, device_seen_at = ?
    WHERE token_hash = ? AND account_id = ? AND expires_at > ?
      AND (device_id IS NULL OR device_id = ?)
      AND (device_id IS NULL OR device_name IS NOT ? OR device_seen_at IS NULL OR device_seen_at <= ?)
  `).bind(id, name, now, auth.tokenHash, auth.account, now, id, name, now - activityInterval).run();
  if (linked.meta.changes) return noContent();

  const session = await readDeviceSession(db, auth);
  if (!session) return fail('sign-in-required', 401);
  if (session.device_id !== id) return fail('device-already-linked', 409);
  return noContent();
}

async function listDevices(db, { account, tokenHash }, { reply, fail }) {
  const now = Date.now();
  // A fresh passkey sign-in can leave several live sessions for one browser.
  const { results } = await db.prepare(`
    WITH current_session AS (
      SELECT account_id, device_id FROM sessions
      WHERE token_hash = ? AND account_id = ? AND expires_at > ?
    ), account_devices AS (
      SELECT sessions.device_id, device_name, device_seen_at,
        ROW_NUMBER() OVER (
          PARTITION BY sessions.device_id ORDER BY device_seen_at DESC, token_hash
        ) AS position
      FROM sessions JOIN current_session ON sessions.account_id = current_session.account_id
      WHERE sessions.expires_at > ? AND sessions.device_id IS NOT NULL
    )
    SELECT d.device_id AS id, d.device_name AS name, d.device_seen_at AS lastSeenAt,
      d.device_id = current_session.device_id AS current
    FROM current_session LEFT JOIN account_devices AS d ON d.position = 1
    ORDER BY current DESC, lastSeenAt DESC, id
  `).bind(tokenHash, account, now, now).all();
  if (!results.length) return fail('sign-in-required', 401);
  const devices = results[0].id === null ? [] : results.map(({ id, name, current, lastSeenAt }) => ({
    id, name, current: Boolean(current), lastSeenAt,
  }));
  return reply({ devices });
}

async function disconnectDevice(db, auth, targetId, { fail, noContent }) {
  if (!uuid.test(targetId)) return fail('invalid-device', 400);
  const id = targetId.toLowerCase();
  const now = Date.now();
  const removed = await db.prepare(`
    DELETE FROM sessions WHERE account_id = ? AND device_id = ? AND expires_at > ?
      AND EXISTS (
        SELECT 1 FROM sessions WHERE token_hash = ? AND account_id = ? AND expires_at > ? AND device_id != ?
      )
  `).bind(auth.account, id, now, auth.tokenHash, auth.account, now, id).run();
  if (removed.meta.changes) return noContent();

  const session = await readDeviceSession(db, auth);
  if (!session) return fail('sign-in-required', 401);
  if (!session.device_id) return fail('device-link-required', 409);
  if (session.device_id === id) return fail('cannot-disconnect-current-device', 409);
  return fail('device-not-found', 404);
}

export function handleAccountDevice(request, db, auth, route, helpers) {
  if (route.action === 'link') return linkDevice(request, db, auth, helpers);
  if (route.action === 'list') return listDevices(db, auth, helpers);
  return disconnectDevice(db, auth, route.id, helpers);
}
