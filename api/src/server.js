import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import session from '@fastify/session';
import { randomUUID, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { z, ZodError } from 'zod';

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';

// @fastify/session enforces secret length >= 32.
const DEFAULT_DEV_SESSION_SECRET = 'replace-me-with-a-local-session-secret';
const SESSION_SECRET = process.env.SESSION_SECRET || DEFAULT_DEV_SESSION_SECRET;
const NODE_ENV = process.env.NODE_ENV || 'development';

const DEV_ADMIN_USER = process.env.DEV_ADMIN_USER || 'admin';
const DEFAULT_DEV_ADMIN_PASS = 'replace-me-local-admin-password';
const DEV_ADMIN_PASS = process.env.DEV_ADMIN_PASS || DEFAULT_DEV_ADMIN_PASS;

const QBO_CLIENT_ID = process.env.QBO_CLIENT_ID || 'qbo-client-dev';
const QBO_CLIENT_SECRET = process.env.QBO_CLIENT_SECRET || 'qbo-secret-dev';
const QBO_REDIRECT_URI = process.env.QBO_REDIRECT_URI || `http://127.0.0.1:${PORT}/qbo/connect/callback`;
const QBO_SCOPE = process.env.QBO_SCOPE || 'com.intuit.quickbooks.accounting';
const QBO_ENV = process.env.QBO_ENV || 'sandbox';
const QBO_AUTHORIZE_BASE =
  process.env.QBO_AUTHORIZE_BASE ||
  (QBO_ENV === 'production'
    ? 'https://appcenter.intuit.com/connect/oauth2'
    : 'https://appcenter.intuit.com/connect/oauth2');
const QBO_TOKEN_URL =
  process.env.QBO_TOKEN_URL ||
  (QBO_ENV === 'production'
    ? 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer'
    : 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer');
const QBO_USE_MOCK = (process.env.QBO_USE_MOCK || '1') === '1';

function assertConfig() {
  // For Slice-1 we keep a dev default, but refuse to boot in prod-like envs.
  if (NODE_ENV === 'production') {
    if (!process.env.SESSION_SECRET) {
      throw new Error('Missing required env: SESSION_SECRET (production)');
    }
    if (SESSION_SECRET === DEFAULT_DEV_SESSION_SECRET) {
      throw new Error('SESSION_SECRET must not be the default dev secret in production');
    }
    if (SESSION_SECRET.length < 32) {
      throw new Error('SESSION_SECRET too short; require >= 32 chars in production');
    }
  }

  if (typeof SESSION_SECRET !== 'string' || SESSION_SECRET.length < 32) {
    throw new Error('Invalid SESSION_SECRET: must be a string with length >= 32');
  }
}

assertConfig();

const app = Fastify({ logger: true });

app.setErrorHandler((error, req, reply) => {
  if (error instanceof ZodError) {
    return reply.code(422).send({
      ok: false,
      error: 'validation_error',
      issues: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
    });
  }

  req.log.error({ err: error }, 'unhandled_error');
  return reply.code(500).send({ ok: false, error: 'internal_error' });
});

await app.register(cors, {
  origin: (origin, cb) => {
    // allow same-origin + server-to-server + localhost dev
    cb(null, true);
  },
  credentials: true
});

await app.register(cookie);
await app.register(session, {
  secret: SESSION_SECRET,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: NODE_ENV === 'production',
    path: '/'
  }
});

app.get('/health', async () => ({ ok: true }));

const DATABASE_URL = process.env.DATABASE_URL || '';
const { Pool } = pg;
const db = DATABASE_URL ? new Pool({ connectionString: DATABASE_URL }) : null;

async function dbExec(sql, params = []) {
  if (!db) return null;
  return db.query(sql, params);
}

async function ensureStateTables() {
  if (!db) return;
  await dbExec(`
    create table if not exists app_tenant (
      tenant_id text primary key,
      tenant_code text not null,
      name text not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
  `);

  await dbExec(`
    create table if not exists app_qbo_connection (
      tenant_id text primary key references app_tenant(tenant_id) on delete cascade,
      realm_id text,
      connected_at timestamptz not null default now(),
      token_type text,
      expires_in integer,
      refresh_expires_in integer,
      access_token_preview text,
      refresh_token_preview text,
      access_token text,
      refresh_token text,
      updated_at timestamptz not null default now()
    );
  `);

  await dbExec(`alter table app_qbo_connection add column if not exists access_token text;`);
  await dbExec(`alter table app_qbo_connection add column if not exists refresh_token text;`);

  await dbExec(`
    create table if not exists app_qbo_mapping_item (
      tenant_id text not null references app_tenant(tenant_id) on delete cascade,
      entity text not null,
      qbo_id text not null,
      display_name text,
      active boolean,
      raw_json jsonb,
      updated_at timestamptz not null default now(),
      primary key (tenant_id, entity, qbo_id)
    );
  `);

  await dbExec(`
    create table if not exists app_submission (
      id text primary key,
      tenant_id text not null references app_tenant(tenant_id) on delete cascade,
      company_key text not null default 'default',
      kind text not null,
      client_ref text not null,
      memo text not null default '',
      status text not null default 'draft',
      payload_json jsonb,
      validation_json jsonb,
      precheck_json jsonb,
      result_json jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
  `);

  await dbExec(`create index if not exists idx_app_submission_tenant_updated on app_submission(tenant_id, updated_at desc);`);

  await dbExec(`
    create table if not exists app_bill_rules (
      tenant_id text primary key references app_tenant(tenant_id) on delete cascade,
      rules_json jsonb not null,
      updated_at timestamptz not null default now()
    );
  `);

  await dbExec(`
    create table if not exists app_bill_payment_rules (
      tenant_id text primary key references app_tenant(tenant_id) on delete cascade,
      rules_json jsonb not null,
      updated_at timestamptz not null default now()
    );
  `);

  await dbExec(`
    create table if not exists app_user (
      id text primary key,
      username text not null unique,
      password_hash text,
      role text not null default 'user',
      status text not null default 'active',
      created_by text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
  `);
  await dbExec(`alter table app_user add column if not exists password_hash text;`);
  await dbExec(`alter table app_user add column if not exists role text not null default 'user';`);
  await dbExec(`alter table app_user add column if not exists status text not null default 'active';`);
  await dbExec(`alter table app_user add column if not exists created_by text;`);
  await dbExec(`alter table app_user add column if not exists created_at timestamptz not null default now();`);
  await dbExec(`alter table app_user add column if not exists updated_at timestamptz not null default now();`);

  await dbExec(`
    create table if not exists app_user_pref (
      username text primary key,
      last_tenant_id text,
      updated_at timestamptz not null default now()
    );
  `);
}

// Minimal in-memory storage for Slice Tenant-QBO Connect.
// Replace with DB persistence in later slices.
const qboConnectionsByTenant = new Map(); // tenantId -> token payload
const qboStateStore = new Map(); // state -> { tenantId, createdAt }

// Minimal tenant registry (dev). Replace with DB persistence in next slice.
const tenantsById = new Map([
  ['t-acme', { tenantId: 't-acme', tenantCode: 't-acme', name: 'Acme Trading' }],
  ['t-beta', { tenantId: 't-beta', tenantCode: 't-beta', name: 'Beta Services' }]
]);

// Slice: Submissions (in-memory + DB persisted, tenant-scoped)
const submissionsById = new Map();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_BILL_RULES = JSON.parse(readFileSync(path.join(__dirname, 'default-bill-form-rules.v1.json'), 'utf8'));
const DEFAULT_BILL_PAYMENT_RULES = JSON.parse(readFileSync(path.join(__dirname, 'default-bill-payment-form-rules.v1.json'), 'utf8'));
const billRulesByTenant = new Map(); // tenantId -> rules JSON
const billPaymentRulesByTenant = new Map(); // tenantId -> rules JSON

function defaultPayloadByKind(kind) {
  if (kind === 'bill_payment') {
    const d = new Date().toISOString().slice(0, 10);
    return {
      vendor_ref_text: '',
      pay_date: d,
      bank_account_ref_text: 'Cash and cash equivalents:Cash in Bank',
      ref_no: '',
      lines: []
    };
  }

  return {
    bill_date: new Date().toISOString().slice(0, 10),
    due_date: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString().slice(0, 10),
    vendor_ref_text: 'Demo Vendor',
    lines: [{ account_ref_text: 'Office Supplies', amount: 100, description: 'Sample line' }]
  };
}

function listSubmissionsForTenant(tenantId) {
  return Array.from(submissionsById.values())
    .filter((r) => r.tenant_id === tenantId)
    .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
}

async function saveSubmission(row) {
  if (!db || !row?.id) return;
  await dbExec(
    `insert into app_submission (
      id, tenant_id, company_key, kind, client_ref, memo, status,
      payload_json, validation_json, precheck_json, result_json,
      created_at, updated_at
    ) values (
      $1,$2,$3,$4,$5,$6,$7,
      $8::jsonb,$9::jsonb,$10::jsonb,$11::jsonb,
      $12::timestamptz,$13::timestamptz
    )
    on conflict (id) do update set
      tenant_id=excluded.tenant_id,
      company_key=excluded.company_key,
      kind=excluded.kind,
      client_ref=excluded.client_ref,
      memo=excluded.memo,
      status=excluded.status,
      payload_json=excluded.payload_json,
      validation_json=excluded.validation_json,
      precheck_json=excluded.precheck_json,
      result_json=excluded.result_json,
      updated_at=excluded.updated_at`,
    [
      row.id,
      row.tenant_id,
      row.company_key || 'default',
      row.kind,
      row.client_ref || '',
      row.memo || '',
      row.status || 'draft',
      JSON.stringify(row.payload || {}),
      JSON.stringify(row.validation || null),
      JSON.stringify(row.precheck || null),
      JSON.stringify(row.result || null),
      row.created_at || new Date().toISOString(),
      row.updated_at || new Date().toISOString()
    ]
  );
}

function isClientRefUnique(clientRef, currentId) {
  return !findSubmissionByClientRef(clientRef, currentId);
}

function findSubmissionByClientRef(clientRef, currentId) {
  const target = String(clientRef || '').trim().toLowerCase();
  if (!target) return null;
  for (const s of submissionsById.values()) {
    if (s.id === currentId) continue;
    const ref = String(s.client_ref || '').trim().toLowerCase();
    if (ref && ref === target) return s;
  }
  return null;
}

function getBillRules(tenantId) {
  return billRulesByTenant.get(tenantId) || structuredClone(DEFAULT_BILL_RULES);
}

const REF_ENTITY_ALIASES = new Map([
  ['vendor', 'vendor'],
  ['vendors', 'vendor'],
  ['department', 'department'],
  ['departments', 'department'],
  ['location', 'department'],
  ['locations', 'department'],
  ['account', 'account'],
  ['accounts', 'account'],
  ['class', 'class'],
  ['classes', 'class'],
  ['taxcode', 'taxcode'],
  ['taxcodes', 'taxcode'],
  ['tax', 'taxcode'],
]);

function normalizeRefEntity(entity) {
  const key = String(entity || '').trim().toLowerCase();
  return REF_ENTITY_ALIASES.get(key) || key;
}

function makeRefId(entity, qboId) {
  const normalizedEntity = normalizeRefEntity(entity);
  const normalizedQboId = String(qboId || '').trim();
  if (!normalizedEntity || !normalizedQboId) return '';
  return `${normalizedEntity}:${normalizedQboId}`;
}

function parseRefId(refId) {
  const raw = String(refId || '').trim();
  const separator = raw.indexOf(':');
  if (separator <= 0 || separator >= raw.length - 1) return null;
  const entity = normalizeRefEntity(raw.slice(0, separator));
  const qboId = raw.slice(separator + 1).trim();
  if (!entity || !qboId) return null;
  return { entity, qboId };
}

function resolveBillLocationRefText(tenantId, rawLocationRefText) {
  const raw = String(rawLocationRefText || '').trim();
  const useDefaultMarker = raw === '__USE_DEFAULT_LOCATION__';
  if (!useDefaultMarker) return raw;
  const rules = getBillRules(tenantId) || {};
  const fromRules = String(rules?.payload?.location_ref_text?.default || '').trim();
  return fromRules;
}

async function findMappingRecordById(tenantId, entity, qboId) {
  const normalizedEntity = normalizeRefEntity(entity);
  const normalizedQboId = String(qboId || '').trim();
  if (!normalizedEntity || !normalizedQboId || !db) return null;
  const res = await dbExec(
    `select entity, qbo_id, display_name from app_qbo_mapping_item
     where tenant_id=$1 and lower(entity)=lower($2) and qbo_id=$3
     order by updated_at desc limit 1`,
    [tenantId, normalizedEntity, normalizedQboId]
  );
  return res?.rows?.[0] || null;
}

async function findMappingRecordByDisplayName(tenantId, entity, displayName) {
  const normalizedEntity = normalizeRefEntity(entity);
  const normalizedName = String(displayName || '').trim();
  if (!normalizedEntity || !normalizedName || !db) return null;
  const res = await dbExec(
    `select entity, qbo_id, display_name from app_qbo_mapping_item
     where tenant_id=$1 and lower(entity)=lower($2) and lower(display_name)=lower($3)
     order by updated_at desc limit 1`,
    [tenantId, normalizedEntity, normalizedName]
  );
  return res?.rows?.[0] || null;
}

async function resolveMappingRef(tenantId, entity, refText, refId) {
  const normalizedEntity = normalizeRefEntity(entity);
  const normalizedText = String(refText || '').trim();
  const parsedRefId = parseRefId(refId);
  const parsedMatchesEntity = parsedRefId && parsedRefId.entity === normalizedEntity;

  if (!db) {
    return {
      entity: normalizedEntity,
      refText: normalizedText,
      refId: parsedMatchesEntity ? makeRefId(normalizedEntity, parsedRefId.qboId) : '',
      qboId: parsedMatchesEntity ? parsedRefId.qboId : '',
      source: parsedMatchesEntity ? 'ref_id' : null
    };
  }

  let record = null;
  if (parsedMatchesEntity) {
    record = await findMappingRecordById(tenantId, normalizedEntity, parsedRefId.qboId);
  }
  if (!record && normalizedText) {
    record = await findMappingRecordByDisplayName(tenantId, normalizedEntity, normalizedText);
  }

  if (record) {
    return {
      entity: normalizedEntity,
      refText: String(record.display_name || normalizedText || ''),
      refId: makeRefId(normalizedEntity, record.qbo_id),
      qboId: String(record.qbo_id || ''),
      source: parsedMatchesEntity && String(record.qbo_id || '') === parsedRefId.qboId ? 'ref_id' : 'text'
    };
  }

  return {
    entity: normalizedEntity,
    refText: normalizedText,
    refId: parsedMatchesEntity ? makeRefId(normalizedEntity, parsedRefId.qboId) : '',
    qboId: '',
    source: null
  };
}

function getCompileReadyQboId(resolvedRef) {
  const resolvedId = String(resolvedRef?.qboId || '').trim();
  if (resolvedId) return resolvedId;
  if (!db) {
    const textFallback = String(resolvedRef?.refText || '').trim();
    if (textFallback) return textFallback;
  }
  return null;
}

async function normalizeRefField(target, tenantId, entity, textField, idField, transformText = null) {
  if (!target || typeof target !== 'object') return;
  const rawText = transformText ? transformText(tenantId, target[textField]) : target[textField];
  const resolved = await resolveMappingRef(tenantId, entity, rawText, target[idField]);
  target[textField] = String(resolved.refText || '').trim();
  if (resolved.refId) {
    target[idField] = resolved.refId;
  } else {
    delete target[idField];
  }
}

function normalizeBillLineDefaults(line) {
  if (!line || typeof line !== 'object') return;
  const kind = String(line?.meta?.kind || 'business').trim().toLowerCase();
  if (kind === 'wht') {
    line.class_ref_text = '';
    delete line.class_ref_id;
  }
}

async function normalizeSubmissionPayloadForStorage(kind, tenantId, payload) {
  const p = payload && typeof payload === 'object' ? structuredClone(payload) : {};
  if (kind === 'bill') {
    await normalizeRefField(p, tenantId, 'vendor', 'vendor_ref_text', 'vendor_ref_id');
    await normalizeRefField(p, tenantId, 'department', 'location_ref_text', 'location_ref_id', resolveBillLocationRefText);
    if (Array.isArray(p.lines)) {
      for (const line of p.lines) {
        if (!line || typeof line !== 'object') continue;
        normalizeBillLineDefaults(line);
        await normalizeRefField(line, tenantId, 'account', 'account_ref_text', 'account_ref_id');
        await normalizeRefField(line, tenantId, 'class', 'class_ref_text', 'class_ref_id');
        await normalizeRefField(line, tenantId, 'taxcode', 'tax_ref_text', 'tax_ref_id');
      }
    }
  } else if (kind === 'bill_payment') {
    await normalizeRefField(p, tenantId, 'vendor', 'vendor_ref_text', 'vendor_ref_id');
    await normalizeRefField(p, tenantId, 'account', 'bank_account_ref_text', 'bank_account_ref_id');
  }
  return p;
}

async function saveBillRules(tenantId, rules) {
  billRulesByTenant.set(tenantId, rules);
  if (!db) return;
  await dbExec(
    `insert into app_bill_rules (tenant_id, rules_json, updated_at)
     values ($1, $2::jsonb, now())
     on conflict (tenant_id) do update set
       rules_json = excluded.rules_json,
       updated_at = now()`,
    [tenantId, JSON.stringify(rules || {})]
  );
}

async function listTenantMappingsByEntity(tenantId, entity) {
  if (!db) return [];
  const res = await dbExec(
    `select qbo_id, display_name from app_qbo_mapping_item where tenant_id=$1 and lower(entity)=lower($2) and active=true order by display_name asc`,
    [tenantId, entity]
  );
  return res?.rows || [];
}

async function alignBillRulesWithMappings(tenantId) {
  const rules = structuredClone(getBillRules(tenantId));
  const q = rules?.qboOptionDictionaries || (rules.qboOptionDictionaries = {});

  const [vendors, departments, classes, taxCodes, accounts] = await Promise.all([
    listTenantMappingsByEntity(tenantId, 'vendor'),
    listTenantMappingsByEntity(tenantId, 'department'),
    listTenantMappingsByEntity(tenantId, 'class'),
    listTenantMappingsByEntity(tenantId, 'taxcode'),
    listTenantMappingsByEntity(tenantId, 'account')
  ]);

  q.vendors = vendors.map((x) => ({ key: String(x.display_name || ''), label: String(x.display_name || ''), qbo_vendor_id: String(x.qbo_id || '') }));
  q.locations = departments.map((x) => ({ key: String(x.display_name || ''), label: String(x.display_name || ''), qbo_department_id: String(x.qbo_id || '') }));
  q.classes = classes.map((x) => ({ key: String(x.display_name || ''), label: String(x.display_name || ''), qbo_class_id: String(x.qbo_id || '') }));
  q.taxCodes = taxCodes.map((x) => ({ key: String(x.display_name || ''), label: String(x.display_name || ''), qbo_tax_code_id: String(x.qbo_id || '') }));
  q.accounts = accounts.map((x) => ({ key: String(x.display_name || ''), label: String(x.display_name || ''), qbo_account_id: String(x.qbo_id || '') }));

  await saveBillRules(tenantId, rules);
  return {
    vendors: q.vendors.length,
    locations: q.locations.length,
    classes: q.classes.length,
    taxCodes: q.taxCodes.length,
    accounts: q.accounts.length,
  };
}

function getBillPaymentRules(tenantId) {
  return billPaymentRulesByTenant.get(tenantId) || structuredClone(DEFAULT_BILL_PAYMENT_RULES);
}

async function saveBillPaymentRules(tenantId, rules) {
  billPaymentRulesByTenant.set(tenantId, rules);
  if (!db) return;
  await dbExec(
    `insert into app_bill_payment_rules (tenant_id, rules_json, updated_at)
     values ($1, $2::jsonb, now())
     on conflict (tenant_id) do update set
       rules_json = excluded.rules_json,
       updated_at = now()`,
    [tenantId, JSON.stringify(rules || {})]
  );
}

async function getUserLastTenant(username) {
  if (!db || !username) return null;
  const res = await dbExec('select last_tenant_id from app_user_pref where username=$1', [username]);
  return res?.rows?.[0]?.last_tenant_id || null;
}

async function saveUserLastTenant(username, tenantId) {
  if (!db || !username) return;
  await dbExec(
    `insert into app_user_pref (username, last_tenant_id, updated_at)
     values ($1, $2, now())
     on conflict (username) do update set
       last_tenant_id=excluded.last_tenant_id,
       updated_at=now()`,
    [username, tenantId || null]
  );
}

function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(String(password), salt, 32).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password, stored) {
  const raw = String(stored || '');
  if (!raw.startsWith('scrypt$')) return false;
  const [, salt, hashHex] = raw.split('$');
  if (!salt || !hashHex) return false;
  const actual = Buffer.from(hashHex, 'hex');
  const expected = scryptSync(String(password), salt, 32);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

async function ensureDefaultAdminUser() {
  if (!db) return;
  const existing = await dbExec('select id, password_hash, role, status from app_user where username=$1 limit 1', [DEV_ADMIN_USER]);
  if (existing?.rows?.length) {
    const row = existing.rows[0];
    const updates = [];
    const vals = [];
    let idx = 1;
    if (!row.password_hash || !String(row.password_hash).startsWith('scrypt$')) {
      updates.push(`password_hash=$${idx++}`);
      vals.push(hashPassword(DEV_ADMIN_PASS));
    }
    if (row.role !== 'admin') {
      updates.push(`role=$${idx++}`);
      vals.push('admin');
    }
    if (row.status !== 'active') {
      updates.push(`status=$${idx++}`);
      vals.push('active');
    }
    if (updates.length) {
      updates.push('updated_at=now()');
      vals.push(row.id);
      await dbExec(`update app_user set ${updates.join(', ')} where id=$${idx}`, vals);
    }
    return;
  }
  await dbExec(
    `insert into app_user (username, password_hash, role, status, created_by, created_at, updated_at)
     values ($1,$2,'admin','active',$3,now(),now())`,
    [DEV_ADMIN_USER, hashPassword(DEV_ADMIN_PASS), 'system']
  );
}

async function getUserByUsername(username) {
  if (!db || !username) return null;
  const r = await dbExec(
    'select id, username, password_hash, role, status, created_by, created_at, updated_at from app_user where username=$1 limit 1',
    [username]
  );
  return r?.rows?.[0] || null;
}

async function listUsers() {
  if (!db) return [];
  const r = await dbExec('select id, username, role, status, created_by, created_at, updated_at from app_user order by created_at desc');
  return r?.rows || [];
}

async function createUser({ username, password, role, createdBy }) {
  if (!db) throw new Error('db_required');
  const hash = hashPassword(password);
  const r = await dbExec(
    `insert into app_user (username, password_hash, role, status, created_by, created_at, updated_at)
     values ($1,$2,$3,'active',$4,now(),now())
     returning id, username, role, status, created_by, created_at, updated_at`,
    [username, hash, role, createdBy || null]
  );
  return r?.rows?.[0] || null;
}

async function updateUserAdminFields(id, { role, status }) {
  if (!db) throw new Error('db_required');
  const fields = [];
  const vals = [];
  let idx = 1;
  if (role) {
    fields.push(`role=$${idx++}`);
    vals.push(role);
  }
  if (status) {
    fields.push(`status=$${idx++}`);
    vals.push(status);
  }
  if (!fields.length) return null;
  fields.push('updated_at=now()');
  vals.push(id);
  const r = await dbExec(
    `update app_user set ${fields.join(', ')} where id=$${idx}
     returning id, username, role, status, created_by, created_at, updated_at`,
    vals
  );
  return r?.rows?.[0] || null;
}

async function resetUserPassword(id, newPassword) {
  if (!db) throw new Error('db_required');
  const hash = hashPassword(newPassword);
  const r = await dbExec(
    `update app_user set password_hash=$1, updated_at=now() where id=$2
     returning id, username, role, status, created_by, created_at, updated_at`,
    [hash, id]
  );
  return r?.rows?.[0] || null;
}

function requireAdmin(req, reply) {
  if (!req.session.user) {
    reply.code(401).send({ ok: false, error: 'unauthorized' });
    return null;
  }
  if (req.session.user.role !== 'admin') {
    reply.code(403).send({ ok: false, error: 'forbidden' });
    return null;
  }
  return req.session.user;
}

function validateSubmissionRow(row) {
  const issues = [];
  const clientRef = String(row.client_ref || '').trim();
  if (!clientRef) issues.push('client_ref_required');
  if (clientRef && !/^[A-Za-z0-9._-]{3,64}$/.test(clientRef)) issues.push('client_ref_invalid_format');
  if (clientRef && !isClientRefUnique(clientRef, row.id)) issues.push('client_ref_not_unique');

  if (row.kind === 'bill') {
    const payload = row.payload && typeof row.payload === 'object' ? row.payload : {};
    const vendor = String(payload.vendor_ref_text || '').trim();
    const billDate = String(payload.bill_date || '').trim();
    const dueDate = String(payload.due_date || '').trim();
    const lines = Array.isArray(payload.lines) ? payload.lines : [];

    if (!vendor) issues.push('vendor_ref_text_required');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(billDate)) issues.push('bill_date_invalid');
    if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) issues.push('due_date_invalid');
    if (billDate && dueDate && /^\d{4}-\d{2}-\d{2}$/.test(billDate) && /^\d{4}-\d{2}-\d{2}$/.test(dueDate) && dueDate < billDate) {
      issues.push('due_date_before_bill_date');
    }

    if (!lines.length) issues.push('bill_lines_required');

    let businessTotal = 0;
    let whtCount = 0;
    for (const ln of lines) {
      const amount = Number(ln?.amount);
      const kind = String(ln?.meta?.kind || 'business');
      if ('location_ref_text' in (ln || {})) issues.push('line_location_not_allowed');
      if (!String(ln?.account_ref_text || '').trim()) issues.push('line_account_ref_required');
      if (!Number.isFinite(amount)) issues.push('line_amount_invalid');
      if (kind === 'wht') {
        whtCount += 1;
        if (!(amount < 0)) issues.push('wht_line_amount_must_be_negative');
      } else {
        if (!(amount > 0)) issues.push('line_amount_must_be_positive');
        if (Number.isFinite(amount)) businessTotal += amount;
      }
    }

    const hasWhtInput = !!String(payload?.wht?.rate ?? '').trim() || !!String(payload?.wht?.amount ?? '').trim();
    if (hasWhtInput && whtCount !== 1) issues.push('wht_line_count_invalid');
    if (!hasWhtInput && whtCount > 0) issues.push('wht_line_without_wht_input');

    const total = lines.reduce((s, ln) => s + Number(ln?.amount || 0), 0);
    if (!(total > 0)) issues.push('bill_amount_must_be_positive');
  } else {
    const payload = row.payload && typeof row.payload === 'object' ? row.payload : {};
    const vendor = String(payload.vendor_ref_text || '').trim();
    const payDate = String(payload.pay_date || '').trim();
    const bankAccount = String(payload.bank_account_ref_text || '').trim();
    const lines = Array.isArray(payload.lines) ? payload.lines : [];

    if (!vendor) issues.push('vendor_ref_text_required');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(payDate)) issues.push('pay_date_invalid');
    if (!bankAccount) issues.push('bank_account_ref_text_required');
    if (!lines.length) issues.push('bill_payment_lines_required');

    let totalPay = 0;
    for (const ln of lines) {
      const open = Number(ln?.open_balance);
      const pay = Number(ln?.pay_amount);
      const billId = String(ln?.bill_id || '').trim();
      if (!billId) issues.push('bill_id_required');
      if (!Number.isFinite(open) || open < 0) issues.push('open_balance_invalid');
      if (!Number.isFinite(pay) || pay < 0) issues.push('pay_amount_invalid');
      if (Number.isFinite(open) && Number.isFinite(pay) && pay > open) issues.push('pay_amount_exceeds_open_balance');
      if (Number.isFinite(pay)) totalPay += pay;
    }

    if (!(totalPay > 0)) issues.push('payment_amount_must_be_positive');
  }

  if (issues.length) {
    row.status = 'draft';
    row.result = { ok: false, mode: 'validate', error_detail: issues.join(', '), at: new Date().toISOString() };
    row.updated_at = new Date().toISOString();
    return { ok: false, issues };
  }

  row.status = 'reviewed';
  row.updated_at = new Date().toISOString();
  return { ok: true, issues: [] };
}

