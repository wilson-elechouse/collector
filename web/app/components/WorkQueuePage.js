'use client';

import { useEffect, useMemo, useState } from 'react';

const STATUS_LABEL = {
  draft: 'Draft',
  reviewed: 'Reviewed',
  posted: 'Posted',
  failed: 'Failed',
  deleted: 'Deleted'
};

const ERROR_LABEL = {
  invalid_kind: 'Kind is invalid.',
  client_ref_required: 'Client Ref is required.',
  client_ref_not_unique: 'Client Ref must be unique.',
  not_found: 'Submission was not found.',
  validation_failed: 'Validation failed. Please fix required fields and try again.',
  submit_failed: 'Submit failed. Please retry.',
  tenant_not_selected: 'No tenant selected. Please choose a tenant first.',
  unauthorized: 'Session expired. Please log in again.'
};

function humanizeError(codeOrMessage) {
  const raw = String(codeOrMessage || '').trim();
  if (!raw) return 'Unexpected error. Please try again.';
  if (ERROR_LABEL[raw]) return ERROR_LABEL[raw];
  if (raw.startsWith('load_failed_')) return `Load failed (${raw.replace('load_failed_', 'HTTP ')}).`;
  if (raw.startsWith('create_failed_')) return `Create failed (${raw.replace('create_failed_', 'HTTP ')}).`;
  return raw;
}

function defaultClientRef(kind) {
  const stamp = new Date().toISOString().slice(0, 10).replaceAll('-', '');
  return `${kind}-${stamp}`;
}

export default function WorkQueuePage({ kind, title, createLabel }) {
  const [clientRef, setClientRef] = useState(defaultClientRef(kind));
  const [memo, setMemo] = useState('');
  const [rows, setRows] = useState([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);

  async function loadRows() {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/submissions', { cache: 'no-store' });
      const j = await res.json().catch(() => ({}));

      if (res.status === 401 || j?.error === 'unauthorized') {
        window.location.href = '/login';
        return;
      }

      if (!res.ok || !j?.ok) throw new Error(j?.error || `load_failed_${res.status}`);
      const filtered = (j.rows || []).filter((r) => r.kind === kind);
      setRows(filtered);
    } catch (e) {
      setError(`Could not load ${title}. ${humanizeError(e.message)}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadRows();
  }, [kind]);

  async function onCreate(e) {
    e.preventDefault();
    setCreating(true);
    setError('');
    try {
      const res = await fetch('/api/submissions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind, client_ref: clientRef, memo })
      });
      const j = await res.json().catch(() => ({}));

      if (res.status === 401 || j?.error === 'unauthorized') {
        window.location.href = '/login';
        return;
      }

      if (!res.ok || !j?.ok || !j?.row?.id) throw new Error(j?.error || `create_failed_${res.status}`);
      window.location.href = `/submissions/${j.row.id}/edit`;
    } catch (e) {
      setError(`Create draft failed. ${humanizeError(e.message)}`);
    } finally {
      setCreating(false);
    }
  }

  async function onDelete(row) {
    if (row.status === 'deleted') return;
    const hasQboId = Boolean(row?.result?.qbo_id);
    if (hasQboId) {
      setError('For posted records, please open View and run delete there.');
      return;
    }
    if (!window.confirm('This draft has not been submitted to QBO. It will be permanently deleted. Continue?')) return;

    setError('');
    const res = await fetch(`/api/submissions/${row.id}`, { method: 'DELETE' });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j?.ok) {
      const detail = j?.detail ? ` | ${j.detail}` : '';
      const source = j?.source ? ` | source=${j.source}` : '';
      setError(`Delete failed. ${humanizeError(j?.error || `HTTP ${res.status}`)}${detail}${source}`);
      return;
    }
    await loadRows();
  }

  const shownRows = useMemo(() => {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      const hay = [
        r.client_ref,
        r.memo,
        r.status,
        r?.result?.qbo_id,
        r.id
      ].map((x) => String(x || '').toLowerCase()).join(' ');
      return hay.includes(q);
    });
  }, [rows, query]);

  const hasRows = useMemo(() => shownRows.length > 0, [shownRows]);

  return (
    <main style={{ padding: 16, maxWidth: 980, margin: '0 auto' }}>
      <h1 style={{ marginBottom: 10 }}>{title}</h1>

      <section style={{ border: '1px solid #d0d7de', borderRadius: 10, padding: 12, marginBottom: 14 }}>
        <h2 style={{ margin: '0 0 8px 0', fontSize: 18 }}>Create draft</h2>
        <form onSubmit={onCreate} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
          <label style={{ display: 'grid', gap: 6 }}>
            <span>Client ref</span>
            <input value={clientRef} onChange={(e) => setClientRef(e.target.value)} required style={{ minHeight: 36 }} />
          </label>

          <label style={{ display: 'grid', gap: 6 }}>
            <span>Memo (optional)</span>
            <input value={memo} onChange={(e) => setMemo(e.target.value)} style={{ minHeight: 36 }} />
          </label>

          <div style={{ display: 'flex', alignItems: 'end' }}>
            <button type='submit' disabled={creating} style={{ minHeight: 38, width: '100%', fontWeight: 600 }}>
              {creating ? 'Creating...' : createLabel}
            </button>
          </div>
        </form>
      </section>

      <section style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 12, marginBottom: 14 }}>
        <label style={{ display: 'grid', gap: 6 }}>
          <span>Search</span>
          <input
            placeholder='Search by client ref / memo / status / QBO ID'
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ minHeight: 36 }}
          />
        </label>
      </section>

      {error ? <p role='alert' style={{ color: '#b42318', marginBottom: 12 }}>{error}</p> : null}
      {loading ? <p>Loading...</p> : null}
      {!loading && !hasRows ? <p>No records found.</p> : null}

      {!loading && hasRows ? (
        <div style={{ display: 'grid', gap: 10 }}>
          {shownRows.map((row) => {
            const statusLabel = STATUS_LABEL[row.status] || row.status;
            const qboId = row?.result?.qbo_id || '-';
            const hasQboId = Boolean(row?.result?.qbo_id);
            return (
              <article key={row.id} style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 12 }}>
                <div style={{ display: 'grid', gap: 6, gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
                  <div><strong>Status</strong><div>{statusLabel}</div></div>
                  <div><strong>Updated</strong><div>{new Date(row.updated_at).toLocaleString()}</div></div>
                  <div><strong>QBO ID</strong><div style={{ wordBreak: 'break-word' }}>{qboId}</div></div>
                  <div><strong>Client ref</strong><div style={{ wordBreak: 'break-word' }}>{row.client_ref}</div></div>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                  {hasQboId ? (
                    <a href={`/submissions/${row.id}/result`} style={{ textDecoration: 'underline' }}>View</a>
                  ) : (
                    <a href={`/submissions/${row.id}/edit`} style={{ textDecoration: 'underline' }}>Open Edit</a>
                  )}
                  {hasQboId ? null : (
                    <button onClick={() => onDelete(row)} disabled={row.status === 'deleted'} style={{ padding: '4px 10px' }}>Delete</button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      ) : null}
    </main>
  );
}
