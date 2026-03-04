'use client';

import { useEffect, useMemo, useState } from 'react';

function norm(s) {
  return String(s || '').trim().toLowerCase();
}

function toKey(label, fallbackId) {
  const raw = String(label || '').trim();
  const key = raw.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (key) return key;
  return `VENDOR_${String(fallbackId || '').replace(/[^A-Z0-9]+/gi, '_').toUpperCase()}`;
}

export default function BillRuleVendorImportPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [vendors, setVendors] = useState([]);
  const [selected, setSelected] = useState({});
  const [aliasById, setAliasById] = useState({});
  const [query, setQuery] = useState('');

  async function loadAll() {
    setLoading(true);
    setError('');
    setOk('');

    const [vRes, rRes] = await Promise.all([
      fetch('/api/vendors', { cache: 'no-store' }).catch(() => null),
      fetch('/api/bill-rules', { cache: 'no-store' }).catch(() => null)
    ]);

    const vj = vRes ? await vRes.json().catch(() => ({})) : {};
    const rj = rRes ? await rRes.json().catch(() => ({})) : {};

    if (!vRes || !vRes.ok || !vj?.ok) {
      setError(vj?.detail || vj?.error || `Load vendors failed${vRes ? ` (${vRes.status})` : ''}`);
      setVendors([]);
      setLoading(false);
      return;
    }
    if (!rRes || !rRes.ok || !rj?.ok) {
      setError(rj?.detail || rj?.error || `Load bill rules failed${rRes ? ` (${rRes.status})` : ''}`);
      setVendors([]);
      setLoading(false);
      return;
    }

    const rows = Array.isArray(vj.rows) ? vj.rows : [];
    const dictVendors = Array.isArray(rj?.rules?.qboOptionDictionaries?.vendors) ? rj.rules.qboOptionDictionaries.vendors : [];

    const nextAlias = {};
    const nextSelected = {};

    for (const row of rows) {
      const id = String(row?.id || '').trim();
      if (!id) continue;
      const mapped = dictVendors.find((x) => String(x?.qbo_vendor_id || '') === id);
      const alias = String(mapped?.label || mapped?.name || row?.name || '').trim();
      nextAlias[id] = alias || String(row?.name || '').trim();
      if (mapped) nextSelected[id] = true;
    }

    setAliasById(nextAlias);
    setSelected(nextSelected);
    setVendors(rows.sort((a, b) => String(a?.name || '').localeCompare(String(b?.name || ''))));
    setLoading(false);
  }

  useEffect(() => { loadAll(); }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return vendors;
    return vendors.filter((v) => [v?.id, v?.name, v?.company_name, aliasById[String(v?.id || '')]].some((x) => String(x || '').toLowerCase().includes(q)));
  }, [vendors, query, aliasById]);

  function setAlias(id, val) {
    setAliasById((s) => ({ ...s, [id]: val }));
  }

  function toggleOne(id, checked) {
    setSelected((s) => ({ ...s, [id]: checked }));
  }

  function toggleAllCurrent(checked) {
    const ids = filtered.map((x) => String(x?.id || '')).filter(Boolean);
    setSelected((s) => {
      const out = { ...s };
      for (const id of ids) out[id] = checked;
      return out;
    });
  }

  async function onSyncFromQBO() {
    setSyncing(true);
    setError('');
    setOk('');
    const res = await fetch('/api/mappings/sync', { method: 'POST' }).catch(() => null);
    const j = res ? await res.json().catch(() => ({})) : {};
    if (!res || !res.ok || !j?.ok) {
      setError(j?.detail || j?.error || `Sync failed${res ? ` (${res.status})` : ''}`);
      setSyncing(false);
      return;
    }
    await loadAll();
    setOk('Updated from QBO. Latest vendor list loaded.');
    setSyncing(false);
  }

  async function onImportSelected() {
    setSaving(true);
    setError('');
    setOk('');

    const selectedIds = Object.entries(selected)
      .filter(([, v]) => !!v)
      .map(([k]) => k);

    if (!selectedIds.length) {
      setError('Please select at least one vendor.');
      setSaving(false);
      return;
    }

    const rRes = await fetch('/api/bill-rules', { cache: 'no-store' }).catch(() => null);
    const rj = rRes ? await rRes.json().catch(() => ({})) : {};
    if (!rRes || !rRes.ok || !rj?.ok) {
      setError(rj?.detail || rj?.error || `Load bill rules failed${rRes ? ` (${rRes.status})` : ''}`);
      setSaving(false);
      return;
    }

    const rules = structuredClone(rj.rules || {});
    rules.qboOptionDictionaries = rules.qboOptionDictionaries || {};
    const original = Array.isArray(rules.qboOptionDictionaries.vendors) ? rules.qboOptionDictionaries.vendors : [];

    const byQboId = new Map();
    const out = [];
    for (const item of original) {
      const qid = String(item?.qbo_vendor_id || '').trim();
      if (qid) {
        byQboId.set(qid, item);
      } else {
        out.push(item);
      }
    }

    const vendorById = new Map(vendors.map((v) => [String(v?.id || ''), v]));

    for (const id of selectedIds) {
      const row = vendorById.get(id);
      if (!row) continue;
      const alias = String(aliasById[id] || row?.name || '').trim();
      if (!alias) continue;
      const merged = {
        ...(byQboId.get(id) || {}),
        key: toKey(alias, id),
        label: alias,
        name: alias,
        qbo_vendor_id: id,
        active: true
      };
      byQboId.set(id, merged);
    }

    const mergedMapped = Array.from(byQboId.values());
    rules.qboOptionDictionaries.vendors = [...out, ...mergedMapped];

    const saveRes = await fetch('/api/bill-rules', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rules })
    }).catch(() => null);

    const sj = saveRes ? await saveRes.json().catch(() => ({})) : {};
    if (!saveRes || !saveRes.ok || !sj?.ok) {
      setError(sj?.detail || sj?.error || `Save bill rules failed${saveRes ? ` (${saveRes.status})` : ''}`);
      setSaving(false);
      return;
    }

    setOk(`Imported ${selectedIds.length} vendor alias(es) into Bill Rules.`);
    setSaving(false);
  }

  return (
    <main style={{ padding: 16, maxWidth: 1080, margin: '0 auto' }}>
      <h1 style={{ marginTop: 0 }}>Import Vendors into Bill Rules</h1>
      <p style={{ color: '#555' }}>Select vendor rows, edit alias if needed, then import selected alias names into Bill Rules &gt; Vendors dictionary.</p>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        <button onClick={onSyncFromQBO} disabled={syncing || saving}>{syncing ? 'Updating...' : 'Update from QBO'}</button>
        <button onClick={onImportSelected} disabled={saving || syncing}>{saving ? 'Importing...' : 'Import selected to Bill Rules'}</button>
        <a href='/submissions/bill-rules' style={{ padding: '6px 10px', border: '1px solid #ccc', borderRadius: 6, textDecoration: 'none' }}>Back to Bill Rules</a>
      </div>

      <div style={{ marginBottom: 10 }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder='Search by alias / vendor name / qbo id / company'
          style={{ minWidth: 360 }}
        />
      </div>

      {error ? <p style={{ color: '#b42318' }}>{error}</p> : null}
      {ok ? <p style={{ color: '#027a48' }}>{ok}</p> : null}

      {loading ? <p>Loading...</p> : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th}><input type='checkbox' onChange={(e) => toggleAllCurrent(e.target.checked)} /></th>
              <th style={th}>Alias (editable)</th>
              <th style={th}>QBO Vendor Name</th>
              <th style={th}>QBO Vendor ID</th>
              <th style={th}>Company</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((v) => {
              const id = String(v?.id || '');
              return (
                <tr key={id}>
                  <td style={td}><input type='checkbox' checked={!!selected[id]} onChange={(e) => toggleOne(id, e.target.checked)} /></td>
                  <td style={td}><input value={aliasById[id] || ''} onChange={(e) => setAlias(id, e.target.value)} style={{ minWidth: 240 }} /></td>
                  <td style={td}>{v?.name || '-'}</td>
                  <td style={td}><code>{id}</code></td>
                  <td style={td}>{v?.company_name || '-'}</td>
                </tr>
              );
            })}
            {!filtered.length ? (
              <tr><td style={td} colSpan={5}>No vendors</td></tr>
            ) : null}
          </tbody>
        </table>
      )}
    </main>
  );
}

const th = { textAlign: 'left', border: '1px solid #ddd', padding: 8, background: '#fafafa' };
const td = { textAlign: 'left', border: '1px solid #eee', padding: 8 };
