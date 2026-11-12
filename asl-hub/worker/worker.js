// ASL-Hub API – Cloudflare Worker + D1
// Speichert den kompletten Hub-Stand (JSON) mit Versionsnummer, verwaltet Benutzerkonten.
// Bindings: DB (D1). Secrets: SESSION_SECRET, ADMIN_USER, ADMIN_PASSWORD (nur für den allerersten Login).
// Variable: ALLOWED_ORIGINS (Komma-getrennt).

const HISTORY_KEEP = 300;          // so viele alte Stände bleiben als Verlauf erhalten
const TOKEN_DAYS = 30;             // Anmeldung bleibt 30 Tage gültig
const PBKDF2_ITER = 20000;         // bewusst moderat (CPU-Limit im kostenlosen Plan)
const MAX_BODY = 2 * 1024 * 1024;  // 2 MB
const LOCK_AFTER = 6, LOCK_MIN = 10;

let schemaReady = false;
async function ensureSchema(db) {
  if (schemaReady) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK (id = 1), v INTEGER NOT NULL, data TEXT, at INTEGER NOT NULL, by TEXT NOT NULL DEFAULT '')`),
    db.prepare(`INSERT OR IGNORE INTO state (id, v, data, at, by) VALUES (1, 0, NULL, 0, '')`),
    db.prepare(`CREATE TABLE IF NOT EXISTS history (v INTEGER PRIMARY KEY, data TEXT NOT NULL, at INTEGER NOT NULL, by TEXT NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE COLLATE NOCASE, role TEXT NOT NULL DEFAULT 'editor', hash TEXT NOT NULL, salt TEXT NOT NULL, iter INTEGER NOT NULL, tv INTEGER NOT NULL DEFAULT 1, disabled INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL, last_login INTEGER)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS fails (name TEXT PRIMARY KEY COLLATE NOCASE, n INTEGER NOT NULL, until INTEGER NOT NULL)`),
  ]);
  schemaReady = true;
}

/* ---------- Hilfen ---------- */
const enc = new TextEncoder();
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0));
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');

async function hashPw(pw, saltHex, iter) {
  const key = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
  const salt = Uint8Array.from(saltHex.match(/../g), h => parseInt(h, 16));
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, key, 256));
}
async function newHash(pw) {
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
  return { salt, iter: PBKDF2_ITER, hash: await hashPw(pw, salt, PBKDF2_ITER) };
}
function safeEq(a, b) {
  if (a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
async function hmacKey(secret) {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
async function makeToken(env, u) {
  const body = b64u(enc.encode(JSON.stringify({ id: u.id, tv: u.tv, exp: Date.now() + TOKEN_DAYS * 864e5 })));
  const sig = b64u(await crypto.subtle.sign('HMAC', await hmacKey(env.SESSION_SECRET), enc.encode(body)));
  return body + '.' + sig;
}
async function readToken(env, tok) {
  if (!tok || !tok.includes('.')) return null;
  const [body, sig] = tok.split('.');
  try {
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(env.SESSION_SECRET), unb64u(sig), enc.encode(body));
    if (!ok) return null;
    const p = JSON.parse(new TextDecoder().decode(unb64u(body)));
    return p.exp > Date.now() ? p : null;
  } catch (e) { return null; }
}
const pubUser = u => ({ id: u.id, name: u.name, role: u.role, disabled: !!u.disabled, created: u.created, lastLogin: u.last_login || null });
const cleanName = s => String(s || '').trim().replace(/\s+/g, ' ').slice(0, 40);
const validPw = s => typeof s === 'string' && s.length >= 8 && s.length <= 200;

class HttpError extends Error { constructor(status, code, msg, extra) { super(msg); this.status = status; this.code = code; this.extra = extra; } }
const fail = (status, code, msg, extra) => { throw new HttpError(status, code, msg, extra); };

async function body(req) {
  const len = +(req.headers.get('content-length') || 0);
  if (len > MAX_BODY) fail(413, 'too_large', 'Zu groß.');
  const t = await req.text();
  if (t.length > MAX_BODY) fail(413, 'too_large', 'Zu groß.');
  try { return JSON.parse(t || '{}'); } catch (e) { fail(400, 'bad_json', 'Ungültige Daten.'); }
}

async function auth(req, env, needAdmin) {
  const h = req.headers.get('authorization') || '';
  const p = await readToken(env, h.startsWith('Bearer ') ? h.slice(7) : '');
  if (!p) fail(401, 'unauthorized', 'Bitte anmelden.');
  const u = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(p.id).first();
  if (!u || u.disabled || u.tv !== p.tv) fail(401, 'unauthorized', 'Bitte neu anmelden.');
  if (needAdmin && u.role !== 'admin') fail(403, 'forbidden', 'Nur für Admins.');
  return u;
}

function validState(s) {
  return s && typeof s === 'object' && !Array.isArray(s) && Array.isArray(s.tournaments);
}

/* ---------- Routen ---------- */
async function route(req, env, url) {
  const db = env.DB;
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const m = req.method;

  if (path === '/' && m === 'GET') return { ok: true, service: 'asl-hub-api' };

  // Stand lesen (öffentlich). ?v=N → nur Versionsinfo, wenn unverändert.
  if (path === '/state' && m === 'GET') {
    const known = url.searchParams.has('v') ? +url.searchParams.get('v') : -1;
    const r = await db.prepare('SELECT v, at, by, CASE WHEN v = ? THEN NULL ELSE data END AS data FROM state WHERE id = 1').bind(known).first();
    if (r.v === known) return { v: r.v, at: r.at, by: r.by, same: true };
    return { v: r.v, at: r.at, by: r.by, state: r.data ? JSON.parse(r.data) : null };
  }

  // Stand speichern (Bearbeiter). base = Version, auf der die Änderung beruht.
  if (path === '/state' && m === 'PUT') {
    const u = await auth(req, env);
    const b = await body(req);
    if (!Number.isInteger(b.base) || !validState(b.state)) fail(400, 'bad_state', 'Ungültiger Stand.');
    const json = JSON.stringify(b.state), now = Date.now();
    const r = await db.prepare('UPDATE state SET v = v + 1, data = ?, at = ?, by = ? WHERE id = 1 AND v = ?').bind(json, now, u.name, b.base).run();
    if (!r.meta.changes) {
      const cur = await db.prepare('SELECT v, at, by, data FROM state WHERE id = 1').first();
      fail(409, 'conflict', 'Jemand anderes hat zwischendurch gespeichert.', { v: cur.v, at: cur.at, by: cur.by, state: cur.data ? JSON.parse(cur.data) : null });
    }
    const v = b.base + 1;
    await db.batch([
      db.prepare('INSERT OR REPLACE INTO history (v, data, at, by) VALUES (?, ?, ?, ?)').bind(v, json, now, u.name),
      db.prepare('DELETE FROM history WHERE v <= ?').bind(v - HISTORY_KEEP),
    ]);
    return { v, at: now, by: u.name };
  }

  if (path === '/login' && m === 'POST') {
    const b = await body(req);
    const name = cleanName(b.name), pw = String(b.password || '');
    if (!name || !pw) fail(400, 'missing', 'Name und Passwort eingeben.');
    const now = Date.now();
    const lock = await db.prepare('SELECT n, until FROM fails WHERE name = ?').bind(name).first();
    if (lock && lock.until > now) fail(429, 'locked', `Zu viele Fehlversuche. Bitte in ${Math.ceil((lock.until - now) / 60000)} Min. erneut versuchen.`);

    let u = await db.prepare('SELECT * FROM users WHERE name = ?').bind(name).first();
    // Allererster Login: noch keine Benutzer → Admin aus den Secrets anlegen
    if (!u) {
      const cnt = await db.prepare('SELECT COUNT(*) AS c FROM users').first();
      if (!cnt.c && env.ADMIN_USER && env.ADMIN_PASSWORD
          && name.toLowerCase() === cleanName(env.ADMIN_USER).toLowerCase() && safeEq(pw, env.ADMIN_PASSWORD)) {
        const h = await newHash(pw);
        await db.prepare('INSERT INTO users (name, role, hash, salt, iter, created) VALUES (?, ?, ?, ?, ?, ?)').bind(cleanName(env.ADMIN_USER), 'admin', h.hash, h.salt, h.iter, now).run();
        u = await db.prepare('SELECT * FROM users WHERE name = ?').bind(name).first();
      }
    }
    const pwOk = !!u && safeEq(await hashPw(pw, u.salt, u.iter), u.hash);
    if (pwOk && u.disabled) fail(403, 'disabled', 'Dieses Konto ist gesperrt.');
    if (!pwOk) {
      const n = (lock && lock.until > now - 3600e3 ? lock.n : 0) + 1;
      await db.prepare('INSERT OR REPLACE INTO fails (name, n, until) VALUES (?, ?, ?)').bind(name, n >= LOCK_AFTER ? 0 : n, n >= LOCK_AFTER ? now + LOCK_MIN * 60e3 : now).run();
      fail(401, 'bad_login', 'Name oder Passwort falsch.');
    }
    await db.batch([
      db.prepare('DELETE FROM fails WHERE name = ?').bind(name),
      db.prepare('UPDATE users SET last_login = ? WHERE id = ?').bind(now, u.id),
    ]);
    return { token: await makeToken(env, u), user: pubUser(u) };
  }

  if (path === '/me' && m === 'GET') { const u = await auth(req, env); return { user: pubUser(u) }; }

  if (path === '/me/password' && m === 'POST') {
    const u = await auth(req, env);
    const b = await body(req);
    if (!safeEq(await hashPw(String(b.old || ''), u.salt, u.iter), u.hash)) fail(400, 'bad_old', 'Altes Passwort stimmt nicht.');
    if (!validPw(b.password)) fail(400, 'weak', 'Neues Passwort: mindestens 8 Zeichen.');
    const h = await newHash(b.password);
    await db.prepare('UPDATE users SET hash = ?, salt = ?, iter = ?, tv = tv + 1 WHERE id = ?').bind(h.hash, h.salt, h.iter, u.id).run();
    const nu = await db.prepare('SELECT * FROM users WHERE id = ?').bind(u.id).first();
    return { token: await makeToken(env, nu), user: pubUser(nu) };
  }

  /* ---- Benutzerverwaltung (Admin) ---- */
  if (path === '/users' && m === 'GET') {
    await auth(req, env, true);
    const r = await db.prepare('SELECT * FROM users ORDER BY name COLLATE NOCASE').all();
    return { users: r.results.map(pubUser) };
  }
  if (path === '/users' && m === 'POST') {
    await auth(req, env, true);
    const b = await body(req);
    const name = cleanName(b.name), role = b.role === 'admin' ? 'admin' : 'editor';
    if (name.length < 2) fail(400, 'bad_name', 'Name: mindestens 2 Zeichen.');
    if (!validPw(b.password)) fail(400, 'weak', 'Passwort: mindestens 8 Zeichen.');
    if (await db.prepare('SELECT id FROM users WHERE name = ?').bind(name).first()) fail(409, 'exists', 'Diesen Namen gibt es schon.');
    const h = await newHash(b.password);
    await db.prepare('INSERT INTO users (name, role, hash, salt, iter, created) VALUES (?, ?, ?, ?, ?, ?)').bind(name, role, h.hash, h.salt, h.iter, Date.now()).run();
    return { user: pubUser(await db.prepare('SELECT * FROM users WHERE name = ?').bind(name).first()) };
  }
  const um = path.match(/^\/users\/(\d+)$/);
  if (um && (m === 'PATCH' || m === 'DELETE')) {
    const me = await auth(req, env, true);
    const id = +um[1];
    const u = await db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();
    if (!u) fail(404, 'not_found', 'Konto nicht gefunden.');
    const admins = (await db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND disabled = 0").first()).c;
    const lastAdmin = u.role === 'admin' && !u.disabled && admins <= 1;
    if (m === 'DELETE') {
      if (id === me.id) fail(400, 'self', 'Du kannst dich nicht selbst löschen.');
      if (lastAdmin) fail(400, 'last_admin', 'Der letzte Admin kann nicht gelöscht werden.');
      await db.prepare('DELETE FROM users WHERE id = ?').bind(id).run();
      return { ok: true };
    }
    const b = await body(req);
    const sets = [], vals = [];
    let bump = false;
    if (b.role !== undefined) {
      const role = b.role === 'admin' ? 'admin' : 'editor';
      if (role !== u.role) {
        if (lastAdmin) fail(400, 'last_admin', 'Es muss mindestens einen Admin geben.');
        sets.push('role = ?'); vals.push(role); bump = true;
      }
    }
    if (b.disabled !== undefined) {
      const d = b.disabled ? 1 : 0;
      if (d && id === me.id) fail(400, 'self', 'Du kannst dich nicht selbst sperren.');
      if (d && lastAdmin) fail(400, 'last_admin', 'Der letzte Admin kann nicht gesperrt werden.');
      sets.push('disabled = ?'); vals.push(d); bump = true;
    }
    if (b.password !== undefined) {
      if (!validPw(b.password)) fail(400, 'weak', 'Passwort: mindestens 8 Zeichen.');
      const h = await newHash(b.password);
      sets.push('hash = ?', 'salt = ?', 'iter = ?'); vals.push(h.hash, h.salt, h.iter); bump = true;
    }
    if (b.name !== undefined) {
      const name = cleanName(b.name);
      if (name.length < 2) fail(400, 'bad_name', 'Name: mindestens 2 Zeichen.');
      const other = await db.prepare('SELECT id FROM users WHERE name = ?').bind(name).first();
      if (other && other.id !== id) fail(409, 'exists', 'Diesen Namen gibt es schon.');
      sets.push('name = ?'); vals.push(name);
    }
    if (bump && id !== me.id) sets.push('tv = tv + 1'); // meldet das Konto überall ab
    if (sets.length) await db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, id).run();
    const nu = await db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();
    const out = { user: pubUser(nu) };
    if (id === me.id && bump) { await db.prepare('UPDATE users SET tv = tv + 1 WHERE id = ?').bind(id).run(); nu.tv += 1; out.token = await makeToken(env, nu); }
    return out;
  }

  /* ---- Verlauf (Admin) ---- */
  if (path === '/history' && m === 'GET') {
    await auth(req, env, true);
    const r = await db.prepare('SELECT v, at, by, length(data) AS size FROM history ORDER BY v DESC LIMIT 60').all();
    return { history: r.results };
  }
  const hm = path.match(/^\/history\/(\d+)$/);
  if (hm && m === 'GET') {
    await auth(req, env, true);
    const r = await db.prepare('SELECT v, at, by, data FROM history WHERE v = ?').bind(+hm[1]).first();
    if (!r) fail(404, 'not_found', 'Diesen Stand gibt es nicht mehr.');
    return { v: r.v, at: r.at, by: r.by, state: JSON.parse(r.data) };
  }

  fail(404, 'not_found', 'Unbekannte Adresse.');
}

function cors(req, env) {
  const origin = req.headers.get('origin') || '';
  const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  const h = { 'Vary': 'Origin' };
  if (allowed.includes(origin)) {
    h['Access-Control-Allow-Origin'] = origin;
    h['Access-Control-Allow-Methods'] = 'GET, POST, PUT, PATCH, DELETE, OPTIONS';
    h['Access-Control-Allow-Headers'] = 'Content-Type, Authorization';
    h['Access-Control-Max-Age'] = '86400';
  }
  return h;
}

export default {
  async fetch(req, env) {
    const ch = cors(req, env);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: ch });
    const headers = { ...ch, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
    try {
      if (!env.DB) fail(500, 'no_db', 'Datenbank nicht verbunden (Binding "DB" fehlt).');
      if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) fail(500, 'no_secret', 'SESSION_SECRET fehlt oder ist zu kurz (mind. 32 Zeichen).');
      await ensureSchema(env.DB);
      const out = await route(req, env, new URL(req.url));
      return new Response(JSON.stringify(out), { status: 200, headers });
    } catch (e) {
      if (e instanceof HttpError) return new Response(JSON.stringify({ error: e.code, message: e.message, ...(e.extra || {}) }), { status: e.status, headers });
      return new Response(JSON.stringify({ error: 'server', message: 'Serverfehler.' }), { status: 500, headers });
    }
  },
};
