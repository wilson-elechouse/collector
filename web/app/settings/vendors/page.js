'use client';

import { useEffect, useMemo, useState } from 'react';

function norm(s) { return String(s || '').trim().replace(/\s+/g, ' ').toLowerCase(); }

export default function VendorsPage() {
  const [rows, setRows] = useState([]);
  const [pending, setPending] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    const [vRes, rRes] = await Promise.all([
      fetch('/api/vendors', { cache: 'no-store' }).catch(() => null),
      fetch('/api/bill-rules', { cache: 'no-store' }).catch(() => null)
    ]);

    const vj = vRes ? await vRes.json().catch(() => ({})) : {};
    const rj = rRes ? await rRes.json().catch(() => ({})) : {};

    if (!vRes || !vRes.ok || !vj?.ok) {
      setError(vj?.detail || vj?.error || `Load vendors failed${vRes ? ` (${vRes.status})` : ''}`);
      setRows([]);
      setPending([]);
      setLoading(false);
      return;
    }

    const qboRows = Array.isArray(vj.rows) ? vj.rows : [];
    const qboNameSet = new Set(qboRows.map((x) => norm(x?.name)));

    const dictVendors = Array.isArray(rj?.rules?.qboOptionDictionaries?.vendors) ? rj.rules.qboOptionDictionaries.vendors : [];
    const pend = dictVendors
      .filter((x) => x?.pending_qbo_create || String(x?.qbo_vendor_id || '') === '__PENDING_MANUAL_CREATE__')
      .map((x) => ({
        key: String(x?.key || ''),
        name: String(x?.label || x?.name || '').trim(),
        note: String(x?.note || '')
      }))
      .filter((x) => x.name)
      .filter((x) => !qboNameSet.has(norm(x.name)));

    setRows(qboRows.sort((a, b) => String(a?.name || '').localeCompare(String(b?.name || ''))));
    setPending(pend);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => [r?.id, r?.name, r?.company_name, r?.email, r?.phone].some((x) => String(x || '').toLowerCase().includes(q)));
  }, [rows, query]);

  async function editPending(item) {
    const nextName = window.prompt('Edit pending vendor name', item?.name || '');
    if (nextName == null) return;
    const nameTrim = String(nextName).trim();
    if (!nameTrim) return;
    const nextNote = window.prompt('Edit pending note (optional)', item?.note || '');

    const rRes = await fetch('/api/bill-rules', { cache: 'no-store' }).catch(() => null);
    const rj = rRes ? await rRes.json().catch(() => ({})) : {};
    if (!rRes || !rRes.ok || !rj?.ok) {
      alert(`Load rules failed: ${rj?.detail || rj?.error || (rRes ? rRes.status : 'network')}`);
      return;
    }

    const rules = rj.rules || {};
    rules.qboOptionDictionaries = rules.qboOptionDictionaries || {};
    const vendors = Array.isArray(rules.qboOptionDictionaries.vendors) ? rules.qboOptionDictionaries.vendors : [];
    rules.qboOptionDictionaries.vendors = vendors.map((v) => {
      const isTarget = (item?.key && String(v?.key || '') === item.key)
        || (!item?.key && norm(v?.label || v?.name) === norm(item?.name));
      if (!isTarget) return v;
      return { ...v, label: nameTrim, name: nameTrim, note: String(nextNote || '').trim() };
    });

    const save = await fetch('/api/bill-rules', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rules })
    }).catch(() => null);
    const sj = save ? await save.json().catch(() => ({})) : {};
    if (!save || !save.ok || !sj?.ok) {
      alert(`Save failed: ${sj?.detail || sj?.error || (save ? save.status : 'network')}`);
      return;
    }

    await load();
  }

  async function createVendor(displayName) {
    const n = String(displayName || name).trim();
    if (!n) return;
    setCreating(true);
    const res = await fetch('/api/vendors', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ display_name: n })
    }).catch(() => null);
    const j = res ? await res.json().catch(() => ({})) : {};
    if (!res || !res.ok || !j?.ok) {
      alert(`Create failed: ${j?.detail || j?.error || (res ? res.status : 'network')}`);
      setCreating(false);
      return;
    }
    setName('');
    await load();
    setCreating(false);
  }

  return (
    <main style={{ padding: 16, maxWidth: 1000, margin: '0 auto' }}>
      <h1 style={{ marginTop: 0 }}>Vendor Management</h1>
      <p style={{ color: '#555' }}>列表视图：先看全量，再点 Edit 进入详情页更新。</p>

      <section style={box}>
        <h2 style={h2}>Create to QBO</h2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder='Display Name *' style={{ minWidth: 360 }} />
          <button disabled={!name.trim() || creating} onClick={() => createVendor()}>{creating ? 'Creating...' : 'Create to QBO'}</button>
        </div>
      </section>

      <section style={box}>
        <h2 style={h2}>Pending from AI / Rules (not yet in QBO)</h2>
        {!pending.length ? <p style={{ color: '#666' }}>No pending vendor.</p> : (
          <table style={table}>
            <thead><tr><th style={th}>Name</th><th style={th}>Note</th><th style={th}>Action</th></tr></thead>
            <tbody>
              {pending.map((p, idx) => (
                <tr key={`${p.key || p.name}-${idx}`}>
                  <td style={td}>{p.name}</td>
                  <td style={td}>{p.note || '-'}</td>
                  <td style={td}>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button disabled={creating} onClick={() => createVendor(p.name)}>Create to QBO</button>
                      <button disabled={creating} onClick={() => editPending(p)}>Edit</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section style={box}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <h2 style={h2}>QBO Vendor List</h2>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder='Search by name/id/company/email/phone' style={{ minWidth: 320 }} />
        </div>
        {error ? <p style={{ color: 'crimson' }}>{error}</p> : null}
        {loading ? <p style={{ color: '#666' }}>Loading...</p> : (
          <table style={table}>
            <thead>
              <tr>
                <th style={th}>QBO ID</th>
                <th style={th}>Display Name</th>
                <th style={th}>Company</th>
                <th style={th}>Email</th>
                <th style={th}>Phone</th>
                <th style={th}>Active</th>
                <th style={th}>Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={String(r.id)}>
                  <td style={td}>{r.id}</td>
                  <td style={td}>{r.name || '-'}</td>
                  <td style={td}>{r.company_name || '-'}</td>
                  <td style={td}>{r.email || '-'}</td>
                  <td style={td}>{r.phone || '-'}</td>
                  <td style={td}>{r.active ? 'Yes' : 'No'}</td>
                  <td style={td}><a href={`/settings/vendors/${encodeURIComponent(r.id)}`}>Edit</a></td>
                </tr>
              ))}
              {!filtered.length ? <tr><td style={td} colSpan={7}>No vendors</td></tr> : null}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}

const box = { border: '1px solid #e5e7eb', borderRadius: 10, padding: 12, marginTop: 12 };
const h2 = { marginTop: 0, fontSize: 18 };
const table = { width: '100%', borderCollapse: 'collapse' };
const th = { textAlign: 'left', border: '1px solid #ddd', padding: 8, background: '#fafafa' };
const td = { textAlign: 'left', border: '1px solid #eee', padding: 8 };
