'use client';

import { useEffect, useState } from 'react';

export default function UsersPage() {
  const [me, setMe] = useState(null);
  const [meLoaded, setMeLoaded] = useState(false);
  const [rows, setRows] = useState([]);
  const [err, setErr] = useState('');
  const [form, setForm] = useState({ username: '', password: '', role: 'user' });

  async function load() {
    setErr('');
    const meRes = await fetch('/api/auth/me', { cache: 'no-store' });
    const meJson = await meRes.json().catch(() => ({}));
    const meUser = meJson?.user || null;
    setMe(meUser);
    setMeLoaded(true);
    if (!meUser) {
      window.location.href = '/login?next=%2Fsettings%2Fusers';
      return;
    }
    if (meUser.role !== 'admin') {
      window.location.href = '/dashboard';
      return;
    }

    const res = await fetch('/api/admin/users', { cache: 'no-store' });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j?.ok) {
      setErr(j?.error || `load_failed_${res.status}`);
      return;
    }
    setRows(j.rows || []);
  }

  useEffect(() => { load(); }, []);

  async function createUser(e) {
    e.preventDefault();
    setErr('');
    const res = await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(form)
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j?.ok) {
      setErr(j?.error || `create_failed_${res.status}`);
      return;
    }
    setForm({ username: '', password: '', role: 'user' });
    await load();
  }

  async function toggleStatus(row) {
    const next = row.status === 'active' ? 'disabled' : 'active';
    const res = await fetch(`/api/admin/users/${row.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: next })
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j?.ok) return setErr(j?.error || `update_failed_${res.status}`);
    await load();
  }

  async function resetPassword(row) {
    const pwd = window.prompt(`Set new password for ${row.username}:`);
    if (!pwd) return;
    const res = await fetch(`/api/admin/users/${row.id}/reset-password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: pwd })
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j?.ok) return setErr(j?.error || `reset_failed_${res.status}`);
    alert('Password reset done.');
  }

  if (!meLoaded) {
    return <main style={{ padding: 16 }}><p>Loading...</p></main>;
  }

  if (!me || me.role !== 'admin') {
    return <main style={{ padding: 16 }}><p>Redirecting...</p></main>;
  }

  return (
    <main style={{ padding: 16, maxWidth: 980, margin: '0 auto' }}>
      <h1>User Management</h1>
      <form onSubmit={createUser} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <input placeholder='username' value={form.username} onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))} />
        <input placeholder='password' type='password' value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} />
        <select value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}>
          <option value='user'>user</option>
          <option value='admin'>admin</option>
        </select>
        <button type='submit'>Create user</button>
      </form>

      {err ? <p style={{ color: 'crimson' }}>{err}</p> : null}

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', borderBottom: '1px solid #eee' }}>Username</th>
            <th style={{ textAlign: 'left', borderBottom: '1px solid #eee' }}>Role</th>
            <th style={{ textAlign: 'left', borderBottom: '1px solid #eee' }}>Status</th>
            <th style={{ textAlign: 'left', borderBottom: '1px solid #eee' }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td style={{ padding: 6, borderBottom: '1px solid #f4f4f4' }}>{r.username}</td>
              <td style={{ padding: 6, borderBottom: '1px solid #f4f4f4' }}>{r.role}</td>
              <td style={{ padding: 6, borderBottom: '1px solid #f4f4f4' }}>{r.status}</td>
              <td style={{ padding: 6, borderBottom: '1px solid #f4f4f4', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button onClick={() => toggleStatus(r)}>{r.status === 'active' ? 'Disable' : 'Enable'}</button>
                <button onClick={() => resetPassword(r)}>Reset password</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
