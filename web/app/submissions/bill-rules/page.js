'use client';

import { useEffect, useState } from 'react';

function parseList(dict = []) {
  return Array.isArray(dict) ? dict.map((x) => x?.label || x?.key).filter(Boolean).join('\n') : '';
}

function toDictItems(text, idField, idByLabel = {}) {
  return String(text || '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((label) => ({
      key: label.toUpperCase().replace(/[^A-Z0-9]+/g, '_'),
      label,
      [idField]: idByLabel[String(label).toLowerCase()] || '__SET_BY_TENANT__',
      active: true
    }));
}

function humanizeSyncError(raw) {
  const s = String(raw || '').toLowerCase();
  if (!s) return 'Sync failed. Please retry.';
  if (s.includes('qbo_not_connected')) return 'QBO not connected for current tenant. Please connect/reconnect first.';
  if (s.includes('missing_access_token_reconnect_required')) return 'QBO token missing/expired. Please reconnect QuickBooks then sync again.';
  if (s.includes('qbo_query_failed_401')) return 'QBO auth failed (401). Please reconnect QuickBooks.';
  if (s.includes('qbo_query_failed_403')) return 'QBO permission denied (403). Check scopes/app permission in Intuit.';
  if (s.includes('qbo_query_failed_429')) return 'QBO rate-limited the request (429). Please retry in a minute.';
  if (s.includes('qbo_query_failed_')) return 'QBO query failed. Please retry, or reconnect if it keeps failing.';
  if (s.includes('unauthorized')) return 'Session expired. Please log in again.';
  if (s.includes('tenant_not_selected')) return 'No tenant selected. Please choose tenant first.';
  return raw;
}

