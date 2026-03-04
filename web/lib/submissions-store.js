const g = globalThis;

if (!g.__v3SubmissionsStore) {
  g.__v3SubmissionsStore = {
    seq: 1,
    rows: []
  };
}

const store = g.__v3SubmissionsStore;

export const STATUS_LABEL = {
  draft: 'Draft',
  reviewed: 'Reviewed',
  posted: 'Posted',
  failed: 'Failed'
};

function nowIso() {
  return new Date().toISOString();
}

function defaultPayload(kind) {
  if (kind === 'bill_payment') {
    return {
      amount: 100,
      vendorRef: 'v-acme',
      method: 'bank_transfer'
    };
  }

  return {
    amount: 120,
    vendorRef: 'v-acme',
    dueDate: '2026-02-20',
    lineItems: [{ desc: 'Office supplies', amount: 120 }]
  };
}

export function listSubmissions() {
  return [...store.rows].sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
}

export function createSubmission({ kind, client_ref, memo }) {
  const id = `sub_${String(store.seq++).padStart(4, '0')}`;
  const now = nowIso();
  const row = {
    id,
    kind,
    client_ref,
    memo: memo || '',
    status: 'draft',
    payload: defaultPayload(kind),
    precheck: null,
    result: null,
    updated_at: now,
    created_at: now
  };
  store.rows.push(row);
  return row;
}

export function getSubmission(id) {
  return store.rows.find((r) => r.id === id) || null;
}

export function updateSubmission(id, patch = {}) {
  const row = getSubmission(id);
  if (!row) return null;

  if (typeof patch.client_ref === 'string') row.client_ref = patch.client_ref;
  if (typeof patch.memo === 'string') row.memo = patch.memo;
  if (patch.payload && typeof patch.payload === 'object') row.payload = patch.payload;

  row.updated_at = nowIso();
  return row;
}

export function validateSubmission(id) {
  const row = getSubmission(id);
  if (!row) return null;

  const issues = [];
  if (!row.client_ref?.trim()) issues.push('client_ref_required');
  if (!row.payload || typeof row.payload !== 'object') issues.push('payload_invalid');
  if (typeof row.payload?.amount !== 'number' || row.payload.amount <= 0) issues.push('amount_must_be_positive');

  row.status = issues.length ? 'draft' : 'reviewed';
  row.updated_at = nowIso();

  return {
    ok: issues.length === 0,
    issues,
    row
  };
}

export function runPrecheck(id) {
  const row = getSubmission(id);
  if (!row) return null;

  const validation = validateSubmission(id);
  if (!validation.ok) {
    row.precheck = {
      ok: false,
      issues: validation.issues,
      checked_at: nowIso()
    };
    row.result = {
      ok: false,
      mode: 'precheck',
      error_detail: validation.issues.join(', '),
      at: nowIso()
    };
    row.status = 'failed';
    row.updated_at = nowIso();
    return { ok: false, row, precheck: row.precheck };
  }

  row.precheck = {
    ok: true,
    checked_at: nowIso(),
    notes: 'Validation passed. No posting performed.'
  };
  row.status = 'reviewed';
  row.result = {
    ok: true,
    mode: 'precheck',
    message: 'Precheck passed (not posted).',
    at: nowIso()
  };
  row.updated_at = nowIso();

  return { ok: true, row, precheck: row.precheck };
}

export function submitToQbo(id) {
  const row = getSubmission(id);
  if (!row) return null;

  const validation = validateSubmission(id);
  if (!validation.ok) {
    row.status = 'failed';
    row.result = {
      ok: false,
      mode: 'submit',
      error_detail: validation.issues.join(', '),
      at: nowIso()
    };
    row.updated_at = nowIso();
    return { ok: false, row, error: 'validation_failed' };
  }

  if ((row.memo || '').toLowerCase().includes('fail')) {
    row.status = 'failed';
    row.result = {
      ok: false,
      mode: 'submit',
      error_detail: 'Simulated QuickBooks rejection (memo contains fail).',
      at: nowIso()
    };
    row.updated_at = nowIso();
    return { ok: false, row, error: 'qbo_rejected' };
  }

  row.status = 'posted';
  row.result = {
    ok: true,
    mode: 'submit',
    qbo_id: `QBO-${row.id.toUpperCase()}`,
    at: nowIso()
  };
  row.updated_at = nowIso();
  return { ok: true, row };
}

export function createFrom(sourceId) {
  const source = getSubmission(sourceId);
  if (!source) return null;
  return createSubmission({
    kind: source.kind,
    client_ref: `${source.client_ref}-copy`,
    memo: source.memo
  });
}
