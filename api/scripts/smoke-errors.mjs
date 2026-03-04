// Smoke for DEV1-003: error-code consistency
const API_BASE = process.env.API_BASE || 'http://127.0.0.1:3000';

function assert(cond, msg) { if (!cond) throw new Error(msg); }

async function post(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  const json = await res.json();
  return { status: res.status, json };
}

const badShape = await post('/auth/login', { username: 'admin' });
console.log('[auth/login:missing-password]', badShape.status, JSON.stringify(badShape.json));
assert(badShape.status === 422, 'expected 422 for missing password');
assert(badShape.json?.error === 'validation_error', 'expected validation_error');

const badCreds = await post('/auth/login', { username: 'admin', password: 'wrong' });
console.log('[auth/login:bad-creds]', badCreds.status, JSON.stringify(badCreds.json));
assert(badCreds.status === 401, 'expected 401 for bad creds');
assert(badCreds.json?.error === 'invalid_credentials', 'expected invalid_credentials');

console.log('OK smoke-errors');