export default function BillRulesPage() {
  const [rules, setRules] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [stats, setStats] = useState(null);
  const [catalog, setCatalog] = useState(null);

  const [vendorsText, setVendorsText] = useState('');
  const [locationsText, setLocationsText] = useState('');
  const [accountsText, setAccountsText] = useState('');
  const [classesText, setClassesText] = useState('');
  const [taxText, setTaxText] = useState('');

  useEffect(() => {
    (async () => {
      setLoading(true);
      setErr('');
      const res = await fetch('/api/bill-rules', { cache: 'no-store' });
      const j = await res.json().catch(() => ({}));
      if (res.status === 401 || j?.error === 'unauthorized') {
        window.location.href = '/login?next=%2Fsubmissions%2Fbill-rules';
        return;
      }
      if (res.status === 400 || j?.error === 'tenant_not_selected') {
        window.location.href = '/tenant/select?next=%2Fsubmissions%2Fbill-rules';
        return;
      }
      if (!res.ok || !j?.ok) {
        setErr(j?.error || `load_failed_${res.status}`);
      } else {
        setRules(j.rules);
        setVendorsText(parseList(j.rules?.qboOptionDictionaries?.vendors));
        setLocationsText(parseList(j.rules?.qboOptionDictionaries?.locations));
        setAccountsText(parseList(j.rules?.qboOptionDictionaries?.accounts));
        setClassesText(parseList(j.rules?.qboOptionDictionaries?.classes));
        setTaxText(parseList(j.rules?.qboOptionDictionaries?.taxCodes));
        try {
          const res2 = await fetch('/api/mappings/catalog', { cache: 'no-store' });
          const j2 = await res2.json().catch(() => ({}));
          if (res2.ok && j2?.ok) {
            setStats(j2.stats || null);
            setCatalog(j2.catalog || null);
          }
        } catch {}
      }
      setLoading(false);
    })();
  }, []);

  async function loadCatalogIntoEditors() {
    const res = await fetch('/api/mappings/catalog', { cache: 'no-store' });
    const j = await res.json().catch(() => ({}));
    if (res.status === 401 || j?.error === 'unauthorized') {
      window.location.href = '/login?next=%2Fsubmissions%2Fbill-rules';
      throw new Error('unauthorized');
    }
    if (res.status === 400 || j?.error === 'tenant_not_selected') {
      window.location.href = '/tenant/select?next=%2Fsubmissions%2Fbill-rules';
      throw new Error('tenant_not_selected');
    }
    if (!res.ok || !j?.ok) throw new Error(j?.detail || j?.error || `catalog_failed_${res.status}`);
    const c = j.catalog || {};
    setCatalog(c);
    setVendorsText((c.vendors || []).map((x) => x.name).filter(Boolean).join('\n'));
    setLocationsText((c.departments || []).map((x) => x.name).filter(Boolean).join('\n'));
    setAccountsText((c.accounts || []).map((x) => x.name).filter(Boolean).join('\n'));
    setClassesText((c.classes || []).map((x) => x.name).filter(Boolean).join('\n'));
    setTaxText((c.taxCodes || []).map((x) => x.name).filter(Boolean).join('\n'));
    setStats(j.stats || null);
  }

  async function onSyncMappings() {
    setSyncing(true);
    setErr('');
    setOk('');
    try {
      const res = await fetch('/api/mappings/sync', { method: 'POST' });
      const j = await res.json().catch(() => ({}));
      if (res.status === 401 || j?.error === 'unauthorized') {
        window.location.href = '/login?next=%2Fsubmissions%2Fbill-rules';
        return;
      }
      if (res.status === 400 || j?.error === 'tenant_not_selected') {
        window.location.href = '/tenant/select?next=%2Fsubmissions%2Fbill-rules';
        return;
      }
      if (!res.ok || !j?.ok) throw new Error(j?.detail || j?.error || `sync_failed_${res.status}`);
      await loadCatalogIntoEditors();
      setOk('QBO mapping sync completed. Dictionaries refreshed from local DB.');
    } catch (e) {
      setErr(humanizeSyncError(String(e?.message || e)));
    } finally {
      setSyncing(false);
    }
  }

  async function onSave(e) {
    e.preventDefault();
    if (!rules) return;
    setSaving(true);
    setErr('');
    setOk('');
    const next = structuredClone(rules);

    const mapFrom = (rows = []) => Object.fromEntries((rows || []).map((x) => [String(x?.name || '').toLowerCase(), String(x?.id || '')]));
    const existingMap = (rows = [], idField) => Object.fromEntries((rows || []).map((x) => [String(x?.label || x?.key || '').toLowerCase(), String(x?.[idField] || '')]));

    const vendorIds = { ...existingMap(next?.qboOptionDictionaries?.vendors, 'qbo_vendor_id'), ...mapFrom(catalog?.vendors) };
    const locationIds = { ...existingMap(next?.qboOptionDictionaries?.locations, 'qbo_department_id'), ...mapFrom(catalog?.departments) };
    const accountIds = { ...existingMap(next?.qboOptionDictionaries?.accounts, 'qbo_account_id'), ...mapFrom(catalog?.accounts) };
    const classIds = { ...existingMap(next?.qboOptionDictionaries?.classes, 'qbo_class_id'), ...mapFrom(catalog?.classes) };
    const taxIds = { ...existingMap(next?.qboOptionDictionaries?.taxCodes, 'qbo_tax_code_id'), ...mapFrom(catalog?.taxCodes) };

    next.qboOptionDictionaries = {
      ...(next.qboOptionDictionaries || {}),
      vendors: toDictItems(vendorsText, 'qbo_vendor_id', vendorIds),
      locations: toDictItems(locationsText, 'qbo_department_id', locationIds),
      accounts: toDictItems(accountsText, 'qbo_account_id', accountIds),
      classes: toDictItems(classesText, 'qbo_class_id', classIds),
      taxCodes: toDictItems(taxText, 'qbo_tax_code_id', taxIds)
    };

    next.submission.client_ref.minLength = Number(next?.submission?.client_ref?.minLength || 3);
    next.submission.client_ref.maxLength = Number(next?.submission?.client_ref?.maxLength || 64);
    next.submission.memo.maxLength = Number(next?.submission?.memo?.maxLength || 500);

    const res = await fetch('/api/bill-rules', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rules: next })
    });
    const j = await res.json().catch(() => ({}));
    if (res.status === 401 || j?.error === 'unauthorized') {
      window.location.href = '/login?next=%2Fsubmissions%2Fbill-rules';
      setSaving(false);
      return;
    }
    if (res.status === 400 || j?.error === 'tenant_not_selected') {
      window.location.href = '/tenant/select?next=%2Fsubmissions%2Fbill-rules';
      setSaving(false);
      return;
    }
    if (!res.ok || !j?.ok) {
      setErr(j?.error || `save_failed_${res.status}`);
    } else {
      setRules(next);
      setOk('Saved. Rules persisted.');
    }
    setSaving(false);
  }

  if (loading) return <main style={{ padding: 16 }}><p>Loading Bill Rules...</p></main>;
  if (err && !rules) return <main style={{ padding: 16 }}><p role="alert">Failed to load Bill Rules: {err}</p></main>;

  return (
    <main style={{ padding: 16, maxWidth: 980, margin: '0 auto' }}>
      <h1>Bill Rules Editor</h1>
      <p style={{ color: '#555' }}>Friendly editor for <code>bill-form-rules.v1.json</code>. One line = one option.</p>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        <button type="button" onClick={onSyncMappings} disabled={syncing} style={{ padding: '10px 14px', fontWeight: 600 }}>
          {syncing ? 'Syncing QBO mappings...' : 'Sync from QBO (Vendor/Department/Class/Tax/Account)'}
        </button>
      </div>

      {stats ? (
        <section style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 12, marginBottom: 12 }}>
          <h3 style={{ marginTop: 0 }}>Mapping sync status</h3>
          <p style={{ margin: '4px 0 10px 0' }}>
            Last sync: <b>{stats.lastSyncAt ? new Date(stats.lastSyncAt).toLocaleString() : 'Never'}</b> · Total items: <b>{stats.total || 0}</b>
          </p>
          <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))' }}>
            <div>Vendors: <b>{stats?.counts?.vendors || 0}</b></div>
            <div>Departments: <b>{stats?.counts?.departments || 0}</b></div>
            <div>Classes: <b>{stats?.counts?.classes || 0}</b></div>
            <div>Tax codes: <b>{stats?.counts?.taxCodes || 0}</b></div>
            <div>Accounts: <b>{stats?.counts?.accounts || 0}</b></div>
          </div>
        </section>
      ) : null}
      <form onSubmit={onSave} style={{ display: 'grid', gap: 12 }}>
        <section style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 12 }}>
          <h3 style={{ marginTop: 0 }}>Core limits</h3>
          <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))' }}>
            <label style={{ display: 'grid', gap: 6 }}>Client Ref min length
              <input type="number" value={rules.submission.client_ref.minLength} onChange={(e) => setRules((r) => ({ ...r, submission: { ...r.submission, client_ref: { ...r.submission.client_ref, minLength: Number(e.target.value || 0) } } }))} />
            </label>
            <label style={{ display: 'grid', gap: 6 }}>Client Ref max length
              <input type="number" value={rules.submission.client_ref.maxLength} onChange={(e) => setRules((r) => ({ ...r, submission: { ...r.submission, client_ref: { ...r.submission.client_ref, maxLength: Number(e.target.value || 0) } } }))} />
            </label>
            <label style={{ display: 'grid', gap: 6 }}>Memo max length
              <input type="number" value={rules.submission.memo.maxLength} onChange={(e) => setRules((r) => ({ ...r, submission: { ...r.submission, memo: { ...r.submission.memo, maxLength: Number(e.target.value || 0) } } }))} />
            </label>
          </div>
        </section>

        <section style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 12 }}>
          <h3 style={{ marginTop: 0 }}>Default values (all bill elements)</h3>
          <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))' }}>
            <label style={{ display: 'grid', gap: 6 }}>kind.default (readonly)
              <input value={rules?.submission?.kind?.default ?? 'bill'} readOnly />
            </label>
            <label style={{ display: 'grid', gap: 6 }}>client_ref.default
              <input value={rules?.submission?.client_ref?.default ?? ''} onChange={(e) => setRules((r) => ({ ...r, submission: { ...r.submission, client_ref: { ...r.submission.client_ref, default: e.target.value } } }))} />
            </label>
            <label style={{ display: 'grid', gap: 6 }}>memo.default
              <input value={rules?.submission?.memo?.default ?? ''} onChange={(e) => setRules((r) => ({ ...r, submission: { ...r.submission, memo: { ...r.submission.memo, default: e.target.value } } }))} />
            </label>
            <label style={{ display: 'grid', gap: 6 }}>vendor_ref_text.default
              <input value={rules?.payload?.vendor_ref_text?.default ?? ''} onChange={(e) => setRules((r) => ({ ...r, payload: { ...r.payload, vendor_ref_text: { ...r.payload.vendor_ref_text, default: e.target.value } } }))} />
            </label>
            <label style={{ display: 'grid', gap: 6 }}>bill_date.default
              <input value={rules?.payload?.bill_date?.default ?? ''} onChange={(e) => setRules((r) => ({ ...r, payload: { ...r.payload, bill_date: { ...r.payload.bill_date, default: e.target.value } } }))} />
            </label>
            <label style={{ display: 'grid', gap: 6 }}>due_date.default
              <input value={rules?.payload?.due_date?.default ?? ''} onChange={(e) => setRules((r) => ({ ...r, payload: { ...r.payload, due_date: { ...r.payload.due_date, default: e.target.value } } }))} />
            </label>
            <label style={{ display: 'grid', gap: 6 }}>location_ref_text.default
              <input value={rules?.payload?.location_ref_text?.default ?? ''} onChange={(e) => setRules((r) => ({ ...r, payload: { ...r.payload, location_ref_text: { ...r.payload.location_ref_text, default: e.target.value } } }))} />
            </label>
            <label style={{ display: 'grid', gap: 6 }}>wht.rate.default
              <input value={rules?.payload?.wht?.properties?.rate?.default ?? ''} onChange={(e) => setRules((r) => ({ ...r, payload: { ...r.payload, wht: { ...r.payload.wht, properties: { ...r.payload.wht.properties, rate: { ...r.payload.wht.properties.rate, default: e.target.value } } } } }))} />
            </label>
            <label style={{ display: 'grid', gap: 6 }}>wht.amount.default
              <input value={rules?.payload?.wht?.properties?.amount?.default ?? ''} onChange={(e) => setRules((r) => ({ ...r, payload: { ...r.payload, wht: { ...r.payload.wht, properties: { ...r.payload.wht.properties, amount: { ...r.payload.wht.properties.amount, default: e.target.value } } } } }))} />
            </label>
            <label style={{ display: 'grid', gap: 6 }}>line.account_ref_text.default
              <input value={rules?.payload?.lines?.item?.account_ref_text?.default ?? ''} onChange={(e) => setRules((r) => ({ ...r, payload: { ...r.payload, lines: { ...r.payload.lines, item: { ...r.payload.lines.item, account_ref_text: { ...r.payload.lines.item.account_ref_text, default: e.target.value } } } } }))} />
            </label>
            <label style={{ display: 'grid', gap: 6 }}>line.description.default
              <input value={rules?.payload?.lines?.item?.description?.default ?? ''} onChange={(e) => setRules((r) => ({ ...r, payload: { ...r.payload, lines: { ...r.payload.lines, item: { ...r.payload.lines.item, description: { ...r.payload.lines.item.description, default: e.target.value } } } } }))} />
            </label>
            <label style={{ display: 'grid', gap: 6 }}>line.amount.default
              <input value={rules?.payload?.lines?.item?.amount?.default ?? ''} onChange={(e) => setRules((r) => ({ ...r, payload: { ...r.payload, lines: { ...r.payload.lines, item: { ...r.payload.lines.item, amount: { ...r.payload.lines.item.amount, default: e.target.value } } } } }))} />
            </label>
            <label style={{ display: 'grid', gap: 6 }}>line.class_ref_text.default
              <input value={rules?.payload?.lines?.item?.class_ref_text?.default ?? ''} onChange={(e) => setRules((r) => ({ ...r, payload: { ...r.payload, lines: { ...r.payload.lines, item: { ...r.payload.lines.item, class_ref_text: { ...r.payload.lines.item.class_ref_text, default: e.target.value } } } } }))} />
            </label>
            <label style={{ display: 'grid', gap: 6 }}>line.tax_ref_text.default
              <input value={rules?.payload?.lines?.item?.tax_ref_text?.default ?? ''} onChange={(e) => setRules((r) => ({ ...r, payload: { ...r.payload, lines: { ...r.payload.lines, item: { ...r.payload.lines.item, tax_ref_text: { ...r.payload.lines.item.tax_ref_text, default: e.target.value } } } } }))} />
            </label>
            <label style={{ display: 'grid', gap: 6 }}>line.meta.kind.default
              <input value={rules?.payload?.lines?.item?.meta?.properties?.kind?.default ?? 'business'} onChange={(e) => setRules((r) => ({ ...r, payload: { ...r.payload, lines: { ...r.payload.lines, item: { ...r.payload.lines.item, meta: { ...r.payload.lines.item.meta, properties: { ...r.payload.lines.item.meta.properties, kind: { ...r.payload.lines.item.meta.properties.kind, default: e.target.value } } } } } } }))} />
            </label>
          </div>
        </section>

        <section style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 12 }}>
          <h3 style={{ marginTop: 0 }}>Finite option dictionaries (match-select)</h3>
          <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))' }}>
            <label style={{ display: 'grid', gap: 6 }}>Vendors
              <a href="/submissions/bill-rules/vendors-import" style={{ justifySelf: 'start', padding: '4px 10px', border: '1px solid #d0d7de', borderRadius: 6, textDecoration: 'none', color: '#111827', fontSize: 13 }}>import</a>
              <textarea value={vendorsText} onChange={(e) => setVendorsText(e.target.value)} style={{ minHeight: 120 }} />
            </label>
            <label style={{ display: 'grid', gap: 6 }}>Locations (bill level)
              <a href="/submissions/bill-rules/dictionary-import?type=locations" style={{ justifySelf: 'start', padding: '4px 10px', border: '1px solid #d0d7de', borderRadius: 6, textDecoration: 'none', color: '#111827', fontSize: 13 }}>import</a>
              <textarea value={locationsText} onChange={(e) => setLocationsText(e.target.value)} style={{ minHeight: 120 }} />
            </label>
            <label style={{ display: 'grid', gap: 6 }}>Categories / Accounts
              <a href="/submissions/bill-rules/dictionary-import?type=accounts" style={{ justifySelf: 'start', padding: '4px 10px', border: '1px solid #d0d7de', borderRadius: 6, textDecoration: 'none', color: '#111827', fontSize: 13 }}>import</a>
              <textarea value={accountsText} onChange={(e) => setAccountsText(e.target.value)} style={{ minHeight: 120 }} />
            </label>
            <label style={{ display: 'grid', gap: 6 }}>Classes (line level)
              <a href="/submissions/bill-rules/dictionary-import?type=classes" style={{ justifySelf: 'start', padding: '4px 10px', border: '1px solid #d0d7de', borderRadius: 6, textDecoration: 'none', color: '#111827', fontSize: 13 }}>import</a>
              <textarea value={classesText} onChange={(e) => setClassesText(e.target.value)} style={{ minHeight: 120 }} />
            </label>
            <label style={{ display: 'grid', gap: 6 }}>Tax codes (line level)
              <a href="/submissions/bill-rules/dictionary-import?type=taxCodes" style={{ justifySelf: 'start', padding: '4px 10px', border: '1px solid #d0d7de', borderRadius: 6, textDecoration: 'none', color: '#111827', fontSize: 13 }}>import</a>
              <textarea value={taxText} onChange={(e) => setTaxText(e.target.value)} style={{ minHeight: 120 }} />
            </label>
          </div>
        </section>

        {err ? <p role="alert" style={{ color: '#b42318' }}>{err}</p> : null}
        {ok ? <p style={{ color: '#027a48' }}>{ok}</p> : null}

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button type="submit" disabled={saving} style={{ padding: '10px 14px', fontWeight: 600 }}>{saving ? 'Saving...' : 'Save Rules'}</button>
          <a href="/submissions" style={{ padding: '10px 14px', border: '1px solid #d0d7de', borderRadius: 8, textDecoration: 'none', color: '#111827' }}>Back to submissions</a>
        </div>
      </form>
    </main>
  );
}
