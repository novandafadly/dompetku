'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import Sidebar from './Sidebar'
import ToastProvider from './Toast'

// Bottom nav items (most used, max 5)
const BOTTOM_NAV = [
  { href: '/dashboard',    icon: '📊', label: 'Home' },
  { href: '/transactions', icon: '📝', label: 'Transaksi' },
  { href: '/wallets',      icon: '💳', label: 'Dompet' },
  { href: '/reports',      icon: '📈', label: 'Laporan' },
  { href: '/budgets',      icon: '🎯', label: 'Anggaran' },
]

export default function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [userName, setUserName] = useState<string>('')
  const [ready, setReady] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { router.replace('/auth'); return }
      setUserName(session.user.user_metadata?.full_name || session.user.email || 'User')
      setReady(true)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) router.replace('/auth')
    })

    return () => subscription.unsubscribe()
  }, [router])

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-50">
        <div className="w-10 h-10 border-4 border-brand-200 border-t-brand-600 rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-surface-50">
      {/* Desktop sidebar */}
      <Sidebar userName={userName} />

      {/* Main content — adds bottom padding on mobile for bottom nav */}
      <main className="lg:ml-64 min-h-screen pb-20 lg:pb-0">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-4 pt-16 lg:pt-6">
          {children}
        </div>
      </main>

      {/* Mobile bottom navigation */}
      <nav className="bottom-nav">
        {BOTTOM_NAV.map(item => (
          <button
            key={item.href}
            onClick={() => router.push(item.href)}
            className={`bottom-nav-item ${pathname === item.href ? 'active' : ''}`}
          >
            <span className="text-xl leading-none">{item.icon}</span>
            <span className="text-[10px] font-semibold">{item.label}</span>
          </button>
        ))}
      </nav>

      <ToastProvider />
    </div>
  )
}