async function syncStateFromDb() {
  if (!db) return;

  const tRes = await dbExec('select tenant_id, tenant_code, name from app_tenant order by tenant_id');
  if (tRes) {
    tenantsById.clear();
    for (const r of tRes.rows) {
      tenantsById.set(r.tenant_id, { tenantId: r.tenant_id, tenantCode: r.tenant_code, name: r.name });
    }
  }

  const cRes = await dbExec('select tenant_id, realm_id, connected_at, token_type, expires_in, refresh_expires_in, access_token_preview, refresh_token_preview, access_token, refresh_token from app_qbo_connection');
  if (cRes) {
    qboConnectionsByTenant.clear();
    for (const r of cRes.rows) {
      qboConnectionsByTenant.set(r.tenant_id, {
        tenantId: r.tenant_id,
        connected: true,
        connectedAt: r.connected_at?.toISOString?.() || String(r.connected_at),
        realmId: r.realm_id,
        tokenType: r.token_type,
        expiresIn: r.expires_in,
        refreshExpiresIn: r.refresh_expires_in,
        accessTokenPreview: r.access_token_preview,
        refreshTokenPreview: r.refresh_token_preview,
        accessToken: r.access_token || null,
        refreshToken: r.refresh_token || null
      });
    }
  }

  const sRes = await dbExec('select id, tenant_id, company_key, kind, client_ref, memo, status, payload_json, validation_json, precheck_json, result_json, created_at, updated_at from app_submission order by updated_at desc');
  if (sRes) {
    submissionsById.clear();
    for (const r of sRes.rows) {
      submissionsById.set(r.id, {
        id: r.id,
        tenant_id: r.tenant_id,
        company_key: r.company_key || 'default',
        kind: r.kind,
        client_ref: r.client_ref,
        memo: r.memo || '',
        status: r.status || 'draft',
        payload: r.payload_json || {},
        validation: r.validation_json || null,
        precheck: r.precheck_json || null,
        result: r.result_json || null,
        created_at: r.created_at?.toISOString?.() || String(r.created_at),
        updated_at: r.updated_at?.toISOString?.() || String(r.updated_at)
      });
    }
  }

  const brRes = await dbExec('select tenant_id, rules_json from app_bill_rules');
  if (brRes) {
    billRulesByTenant.clear();
    for (const r of brRes.rows) {
      if (r?.tenant_id) billRulesByTenant.set(r.tenant_id, r.rules_json || structuredClone(DEFAULT_BILL_RULES));
    }
  }

  const bprRes = await dbExec('select tenant_id, rules_json from app_bill_payment_rules');
  if (bprRes) {
    billPaymentRulesByTenant.clear();
    for (const r of bprRes.rows) {
      if (r?.tenant_id) billPaymentRulesByTenant.set(r.tenant_id, r.rules_json || structuredClone(DEFAULT_BILL_PAYMENT_RULES));
    }
  }
}

