import { NextResponse } from 'next/server';

const API_BASE = process.env.API_BASE || process.env.NEXT_PUBLIC_API_BASE || 'http://127.0.0.1:3000';

export async function POST(req) {
  const bodyText = await req.text();

  const upstream = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      // Forward browser cookies (rarely needed for login, but keeps behavior consistent)
      cookie: req.headers.get('cookie') || ''
    },
    body: bodyText
  });

  const text = await upstream.text();
  const res = new NextResponse(text, {
    status: upstream.status,
    headers: {
      'content-type': upstream.headers.get('content-type') || 'application/json'
    }
  });

  // Important: forward Set-Cookie to the browser (may contain multiple cookies)
  const getSetCookie = upstream.headers.getSetCookie?.bind(upstream.headers);
  const cookies = getSetCookie ? getSetCookie() : (upstream.headers.get('set-cookie') ? [upstream.headers.get('set-cookie')] : []);
  for (const c of cookies) {
    if (c) res.headers.append('set-cookie', c);
  }

  return res;
}
