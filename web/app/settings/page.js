'use client';

import { useEffect, useState } from 'react';

export default function SettingsPage() {
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    (async () => {
      const res = await fetch('/api/auth/me', { cache: 'no-store' }).catch(() => null);
      const j = res ? await res.json().catch(() => ({})) : {};
      setIsAdmin(j?.user?.role === 'admin');
    })();
  }, []);

  return (
    <main style={{ padding: 16, maxWidth: 860, margin: '0 auto' }}>
      <h1 style={{ marginTop: 0 }}>Settings</h1>
      <p style={{ color: '#555' }}>集中管理规则与连接配置。</p>

      <section style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 12, marginTop: 12 }}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>Form Rules</h2>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <a href="/submissions/bill-rules" style={{ padding: '10px 12px', border: '1px solid #ccc', borderRadius: 6, textDecoration: 'none', color: '#111' }}>
            Bill Rules
          </a>
          <a href="/submissions/bill-payment-rules" style={{ padding: '10px 12px', border: '1px solid #ccc', borderRadius: 6, textDecoration: 'none', color: '#111' }}>
            Bill Payment Rules
          </a>
        </div>
      </section>

      <section style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 12, marginTop: 12 }}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>Tenant / QBO</h2>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <a href="/tenant/select" style={{ padding: '10px 12px', border: '1px solid #ccc', borderRadius: 6, textDecoration: 'none', color: '#111', display: 'inline-block' }}>
            Manage tenant & QBO connection
          </a>
          <a href="/settings/vendors" style={{ padding: '10px 12px', border: '1px solid #ccc', borderRadius: 6, textDecoration: 'none', color: '#111', display: 'inline-block' }}>
            Vendor Management
          </a>
        </div>
      </section>

      {isAdmin ? (
        <section style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 12, marginTop: 12 }}>
          <h2 style={{ marginTop: 0, fontSize: 18 }}>Admin</h2>
          <a href="/settings/users" style={{ padding: '10px 12px', border: '1px solid #ccc', borderRadius: 6, textDecoration: 'none', color: '#111', display: 'inline-block' }}>
            User Management
          </a>
        </section>
      ) : null}
    </main>
  );
}
