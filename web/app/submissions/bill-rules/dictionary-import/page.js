'use client';

import { useEffect, useMemo, useState } from 'react';

const TYPE_CONFIG = {
  locations: {
    title: 'Import Locations (Bill Level)',
    dictKey: 'locations',
    idField: 'qbo_department_id',
    catalogKey: 'departments',
    idPick: ['id', 'qbo_id'],
    namePick: ['name', 'display_name']
  },
  accounts: {
    title: 'Import Categories / Accounts',
    dictKey: 'accounts',
    idField: 'qbo_account_id',
    catalogKey: 'accounts',
    idPick: ['id', 'qbo_id'],
    namePick: ['name', 'fully_qualified_name', 'display_name']
  },
  classes: {
    title: 'Import Classes (Line Level)',
    dictKey: 'classes',
    idField: 'qbo_class_id',
    catalogKey: 'classes',
    idPick: ['id', 'qbo_id'],
    namePick: ['name', 'display_name']
  },
  taxCodes: {
    title: 'Import Tax Codes (Line Level)',
    dictKey: 'taxCodes',
    idField: 'qbo_tax_code_id',
    catalogKey: 'taxCodes',
    idPick: ['id', 'qbo_id'],
    namePick: ['name', 'display_name']
  }
};

function pick(obj, keys) {
  for (const k of keys) {
    const v = obj?.[k];
    if (v !== undefined && v !== null && String(v).trim()) return String(v).trim();
  }
  return '';
}

