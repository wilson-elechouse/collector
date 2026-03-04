'use client';

import { useEffect, useState } from 'react';

function parseList(dict = []) {
  return Array.isArray(dict) ? dict.map((x) => x?.label || x?.key).filter(Boolean).join('\n') : '';
}

function toDictItems(text, idField) {
  return String(text || '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((label) => ({ key: label.toUpperCase().replace(/[^A-Z0-9]+/g, '_'), label, [idField]: '__SET_BY_TENANT__', active: true }));
}

export default function BillPaymentRulesPage() {
  const [rules, setRules] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');

  const [vendorsText, setVendorsText] = useState('');
  const [bankAccountsText, setBankAccountsText] = useState('');

  useEffect(() => {
    (async () => {
      const res = await fetch('/api/bill-payment-rules', { cache: 'no-store' });
      const j = await res.json().catch(() => ({}));
      if (res.status === 401 || j?.error === 'unauthorized') {
        window.location.href = '/login?next=%2Fsubmissions%2Fbill-payment-rules';
        return;
      }
      if (res.status === 400 || j?.error === 'tenant_not_selected') {
        window.location.href = '/tenant/select?next=%2Fsubmissions%2Fbill-payment-rules';
        return;
      }
      if (!res.ok || !j?.ok) {
        setErr(j?.error || `load_failed_${res.status}`);
      } else {
        setRules(j.rules);
        setVendorsText(parseList(j.rules?.qboOptionDictionaries?.vendors));
        setBankAccountsText(parseList(j.rules?.qboOptionDictionaries?.bankAccounts));
      }
      setLoading(false);
    })();
  }, []);

  async function onSyncFromQbo() {
    setSyncing(true);
    setErr('');
    setOk('');
    try {
      const syncRes = await fetch('/api/mappings/sync', { method: 'POST' });
      const syncJson = await syncRes.json().catch(() => ({}));
      if (!syncRes.ok || !syncJson?.ok) throw new Error(syncJson?.detail || syncJson?.error || `sync_failed_${syncRes.status}`);

      const catRes = await fetch('/api/mappings/catalog', { cache: 'no-store' });
      const catJson = await catRes.json().catch(() => ({}));
      if (!catRes.ok || !catJson?.ok) throw new Error(catJson?.detail || catJson?.error || `catalog_failed_${catRes.status}`);

      setVendorsText((catJson.catalog?.vendors || []).map((x) => x.name).filter(Boolean).join('\n'));
      setBankAccountsText((catJson.catalog?.accounts || []).map((x) => x.name).filter(Boolean).join('\n'));
      setOk('Synced from QBO and refreshed vendor/bank account dictionaries.');
    } catch (e) {
      setErr(String(e?.message || e));
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
    next.qboOptionDictionaries = {
      ...(next.qboOptionDictionaries || {}),
      vendors: toDictItems(vendorsText, 'qbo_vendor_id'),
      bankAccounts: toDictItems(bankAccountsText, 'qbo_account_id')
    };

    const res = await fetch('/api/bill-payment-rules', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rules: next })
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j?.ok) {
      setErr(j?.error || `save_failed_${res.status}`);
    } else {
      setRules(next);
      setOk('Saved. BillPayment rules persisted.');
    }
    setSaving(false);
  }

  if (loading) return <main style={{ padding: 16 }}><p>Loading BillPayment Rules...</p></main>;
  if (err && !rules) return <main style={{ padding: 16 }}><p role="alert">Failed to load BillPayment Rules: {err}</p></main>;

  return (
    <main style={{ padding: 16, maxWidth: 980, margin: '0 auto' }}>
      <h1>BillPayment Rules Editor</h1>
      <p style={{ color: '#555' }}>Configuration for BillPayment creation defaults and option dictionaries.</p>
      <div style={{ marginBottom: 10 }}>
        <button type="button" onClick={onSyncFromQbo} disabled={syncing} style={{ padding: '10px 14px', fontWeight: 600 }}>
          {syncing ? 'Syncing from QBO...' : 'Sync from QBO (Vendor/Bank Account)'}
        </button>
      </div>
      <form onSubmit={onSave} style={{ display: 'grid', gap: 12 }}>
        <section style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 12 }}>
          <h3 style={{ marginTop: 0 }}>Core limits</h3>
          <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))' }}>
            <label style={{ display: 'grid', gap: 6 }}>Client Ref min length
              <input type="number" value={rules?.submission?.client_ref?.minLength ?? 3} onChange={(e) => setRules((r) => ({ ...r, submission: { ...r.submission, client_ref: { ...r.submission.client_ref, minLength: Number(e.target.value || 0) } } }))} />
            </label>
            <label style={{ display: 'grid', gap: 6 }}>Client Ref max length
              <input type="number" value={rules?.submission?.client_ref?.maxLength ?? 64} onChange={(e) => setRules((r) => ({ ...r, submission: { ...r.submission, client_ref: { ...r.submission.client_ref, maxLength: Number(e.target.value || 0) } } }))} />
            </label>
            <label style={{ display: 'grid', gap: 6 }}>Memo max length
              <input type="number" value={rules?.submission?.memo?.maxLength ?? 500} onChange={(e) => setRules((r) => ({ ...r, submission: { ...r.submission, memo: { ...r.submission.memo, maxLength: Number(e.target.value || 0) } } }))} />
            </label>
          </div>
        </section>

        <section style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 12 }}>
          <h3 style={{ marginTop: 0 }}>Default values</h3>
          <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))' }}>
            <label style={{ display: 'grid', gap: 6 }}>pay_date.default
              <input value={rules?.payload?.pay_date?.default ?? 'today'} onChange={(e) => setRules((r) => ({ ...r, payload: { ...r.payload, pay_date: { ...r.payload.pay_date, default: e.target.value } } }))} />
            </label>
            <label style={{ display: 'grid', gap: 6 }}>vendor_ref_text.default
              <input value={rules?.payload?.vendor_ref_text?.default ?? ''} onChange={(e) => setRules((r) => ({ ...r, payload: { ...r.payload, vendor_ref_text: { ...r.payload.vendor_ref_text, default: e.target.value } } }))} />
            </label>
            <label style={{ display: 'grid', gap: 6 }}>bank_account_ref_text.default
              <input value={rules?.payload?.bank_account_ref_text?.default ?? ''} onChange={(e) => setRules((r) => ({ ...r, payload: { ...r.payload, bank_account_ref_text: { ...r.payload.bank_account_ref_text, default: e.target.value } } }))} />
            </label>
          </div>
        </section>

        <section style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 12 }}>
          <h3 style={{ marginTop: 0 }}>Finite option dictionaries (match-select)</h3>
          <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))' }}>
            <label style={{ display: 'grid', gap: 6 }}>Vendors
              <textarea value={vendorsText} onChange={(e) => setVendorsText(e.target.value)} style={{ minHeight: 120 }} />
            </label>
            <label style={{ display: 'grid', gap: 6 }}>Bank / Credit Accounts
              <textarea value={bankAccountsText} onChange={(e) => setBankAccountsText(e.target.value)} style={{ minHeight: 120 }} />
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
