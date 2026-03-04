import { NextResponse } from 'next/server';

const API_BASE = process.env.API_BASE || process.env.NEXT_PUBLIC_API_BASE || 'http://127.0.0.1:3000';

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const vendor = searchParams.get('vendor_ref_text') || '';
  const upstream = await fetch(`${API_BASE}/bill-payments/open-bills?vendor_ref_text=${encodeURIComponent(vendor)}`, {
    method: 'GET',
    headers: { cookie: req.headers.get('cookie') || '' }
  });
  const text = await upstream.text();
  return new NextResponse(text, {
    status: upstream.status,
    headers: { 'content-type': upstream.headers.get('content-type') || 'application/json' }
  });
}
