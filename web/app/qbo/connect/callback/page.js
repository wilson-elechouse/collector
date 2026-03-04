'use client';

import { useEffect, useState } from 'react';

export default function QboCallbackPage() {
  const [message, setMessage] = useState('Finishing QuickBooks connection...');

  useEffect(() => {
    let active = true;

    (async () => {
      try {
        const url = new URL(window.location.href);
        const res = await fetch(`/api/qbo/connect/callback?${url.searchParams.toString()}`, {
          credentials: 'include',
          cache: 'no-store'
        });
        const j = await res.json().catch(() => ({}));

        if (!active) return;

        if (!res.ok || !j?.ok) {
          setMessage(`QuickBooks callback failed: ${j?.error || res.status}`);
          return;
        }

        window.location.href = '/tenant/select?qbo=connected';
      } catch (e) {
        if (!active) return;
        setMessage(`QuickBooks callback failed: ${String(e?.message || e)}`);
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  return (
    <div style={{ maxWidth: 560 }}>
      <h2>QuickBooks</h2>
      <p>{message}</p>
    </div>
  );
}