async function persistTenant(tenant) {
  if (!db) return;
  await dbExec(
    `insert into app_tenant (tenant_id, tenant_code, name, updated_at)
     values ($1,$2,$3,now())
     on conflict (tenant_id)
     do update set tenant_code=excluded.tenant_code, name=excluded.name, updated_at=now()`,
    [tenant.tenantId, tenant.tenantCode, tenant.name]
  );
}

async function deleteTenantState(tenantId) {
  if (!db) return;
  await dbExec('delete from app_tenant where tenant_id=$1', [tenantId]);
}

async function persistQboConnection(record) {
  if (!db) return;
  await dbExec(
    `insert into app_qbo_connection (
      tenant_id, realm_id, connected_at, token_type, expires_in, refresh_expires_in, access_token_preview, refresh_token_preview, access_token, refresh_token, updated_at
    ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now())
    on conflict (tenant_id)
    do update set realm_id=excluded.realm_id, connected_at=excluded.connected_at, token_type=excluded.token_type,
      expires_in=excluded.expires_in, refresh_expires_in=excluded.refresh_expires_in,
      access_token_preview=excluded.access_token_preview, refresh_token_preview=excluded.refresh_token_preview,
      access_token=excluded.access_token, refresh_token=excluded.refresh_token, updated_at=now()`,
    [
      record.tenantId,
      record.realmId,
      record.connectedAt,
      record.tokenType,
      record.expiresIn,
      record.refreshExpiresIn,
      record.accessTokenPreview,
      record.refreshTokenPreview,
      record.accessToken || null,
      record.refreshToken || null
    ]
  );
}

async function replaceTenantMappings(tenantId, entity, items) {
  if (!db) return;
  await dbExec('delete from app_qbo_mapping_item where tenant_id=$1 and entity=$2', [tenantId, entity]);
  for (const it of items) {
    await dbExec(
      `insert into app_qbo_mapping_item (tenant_id, entity, qbo_id, display_name, active, raw_json, updated_at)
       values ($1,$2,$3,$4,$5,$6::jsonb,now())
       on conflict (tenant_id, entity, qbo_id)
       do update set display_name=excluded.display_name, active=excluded.active, raw_json=excluded.raw_json, updated_at=now()`,
      [tenantId, entity, String(it.qbo_id || ''), it.display_name || '', !!it.active, JSON.stringify(it.raw || {})]
    );
  }
}

async function getTenantMappings(tenantId) {
  if (!db) return { vendors: [], departments: [], classes: [], taxCodes: [], accounts: [] };
  const res = await dbExec(
    'select entity, qbo_id, display_name, active, raw_json from app_qbo_mapping_item where tenant_id=$1 order by entity, display_name nulls last, qbo_id',
    [tenantId]
  );
  const out = { vendors: [], departments: [], classes: [], taxCodes: [], accounts: [] };
  const map = {
    vendor: 'vendors',
    department: 'departments',
    class: 'classes',
    taxcode: 'taxCodes',
    account: 'accounts'
  };
  for (const r of res?.rows || []) {
    const k = map[String(r.entity || '').toLowerCase()];
    if (!k) continue;
    out[k].push({ id: r.qbo_id, name: r.display_name, active: !!r.active, raw: r.raw_json || {} });
  }
  return out;
}

