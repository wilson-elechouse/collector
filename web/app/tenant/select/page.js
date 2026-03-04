'use client';

import { useEffect, useMemo, useState } from 'react';

const DEFAULT_TENANTS = [
  { id: 't-acme', name: 'Acme Trading' },
  { id: 't-beta', name: 'Beta Services' }
];

export default function TenantSelectPage() {
  const [next, setNext] = useState('/dashboard');
  const [tenants, setTenants] = useState(DEFAULT_TENANTS);
  const [tenantId, setTenantId] = useState(DEFAULT_TENANTS[0].id);
  const [rows, setRows] = useState([]);
  const [currentTenantId, setCurrentTenantId] = useState('');

  const [newTenantName, setNewTenantName] = useState('');
  const [loading, setLoading] = useState(false);
  const [qboLoading, setQboLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    try {
      const u = new URL(window.location.href);
      const n = u.searchParams.get('next') || '/dashboard';
      setNext(n.startsWith('/') ? n : '/dashboard');
    } catch {}

    refreshMe();
    refreshTenants();
    refreshConnections();
  }, []);

  function redirectToLogin() {
    window.location.href = '/login?next=%2Ftenant%2Fselect';
  }

  async function refreshMe() {
    try {
      const r = await fetch('/api/auth/me', { credentials: 'include', cache: 'no-store' });
      const j = await r.json().catch(() => ({}));
      if (r.status === 401 || j?.error === 'unauthorized') {
        redirectToLogin();
        return;
      }
      const selectedId = String(j?.tenant?.tenantId || '').trim();
      if (selectedId) {
        setCurrentTenantId(selectedId);
        setTenantId(selectedId);
      }
    } catch {}
  }

  async function refreshTenants() {
    try {
      const r = await fetch('/api/tenants', { credentials: 'include', cache: 'no-store' });
      const j = await r.json().catch(() => ({}));
      if (r.status === 401 || j?.error === 'unauthorized') {
        redirectToLogin();
        return;
      }
      if (r.ok && Array.isArray(j?.tenants) && j.tenants.length > 0) {
        const mapped = j.tenants.map((t) => ({ id: t.tenantId || t.id, name: t.name || t.tenantCode || t.tenantId }));
        setTenants(mapped);
        const preferredId = currentTenantId || tenantId;
        if (!mapped.find((t) => t.id === preferredId)) setTenantId(mapped[0].id);
        else if (tenantId !== preferredId) setTenantId(preferredId);
      }
    } catch {}
  }

  async function refreshConnections() {
    try {
      const r = await fetch('/api/qbo/connect/connections', { credentials: 'include', cache: 'no-store' });
      const j = await r.json().catch(() => ({}));
      if (r.status === 401 || j?.error === 'unauthorized') {
        redirectToLogin();
        return;
      }
      if (r.ok && j?.ok && Array.isArray(j.rows)) setRows(j.rows);
      else setRows([]);
    } catch {
      setRows([]);
    }
  }

  async function selectTenant(id) {
    const res = await fetch('/api/tenant/select', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ tenantId: id })
    });
    const j = await res.json().catch(() => ({}));
    if (res.status === 401 || j?.error === 'unauthorized') {
      redirectToLogin();
      throw new Error('unauthorized');
    }
    if (!res.ok || !j?.ok) throw new Error(j?.error || `tenant_select_failed_${res.status}`);
  }

  async function startQboForTenant(id) {
    await selectTenant(id);
    const res = await fetch('/api/qbo/connect/start', { method: 'POST', credentials: 'include' });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j?.ok || !j?.authorizationUrl) throw new Error(j?.error || `qbo_connect_start_failed_${res.status}`);
    window.location.href = j.authorizationUrl;
  }

  async function deleteTenant(id) {
    if (!window.confirm(`Delete tenant ${id}?`)) return;
    setError('');
    try {
      const res = await fetch('/api/tenants', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ tenantId: id })
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.ok) throw new Error(j?.error || `tenant_delete_failed_${res.status}`);
      await refreshTenants();
      await refreshConnections();
    } catch (e) {
      setError(String(e?.message || e));
    }
  }

  async function createAndConnect() {
    const name = newTenantName.trim();
    if (!name) return;

    setError('');
    setQboLoading(true);
    try {
      const res = await fetch('/api/tenants', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name })
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.ok || !j?.tenant?.tenantId) {
        throw new Error(j?.error || `tenant_create_failed_${res.status}`);
      }

      const createdId = j.tenant.tenantId;
      setNewTenantName('');
      await refreshTenants();
      await refreshConnections();
      await startQboForTenant(createdId);
    } catch (e) {
      setError(String(e?.message || e));
      setQboLoading(false);
    }
  }

  async function onContinue(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await selectTenant(tenantId);
      window.location.href = next;
    } catch (e2) {
      setError(String(e2?.message || e2));
    } finally {
      setLoading(false);
    }
  }

  const connectedTenantIds = useMemo(
    () => new Set(rows.filter((r) => r.connected && r.tokenReady).map((r) => r.tenantId)),
    [rows]
  );
  const selectableTenants = useMemo(
    () => tenants.filter((t) => connectedTenantIds.has(t.id)),
    [tenants, connectedTenantIds]
  );

  useEffect(() => {
    if (selectableTenants.length === 0) return;
    if (!selectableTenants.find((t) => t.id === tenantId)) {
      setTenantId(selectableTenants[0].id);
    }
  }, [tenantId, selectableTenants]);

  const tenantName = useMemo(() => tenants.find((t) => t.id === tenantId)?.name || tenantId, [tenantId, tenants]);

  return (
    <div style={{ width: '100%', maxWidth: 860 }}>
      <h2>Tenant Management</h2>
      <p style={{ color: '#666' }}>新建租户后可一键跳转 QuickBooks 授权；下方表格显示已连接状态。</p>
      <p style={{ color: '#b42318', marginTop: -4 }}>注意：应用登录仅是平台登录，不会刷新 QBO OAuth token。若显示 "Connected (token missing)"，请点 Reconnect 并完成 Intuit 授权回跳。</p>

      <div style={{ display: 'flex', gap: 8, margin: '12px 0', flexWrap: 'wrap' }}>
        <input
          placeholder="New tenant name"
          value={newTenantName}
          onChange={(e) => setNewTenantName(e.target.value)}
          style={{ flex: 1, minWidth: 260, padding: 10 }}
        />
        <button type="button" onClick={createAndConnect} disabled={qboLoading} style={{ padding: '10px 12px' }}>
          {qboLoading ? 'Creating...' : 'Create & Connect QuickBooks'}
        </button>
      </div>

      <div style={{ overflowX: 'auto', border: '1px solid #eee', borderRadius: 6, marginBottom: 16 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 680 }}>
          <thead>
            <tr style={{ background: '#fafafa' }}>
              <th style={{ textAlign: 'left', padding: 10, borderBottom: '1px solid #eee' }}>Tenant</th>
              <th style={{ textAlign: 'left', padding: 10, borderBottom: '1px solid #eee' }}>Status</th>
              <th style={{ textAlign: 'left', padding: 10, borderBottom: '1px solid #eee' }}>RealmId</th>
              <th style={{ textAlign: 'left', padding: 10, borderBottom: '1px solid #eee' }}>ConnectedAt</th>
              <th style={{ textAlign: 'left', padding: 10, borderBottom: '1px solid #eee' }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={5} style={{ padding: 12, color: '#666' }}>No tenant records</td></tr>
            ) : rows.map((r) => (
              <tr key={r.tenantId}>
                <td style={{ padding: 10, borderBottom: '1px solid #f2f2f2' }}>{r.tenantName} ({r.tenantId})</td>
                <td style={{ padding: 10, borderBottom: '1px solid #f2f2f2' }}>
                  <b>{r.connected ? (r.tokenReady ? 'Connected' : 'Connected (token missing)') : 'Not connected'}</b>
                </td>
                <td style={{ padding: 10, borderBottom: '1px solid #f2f2f2' }}>{r.realmId || '-'}</td>
                <td style={{ padding: 10, borderBottom: '1px solid #f2f2f2' }}>{r.connectedAt || '-'}</td>
                <td style={{ padding: 10, borderBottom: '1px solid #f2f2f2' }}>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button type="button" onClick={() => startQboForTenant(r.tenantId)} style={{ padding: '6px 10px' }}>
                      {r.connected ? 'Reconnect' : 'Connect'}
                    </button>
                    <button type="button" onClick={() => deleteTenant(r.tenantId)} style={{ padding: '6px 10px' }}>
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selectableTenants.length > 0 ? (
        <div style={{ marginTop: 12, color: '#555' }}>
          已连接租户可直接在页面顶部的 <b>QBO Company</b> 下拉框切换，无需在此页 Continue。
        </div>
      ) : null}

      {error ? <div style={{ marginTop: 12, color: 'crimson' }}>Error: {error}</div> : null}
    </div>
  );
}
