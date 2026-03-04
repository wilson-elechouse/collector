'use client';

import { useEffect, useMemo, useState } from 'react';

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

function KV({ k, v }) {
  return (
    <div>
      <div style={{ color: '#666', fontSize: 12 }}>{k}</div>
      <div style={{ fontWeight: 600, wordBreak: 'break-word' }}>{String(v ?? '-')}</div>
    </div>
  );
}

export default function SubmissionResultPage({ params }) {
  const [row, setRow] = useState(null);
  const [err, setErr] = useState('');
  const [copying, setCopying] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleteAlsoQbo, setDeleteAlsoQbo] = useState(false);

  async function loadRow() {
    const res = await fetch(`/api/submissions/${params.id}`, { cache: 'no-store' });
    const j = await res.json();
    if (!res.ok || !j?.ok) throw new Error(j?.error || `load_failed_${res.status}`);
    setRow(j.row);
  }

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
    return () => { ignore = true; };
  }, [params.id]);

  async function createSimilar() {
    setCopying(true);
    setErr('');
    try {
      const res = await fetch(`/api/submissions/${params.id}/copy`, { method: 'POST' });
      const j = await res.json();
      if (!res.ok || !j?.ok || !j?.row?.id) throw new Error(j?.error || `copy_failed_${res.status}`);
      window.location.href = `/submissions/${j.row.id}/edit`;
    } catch (e) {
      setErr(String(e?.message || e));
      setCopying(false);
    }
  }

  function onDelete() {
    if (!row || deleting) return;
    setDeleteAlsoQbo(Boolean(row?.result?.qbo_id));
    setShowDeleteDialog(true);
  }

  async function confirmDelete() {
    if (!row || deleting) return;
    setErr('');
    setDeleting(true);
    try {
      const q = deleteAlsoQbo && row?.result?.qbo_id ? '?delete_qbo=1' : '';
      const del = await fetch(`/api/submissions/${params.id}${q}`, { method: 'DELETE' });
      const dj = await del.json().catch(() => ({}));
      if (!del.ok || !dj?.ok) {
        throw new Error(`${dj?.error || `HTTP ${del.status}`}${dj?.detail ? ` | ${dj.detail}` : ''}${dj?.qbo_delete_error ? ` | qbo=${dj.qbo_delete_error}` : ''}`);
      }
      if (dj?.qbo_delete_error) {
        setErr(`Local record deleted. QBO delete warning: ${dj.qbo_delete_error}`);
      }
      window.location.href = row.kind === 'bill_payment' ? '/bill-payment' : '/bill';
    } catch (e) {
      setErr(`Delete failed: ${String(e?.message || e)}`);
    } finally {
      setDeleting(false);
      setShowDeleteDialog(false);
    }
  }

  const payload = row?.payload || {};
  const lines = Array.isArray(payload?.lines) ? payload.lines : [];
  const ok = !!row?.result?.ok;
  const qboId = row?.result?.qbo_id || '-';

  const totalAmount = useMemo(() => {
    if (row?.kind === 'bill_payment') return lines.reduce((s, x) => s + (Number(x?.pay_amount || 0) || 0), 0);
    return lines.reduce((s, x) => s + (Number(x?.amount || 0) || 0), 0);
  }, [row?.kind, lines]);

  if (err && !row) return <main style={{ padding: 16 }}><p role='alert'>Failed to load result page: {err}</p></main>;
  if (!row) return <main style={{ padding: 16 }}><p>Loading result page...</p></main>;

  return (
    <main style={{ padding: 16, maxWidth: 980, margin: '0 auto' }}>
      <StepHeader current={3} />
      <h1>Submission View (Read-only)</h1>

      <section style={{ border: `1px solid ${ok ? '#16a34a' : '#ef4444'}`, borderRadius: 10, padding: 12, background: ok ? '#f0fdf4' : '#fef2f2' }}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>{ok ? 'Success' : 'Failed'}</div>
        <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
          <KV k='Status' v={row.status} />
          <KV k='Kind' v={row.kind} />
          <KV k='Client ref' v={row.client_ref} />
          <KV k='QBO ID' v={qboId} />
        </div>
        {row.memo ? <div style={{ marginTop: 8 }}><KV k='Memo' v={row.memo} /></div> : null}

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 12 }}>
          <button onClick={createSimilar} disabled={copying} style={{ padding: '10px 12px', fontWeight: 700 }}>
            {copying ? 'Copying...' : 'Copy as New'}
          </button>
          <button onClick={onDelete} disabled={deleting} style={{ padding: '10px 12px' }}>
            {deleting ? 'Deleting...' : 'Delete'}
          </button>
          {!ok ? <a href={`/submissions/${params.id}/edit`} style={{ textDecoration: 'underline', alignSelf: 'center' }}>Back to Edit</a> : null}
        </div>
      </section>

      <section style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 12, marginTop: 12 }}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>Header (read-only)</h2>
        <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
          {row.kind === 'bill' ? (
            <>
              <KV k='Vendor' v={payload.vendor_ref_text} />
              <KV k='Bill date' v={payload.bill_date} />
              <KV k='Due date' v={payload.due_date} />
              <KV k='Location' v={payload.location_ref_text} />
            </>
          ) : (
            <>
              <KV k='Vendor' v={payload.vendor_ref_text} />
              <KV k='Pay date' v={payload.pay_date} />
              <KV k='Bank account' v={payload.bank_account_ref_text} />
            </>
          )}
          <KV k='Total' v={Number(totalAmount || 0).toFixed(2)} />
        </div>
      </section>

      <section style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 12, marginTop: 12 }}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>Lines (read-only)</h2>
        {lines.length === 0 ? <p>No lines.</p> : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
              <thead>
                <tr style={{ background: '#fafafa' }}>
                  <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid #eee' }}>#</th>
                  {row.kind === 'bill' ? (
                    <>
                      <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid #eee' }}>Account</th>
                      <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid #eee' }}>Description</th>
                      <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid #eee' }}>Class</th>
                      <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid #eee' }}>Tax</th>
                      <th style={{ textAlign: 'right', padding: 8, borderBottom: '1px solid #eee' }}>Amount</th>
                    </>
                  ) : (
                    <>
                      <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid #eee' }}>Bill ref</th>
                      <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid #eee' }}>Bill date</th>
                      <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid #eee' }}>Due date</th>
                      <th style={{ textAlign: 'right', padding: 8, borderBottom: '1px solid #eee' }}>Open balance</th>
                      <th style={{ textAlign: 'right', padding: 8, borderBottom: '1px solid #eee' }}>Pay amount</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {lines.map((ln, i) => (
                  <tr key={i}>
                    <td style={{ padding: 8, borderBottom: '1px solid #f4f4f4' }}>{i + 1}</td>
                    {row.kind === 'bill' ? (
                      <>
                        <td style={{ padding: 8, borderBottom: '1px solid #f4f4f4' }}>{ln.account_ref_text || '-'}</td>
                        <td style={{ padding: 8, borderBottom: '1px solid #f4f4f4' }}>{ln.description || '-'}</td>
                        <td style={{ padding: 8, borderBottom: '1px solid #f4f4f4' }}>{ln.class_ref_text || '-'}</td>
                        <td style={{ padding: 8, borderBottom: '1px solid #f4f4f4' }}>{ln.tax_ref_text || '-'}</td>
                        <td style={{ padding: 8, borderBottom: '1px solid #f4f4f4', textAlign: 'right' }}>{Number(ln.amount || 0).toFixed(2)}</td>
                      </>
                    ) : (
                      <>
                        <td style={{ padding: 8, borderBottom: '1px solid #f4f4f4' }}>{ln.linked_bill_ref || ln.linked_bill_qbo_id || '-'}</td>
                        <td style={{ padding: 8, borderBottom: '1px solid #f4f4f4' }}>{ln.bill_date || '-'}</td>
                        <td style={{ padding: 8, borderBottom: '1px solid #f4f4f4' }}>{ln.due_date || '-'}</td>
                        <td style={{ padding: 8, borderBottom: '1px solid #f4f4f4', textAlign: 'right' }}>{Number(ln.open_balance || 0).toFixed(2)}</td>
                        <td style={{ padding: 8, borderBottom: '1px solid #f4f4f4', textAlign: 'right' }}>{Number(ln.pay_amount || 0).toFixed(2)}</td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {showDeleteDialog ? (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'grid', placeItems: 'center', zIndex: 1000 }}>
          <div style={{ width: 'min(560px, 92vw)', background: '#fff', borderRadius: 10, border: '1px solid #e5e7eb', padding: 16 }}>
            <h3 style={{ marginTop: 0 }}>Delete submission</h3>
            <p style={{ marginTop: 0 }}>This will permanently delete this record from Collector database.</p>
            {row?.result?.qbo_id ? (
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '10px 0' }}>
                <input type='checkbox' checked={deleteAlsoQbo} onChange={(e) => setDeleteAlsoQbo(e.target.checked)} />
                <span>Also delete QuickBooks {row.kind === 'bill_payment' ? 'BillPayment' : 'Bill'} ID <b>{row.result.qbo_id}</b></span>
              </label>
            ) : null}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
              <button type='button' onClick={() => setShowDeleteDialog(false)} disabled={deleting}>Cancel</button>
              <button type='button' onClick={confirmDelete} disabled={deleting} style={{ background: '#b42318', color: '#fff', border: '1px solid #7f1d1d', padding: '8px 12px' }}>
                {deleting ? 'Deleting...' : 'Confirm delete'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {err ? <p role='alert' style={{ color: '#b42318', marginTop: 12, whiteSpace: 'pre-wrap' }}>{err}</p> : null}
    </main>
  );
}