async function getTenantMappingStats(tenantId) {
  if (!db) return { total: 0, lastSyncAt: null, counts: { vendors: 0, departments: 0, classes: 0, taxCodes: 0, accounts: 0 } };
  const res = await dbExec(
    `select entity, count(*)::int as cnt, max(updated_at) as last_at
     from app_qbo_mapping_item where tenant_id=$1 group by entity`,
    [tenantId]
  );
  const counts = { vendors: 0, departments: 0, classes: 0, taxCodes: 0, accounts: 0 };
  let total = 0;
  let lastSyncAt = null;
  for (const r of res?.rows || []) {
    const e = String(r.entity || '').toLowerCase();
    const c = Number(r.cnt || 0);
    if (e === 'vendor') counts.vendors = c;
    if (e === 'department') counts.departments = c;
    if (e === 'class') counts.classes = c;
    if (e === 'taxcode') counts.taxCodes = c;
    if (e === 'account') counts.accounts = c;
    total += c;
    const at = r.last_at ? new Date(r.last_at).toISOString() : null;
    if (at && (!lastSyncAt || at > lastSyncAt)) lastSyncAt = at;
  }
  return { total, lastSyncAt, counts };
}

async function findMappingId(tenantId, entity, displayName) {
  const record = await findMappingRecordByDisplayName(tenantId, entity, displayName);
  if (record?.qbo_id) return record.qbo_id;
  if (!db) {
    const name = String(displayName || '').trim();
    return name || null;
  }
  return null;
}

async function compileBillToQboPayload(row) {
  const payload = row?.payload || {};
  const tenantId = row?.tenant_id;
  const issues = [];
  const effectiveLocationRefText = resolveBillLocationRefText(tenantId, payload.location_ref_text);

  const vendorRef = await resolveMappingRef(tenantId, 'vendor', payload.vendor_ref_text, payload.vendor_ref_id);
  const vendorId = getCompileReadyQboId(vendorRef);
  if (!vendorId) issues.push('vendor_mapping_not_found');

  const locationRef = await resolveMappingRef(
    tenantId,
    'department',
    effectiveLocationRefText,
    payload.location_ref_id
  );
  const departmentId = getCompileReadyQboId(locationRef);
  if (effectiveLocationRefText && !departmentId) issues.push('location_mapping_not_found');

  const linesIn = Array.isArray(payload.lines) ? payload.lines : [];
  const linesOut = [];

  for (const ln of linesIn) {
    const accountRef = await resolveMappingRef(tenantId, 'account', ln?.account_ref_text, ln?.account_ref_id);
    const accountId = getCompileReadyQboId(accountRef);
    if (!accountId) issues.push('account_mapping_not_found');

    const hasClassRef = !!String(ln?.class_ref_text || '').trim() || !!String(ln?.class_ref_id || '').trim();
    const classRef = hasClassRef
      ? await resolveMappingRef(tenantId, 'class', ln?.class_ref_text, ln?.class_ref_id)
      : null;
    const classId = getCompileReadyQboId(classRef);
    if (hasClassRef && !classId) issues.push('class_mapping_not_found');

    const hasTaxRef = !!String(ln?.tax_ref_text || '').trim() || !!String(ln?.tax_ref_id || '').trim();
    const taxRef = hasTaxRef
      ? await resolveMappingRef(tenantId, 'taxcode', ln?.tax_ref_text, ln?.tax_ref_id)
      : null;
    const taxId = getCompileReadyQboId(taxRef);
    if (hasTaxRef && !taxId) issues.push('tax_mapping_not_found');

    const detail = {
      AccountRef: accountId ? { value: String(accountId) } : undefined,
      ClassRef: classId ? { value: String(classId) } : undefined,
      TaxCodeRef: taxId ? { value: String(taxId) } : undefined
    };

    linesOut.push({
      DetailType: 'AccountBasedExpenseLineDetail',
      Amount: Number(ln?.amount || 0),
      Description: String(ln?.description || ''),
      AccountBasedExpenseLineDetail: detail
    });
  }

  const qboPayload = {
    VendorRef: vendorId ? { value: String(vendorId) } : undefined,
    TxnDate: payload.bill_date || undefined,
    DueDate: payload.due_date || undefined,
    PrivateNote: row.memo || '',
    DepartmentRef: departmentId ? { value: String(departmentId) } : undefined,
    Line: linesOut
  };

  return { qboPayload, issues };
}

async function compileBillPaymentToQboPayload(row) {
  const payload = row?.payload || {};
  const tenantId = row?.tenant_id;
  const issues = [];

  const vendorRef = await resolveMappingRef(tenantId, 'vendor', payload.vendor_ref_text, payload.vendor_ref_id);
  const vendorId = getCompileReadyQboId(vendorRef);
  if (!vendorId) issues.push('vendor_mapping_not_found');

  const bankAccountRef = await resolveMappingRef(
    tenantId,
    'account',
    payload.bank_account_ref_text,
    payload.bank_account_ref_id
  );
  const bankAccountId = getCompileReadyQboId(bankAccountRef);
  if (!bankAccountId) issues.push('bank_account_mapping_not_found');

  const linesIn = Array.isArray(payload.lines) ? payload.lines : [];
  const linesOut = [];
  for (const ln of linesIn) {
    const payAmt = Number(ln?.pay_amount || 0);
    const billId = String(ln?.bill_id || '').trim();
    if (!billId) issues.push('bill_id_required');
    if (!(payAmt > 0)) continue;
    linesOut.push({
      Amount: payAmt,
      LinkedTxn: [{ TxnId: billId, TxnType: 'Bill' }]
    });
  }

  if (!linesOut.length) issues.push('payment_lines_required');

  const totalAmt = linesOut.reduce((s, ln) => s + (Number(ln?.Amount || 0) || 0), 0);
  const qboPayload = {
    VendorRef: vendorId ? { value: String(vendorId) } : undefined,
    TxnDate: payload.pay_date || undefined,
    PrivateNote: row.memo || payload.memo || '',
    DocNumber: payload.ref_no || undefined,
    TotalAmt: totalAmt,
    PayType: 'Check',
    CheckPayment: bankAccountId ? { BankAccountRef: { value: String(bankAccountId) } } : undefined,
    Line: linesOut
  };

  return { qboPayload, issues };
}

function toMappingItem(entity, x) {
  const entityLower = String(entity || '').toLowerCase();
  const qboId = String(x?.Id || '');
  const name = entityLower === 'vendor'
    ? String(x?.DisplayName || x?.CompanyName || x?.Name || qboId)
    : String(x?.Name || x?.DisplayName || qboId);
  return {
    qbo_id: qboId,
    display_name: name,
    active: x?.Active !== false,
    raw: x || {}
  };
}

function qboBaseUrl() {
  return QBO_ENV === 'production'
    ? 'https://quickbooks.api.intuit.com'
    : 'https://sandbox-quickbooks.api.intuit.com';
}

function extractQboFaultMessage(json) {
  const errs = json?.Fault?.Error;
  if (Array.isArray(errs) && errs.length) {
    const first = errs[0] || {};
    const parts = [first.Message, first.Detail, first.code].filter(Boolean);
    if (parts.length) return parts.join(' | ');
  }
  return null;
}

async function qboQuery(connection, sql) {
  if (!connection?.realmId) throw new Error('missing_realm_id');
  if (QBO_USE_MOCK || String(connection?.accessToken || '').startsWith('mock_access_')) {
    if (sql.includes('from Vendor')) return [{ Id: '1', DisplayName: 'Demo Vendor', Active: true }];
    if (sql.includes('from Department')) return [{ Id: '10', Name: 'Head Office', Active: true }];
    if (sql.includes('from Class')) return [{ Id: '20', Name: 'Default Class', Active: true }];
    if (sql.includes('from TaxCode')) return [{ Id: '30', Name: 'Non-Taxable', Active: true }, { Id: '31', Name: 'WHT - Out of scope', Active: true }];
    if (sql.includes('from Account')) return [{ Id: '40', Name: 'Office Supplies', Active: true }, { Id: '41', Name: 'EWT Payable-BIR', Active: true }];
    return [];
  }
  if (!connection?.accessToken) throw new Error('missing_access_token_reconnect_required');

  const url = new URL(`${qboBaseUrl()}/v3/company/${encodeURIComponent(connection.realmId)}/query`);
  url.searchParams.set('query', sql);

  async function run(accessToken) {
    const res = await fetch(url.toString(), {
      headers: {
        authorization: `Bearer ${accessToken}`,
        accept: 'application/json'
      }
    });
    const text = await res.text();
    let json;
    try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
    return { res, json };
  }

  let { res, json } = await run(connection.accessToken);
  if (res.status === 401 && connection?.refreshToken) {
    const refreshed = await refreshQboAccessToken(connection);
    ({ res, json } = await run(refreshed.access_token));
  }

  if (!res.ok) {
    const detail = extractQboFaultMessage(json) || json?.raw;
    throw new Error(detail ? `qbo_query_failed_${res.status}:${detail}` : `qbo_query_failed_${res.status}`);
  }

  const qr = json?.QueryResponse || {};
  const key = Object.keys(qr).find((k) => Array.isArray(qr[k]));
  return key ? qr[key] : [];
}

async function qboCreateBill(connection, billPayload) {
  if (!connection?.realmId) throw new Error('missing_realm_id');
  if (QBO_USE_MOCK || String(connection?.accessToken || '').startsWith('mock_access_')) {
    return { Id: String(Math.floor(Math.random() * 900000) + 100000), mock: true };
  }
  if (!connection?.accessToken) throw new Error('missing_access_token_reconnect_required');

  const url = `${qboBaseUrl()}/v3/company/${encodeURIComponent(connection.realmId)}/bill`;

  async function run(accessToken) {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        accept: 'application/json',
        'content-type': 'application/json'
      },
      body: JSON.stringify(billPayload || {})
    });
    const text = await res.text();
    let json;
    try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
    return { res, json };
  }

  let { res, json } = await run(connection.accessToken);
  if (res.status === 401 && connection?.refreshToken) {
    const refreshed = await refreshQboAccessToken(connection);
    ({ res, json } = await run(refreshed.access_token));
  }

  if (!res.ok) {
    const detail = extractQboFaultMessage(json) || json?.raw;
    throw new Error(detail ? `qbo_create_bill_failed_${res.status}:${detail}` : `qbo_create_bill_failed_${res.status}`);
  }

  const bill = json?.Bill;
  const qboId = String(bill?.Id || '').trim();
  if (!qboId) throw new Error('qbo_create_bill_missing_id');
  return bill;
}

async function qboCreateVendor(connection, payload) {
  if (!connection?.realmId) throw new Error('missing_realm_id');
  if (QBO_USE_MOCK || String(connection?.accessToken || '').startsWith('mock_access_')) {
    return { Id: String(Math.floor(Math.random() * 900000) + 100000), DisplayName: payload?.DisplayName || 'Mock Vendor', Active: true, mock: true };
  }
  if (!connection?.accessToken) throw new Error('missing_access_token_reconnect_required');

  const url = `${qboBaseUrl()}/v3/company/${encodeURIComponent(connection.realmId)}/vendor`;

  async function run(accessToken) {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        accept: 'application/json',
        'content-type': 'application/json'
      },
      body: JSON.stringify(payload || {})
    });
    const text = await res.text();
    let json;
    try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
    return { res, json };
  }

  let { res, json } = await run(connection.accessToken);
  if (res.status === 401 && connection?.refreshToken) {
    const refreshed = await refreshQboAccessToken(connection);
    ({ res, json } = await run(refreshed.access_token));
  }

  if (!res.ok) {
    const detail = extractQboFaultMessage(json) || json?.raw;
    throw new Error(detail ? `qbo_create_vendor_failed_${res.status}:${detail}` : `qbo_create_vendor_failed_${res.status}`);
  }

  const vendor = json?.Vendor;
  const qboId = String(vendor?.Id || '').trim();
  if (!qboId) throw new Error('qbo_create_vendor_missing_id');
  return vendor;
}

