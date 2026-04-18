import { createServerClient, type CookieMethodsServer } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const cookieMethods: CookieMethodsServer = {
    getAll() { return request.cookies.getAll() },
    setAll(cookiesToSet) {
      cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
      supabaseResponse = NextResponse.next({ request })
      cookiesToSet.forEach(({ name, value, options }) =>
        supabaseResponse.cookies.set(name, value, options)
      )
    }
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: cookieMethods }
  )

  const { data: { user } } = await supabase.auth.getUser()

  const pathname = request.nextUrl.pathname
  const isAuthPage = pathname.startsWith('/auth')
  const isTrialExpiredPage = pathname.startsWith('/trial-expired')

  // Kalau tidak ada user, paksa ke /auth (kecuali sudah di halaman publik)
  if (!user && !isAuthPage && !isTrialExpiredPage) {
    return NextResponse.redirect(new URL('/auth', request.url))
  }

  // Kalau sudah login, jangan bisa akses /auth lagi
  if (user && isAuthPage) {
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

  // Cek trial expired — TANPA signOut di sini
  if (user && !isTrialExpiredPage && !isAuthPage) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('role, trial_expires_at')
      .eq('id', user.id)
      .single()

    if (
      profile?.role === 'trial' &&
      profile?.trial_expires_at &&
      new Date(profile.trial_expires_at) < new Date()
    ) {
      // Jangan signOut di sini! Redirect dulu, signOut di halaman trial-expired
      return NextResponse.redirect(new URL('/trial-expired', request.url))
    }
  }

  return supabaseResponse
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/).*)']
}