function makeKey(label, fallbackId) {
  const key = String(label || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (key) return key;
  return `ITEM_${String(fallbackId || '').replace(/[^A-Z0-9]+/gi, '_').toUpperCase()}`;
}

export default function DictionaryImportPage() {
  const [mode, setMode] = useState('locations');
  const cfg = TYPE_CONFIG[mode] || TYPE_CONFIG.locations;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');

  const [rows, setRows] = useState([]);
  const [selected, setSelected] = useState({});
  const [aliasById, setAliasById] = useState({});
  const [query, setQuery] = useState('');

  useEffect(() => {
    try {
      const p = new URLSearchParams(window.location.search);
      const t = p.get('type');
      if (t && TYPE_CONFIG[t]) setMode(t);
    } catch {}
  }, []);

  async function loadAll() {
    setLoading(true);
    setError('');
    setOk('');

    const [cRes, rRes] = await Promise.all([
      fetch('/api/mappings/catalog', { cache: 'no-store' }).catch(() => null),
      fetch('/api/bill-rules', { cache: 'no-store' }).catch(() => null)
    ]);

    const cj = cRes ? await cRes.json().catch(() => ({})) : {};
    const rj = rRes ? await rRes.json().catch(() => ({})) : {};

    if (!cRes || !cRes.ok || !cj?.ok) {
      setError(cj?.detail || cj?.error || `Load catalog failed${cRes ? ` (${cRes.status})` : ''}`);
      setRows([]);
      setLoading(false);
      return;
    }

    if (!rRes || !rRes.ok || !rj?.ok) {
      setError(rj?.detail || rj?.error || `Load bill rules failed${rRes ? ` (${rRes.status})` : ''}`);
      setRows([]);
      setLoading(false);
      return;
    }

    const catalogRows = Array.isArray(cj?.catalog?.[cfg.catalogKey]) ? cj.catalog[cfg.catalogKey] : [];
    const mapped = Array.isArray(rj?.rules?.qboOptionDictionaries?.[cfg.dictKey]) ? rj.rules.qboOptionDictionaries[cfg.dictKey] : [];

    const mappedById = new Map();
    for (const m of mapped) {
      const id = String(m?.[cfg.idField] || '').trim();
      if (id) mappedById.set(id, m);
    }

    const normalized = [];
    const nextAlias = {};
    const nextSelected = {};

    for (const row of catalogRows) {
      const id = pick(row, cfg.idPick);
      const name = pick(row, cfg.namePick);
      if (!id || !name) continue;
      normalized.push({ id, name });
      const mappedItem = mappedById.get(id);
      nextAlias[id] = String(mappedItem?.label || mappedItem?.name || name);
      if (mappedItem) nextSelected[id] = true;
    }

    normalized.sort((a, b) => a.name.localeCompare(b.name));
    setRows(normalized);
    setAliasById(nextAlias);
    setSelected(nextSelected);
    setLoading(false);
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => [r.id, r.name, aliasById[r.id]].some((x) => String(x || '').toLowerCase().includes(q)));
  }, [rows, query, aliasById]);

  function toggleOne(id, checked) {
    setSelected((s) => ({ ...s, [id]: checked }));
  }

  function toggleAllCurrent(checked) {
    const ids = filtered.map((x) => x.id);
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
    setOk('Updated from QBO.');
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
      setError('Please select at least one row.');
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

    const original = Array.isArray(rules.qboOptionDictionaries[cfg.dictKey]) ? rules.qboOptionDictionaries[cfg.dictKey] : [];
    const byId = new Map();
    const noIdItems = [];

    for (const item of original) {
      const id = String(item?.[cfg.idField] || '').trim();
      if (id) byId.set(id, item);
      else noIdItems.push(item);
    }

    const rowById = new Map(rows.map((r) => [r.id, r]));

    for (const id of selectedIds) {
      const row = rowById.get(id);
      if (!row) continue;
      const alias = String(aliasById[id] || row.name || '').trim();
      if (!alias) continue;
      byId.set(id, {
        ...(byId.get(id) || {}),
        key: makeKey(alias, id),
        label: alias,
        name: alias,
        [cfg.idField]: id,
        active: true
      });
    }

    rules.qboOptionDictionaries[cfg.dictKey] = [...noIdItems, ...Array.from(byId.values())];

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

    setOk(`Imported ${selectedIds.length} item(s) into ${cfg.dictKey}.`);
    setSaving(false);
  }

  return (
    <main style={{ padding: 16, maxWidth: 1060, margin: '0 auto' }}>
      <h1 style={{ marginTop: 0 }}>{cfg.title}</h1>
      <p style={{ color: '#555' }}>Edit alias, select rows, then import into Bill Rules dictionary.</p>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        <select value={mode} onChange={(e) => setMode(e.target.value)}>
          <option value='locations'>Locations</option>
          <option value='accounts'>Categories / Accounts</option>
          <option value='classes'>Classes</option>
          <option value='taxCodes'>Tax codes</option>
        </select>
        <button onClick={onSyncFromQBO} disabled={syncing || saving}>{syncing ? 'Updating...' : 'Update from QBO'}</button>
        <button onClick={onImportSelected} disabled={saving || syncing}>{saving ? 'Importing...' : 'Import selected'}</button>
        <a href='/submissions/bill-rules' style={{ padding: '6px 10px', border: '1px solid #ccc', borderRadius: 6, textDecoration: 'none' }}>Back to Bill Rules</a>
      </div>

      <div style={{ marginBottom: 10 }}>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder='Search by alias / name / id' style={{ minWidth: 360 }} />
      </div>

      {error ? <p style={{ color: '#b42318' }}>{error}</p> : null}
      {ok ? <p style={{ color: '#027a48' }}>{ok}</p> : null}

      {loading ? <p>Loading...</p> : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th}><input type='checkbox' onChange={(e) => toggleAllCurrent(e.target.checked)} /></th>
              <th style={th}>Alias (editable)</th>
              <th style={th}>QBO Name</th>
              <th style={th}>QBO ID</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id}>
                <td style={td}><input type='checkbox' checked={!!selected[r.id]} onChange={(e) => toggleOne(r.id, e.target.checked)} /></td>
                <td style={td}><input value={aliasById[r.id] || ''} onChange={(e) => setAliasById((s) => ({ ...s, [r.id]: e.target.value }))} style={{ minWidth: 260 }} /></td>
                <td style={td}>{r.name}</td>
                <td style={td}><code>{r.id}</code></td>
              </tr>
            ))}
            {!filtered.length ? <tr><td style={td} colSpan={4}>No rows</td></tr> : null}
          </tbody>
        </table>
      )}
    </main>
  );
}

const th = { textAlign: 'left', border: '1px solid #ddd', padding: 8, background: '#fafafa' };
const td = { textAlign: 'left', border: '1px solid #eee', padding: 8 };
