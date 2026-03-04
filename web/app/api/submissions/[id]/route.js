import { NextResponse } from 'next/server';

const API_BASE = process.env.API_BASE || process.env.NEXT_PUBLIC_API_BASE || 'http://127.0.0.1:3000';

function jsonError(status, error, detail) {
  return NextResponse.json({ ok: false, error, detail }, { status });
}

export async function GET(req, { params }) {
  try {
    const upstream = await fetch(`${API_BASE}/submissions/${encodeURIComponent(params.id)}`, {
      method: 'GET',
      headers: { cookie: req.headers.get('cookie') || '' },
      cache: 'no-store'
    });

    const text = await upstream.text();
    return new NextResponse(text, {
      status: upstream.status,
      headers: { 'content-type': upstream.headers.get('content-type') || 'application/json' }
    });
  } catch (e) {
    return jsonError(502, 'upstream_unreachable', String(e?.message || e));
  }
}

export async function PUT(req, { params }) {
  try {
    const body = await req.text();
    const upstream = await fetch(`${API_BASE}/submissions/${encodeURIComponent(params.id)}`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        cookie: req.headers.get('cookie') || ''
      },
      body
    });

    const text = await upstream.text();
    return new NextResponse(text, {
      status: upstream.status,
      headers: { 'content-type': upstream.headers.get('content-type') || 'application/json' }
    });
  } catch (e) {
    return jsonError(502, 'upstream_unreachable', String(e?.message || e));
  }
}

export async function DELETE(req, { params }) {
  try {
    const u = new URL(req.url);
    const force = u.searchParams.get('force_mark_deleted') === '1' ? '?force_mark_deleted=1' : '';
    const upstream = await fetch(`${API_BASE}/submissions/${encodeURIComponent(params.id)}${force}`, {
      method: 'DELETE',
      headers: { cookie: req.headers.get('cookie') || '' }
    });

    const text = await upstream.text();
    return new NextResponse(text, {
      status: upstream.status,
      headers: { 'content-type': upstream.headers.get('content-type') || 'application/json' }
    });
  } catch (e) {
    return jsonError(502, 'upstream_unreachable', String(e?.message || e));
  }
}
