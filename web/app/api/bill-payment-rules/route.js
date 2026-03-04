import { NextResponse } from 'next/server';

const API_BASE = process.env.API_BASE || process.env.NEXT_PUBLIC_API_BASE || 'http://127.0.0.1:3000';

export async function GET(req) {
  const upstream = await fetch(`${API_BASE}/bill-payment-rules`, {
    method: 'GET',
    headers: { cookie: req.headers.get('cookie') || '' }
  });
  const text = await upstream.text();
  return new NextResponse(text, {
    status: upstream.status,
    headers: { 'content-type': upstream.headers.get('content-type') || 'application/json' }
  });
}

export async function POST(req) {
  const bodyText = await req.text();
  const upstream = await fetch(`${API_BASE}/bill-payment-rules`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: req.headers.get('cookie') || ''
    },
    body: bodyText
  });
  const text = await upstream.text();
  return new NextResponse(text, {
    status: upstream.status,
    headers: { 'content-type': upstream.headers.get('content-type') || 'application/json' }
  });
}
