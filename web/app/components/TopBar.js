'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

export default function TopBar() {
  const pathname = usePathname();
  const [me, setMe] = useState(null);

  useEffect(() => {
    (async () => {
      const meRes = await fetch('/api/auth/me', { cache: 'no-store' }).catch(() => null);
      if (meRes?.ok) {
        const j = await meRes.json().catch(() => ({}));
        setMe(j);
      }
    })();
  }, []);

  if (pathname?.startsWith('/login')) return null;

  return (
    <div style={{ padding: 12, borderBottom: '1px solid #eee', display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <b>Collector V3</b>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <a href="/dashboard">Dashboard</a>
          <a href="/bill">Bill</a>
          <a href="/bill-payment">Bill Payment</a>
          <a href="/settings">Settings</a>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ color: '#666' }}>
          {`Current QBO Company: ${me?.tenant?.name || me?.tenant?.tenantId || 'none'}`}
        </span>
      </div>
    </div>
  );
}
