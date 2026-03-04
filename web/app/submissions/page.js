export default function SubmissionsPage() {
  return (
    <main style={{ padding: 16, maxWidth: 760, margin: '0 auto' }}>
      <h1 style={{ marginTop: 0 }}>Submissions</h1>
      <p style={{ color: '#555' }}>已按业务拆分，请进入对应工作区操作：</p>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <a href="/bill" style={{ padding: '10px 12px', border: '1px solid #ccc', borderRadius: 6, textDecoration: 'none', color: '#111' }}>
          Go to Bill Workspace
        </a>
        <a href="/bill-payment" style={{ padding: '10px 12px', border: '1px solid #ccc', borderRadius: 6, textDecoration: 'none', color: '#111' }}>
          Go to Bill Payment Workspace
        </a>
      </div>
    </main>
  );
}
