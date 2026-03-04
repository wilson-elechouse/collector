'use client';

import { useEffect, useState } from 'react';

function confidenceStyle(level) {
  const v = String(level || '').toLowerCase();
  if (v === 'high') return { bg: '#ecfdf3', bd: '#abefc6', fg: '#067647', label: 'HIGH' };
  if (v === 'medium') return { bg: '#fffaeb', bd: '#fedf89', fg: '#b54708', label: 'MEDIUM' };
  return { bg: '#fff6f6', bd: '#fecdca', fg: '#b42318', label: 'LOW' };
}

function StepHeader({ current }) {
  const steps = ['Edit', 'Confirm', 'Result'];
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
      {steps.map((name, idx) => {
        const stepNo = idx + 1;
        const active = current === stepNo;
        return (
          <div key={name} style={{ border: '1px solid #d0d7de', borderRadius: 999, padding: '6px 10px', background: active ? '#111827' : '#fff', color: active ? '#fff' : '#111827', fontWeight: 600 }}>
            Step {stepNo}: {name}
          </div>
        );
      })}
    </div>
  );
}

export default function SubmissionConfirmPage({ params }) {
  const [row, setRow] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [finalChecked, setFinalChecked] = useState(false);
  const [showRaw, setShowRaw] = useState(false);

  useEffect(() => {
    let ignore = false;
    (async () => {
      try {
        const res = await fetch(`/api/submissions/${params.id}`, { cache: 'no-store' });
        const j = await res.json();
        if (!res.ok || !j?.ok) throw new Error(j?.error || `load_failed_${res.status}`);
        if (!ignore) setRow(j.row);
      } catch (e) {
        if (!ignore) setErr(e.message);
      }
    })();
    return () => {
      ignore = true;
    };
  }, [params.id]);

  async function runAction(kind) {
    setErr('');
    setBusy(true);
    try {
      const route = kind === 'precheck' ? 'precheck' : 'submit';
      const res = await fetch(`/api/submissions/${params.id}/${route}`, { method: 'POST' });
      const j = await res.json();
      if (!res.ok || !j?.ok) throw new Error(j?.detail || j?.error || `action_failed_${res.status}`);
      window.location.href = `/submissions/${params.id}/result`;
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (err && !row) return <main style={{ padding: 16 }}><p role="alert">Failed to load confirm page: {err}</p></main>;
  if (!row) return <main style={{ padding: 16 }}><p>Loading confirm page...</p></main>;

  const sourcePayload = {
    id: row.id,
    kind: row.kind,
    client_ref: row.client_ref,
    memo: row.memo || '',
    payload: row.payload || {}
  };
  const compiledQboPayload = row?.validation?.qbo_payload || null;
  const mappingIssues = (row?.validation?.issues || []).filter((x) => String(x).includes('mapping_'));

  return (
    <main style={{ padding: 16, maxWidth: 860, margin: '0 auto' }}>
      <StepHeader current={2} />
      <h1>Confirm Submission</h1>
      <p>Kind: <b>{row.kind}</b> · Client ref: <b>{row.client_ref}</b></p>

      {mappingIssues.length ? (
        <section style={{ border: '1px solid #fecdca', background: '#fff6f6', borderRadius: 10, padding: 12, marginTop: 12 }}>
          <h2 style={{ marginTop: 0, fontSize: 18, color: '#b42318' }}>Mapping issue summary</h2>
          <p style={{ color: '#b42318', marginTop: 6 }}>Please fix these mapping gaps before final submit:</p>
          <ul style={{ color: '#b42318' }}>
            {mappingIssues.map((x, i) => <li key={`${x}-${i}`}>{x}</li>)}
          </ul>
        </section>
      ) : null}

      {Array.isArray(row?.payload?.lines) && row.payload.lines.length ? (
        <section style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 12, marginTop: 12 }}>
          <h2 style={{ marginTop: 0, fontSize: 18 }}>Line confidence</h2>
          <div style={{ display: 'grid', gap: 8 }}>
            {row.payload.lines.map((ln, idx) => {
              const level = ln?.meta?.confidence_level || ln?.confidence_level || 'low';
              const reason = ln?.meta?.confidence_reason || ln?.confidence_reason || 'Needs customer confirmation.';
              const c = confidenceStyle(level);
              return (
                <div key={idx} style={{ border: `1px solid ${c.bd}`, background: c.bg, borderRadius: 8, padding: 8 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <b style={{ color: c.fg }}>Line {idx + 1}: {c.label}</b>
                    <span style={{ color: '#333' }}>{reason}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      <section style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 12, marginTop: 12 }}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>Review actions</h2>
        <ul>
          <li><b>Precheck (not posting)</b>: validates payload and business rules without creating QBO transaction.</li>
          <li><b>Submit to QuickBooks (final)</b>: sends the transaction to QBO and cannot be undone here.</li>
        </ul>
        <div style={{ marginTop: 10 }}>
          <button type="button" onClick={() => setShowRaw((v) => !v)} style={{ padding: '8px 10px' }}>
            {showRaw ? 'Hide' : 'View'} source + compiled payload
          </button>
        </div>
        {showRaw ? (
          <div style={{ display: 'grid', gap: 10, marginTop: 10 }}>
            <label style={{ display: 'grid', gap: 6 }}>
              <b>Source payload (UI/business model)</b>
              <textarea
                readOnly
                value={JSON.stringify(sourcePayload, null, 2)}
                style={{ width: '100%', minHeight: 180, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
              />
            </label>
            <label style={{ display: 'grid', gap: 6 }}>
              <b>Compiled QBO payload (after validate mapping)</b>
              <textarea
                readOnly
                value={JSON.stringify(compiledQboPayload || { note: 'Run Validate/Precheck first to generate compiled QBO payload.' }, null, 2)}
                style={{ width: '100%', minHeight: 180, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
              />
            </label>
          </div>
        ) : null}
      </section>

      <label style={{ display: 'flex', gap: 8, marginTop: 14, alignItems: 'center' }}>
        <input type="checkbox" checked={finalChecked} onChange={(e) => setFinalChecked(e.target.checked)} />
        <span>I understand final submit is irreversible in this flow.</span>
      </label>

      {err ? (
        <div role="alert" style={{ color: '#b42318', marginTop: 12, border: '1px solid #fecdca', background: '#fff6f6', borderRadius: 8, padding: 10 }}>
          <b>Action failed</b>
          <div style={{ whiteSpace: 'pre-wrap', marginTop: 6 }}>{err}</div>
        </div>
      ) : null}

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 14 }}>
        <button disabled={busy} onClick={() => runAction('precheck')} style={{ padding: '10px 12px' }}>
          {busy ? 'Running...' : 'Precheck (not posting)'}
        </button>
        <button disabled={busy || !finalChecked} onClick={() => runAction('submit')} style={{ padding: '10px 12px', fontWeight: 700 }}>
          {busy ? 'Submitting...' : 'Submit to QuickBooks (final)'}
        </button>
      </div>

      <p style={{ marginTop: 14 }}><a href={`/submissions/${params.id}/edit`}>Back to Edit</a></p>
    </main>
  );
}
