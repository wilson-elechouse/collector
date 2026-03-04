import { NextResponse } from 'next/server';

const API_BASE = process.env.API_BASE || process.env.NEXT_PUBLIC_API_BASE || 'http://127.0.0.1:3000';

export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const tenantId = String(body?.tenantId || '').trim();

  if (!tenantId) {
    return NextResponse.json({ ok: false, error: 'invalid_tenant' }, { status: 400 });
  }

  const upstream = await fetch(`${API_BASE}/tenant/select`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: req.headers.get('cookie') || ''
    },
    body: JSON.stringify({ tenantId, tenantCode: tenantId })
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

  if (upstream.ok) {
    res.cookies.set('tenant_id', tenantId, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 60 * 60 * 24 * 30
    });
  }

  return res;
}
