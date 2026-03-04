import { NextResponse } from 'next/server';

function isBusinessPath(pathname) {
  return pathname.startsWith('/dashboard')
    || pathname.startsWith('/bills')
    || pathname.startsWith('/submissions')
    || pathname.startsWith('/bill-payment')
    || pathname.startsWith('/bill')
    || pathname.startsWith('/settings');
}

export async function middleware(req) {
  const { pathname } = req.nextUrl;

  const needsLogin = isBusinessPath(pathname) || pathname.startsWith('/tenant/select');
  const hasSession = Boolean(req.cookies.get('sessionId')?.value);

  if (needsLogin && !hasSession) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard/:path*', '/bills/:path*', '/submissions/:path*', '/bill/:path*', '/bill-payment/:path*', '/settings/:path*', '/tenant/select']
};
