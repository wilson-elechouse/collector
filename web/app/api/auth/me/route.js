import { NextResponse } from 'next/server';

const API_BASE = process.env.API_BASE || process.env.NEXT_PUBLIC_API_BASE || 'http://127.0.0.1:3000';

export async function GET(req) {
  const upstream = await fetch(`${API_BASE}/auth/me`, {
    method: 'GET',
    headers: {
      cookie: req.headers.get('cookie') || ''
    }
  });

  const text = await upstream.text();
  const res = new NextResponse(text, {
    status: upstream.status,
    headers: {
      'content-type': upstream.headers.get('content-type') || 'application/json'
    }
  });

  const getSetCookie = upstream.headers.getSetCookie?.bind(upstream.headers);
  const cookies = getSetCookie ? getSetCookie() : (upstream.headers.get('set-cookie') ? [upstream.headers.get('set-cookie')] : []);
  for (const c of cookies) {
    if (c) res.headers.append('set-cookie', c);
  }

  return res;
}
