'use client';

import { useEffect, useMemo, useState } from 'react';

function toErrorText(label, reason) {
  return `${label} load failed${reason ? `: ${reason}` : ''}`;
}

export default function Dashboard() {
  const [me, setMe] = useState(null);
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(true);
  const [meError, setMeError] = useState('');
  const [healthError, setHealthError] = useState('');

  useEffect(() => {
    let alive = true;

    (async () => {
      setLoading(true);
      setMeError('');
      setHealthError('');

      const [meRes, healthRes] = await Promise.allSettled([
        fetch('/api/auth/me', { cache: 'no-store' }),
        fetch('/api/health', { cache: 'no-store' })
      ]);

      if (!alive) return;

      if (meRes.status === 'fulfilled') {
        const payload = await meRes.value.json().catch(() => null);
        if (!meRes.value.ok || payload?.ok === false) {
          setMe(null);
          const reason = payload?.error || `${meRes.value.status}`;
          setMeError(toErrorText('User info', reason));
        } else {
          setMe(payload?.user ? { ...payload.user, tenant: payload.tenant || null } : null);
        }
      } else {
        setMe(null);
        setMeError(toErrorText('User info', meRes.reason?.message));
      }

      if (healthRes.status === 'fulfilled') {
        const payload = await healthRes.value.json().catch(() => null);
        if (!healthRes.value.ok || !payload) {
          setHealth(null);
          const reason = payload?.error || `${healthRes.value.status}`;
          setHealthError(toErrorText('Health check', reason));
        } else {
          setHealth(payload);
        }
      } else {
        setHealth(null);
        setHealthError(toErrorText('Health check', healthRes.reason?.message));
      }

      if (alive) setLoading(false);
    })();

    return () => {
      alive = false;
    };
  }, []);

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => null);
    window.location.href = '/login';
  }

  const accountLine = useMemo(() => {
    if (loading) return 'Loading user...';
    if (me?.username) return `Logged in as ${me.username}`;
    return 'Logged in as unavailable';
  }, [loading, me]);

  const tenantLine = useMemo(() => {
    if (loading) return 'Loading company...';
    if (me?.tenant?.name) return `Current company: ${me.tenant.name}`;
    if (me?.tenant?.tenantCode) return `Current company: ${me.tenant.tenantCode}`;
    return 'Current company: not selected';
  }, [loading, me]);

  return (
    <div style={{ width: '100%', maxWidth: 960, margin: '0 auto' }}>
      <h2 style={{ marginTop: 0 }}>Dashboard</h2>
      <p style={{ margin: '6px 0' }}><b>{accountLine}</b></p>
      <p style={{ margin: '6px 0' }}><b>{tenantLine}</b></p>
      <p style={{ margin: '6px 0' }}>System health: <b>{health?.ok ? 'OK' : 'UNAVAILABLE'}</b></p>

      {meError ? <p style={{ color: 'crimson', margin: '8px 0' }}>{meError}</p> : null}
      {healthError ? <p style={{ color: 'crimson', margin: '8px 0' }}>{healthError}</p> : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: 12, marginTop: 14 }}>
        <a href="/bill" style={{ border: '1px solid #d0d7de', borderRadius: 10, padding: 14, textDecoration: 'none', color: '#111' }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Bill Workspace</div>
          <div style={{ color: '#555' }}>Create, edit, validate and submit Bill records.</div>
        </a>

        <a href="/bill-payment" style={{ border: '1px solid #d0d7de', borderRadius: 10, padding: 14, textDecoration: 'none', color: '#111' }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Bill Payment Workspace</div>
          <div style={{ color: '#555' }}>Create, edit, validate and submit Bill Payment records.</div>
        </a>

        <a href="/settings" style={{ border: '1px solid #d0d7de', borderRadius: 10, padding: 14, textDecoration: 'none', color: '#111' }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Settings</div>
          <div style={{ color: '#555' }}>Rules, tenant/QBO connection, and configuration.</div>
        </a>
      </div>

      <div style={{ marginTop: 14 }}>
        <button onClick={logout} style={{ padding: '10px 12px' }}>Logout</button>
      </div>
    </div>
  );
}
