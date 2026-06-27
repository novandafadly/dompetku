import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

// Routes yang boleh diakses tanpa login
const PUBLIC_PATHS = ['/auth']

// Security headers — best practice industri
function addSecurityHeaders(response: NextResponse): NextResponse {
  // Cegah clickjacking
  response.headers.set('X-Frame-Options', 'DENY')
  // Cegah MIME sniffing
  response.headers.set('X-Content-Type-Options', 'nosniff')
  // Paksa HTTPS
  response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  // Batasi referrer info
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  // Matikan fitur browser yang tidak dipakai
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  // Basic CSP — cegah XSS inline scripts dari domain asing
  response.headers.set(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'", // unsafe-eval diperlukan Next.js dev
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self'",
      `connect-src 'self' ${process.env.NEXT_PUBLIC_SUPABASE_URL} https://*.supabase.co wss://*.supabase.co`,
      "frame-ancestors 'none'",
    ].join('; ')
  )
  return response
}

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
          // Set di request dulu agar server components bisa baca
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          // Re-create response dengan request yang sudah updated
          supabaseResponse = NextResponse.next({ request })
          // Set di response agar browser simpan cookie
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, {
              ...options,
              // Hardened cookie options
              httpOnly: true,
              secure: process.env.NODE_ENV === 'production',
              sameSite: 'lax',
            })
          )
        },
      },
    }
  )

  const pathname = request.nextUrl.pathname
  const isPublic = PUBLIC_PATHS.some(p => pathname.startsWith(p))

  // Gunakan getUser() bukan getSession() — getUser() verifikasi token ke Supabase server
  // getSession() hanya baca cookie lokal, bisa di-spoof
  const { data: { user }, error: userError } = await supabase.auth.getUser()

  // Tidak login → redirect ke /auth
  // Simpan intended URL di query param agar bisa redirect balik setelah login
  if (!user && !isPublic) {
    const url = request.nextUrl.clone()
    const intendedPath = pathname !== '/' ? pathname : undefined
    url.pathname = '/auth'
    if (intendedPath) url.searchParams.set('next', intendedPath)
    return addSecurityHeaders(NextResponse.redirect(url))
  }

  // Sudah login → tidak boleh akses /auth lagi
  if (user && isPublic) {
    // Redirect ke intended URL kalau ada, atau dashboard
    const next = request.nextUrl.searchParams.get('next')
    const url = request.nextUrl.clone()
    // Validasi next param — harus relative path, cegah open redirect
    url.pathname = (next && next.startsWith('/') && !next.startsWith('//')) ? next : '/dashboard'
    url.search = ''
    return addSecurityHeaders(NextResponse.redirect(url))
  }

  // Tambah security headers ke semua response
  return addSecurityHeaders(supabaseResponse)
}

export const config = {
  // Match semua route KECUALI:
  // - _next/static (static files)
  // - _next/image (image optimization)
  // - favicon.ico
  // - file dengan ekstensi (gambar, font, dll)
  // API routes tetap di-protect (butuh session valid)
  matcher: [
    '/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff|woff2|ttf|eot)$).*)',
  ],
}
