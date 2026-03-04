// Smoke test: Tenant-QBO Connect minimal backend loop.
// Usage:
//   API_BASE=http://127.0.0.1:3000 node scripts/smoke-qbo.mjs

const API_BASE = process.env.API_BASE || 'http://127.0.0.1:3000';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function pickSetCookies(res) {
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
    const [nv] = String(setCookie).split(';');
    const eq = nv.indexOf('=');
    if (eq <= 0) return;
    const name = nv.slice(0, eq).trim();
    const value = nv.slice(eq + 1).trim();
    if (!name) return;
    if (!value) this.map.delete(name);
    else this.map.set(name, value);
  }
  header() {
    return [...this.map.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }
}

async function jfetch(path, { method = 'GET', jar, body } = {}) {
  const headers = {};
  if (jar) headers.cookie = jar.header();
  if (body != null) headers['content-type'] = 'application/json';
  const res = await fetch(`${API_BASE}${path}`, {
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
  return { res, json, text };
}

function logStep(step, status, json) {
  console.log(`[${step}] status=${status} body=${JSON.stringify(json)}`);
}

const jar = new CookieJar();

// 1) Login with the locally configured admin account
{
  const username = process.env.DEV_ADMIN_USER || 'admin';
  const password = process.env.DEV_ADMIN_PASS || 'replace-me-local-admin-password';
  const { res, json } = await jfetch('/auth/login', {
    method: 'POST',
    jar,
    body: { username, password }
  });
  logStep('auth/login', res.status, json);
  assert(res.status === 200, `login expected 200, got ${res.status}`);
}

// 2) Select tenant t-acme
{
  const { res, json } = await jfetch('/tenant/select', {
    method: 'POST',
    jar,
    body: { tenantId: 't-acme', tenantCode: 'T-ACME' }
  });
  logStep('tenant/select', res.status, json);
  assert(res.status === 200, `tenant/select expected 200, got ${res.status}`);
}

// 3) Start QBO connect
let state;
{
  const { res, json } = await jfetch('/qbo/connect/start', {
    method: 'POST',
    jar
  });
  logStep('qbo/connect/start', res.status, json);
  assert(res.status === 200, `qbo/connect/start expected 200, got ${res.status}`);
  assert(json?.state, 'qbo/connect/start should return state');
  assert(json?.authorizationUrl, 'qbo/connect/start should return authorizationUrl');
  state = json.state;
}

// 4) Callback (mock code)
{
  const code = 'mock_code_smoke';
  const realmId = 'realm-smoke';
  const { res, json } = await jfetch(`/qbo/connect/callback?state=${encodeURIComponent(state)}&code=${encodeURIComponent(code)}&realmId=${encodeURIComponent(realmId)}`, {
    method: 'GET',
    jar
  });
  logStep('qbo/connect/callback', res.status, json);
  assert(res.status === 200, `qbo/connect/callback expected 200, got ${res.status}`);
  assert(json?.connected === true, 'qbo/connect/callback should connect');
}

// 5) Status
{
  const { res, json } = await jfetch('/qbo/connect/status', {
    method: 'GET',
    jar
  });
  logStep('qbo/connect/status', res.status, json);
  assert(res.status === 200, `qbo/connect/status expected 200, got ${res.status}`);
  assert(json?.qbo?.connected === true, 'qbo/connect/status should return connected=true');
  assert(json?.tenant?.tenantId === 't-acme', 'status should be tied to t-acme');
}

console.log(`OK smoke-qbo connect (${API_BASE})`);