async function qboUpdateVendor(connection, payload) {
  if (!connection?.realmId) throw new Error('missing_realm_id');
  if (!payload?.Id) throw new Error('vendor_id_required');
  if (!payload?.SyncToken && payload?.SyncToken !== '0') throw new Error('vendor_synctoken_required');
  if (QBO_USE_MOCK || String(connection?.accessToken || '').startsWith('mock_access_')) {
    return { Id: String(payload.Id), DisplayName: payload.DisplayName || 'Mock Vendor', Active: payload.Active !== false, SyncToken: String(Number(payload.SyncToken || 0) + 1), mock: true };
  }
  if (!connection?.accessToken) throw new Error('missing_access_token_reconnect_required');

  const url = `${qboBaseUrl()}/v3/company/${encodeURIComponent(connection.realmId)}/vendor?operation=update`;

  async function run(accessToken) {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        accept: 'application/json',
        'content-type': 'application/json'
      },
      body: JSON.stringify(payload || {})
    });
    const text = await res.text();
    let json;
    try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
    return { res, json };
  }

  let { res, json } = await run(connection.accessToken);
  if (res.status === 401 && connection?.refreshToken) {
    const refreshed = await refreshQboAccessToken(connection);
    ({ res, json } = await run(refreshed.access_token));
  }

  if (!res.ok) {
    const detail = extractQboFaultMessage(json) || json?.raw;
    throw new Error(detail ? `qbo_update_vendor_failed_${res.status}:${detail}` : `qbo_update_vendor_failed_${res.status}`);
  }

  const vendor = json?.Vendor;
  const qboId = String(vendor?.Id || '').trim();
  if (!qboId) throw new Error('qbo_update_vendor_missing_id');
  return vendor;
}

async function qboCreateBillPayment(connection, payload) {
  if (!connection?.realmId) throw new Error('missing_realm_id');
  if (QBO_USE_MOCK || String(connection?.accessToken || '').startsWith('mock_access_')) {
    return { Id: String(Math.floor(Math.random() * 900000) + 100000), mock: true };
  }
  if (!connection?.accessToken) throw new Error('missing_access_token_reconnect_required');

  const url = `${qboBaseUrl()}/v3/company/${encodeURIComponent(connection.realmId)}/billpayment`;

  async function run(accessToken) {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        accept: 'application/json',
        'content-type': 'application/json'
      },
      body: JSON.stringify(payload || {})
    });
    const text = await res.text();
    let json;
    try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
    return { res, json };
  }

  let { res, json } = await run(connection.accessToken);
  if (res.status === 401 && connection?.refreshToken) {
    const refreshed = await refreshQboAccessToken(connection);
    ({ res, json } = await run(refreshed.access_token));
  }

  if (!res.ok) {
    const detail = extractQboFaultMessage(json) || json?.raw;
    throw new Error(detail ? `qbo_create_billpayment_failed_${res.status}:${detail}` : `qbo_create_billpayment_failed_${res.status}`);
  }

  const bp = json?.BillPayment;
  const qboId = String(bp?.Id || '').trim();
  if (!qboId) throw new Error('qbo_create_billpayment_missing_id');
  return bp;
}

async function qboEntityExists(connection, entity, id) {
  if (!connection?.realmId) throw new Error('missing_realm_id');
  if (!id) throw new Error('missing_qbo_id');
  const sql = `select Id, SyncToken from ${entity} where Id = '${String(id).replace(/'/g, "''")}' maxresults 1`;
  const rows = await qboQuery(connection, sql);
  const row = rows?.[0] || null;
  return row?.Id ? { exists: true, row } : { exists: false, row: null };
}

async function qboFindLinkedBillPayments(connection, billId) {
  if (!connection?.realmId) throw new Error('missing_realm_id');
  if (!billId) return [];
  const rows = await qboQuery(connection, 'select Id, TxnDate, TotalAmt, Line from BillPayment maxresults 1000');
  const hits = [];
  for (const bp of rows || []) {
    const lines = Array.isArray(bp?.Line) ? bp.Line : [];
    const linked = lines.some((ln) => {
      const linkedTxns = Array.isArray(ln?.LinkedTxn) ? ln.LinkedTxn : [];
      return linkedTxns.some((x) => String(x?.TxnId || '').trim() === String(billId));
    });
    if (linked) {
      hits.push({ id: String(bp?.Id || ''), txn_date: bp?.TxnDate || '', total_amt: Number(bp?.TotalAmt || 0) });
    }
  }
  return hits;
}

async function qboDeleteEntity(connection, entity, id) {
  if (!connection?.realmId) throw new Error('missing_realm_id');
  if (!id) throw new Error('missing_qbo_id');
  if (QBO_USE_MOCK || String(connection?.accessToken || '').startsWith('mock_access_')) {
    return { ok: true, mock: true, entity, id };
  }
  if (!connection?.accessToken) throw new Error('missing_access_token_reconnect_required');

  const found = await qboEntityExists(connection, entity, id);
  const row = found?.row || null;
  if (!row?.Id) throw new Error(`qbo_${String(entity).toLowerCase()}_not_found`);

  const url = `${qboBaseUrl()}/v3/company/${encodeURIComponent(connection.realmId)}/${String(entity).toLowerCase()}?operation=delete`;
  const payload = { Id: String(row.Id), SyncToken: String(row.SyncToken || '0'), sparse: true };

  async function run(accessToken) {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        accept: 'application/json',
        'content-type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    const text = await res.text();
    let json;
    try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
    return { res, json };
  }

  let { res, json } = await run(connection.accessToken);
  if (res.status === 401 && connection?.refreshToken) {
    const refreshed = await refreshQboAccessToken(connection);
    ({ res, json } = await run(refreshed.access_token));
  }

  if (!res.ok) {
    const detail = extractQboFaultMessage(json) || json?.raw;
    throw new Error(detail ? `qbo_delete_${String(entity).toLowerCase()}_failed_${res.status}:${detail}` : `qbo_delete_${String(entity).toLowerCase()}_failed_${res.status}`);
  }

  return json;
}

async function syncMappingsFromQbo(tenantId) {
  const conn = qboConnectionsByTenant.get(tenantId);
  if (!conn?.connected) throw new Error('qbo_not_connected');

  const [vendorsRaw, departmentsRaw, classesRaw, taxCodesRaw, accountsRaw] = await Promise.all([
    qboQuery(conn, 'select Id, DisplayName, Active from Vendor maxresults 1000'),
    qboQuery(conn, 'select Id, Name, Active from Department maxresults 1000'),
    qboQuery(conn, 'select Id, Name, Active from Class maxresults 1000'),
    qboQuery(conn, 'select Id, Name, Active from TaxCode maxresults 1000'),
    qboQuery(conn, 'select Id, Name, FullyQualifiedName, AccountType, AccountSubType, Classification, Active from Account maxresults 1000')
  ]);

  await replaceTenantMappings(tenantId, 'vendor', vendorsRaw.map((x) => toMappingItem('vendor', x)));
  await replaceTenantMappings(tenantId, 'department', departmentsRaw.map((x) => toMappingItem('department', x)));
  await replaceTenantMappings(tenantId, 'class', classesRaw.map((x) => toMappingItem('class', x)));
  await replaceTenantMappings(tenantId, 'taxcode', taxCodesRaw.map((x) => toMappingItem('taxcode', x)));
  await replaceTenantMappings(tenantId, 'account', accountsRaw.map((x) => toMappingItem('account', x)));

  const aligned = await alignBillRulesWithMappings(tenantId);

  return {
    vendors: vendorsRaw.length,
    departments: departmentsRaw.length,
    classes: classesRaw.length,
    taxCodes: taxCodesRaw.length,
    accounts: accountsRaw.length,
    billRulesAligned: aligned
  };
}

function requireAuthAndTenant(req, reply) {
  if (!req.session.user) {
    reply.code(401).send({ ok: false, error: 'unauthorized' });
    return null;
  }
  if (!req.session.tenant?.tenantId) {
    reply.code(400).send({ ok: false, error: 'tenant_not_selected' });
    return null;
  }
  return {
    user: req.session.user,
    tenant: req.session.tenant
  };
}

async function exchangeQboToken({ code, realmId }) {
  if (QBO_USE_MOCK || String(code).startsWith('mock_')) {
    return {
      access_token: `mock_access_${code}`,
      refresh_token: `mock_refresh_${code}`,
      expires_in: 3600,
      x_refresh_token_expires_in: 8726400,
      token_type: 'bearer',
      realmId: realmId || 'mock-realm'
    };
  }

  const basic = Buffer.from(`${QBO_CLIENT_ID}:${QBO_CLIENT_SECRET}`).toString('base64');
  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: QBO_REDIRECT_URI
  });

  const res = await fetch(QBO_TOKEN_URL, {
    method: 'POST',
    headers: {
      authorization: `Basic ${basic}`,
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json'
    },
    body: params.toString()
  });

  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }

  if (!res.ok) {
    throw new Error(`qbo_token_exchange_failed:${res.status}:${JSON.stringify(json)}`);
  }

  return {
    ...json,
    realmId: realmId || json?.realmId || null
  };
}

async function refreshQboAccessToken(connection) {
  if (!connection?.refreshToken) throw new Error('missing_refresh_token_reconnect_required');
  const basic = Buffer.from(`${QBO_CLIENT_ID}:${QBO_CLIENT_SECRET}`).toString('base64');
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: String(connection.refreshToken)
  });

  const res = await fetch(QBO_TOKEN_URL, {
    method: 'POST',
    headers: {
      authorization: `Basic ${basic}`,
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json'
    },
    body: params.toString()
  });

  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }

  if (!res.ok) {
    throw new Error(`qbo_token_refresh_failed:${res.status}:${JSON.stringify(json)}`);
  }

  const updated = {
    ...connection,
    connected: true,
    tokenType: json?.token_type || connection.tokenType || null,
    accessToken: json?.access_token || connection.accessToken || null,
    refreshToken: json?.refresh_token || connection.refreshToken || null,
    accessTokenPreview: json?.access_token ? String(json.access_token).slice(0, 12) : connection.accessTokenPreview || null,
    refreshTokenPreview: json?.refresh_token ? String(json.refresh_token).slice(0, 12) : connection.refreshTokenPreview || null,
    expiresIn: json?.expires_in || connection.expiresIn || null,
    refreshExpiresIn: json?.x_refresh_token_expires_in || connection.refreshExpiresIn || null,
    connectedAt: new Date().toISOString()
  };

  qboConnectionsByTenant.set(connection.tenantId, updated);
  await persistQboConnection(updated);
  return json;
}

// Slice-1 auth contract (fixed):
// - GET  /auth/me      -> { ok: true, user: {username, role} | null, tenant: {tenantId, tenantCode} | null }
// - POST /auth/login   -> 200 { ok: true, user } OR 401 { ok: false, error: 'invalid_credentials' }
// - POST /tenant/select -> 200 { ok: true, tenant: {tenantId, tenantCode} }
// - POST /auth/logout  -> { ok: true }
app.get('/auth/me', async (req) => {
  const user = req.session.user;
  const tenant = req.session.tenant;
  return { ok: true, user: user || null, tenant: tenant || null };
});

