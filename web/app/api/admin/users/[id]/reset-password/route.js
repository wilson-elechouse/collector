import { NextResponse } from 'next/server';

const API_BASE = process.env.API_BASE || process.env.NEXT_PUBLIC_API_BASE || 'http://127.0.0.1:3000';

export async function POST(req, { params }) {
  const body = await req.text();
  const upstream = await fetch(`${API_BASE}/admin/users/${encodeURIComponent(params.id)}/reset-password`, {
    method: 'POST',
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
}
