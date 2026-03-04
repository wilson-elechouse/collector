import { NextResponse } from 'next/server';

const API_BASE = process.env.API_BASE || process.env.NEXT_PUBLIC_API_BASE || 'http://127.0.0.1:3000';

export async function POST(req) {
  const upstream = await fetch(`${API_BASE}/mappings/sync`, {
    method: 'POST',
    headers: { cookie: req.headers.get('cookie') || '' }
  });
  const text = await upstream.text();
  return new NextResponse(text, {
    status: upstream.status,
    headers: { 'content-type': upstream.headers.get('content-type') || 'application/json' }
  });
}
