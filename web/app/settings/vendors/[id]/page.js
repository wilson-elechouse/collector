'use client';

import { useEffect, useMemo, useState } from 'react';

const emptyAddr = { line1: '', city: '', country_sub_division_code: '', postal_code: '', country: '' };

export default function VendorEditPage({ params }) {
  const id = decodeURIComponent(params?.id || '');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [v, setV] = useState({ name: '', company_name: '', email: '', phone: '', tax_identifier: '', active: true, bill_addr: { ...emptyAddr } });
  const [origin, setOrigin] = useState(null);

  async function load() {
    setLoading(true);
    setError('');
    const res = await fetch('/api/vendors', { cache: 'no-store' }).catch(() => null);
    const j = res ? await res.json().catch(() => ({})) : {};
    if (!res || !res.ok || !j?.ok) {
      setError(j?.detail || j?.error || `Load failed${res ? ` (${res.status})` : ''}`);
      setLoading(false);
      return;
    }
    const row = (Array.isArray(j.rows) ? j.rows : []).find((x) => String(x?.id) === String(id));
    if (!row) {
      setError('vendor_not_found');
      setLoading(false);
      return;
    }
    const data = {
      name: row?.name || '',
      company_name: row?.company_name || '',
      email: row?.email || '',
      phone: row?.phone || '',
      tax_identifier: row?.tax_identifier || '',
      active: !!row?.active,
      bill_addr: {
        line1: row?.bill_addr?.line1 || '',
        city: row?.bill_addr?.city || '',
        country_sub_division_code: row?.bill_addr?.country_sub_division_code || '',
        postal_code: row?.bill_addr?.postal_code || '',
        country: row?.bill_addr?.country || ''
      }
    };
    setV(data);
    setOrigin(JSON.stringify(data));
    setLoading(false);
  }

  useEffect(() => { load(); }, [id]);

  const changed = useMemo(() => JSON.stringify(v) !== origin, [v, origin]);

  async function updateVendor(forceSync = false) {
    setSaving(true);
    const res = await fetch(`/api/vendors/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(forceSync ? { force_sync: true } : {
        display_name: v.name.trim(),
        company_name: v.company_name.trim(),
        email: v.email.trim(),
        phone: v.phone.trim(),
        tax_identifier: v.tax_identifier.trim(),
        active: v.active,
        bill_addr: {
          line1: v.bill_addr.line1.trim(),
          city: v.bill_addr.city.trim(),
          country_sub_division_code: v.bill_addr.country_sub_division_code.trim(),
          postal_code: v.bill_addr.postal_code.trim(),
          country: v.bill_addr.country.trim()
        }
      })
    }).catch(() => null);
    const j = res ? await res.json().catch(() => ({})) : {};
    if (!res || !res.ok || !j?.ok) {
      alert(`Save failed: ${j?.detail || j?.error || (res ? res.status : 'network')}`);
      setSaving(false);
      return;
    }
    await load();
    setSaving(false);
  }

  return (
    <main style={{ padding: 16, maxWidth: 900, margin: '0 auto' }}>
      <h1 style={{ marginTop: 0 }}>Edit Vendor #{id}</h1>
      <p><a href='/settings/vendors'>← Back to list</a></p>
      {error ? <p style={{ color: 'crimson' }}>{error}</p> : null}
      {loading ? <p style={{ color: '#666' }}>Loading...</p> : (
        <section style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 12 }}>
          <div style={grid3}>
            <L label='Display Name *'><input value={v.name} onChange={(e) => setV((s) => ({ ...s, name: e.target.value }))} /></L>
            <L label='Company Name'><input value={v.company_name} onChange={(e) => setV((s) => ({ ...s, company_name: e.target.value }))} /></L>
            <L label='Tax Identifier'><input value={v.tax_identifier} onChange={(e) => setV((s) => ({ ...s, tax_identifier: e.target.value }))} /></L>
            <L label='Email'><input value={v.email} onChange={(e) => setV((s) => ({ ...s, email: e.target.value }))} /></L>
            <L label='Phone'><input value={v.phone} onChange={(e) => setV((s) => ({ ...s, phone: e.target.value }))} /></L>
            <L label='Active'><input type='checkbox' checked={v.active} onChange={(e) => setV((s) => ({ ...s, active: e.target.checked }))} /></L>
          </div>
          <div style={{ marginTop: 8 }}><b>Bill Address</b></div>
          <div style={grid5}>
            <L label='Line1'><input value={v.bill_addr.line1} onChange={(e) => setV((s) => ({ ...s, bill_addr: { ...s.bill_addr, line1: e.target.value } }))} /></L>
            <L label='City'><input value={v.bill_addr.city} onChange={(e) => setV((s) => ({ ...s, bill_addr: { ...s.bill_addr, city: e.target.value } }))} /></L>
            <L label='State/Province'><input value={v.bill_addr.country_sub_division_code} onChange={(e) => setV((s) => ({ ...s, bill_addr: { ...s.bill_addr, country_sub_division_code: e.target.value } }))} /></L>
            <L label='Postal'><input value={v.bill_addr.postal_code} onChange={(e) => setV((s) => ({ ...s, bill_addr: { ...s.bill_addr, postal_code: e.target.value } }))} /></L>
            <L label='Country'><input value={v.bill_addr.country} onChange={(e) => setV((s) => ({ ...s, bill_addr: { ...s.bill_addr, country: e.target.value } }))} /></L>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button disabled={!changed || saving || !v.name.trim()} onClick={() => updateVendor(false)}>{saving ? 'Saving...' : 'Update QBO'}</button>
            <button disabled={saving} onClick={() => updateVendor(true)}>Force Sync</button>
          </div>
        </section>
      )}
    </main>
  );
}

function L({ label, children }) { return <label style={{ display: 'grid', gap: 4 }}><span style={{ fontSize: 12, color: '#555' }}>{label}</span>{children}</label>; }
const grid3 = { display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' };
const grid5 = { display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', marginTop: 6 };
