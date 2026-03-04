// Smoke test for Slice-1 auth contract.
// Usage:
//   API_BASE=http://127.0.0.1:3000 node scripts/smoke-auth.mjs
// Assumes the API server is already running.

const API_BASE = process.env.API_BASE || 'http://127.0.0.1:3000';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function pickSetCookies(res) {
  // Node fetch supports getSetCookie() (undici). Fallback to single header.
  const h = res.headers;
  const getSetCookie = h.getSetCookie?.bind(h);
  const cookies = getSetCookie ? getSetCookie() : (h.get('set-cookie') ? [h.get('set-cookie')] : []);
  return cookies.filter(Boolean);
}

class CookieJar {
  constructor() {
    this.map = new Map();
  }
  addFromSetCookie(setCookie) {
    // Very small parser: "name=value; ..." only.
    const [nv] = String(setCookie).split(';');
    const eq = nv.indexOf('=');
    if (eq <= 0) return;
    const name = nv.slice(0, eq).trim();
    const value = nv.slice(eq + 1).trim();
    if (!name) return;

    // If value is empty, treat as deletion.
    if (!value) this.map.delete(name);
    else this.map.set(name, value);
  }
  header() {
    const parts = [];
    for (const [k, v] of this.map.entries()) parts.push(`${k}=${v}`);
    return parts.join('; ');
  }
}

async function jfetch(path, { method = 'GET', jar, body } = {}) {
  const url = `${API_BASE}${path}`;
  const headers = {};
  if (jar) headers.cookie = jar.header();
  if (body != null) headers['content-type'] = 'application/json';

  const res = await fetch(url, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined
  });

  for (const c of pickSetCookies(res)) jar?.addFromSetCookie(c);

  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // ignore
  }
  return { res, text, json };
}

const TENANT_ID = process.env.SMOKE_TENANT_ID || 't-acme';
const TENANT_CODE = process.env.SMOKE_TENANT_CODE || 't-acme';

function brief(v) {
  return JSON.stringify(v);
}

function logStep(name, status, json) {
  console.log(`[${name}] status=${status} body=${brief(json)}`);
}

const jar = new CookieJar();

// 1) me when logged out
{
  const { res, json } = await jfetch('/auth/me', { jar });
  logStep('auth/me:logged-out', res.status, json);
  assert(res.status === 200, `GET /auth/me expected 200, got ${res.status}`);
  assert(json?.ok === true, 'GET /auth/me expected {ok:true}');
  assert(json?.user === null, 'GET /auth/me expected user:null when logged out');
}

// 2) login wrong creds
{
  const { res, json } = await jfetch('/auth/login', {
    method: 'POST',
    jar,
    body: { username: 'nope', password: 'nope' }
  });
  logStep('auth/login:bad-creds', res.status, json);
  assert(res.status === 401, `POST /auth/login (bad creds) expected 401, got ${res.status}`);
  assert(json?.ok === false && json?.error === 'invalid_credentials', 'bad login should return invalid_credentials');
}

// 3) login correct creds
{
  const username = process.env.DEV_ADMIN_USER || 'admin';
  const password = process.env.DEV_ADMIN_PASS || 'admin';
  const { res, json } = await jfetch('/auth/login', {
    method: 'POST',
    jar,
    body: { username, password }
  });
  logStep('auth/login:admin', res.status, json);
  assert(res.status === 200, `POST /auth/login expected 200, got ${res.status}`);
  assert(json?.ok === true, 'good login should return ok:true');
  assert(json?.user?.username === username, 'good login should echo username');
  assert(jar.header().includes('sessionId='), 'expected sessionId cookie after login');
}

// 4) tenant select (t-acme)
{
  const { res, json } = await jfetch('/tenant/select', {
    method: 'POST',
    jar,
    body: { tenantId: TENANT_ID, tenantCode: TENANT_CODE }
  });
  logStep('tenant/select:t-acme', res.status, json);
  assert(res.status === 200, `POST /tenant/select expected 200, got ${res.status}`);
  assert(json?.ok === true, 'tenant/select should return ok:true');
  assert(json?.tenant?.tenantId === TENANT_ID, 'tenant/select should persist tenantId');
  assert(json?.tenant?.tenantCode === TENANT_CODE, 'tenant/select should persist tenantCode');
}

// 5) me when logged in + tenant selected
{
  const { res, json } = await jfetch('/auth/me', { jar });
  logStep('auth/me:authed+tenant', res.status, json);
  assert(res.status === 200, `GET /auth/me (authed) expected 200, got ${res.status}`);
  assert(json?.ok === true, 'authed /auth/me should return ok:true');
  assert(json?.user?.role === 'admin', 'authed /auth/me should return admin role');
  assert(json?.tenant?.tenantId === TENANT_ID, 'authed /auth/me should return selected tenantId');
  assert(json?.tenant?.tenantCode === TENANT_CODE, 'authed /auth/me should return selected tenantCode');
}

// 6) logout
{
  const { res, json } = await jfetch('/auth/logout', { method: 'POST', jar });
  logStep('auth/logout', res.status, json);
  assert(res.status === 200, `POST /auth/logout expected 200, got ${res.status}`);
  assert(json?.ok === true, 'logout should return ok:true');
}

// 7) me after logout
{
  const { res, json } = await jfetch('/auth/me', { jar });
  logStep('auth/me:after-logout', res.status, json);
  assert(res.status === 200, `GET /auth/me after logout expected 200, got ${res.status}`);
  assert(json?.ok === true, 'after logout /auth/me should return ok:true');
  assert(json?.user === null, 'after logout /auth/me should return user:null');
  assert(json?.tenant === null, 'after logout /auth/me should return tenant:null');
}

console.log(`OK smoke-auth tenant contract (${API_BASE}) tenant=${TENANT_ID}`);
