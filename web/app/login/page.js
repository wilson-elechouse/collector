'use client';

import { useEffect, useState } from 'react';

export default function LoginPage() {
  const [next, setNext] = useState('/dashboard');

  useEffect(() => {
    // Avoid useSearchParams() prerender constraint; this is a client page anyway.
    try {
      const u = new URL(window.location.href);
      setNext(u.searchParams.get('next') || '/dashboard');
    } catch {}
  }, []);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ username, password })
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(j?.error || `login_failed_${res.status}`);
        return;
      }
      window.location.href = next;
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ maxWidth: 420 }}>
      <h2>Login</h2>
      <p style={{ color: '#666' }}>Set local credentials in `infra/.env` before logging in.</p>
      <form onSubmit={onSubmit}>
        <label style={{ display: 'block', marginTop: 12 }}>
          Username
          <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder='Username' style={{ width: '100%', padding: 10, marginTop: 6 }} />
        </label>
        <label style={{ display: 'block', marginTop: 12 }}>
          Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder='Password' style={{ width: '100%', padding: 10, marginTop: 6 }} />
        </label>
        <button disabled={loading} style={{ marginTop: 16, padding: '10px 12px' }}>
          {loading ? 'Logging in…' : 'Login'}
        </button>
      </form>
      {error ? <div style={{ marginTop: 12, color: 'crimson' }}>Error: {error}</div> : null}
    </div>
  );
}