app.post('/auth/login', async (req, reply) => {
  const schema = z.object({ username: z.string().min(1), password: z.string().min(1) });
  const body = schema.parse(req.body);

  const userRec = await getUserByUsername(body.username);
  if (!userRec || !verifyPassword(body.password, userRec.password_hash)) {
    return reply.code(401).send({ ok: false, error: 'invalid_credentials' });
  }
  if (userRec.status !== 'active') {
    return reply.code(403).send({ ok: false, error: 'user_disabled' });
  }

  req.session.user = { id: userRec.id, username: userRec.username, role: userRec.role };
  req.session.tenant = null;

  const preferred = await getUserLastTenant(userRec.username);
  if (preferred && tenantsById.has(preferred)) {
    const found = tenantsById.get(preferred);
    req.session.tenant = { tenantId: preferred, tenantCode: found.tenantCode, name: found.name };
  }

  return { ok: true, user: req.session.user, tenant: req.session.tenant || null };
});

app.get('/tenants', async (req, reply) => {
  if (!req.session.user) {
    return reply.code(401).send({ ok: false, error: 'unauthorized' });
  }
  return { ok: true, tenants: Array.from(tenantsById.values()) };
});

app.post('/tenants', async (req, reply) => {
  if (!req.session.user) {
    return reply.code(401).send({ ok: false, error: 'unauthorized' });
  }

  const schema = z.object({
    name: z.string().min(1),
    tenantId: z.string().min(1).optional()
  });
  const body = schema.parse(req.body);

  const idBase = (body.tenantId || body.name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const tenantId = `t-${idBase || randomUUID().slice(0, 8)}`;

  if (tenantsById.has(tenantId)) {
    return reply.code(409).send({ ok: false, error: 'tenant_exists', tenantId });
  }

  const tenant = { tenantId, tenantCode: tenantId, name: body.name.trim() };
  tenantsById.set(tenantId, tenant);
  await persistTenant(tenant);
  return { ok: true, tenant };
});

app.delete('/tenants/:tenantId', async (req, reply) => {
  if (!req.session.user) {
    return reply.code(401).send({ ok: false, error: 'unauthorized' });
  }

  const tenantId = String(req.params.tenantId || '').trim();
  if (!tenantId) return reply.code(400).send({ ok: false, error: 'invalid_tenant' });

  if (!tenantsById.has(tenantId)) {
    return reply.code(404).send({ ok: false, error: 'tenant_not_found' });
  }

  tenantsById.delete(tenantId);
  qboConnectionsByTenant.delete(tenantId);
  for (const [sid, s] of submissionsById.entries()) {
    if (s.tenant_id === tenantId) submissionsById.delete(sid);
  }
  await deleteTenantState(tenantId);

  if (req.session.tenant?.tenantId === tenantId) {
    req.session.tenant = null;
  }

  return { ok: true, deletedTenantId: tenantId };
});

app.post('/tenant/select', async (req, reply) => {
  if (!req.session.user) {
    return reply.code(401).send({ ok: false, error: 'unauthorized' });
  }

  const schema = z.object({
    tenantId: z.union([z.string().min(1), z.number().int().nonnegative()]),
    tenantCode: z.string().min(1)
  });
  const body = schema.parse(req.body);

  const tenantId = String(body.tenantId);
  const found = tenantsById.get(tenantId);
  if (!found) {
    return reply.code(404).send({ ok: false, error: 'tenant_not_found' });
  }

  req.session.tenant = {
    tenantId,
    tenantCode: found.tenantCode,
    name: found.name
  };
  await saveUserLastTenant(req.session.user?.username, tenantId);

  return { ok: true, tenant: req.session.tenant };
});

app.get('/admin/users', async (req, reply) => {
  const admin = requireAdmin(req, reply);
  if (!admin) return;
  return { ok: true, rows: await listUsers() };
});

app.post('/admin/users', async (req, reply) => {
  const admin = requireAdmin(req, reply);
  if (!admin) return;

  const schema = z.object({
    username: z.string().min(3).max(64).regex(/^[A-Za-z0-9._-]+$/),
    password: z.string().min(6),
    role: z.enum(['admin', 'user']).default('user')
  });
  const body = schema.parse(req.body || {});

  const existing = await getUserByUsername(body.username);
  if (existing) return reply.code(409).send({ ok: false, error: 'user_exists' });

  const row = await createUser({ username: body.username, password: body.password, role: body.role, createdBy: admin.username });
  return reply.code(201).send({ ok: true, row });
});

app.put('/admin/users/:id', async (req, reply) => {
  const admin = requireAdmin(req, reply);
  if (!admin) return;

  const schema = z.object({ status: z.enum(['active', 'disabled']) });
  const body = schema.parse(req.body || {});

  const row = await updateUserAdminFields(String(req.params.id || ''), { status: body.status });
  if (!row) return reply.code(404).send({ ok: false, error: 'user_not_found' });
  return { ok: true, row };
});

app.post('/admin/users/:id/reset-password', async (req, reply) => {
  const admin = requireAdmin(req, reply);
  if (!admin) return;

  const schema = z.object({ password: z.string().min(6) });
  const body = schema.parse(req.body || {});
  const row = await resetUserPassword(String(req.params.id || ''), body.password);
  if (!row) return reply.code(404).send({ ok: false, error: 'user_not_found' });
  return { ok: true, row };
});

// Slice: Tenant-QBO Connect
app.post('/qbo/connect/start', async (req, reply) => {
  const ctx = requireAuthAndTenant(req, reply);
  if (!ctx) return;

  const state = randomUUID();
  qboStateStore.set(state, { tenantId: ctx.tenant.tenantId, createdAt: Date.now() });

  const authUrl = new URL(QBO_AUTHORIZE_BASE);
  authUrl.searchParams.set('client_id', QBO_CLIENT_ID);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', QBO_SCOPE);
  authUrl.searchParams.set('redirect_uri', QBO_REDIRECT_URI);
  authUrl.searchParams.set('state', state);

  return {
    ok: true,
    tenant: ctx.tenant,
    state,
    authorizationUrl: authUrl.toString()
  };
});

app.get('/qbo/connect/callback', async (req, reply) => {
  const querySchema = z.object({
    state: z.string().min(1),
    code: z.string().min(1),
    realmId: z.string().min(1).optional()
  });
  const q = querySchema.parse(req.query || {});

  const saved = qboStateStore.get(q.state);
  if (!saved) {
    return reply.code(400).send({ ok: false, error: 'invalid_state' });
  }

  qboStateStore.delete(q.state);

  try {
    const token = await exchangeQboToken({ code: q.code, realmId: q.realmId });
    const record = {
      tenantId: saved.tenantId,
      connected: true,
      connectedAt: new Date().toISOString(),
      realmId: token.realmId || q.realmId || null,
      tokenType: token.token_type || null,
      accessTokenPreview: token.access_token ? String(token.access_token).slice(0, 12) : null,
      refreshTokenPreview: token.refresh_token ? String(token.refresh_token).slice(0, 12) : null,
      accessToken: token.access_token || null,
      refreshToken: token.refresh_token || null,
      expiresIn: token.expires_in || null,
      refreshExpiresIn: token.x_refresh_token_expires_in || null
    };
    qboConnectionsByTenant.set(saved.tenantId, record);
    await persistQboConnection(record);

    return {
      ok: true,
      tenantId: saved.tenantId,
      realmId: record.realmId,
      connected: true
    };
  } catch (err) {
    req.log.error({ err }, 'QBO callback token exchange failed');
    return reply.code(502).send({ ok: false, error: 'qbo_token_exchange_failed' });
  }
});

app.get('/qbo/connect/status', async (req, reply) => {
  const ctx = requireAuthAndTenant(req, reply);
  if (!ctx) return;

  const conn = qboConnectionsByTenant.get(ctx.tenant.tenantId);
  return {
    ok: true,
    tenant: ctx.tenant,
    qbo: conn
      ? {
          connected: true,
          tokenReady: !!conn.accessToken,
          realmId: conn.realmId,
          connectedAt: conn.connectedAt,
          tokenType: conn.tokenType,
          expiresIn: conn.expiresIn
        }
      : {
          connected: false,
          tokenReady: false
        }
  };
});

app.get('/qbo/connect/connections', async (req, reply) => {
  if (!req.session.user) {
    return reply.code(401).send({ ok: false, error: 'unauthorized' });
  }

  const rows = Array.from(tenantsById.values()).map((t) => {
    const conn = qboConnectionsByTenant.get(t.tenantId);
    const tokenReady = !!(conn?.accessToken);
    return {
      tenantId: t.tenantId,
      tenantCode: t.tenantCode,
      tenantName: t.name,
      connected: !!conn,
      tokenReady,
      realmId: conn?.realmId || null,
      connectedAt: conn?.connectedAt || null
    };
  });

  return { ok: true, rows };
});

app.post('/mappings/sync', async (req, reply) => {
  const ctx = requireAuthAndTenant(req, reply);
  if (!ctx) return;

  try {
    const counts = await syncMappingsFromQbo(ctx.tenant.tenantId);
    return { ok: true, tenantId: ctx.tenant.tenantId, counts };
  } catch (e) {
    return reply.code(422).send({ ok: false, error: 'mapping_sync_failed', detail: String(e?.message || e) });
  }
});

app.get('/mappings/catalog', async (req, reply) => {
  const ctx = requireAuthAndTenant(req, reply);
  if (!ctx) return;

  try {
    const catalog = await getTenantMappings(ctx.tenant.tenantId);
    const stats = await getTenantMappingStats(ctx.tenant.tenantId);
    return { ok: true, tenantId: ctx.tenant.tenantId, catalog, stats };
  } catch (e) {
    return reply.code(500).send({ ok: false, error: 'mapping_catalog_failed', detail: String(e?.message || e) });
  }
});

function normalizeVendorView(v) {
  return {
    id: String(v?.Id || ''),
    sync_token: String(v?.SyncToken || ''),
    name: String(v?.DisplayName || ''),
    company_name: String(v?.CompanyName || ''),
    active: v?.Active !== false,
    email: String(v?.PrimaryEmailAddr?.Address || ''),
    phone: String(v?.PrimaryPhone?.FreeFormNumber || ''),
    tax_identifier: String(v?.TaxIdentifier || ''),
    term_id: String(v?.TermRef?.value || ''),
    currency_id: String(v?.CurrencyRef?.value || ''),
    bill_addr: {
      line1: String(v?.BillAddr?.Line1 || ''),
      city: String(v?.BillAddr?.City || ''),
      country_sub_division_code: String(v?.BillAddr?.CountrySubDivisionCode || ''),
      postal_code: String(v?.BillAddr?.PostalCode || ''),
      country: String(v?.BillAddr?.Country || '')
    },
    raw: v || {}
  };
}

function buildVendorPayload(body = {}, { forUpdate = false, allowEmpty = false } = {}) {
  const payload = {};
  const name = String(body?.display_name || body?.name || '').trim();
  const companyName = String(body?.company_name || '').trim();
  const email = String(body?.email || '').trim();
  const phone = String(body?.phone || '').trim();
  const taxIdentifier = String(body?.tax_identifier || '').trim();
  const termId = String(body?.term_id || '').trim();
  const currencyId = String(body?.currency_id || '').trim();
  const hasActive = Object.prototype.hasOwnProperty.call(body || {}, 'active');

  if (name) payload.DisplayName = name;
  if (companyName) payload.CompanyName = companyName;
  if (email) payload.PrimaryEmailAddr = { Address: email };
  if (phone) payload.PrimaryPhone = { FreeFormNumber: phone };
  if (taxIdentifier) payload.TaxIdentifier = taxIdentifier;
  if (termId) payload.TermRef = { value: termId };
  if (currencyId) payload.CurrencyRef = { value: currencyId };
  if (hasActive) payload.Active = !!body.active;

  const billAddr = body?.bill_addr && typeof body.bill_addr === 'object' ? body.bill_addr : {};
  const addr = {
    Line1: String(billAddr?.line1 || '').trim(),
    City: String(billAddr?.city || '').trim(),
    CountrySubDivisionCode: String(billAddr?.country_sub_division_code || '').trim(),
    PostalCode: String(billAddr?.postal_code || '').trim(),
    Country: String(billAddr?.country || '').trim()
  };
  if (Object.values(addr).some(Boolean)) payload.BillAddr = addr;

  if (!forUpdate && !payload.DisplayName) throw new Error('vendor_name_required');
  if (forUpdate && !allowEmpty && !Object.keys(payload).length) throw new Error('nothing_to_update');
  return payload;
}

async function refreshVendorMappings(tenantId, conn) {
  const vendorsRaw = await qboQuery(conn, 'select Id, DisplayName, Active from Vendor maxresults 1000');
  await replaceTenantMappings(tenantId, 'vendor', vendorsRaw.map((x) => toMappingItem('vendor', x)));
}

app.get('/vendors', async (req, reply) => {
  const ctx = requireAuthAndTenant(req, reply);
  if (!ctx) return;

  const conn = qboConnectionsByTenant.get(ctx.tenant.tenantId);
  if (!conn?.connected) return reply.code(422).send({ ok: false, error: 'qbo_not_connected' });

  try {
    const rows = await qboQuery(conn, 'select Id, SyncToken, DisplayName, CompanyName, Active, PrimaryEmailAddr, PrimaryPhone, TaxIdentifier, BillAddr, CurrencyRef, TermRef from Vendor maxresults 1000');
    return { ok: true, tenantId: ctx.tenant.tenantId, rows: (rows || []).map(normalizeVendorView) };
  } catch (e) {
    return reply.code(422).send({ ok: false, error: 'vendor_list_failed', detail: String(e?.message || e) });
  }
});

app.post('/vendors', async (req, reply) => {
  const ctx = requireAuthAndTenant(req, reply);
  if (!ctx) return;

  const conn = qboConnectionsByTenant.get(ctx.tenant.tenantId);
  if (!conn?.connected) return reply.code(422).send({ ok: false, error: 'qbo_not_connected' });

  try {
    const payload = buildVendorPayload(req.body || {}, { forUpdate: false });
    const vendor = await qboCreateVendor(conn, payload);
    await refreshVendorMappings(ctx.tenant.tenantId, conn);
    return { ok: true, tenantId: ctx.tenant.tenantId, vendor: normalizeVendorView(vendor) };
  } catch (e) {
    const msg = String(e?.message || e);
    if (msg === 'vendor_name_required') return reply.code(400).send({ ok: false, error: msg });
    return reply.code(422).send({ ok: false, error: 'vendor_create_failed', detail: msg });
  }
});

app.put('/vendors/:id', async (req, reply) => {
  const ctx = requireAuthAndTenant(req, reply);
  if (!ctx) return;

  const id = String(req.params?.id || '').trim();
  if (!id) return reply.code(400).send({ ok: false, error: 'vendor_id_required' });

  const conn = qboConnectionsByTenant.get(ctx.tenant.tenantId);
  if (!conn?.connected) return reply.code(422).send({ ok: false, error: 'qbo_not_connected' });

  try {
    const found = await qboEntityExists(conn, 'Vendor', id);
    if (!found?.exists || !found?.row?.Id) return reply.code(404).send({ ok: false, error: 'vendor_not_found' });

    const forceSync = !!req.body?.force_sync;
    const payload = buildVendorPayload(req.body || {}, { forUpdate: true, allowEmpty: forceSync });

    let vendor;
    if (Object.keys(payload).length) {
      payload.Id = String(found.row.Id);
      payload.SyncToken = String(found.row.SyncToken || '0');
      payload.sparse = true;
      vendor = await qboUpdateVendor(conn, payload);
    } else {
      vendor = found.row;
    }

    await refreshVendorMappings(ctx.tenant.tenantId, conn);
    return { ok: true, tenantId: ctx.tenant.tenantId, vendor: normalizeVendorView(vendor), mode: Object.keys(payload).length ? 'updated' : 'synced' };
  } catch (e) {
    const msg = String(e?.message || e);
    if (msg === 'nothing_to_update') return reply.code(400).send({ ok: false, error: msg });
    return reply.code(422).send({ ok: false, error: 'vendor_update_failed', detail: msg });
  }
});

app.get('/bill-rules', async (req, reply) => {
  const ctx = requireAuthAndTenant(req, reply);
  if (!ctx) return;
  return { ok: true, tenantId: ctx.tenant.tenantId, rules: getBillRules(ctx.tenant.tenantId) };
});

app.post('/bill-rules', async (req, reply) => {
  const ctx = requireAuthAndTenant(req, reply);
  if (!ctx) return;

  const body = (req.body && typeof req.body === 'object') ? req.body : {};
  if (!body.rules || typeof body.rules !== 'object') {
    return reply.code(400).send({ ok: false, error: 'invalid_payload' });
  }

  try {
    await saveBillRules(ctx.tenant.tenantId, body.rules);
    return { ok: true, tenantId: ctx.tenant.tenantId };
  } catch (e) {
    return reply.code(500).send({ ok: false, error: 'save_rules_failed', detail: String(e?.message || e) });
  }
});

app.get('/bill-payment-rules', async (req, reply) => {
  const ctx = requireAuthAndTenant(req, reply);
  if (!ctx) return;
  return { ok: true, tenantId: ctx.tenant.tenantId, rules: getBillPaymentRules(ctx.tenant.tenantId) };
});

app.post('/bill-payment-rules', async (req, reply) => {
  const ctx = requireAuthAndTenant(req, reply);
  if (!ctx) return;

  const body = (req.body && typeof req.body === 'object') ? req.body : {};
  if (!body.rules || typeof body.rules !== 'object') {
    return reply.code(400).send({ ok: false, error: 'invalid_payload' });
  }

  try {
    await saveBillPaymentRules(ctx.tenant.tenantId, body.rules);
    return { ok: true, tenantId: ctx.tenant.tenantId };
  } catch (e) {
    return reply.code(500).send({ ok: false, error: 'save_rules_failed', detail: String(e?.message || e) });
  }
});

app.get('/bill-payments/open-bills', async (req, reply) => {
  const ctx = requireAuthAndTenant(req, reply);
  if (!ctx) return;
  const vendorName = String(req.query?.vendor_ref_text || '').trim();
  if (!vendorName) return reply.code(400).send({ ok: false, error: 'vendor_ref_text_required' });

  const vendorId = await findMappingId(ctx.tenant.tenantId, 'vendor', vendorName);
  if (!vendorId) return reply.code(422).send({ ok: false, error: 'vendor_mapping_not_found' });

  const conn = qboConnectionsByTenant.get(ctx.tenant.tenantId);
  if (!conn?.connected) return reply.code(422).send({ ok: false, error: 'qbo_not_connected' });

  try {
    const sql = `select Id, DocNumber, TxnDate, DueDate, TotalAmt, Balance, PrivateNote from Bill where VendorRef = '${String(vendorId).replace(/'/g, "''")}' and Balance > '0' maxresults 1000`;
    const rows = await qboQuery(conn, sql);
    const out = rows.map((x) => {
      const qboId = String(x?.Id || '').trim();
      const linked = Array.from(submissionsById.values()).find((s) => String(s?.result?.qbo_id || '') === qboId);
      return {
        bill_id: qboId,
        doc_number: x?.DocNumber || '',
        bill_date: x?.TxnDate || '',
        due_date: x?.DueDate || '',
        amount: Number(x?.TotalAmt || 0),
        open_balance: Number(x?.Balance || 0),
        client_ref: linked?.client_ref || '',
        memo: x?.PrivateNote || ''
      };
    });
    return { ok: true, rows: out };
  } catch (e) {
    return reply.code(422).send({ ok: false, error: 'open_bills_fetch_failed', detail: String(e?.message || e) });
  }
});

app.get('/submissions', async (req, reply) => {
  const ctx = requireAuthAndTenant(req, reply);
  if (!ctx) return;
  return { ok: true, rows: listSubmissionsForTenant(ctx.tenant.tenantId) };
});

app.post('/submissions', async (req, reply) => {
  const ctx = requireAuthAndTenant(req, reply);
  if (!ctx) return;

  const schema = z.object({
    kind: z.enum(['bill', 'bill_payment']),
    client_ref: z.string().min(1),
    memo: z.string().optional().default('')
  });
  const body = schema.parse(req.body || {});

    if (!isClientRefUnique(body.client_ref, null)) {
      const existing = findSubmissionByClientRef(body.client_ref, null);
      return reply.code(409).send({
        ok: false,
        error: 'client_ref_not_unique',
        existing_submission_id: existing?.id || null,
        existing_view_path: existing?.id ? `/submissions/${existing.id}/edit` : null,
        existing_client_ref: existing?.client_ref || null,
        existing_kind: existing?.kind || null,
        existing_status: existing?.status || null
      });
  }

  const now = new Date().toISOString();
  const id = `sub_${randomUUID().slice(0, 8)}`;
  const row = {
    id,
    tenant_id: ctx.tenant.tenantId,
    company_key: 'default',
    kind: body.kind,
    client_ref: body.client_ref.trim(),
    memo: (body.memo || '').trim(),
    status: 'draft',
    payload: defaultPayloadByKind(body.kind),
    precheck: null,
    result: null,
    created_at: now,
    updated_at: now
  };

  submissionsById.set(id, row);
  await saveSubmission(row);
  return reply.code(201).send({ ok: true, row });
});

app.get('/submissions/:id', async (req, reply) => {
  const ctx = requireAuthAndTenant(req, reply);
  if (!ctx) return;

  const row = submissionsById.get(req.params.id);
  if (!row || row.tenant_id !== ctx.tenant.tenantId) {
    return reply.code(404).send({ ok: false, error: 'not_found' });
  }
  return { ok: true, row };
});

app.put('/submissions/:id', async (req, reply) => {
  const ctx = requireAuthAndTenant(req, reply);
  if (!ctx) return;

  const row = submissionsById.get(req.params.id);
  if (!row || row.tenant_id !== ctx.tenant.tenantId) {
    return reply.code(404).send({ ok: false, error: 'not_found' });
  }

  const body = (req.body && typeof req.body === 'object') ? req.body : {};
  if (typeof body.client_ref === 'string') {
    const nextRef = body.client_ref.trim();
      if (!isClientRefUnique(nextRef, row.id)) {
        const existing = findSubmissionByClientRef(nextRef, row.id);
        return reply.code(409).send({
          ok: false,
          error: 'client_ref_not_unique',
          existing_submission_id: existing?.id || null,
          existing_view_path: existing?.id ? `/submissions/${existing.id}/edit` : null,
          existing_client_ref: existing?.client_ref || null,
          existing_kind: existing?.kind || null,
          existing_status: existing?.status || null
        });
    }
    row.client_ref = nextRef;
  }
  if (typeof body.memo === 'string') row.memo = body.memo.trim();
  if (body.payload && typeof body.payload === 'object') {
    row.payload = await normalizeSubmissionPayloadForStorage(row.kind, row.tenant_id, body.payload);
  }
  row.updated_at = new Date().toISOString();
  await saveSubmission(row);

  return { ok: true, row };
});

app.post('/submissions/:id/validate', async (req, reply) => {
  const ctx = requireAuthAndTenant(req, reply);
  if (!ctx) return;

  const row = submissionsById.get(req.params.id);
  if (!row || row.tenant_id !== ctx.tenant.tenantId) {
    return reply.code(404).send({ ok: false, error: 'not_found' });
  }

  row.payload = await normalizeSubmissionPayloadForStorage(row.kind, row.tenant_id, row.payload);
  const result = validateSubmissionRow(row);
  if (!result.ok) {
    row.validation = { ok: false, issues: result.issues, source_payload: row.payload || {}, qbo_payload: null, at: new Date().toISOString() };
    await saveSubmission(row);
    return reply.code(422).send({ ok: false, error: 'validation_failed', issues: result.issues, row });
  }

  if (row.kind === 'bill') {
    const compiled = await compileBillToQboPayload(row);
    if (compiled.issues.length) {
      row.validation = { ok: false, issues: compiled.issues, source_payload: row.payload || {}, qbo_payload: compiled.qboPayload, at: new Date().toISOString() };
      await saveSubmission(row);
      return reply.code(422).send({ ok: false, error: 'mapping_failed', issues: compiled.issues, row });
    }
    row.validation = { ok: true, issues: [], source_payload: row.payload || {}, qbo_payload: compiled.qboPayload, at: new Date().toISOString() };
  } else if (row.kind === 'bill_payment') {
    const compiled = await compileBillPaymentToQboPayload(row);
    if (compiled.issues.length) {
      row.validation = { ok: false, issues: compiled.issues, source_payload: row.payload || {}, qbo_payload: compiled.qboPayload, at: new Date().toISOString() };
      await saveSubmission(row);
      return reply.code(422).send({ ok: false, error: 'mapping_failed', issues: compiled.issues, row });
    }
    row.validation = { ok: true, issues: [], source_payload: row.payload || {}, qbo_payload: compiled.qboPayload, at: new Date().toISOString() };
  }

  await saveSubmission(row);
  return { ok: true, row };
});

app.post('/submissions/:id/precheck', async (req, reply) => {
  const ctx = requireAuthAndTenant(req, reply);
  if (!ctx) return;

  const row = submissionsById.get(req.params.id);
  if (!row || row.tenant_id !== ctx.tenant.tenantId) {
    return reply.code(404).send({ ok: false, error: 'not_found' });
  }

  row.payload = await normalizeSubmissionPayloadForStorage(row.kind, row.tenant_id, row.payload);
  const result = validateSubmissionRow(row);
  let issues = [...result.issues];
  let qboPayload = null;

  if (result.ok && row.kind === 'bill') {
    const compiled = await compileBillToQboPayload(row);
    qboPayload = compiled.qboPayload;
    if (compiled.issues.length) issues = issues.concat(compiled.issues);
  } else if (result.ok && row.kind === 'bill_payment') {
    const compiled = await compileBillPaymentToQboPayload(row);
    qboPayload = compiled.qboPayload;
    if (compiled.issues.length) issues = issues.concat(compiled.issues);
  }

  const ok = issues.length === 0;
  row.validation = { ok, issues, source_payload: row.payload || {}, qbo_payload: qboPayload, at: new Date().toISOString() };
  row.precheck = {
    ok,
    issues,
    checked_at: new Date().toISOString()
  };

  if (!ok) {
    row.status = 'failed';
    await saveSubmission(row);
    return reply.code(422).send({ ok: false, error: 'precheck_failed', precheck: row.precheck, row });
  }

  row.status = 'reviewed';
  row.result = { ok: true, mode: 'precheck', message: 'Precheck passed (not posted).', at: new Date().toISOString() };
  row.updated_at = new Date().toISOString();
  await saveSubmission(row);
  return { ok: true, precheck: row.precheck, row };
});

app.post('/submissions/:id/submit', async (req, reply) => {
  const ctx = requireAuthAndTenant(req, reply);
  if (!ctx) return;

  const row = submissionsById.get(req.params.id);
  if (!row || row.tenant_id !== ctx.tenant.tenantId) {
    return reply.code(404).send({ ok: false, error: 'not_found' });
  }

  row.payload = await normalizeSubmissionPayloadForStorage(row.kind, row.tenant_id, row.payload);
  const result = validateSubmissionRow(row);
  let issues = [...result.issues];
  let qboPayload = null;
  if (result.ok && row.kind === 'bill') {
    const compiled = await compileBillToQboPayload(row);
    qboPayload = compiled.qboPayload;
    if (compiled.issues.length) issues = issues.concat(compiled.issues);
  } else if (result.ok && row.kind === 'bill_payment') {
    const compiled = await compileBillPaymentToQboPayload(row);
    qboPayload = compiled.qboPayload;
    if (compiled.issues.length) issues = issues.concat(compiled.issues);
  }

  const ok = issues.length === 0;
  row.validation = { ok, issues, source_payload: row.payload || {}, qbo_payload: qboPayload, at: new Date().toISOString() };

  if (!ok) {
    row.status = 'failed';
    row.result = { ok: false, mode: 'submit', error_detail: issues.join(', '), at: new Date().toISOString() };
    row.updated_at = new Date().toISOString();
    await saveSubmission(row);
    return reply.code(422).send({ ok: false, error: 'validation_failed', issues, row });
  }

  try {
    const conn = qboConnectionsByTenant.get(ctx.tenant.tenantId);
    if (!conn?.connected) {
      row.status = 'failed';
      row.result = { ok: false, mode: 'submit', error_detail: 'qbo_not_connected', at: new Date().toISOString() };
      row.updated_at = new Date().toISOString();
      await saveSubmission(row);
      return reply.code(422).send({ ok: false, error: 'qbo_not_connected', row });
    }

    if (row.kind === 'bill') {
      const createdBill = await qboCreateBill(conn, qboPayload);
      row.status = 'posted';
      row.result = {
        ok: true,
        mode: 'submit',
        qbo_id: String(createdBill?.Id || ''),
        request_payload: qboPayload,
        qbo_response: createdBill,
        at: new Date().toISOString()
      };
      row.updated_at = new Date().toISOString();
      await saveSubmission(row);
      return { ok: true, row };
    }

    if (row.kind === 'bill_payment') {
      const created = await qboCreateBillPayment(conn, qboPayload);
      row.status = 'posted';
      row.result = {
        ok: true,
        mode: 'submit',
        qbo_id: String(created?.Id || ''),
        request_payload: qboPayload,
        qbo_response: created,
        at: new Date().toISOString()
      };
      row.updated_at = new Date().toISOString();
      await saveSubmission(row);
      return { ok: true, row };
    }

    row.status = 'failed';
    row.result = { ok: false, mode: 'submit', error_detail: 'unsupported_kind_for_qbo_submit', at: new Date().toISOString() };
    row.updated_at = new Date().toISOString();
    await saveSubmission(row);
    return reply.code(422).send({ ok: false, error: 'unsupported_kind_for_qbo_submit', row });
  } catch (e) {
    row.status = 'failed';
    row.result = {
      ok: false,
      mode: 'submit',
      error_detail: String(e?.message || e || 'qbo_submit_failed'),
      request_payload: qboPayload,
      at: new Date().toISOString()
    };
    row.updated_at = new Date().toISOString();
    await saveSubmission(row);
    return reply.code(422).send({ ok: false, error: 'qbo_submit_failed', detail: row.result.error_detail, row });
  }
});

app.get('/submissions/:id/delete-check', async (req, reply) => {
  const ctx = requireAuthAndTenant(req, reply);
  if (!ctx) return;

  const row = submissionsById.get(req.params.id);
  if (!row || row.tenant_id !== ctx.tenant.tenantId) {
    return reply.code(404).send({ ok: false, error: 'not_found' });
  }

  const qboId = String(row?.result?.qbo_id || '').trim();
  if (!qboId) return { ok: true, has_qbo_id: false, qbo_exists: null };

  const conn = qboConnectionsByTenant.get(ctx.tenant.tenantId);
  if (!conn?.connected) return reply.code(422).send({ ok: false, error: 'qbo_not_connected_for_delete_check' });

  try {
    const entity = row.kind === 'bill_payment' ? 'BillPayment' : 'Bill';
    const found = await qboEntityExists(conn, entity, qboId);
    return { ok: true, has_qbo_id: true, qbo_exists: !!found.exists, qbo_id: qboId, entity };
  } catch (e) {
    return reply.code(422).send({ ok: false, error: 'qbo_delete_check_failed', detail: String(e?.message || e) });
  }
});

app.delete('/submissions/:id', async (req, reply) => {
  const ctx = requireAuthAndTenant(req, reply);
  if (!ctx) return;

  const row = submissionsById.get(req.params.id);
  if (!row || row.tenant_id !== ctx.tenant.tenantId) {
    return reply.code(404).send({ ok: false, error: 'not_found' });
  }

  const deleteQbo = String(req.query?.delete_qbo || '') === '1';
  const qboId = String(row?.result?.qbo_id || '').trim();
  const entity = row.kind === 'bill_payment' ? 'BillPayment' : 'Bill';

  let qbo_deleted = false;
  let qbo_delete_error = null;

  if (deleteQbo && qboId) {
    const conn = qboConnectionsByTenant.get(ctx.tenant.tenantId);
    if (!conn?.connected) {
      qbo_delete_error = 'qbo_not_connected_for_delete';
    } else {
      try {
        const isNumericQboId = /^\d+$/.test(qboId);
        if (isNumericQboId) {
          const found = await qboEntityExists(conn, entity, qboId);
          if (found?.exists) {
            if (entity === 'Bill') {
              const linked = await qboFindLinkedBillPayments(conn, qboId);
              if (linked.length > 0) {
                qbo_delete_error = `bill_has_linked_billpayment:${linked.map((x) => x.id).join(',')}`;
              } else {
                await qboDeleteEntity(conn, entity, qboId);
                qbo_deleted = true;
              }
            } else {
              await qboDeleteEntity(conn, entity, qboId);
              qbo_deleted = true;
            }
          }
        } else {
          qbo_delete_error = `invalid_qbo_id_for_delete:${qboId}`;
        }
      } catch (e) {
        qbo_delete_error = String(e?.message || e || 'qbo_delete_failed');
      }
    }
  }

  // Always physically delete local record (per UX requirement), regardless of deleteQbo checkbox.
  submissionsById.delete(row.id);
  if (db) await dbExec('delete from app_submission where id=$1', [row.id]);

  return {
    ok: true,
    mode: 'hard_deleted',
    id: row.id,
    delete_qbo_requested: deleteQbo,
    qbo_id: qboId || null,
    qbo_entity: qboId ? entity : null,
    qbo_deleted,
    qbo_delete_error,
  };
});

app.post('/submissions/:id/copy', async (req, reply) => {
  const ctx = requireAuthAndTenant(req, reply);
  if (!ctx) return;

  const source = submissionsById.get(req.params.id);
  if (!source || source.tenant_id !== ctx.tenant.tenantId) {
    return reply.code(404).send({ ok: false, error: 'not_found' });
  }

  const now = new Date().toISOString();
  const copied = {
    ...source,
    id: `sub_${randomUUID().slice(0, 8)}`,
    client_ref: `${source.client_ref}-copy`,
    status: 'draft',
    precheck: null,
    result: null,
    created_at: now,
    updated_at: now
  };
  submissionsById.set(copied.id, copied);
  await saveSubmission(copied);

  return reply.code(201).send({ ok: true, row: copied });
});

app.post('/auth/logout', async (req, reply) => {
  await req.session.destroy();
  // ensure cookie is cleared for clients that rely on it
  reply.clearCookie('sessionId', { path: '/' });
  return { ok: true };
});

try {
  await ensureStateTables();
  await ensureDefaultAdminUser();
  await syncStateFromDb();
} catch (e) {
  app.log.error({ err: e }, 'state_init_failed_using_memory_fallback');
}

app.listen({ port: PORT, host: HOST });
