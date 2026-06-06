'use client'
import { usePathname, useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { supabase } from '@/lib/supabase'
import { useState } from 'react'

const NAV_ITEMS = [
  { href: '/dashboard',    label: 'Dashboard',      icon: '📊' },
  { href: '/wallets',      label: 'Dompet',          icon: '💳' },
  { href: '/transfers',    icon: '🔀',  label: 'Transfer' }, 
  { href: '/transactions', label: 'Transaksi',       icon: '📝' },
  { href: '/recurring',    label: 'Tagihan Rutin',   icon: '🔄' },
  { href: '/budgets',      label: 'Anggaran',        icon: '🎯' },
  { href: '/assets',       label: 'Aset & Saham',    icon: '🏦' },
  { href: '/credit-cards', label: 'Kartu Kredit',    icon: '💎' },
  { href: '/debts',        label: 'Utang/Piutang',   icon: '🤝' },
  { href: '/trips',         label: 'Trip & Healing',   icon: '🧳' },
  { href: '/savings-goals', label: 'Tujuan Tabunganku', icon: '🎯' },
  { href: '/categories',    label: 'Kategori',         icon: '🏷️' },
  { href: '/reports',       label: 'Laporan',          icon: '📈' },
  { href: '/export',        label: 'Export Data',      icon: '📤' },
  { href: '/ai-analysis',   label: 'Analisis AI',      icon: '🤖' },
]

export default function Sidebar({ userName }: { userName?: string }) {
  const pathname = usePathname()
  const router = useRouter()
  const [mobileOpen, setMobileOpen] = useState(false)

  async function handleLogout() {
    await supabase.auth.signOut()
    router.replace('/auth')
  }

  return (
    <>
      {/* Mobile hamburger — top-left, only shows on mobile */}
      <button
        onClick={() => setMobileOpen(true)}
        className="lg:hidden fixed top-3 left-3 z-50 w-11 h-11 bg-white rounded-xl shadow-md flex items-center justify-center border border-surface-200 active:scale-95"
        aria-label="Menu"
      >
        <svg className="w-5 h-5 text-surface-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

      {/* App name on mobile top bar */}
      <div className="lg:hidden fixed top-0 left-0 right-0 h-14 bg-white border-b border-surface-200 z-40 flex items-center justify-center pointer-events-none">
        <span className="text-base font-extrabold text-surface-900 tracking-tight">DompetKu 💰</span>
      </div>

      {/* Overlay */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-black/40 z-[60] backdrop-blur-sm"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar panel */}
      <aside className={cn(
        'fixed top-0 left-0 h-full w-72 bg-white border-r border-surface-200/60 z-[70] flex flex-col transition-transform duration-300 ease-in-out',
        'lg:w-64 lg:translate-x-0 lg:z-40',
        mobileOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full'
      )}>
        {/* Logo */}
        <div className="px-6 py-5 border-b border-surface-100 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-brand-600 rounded-xl flex items-center justify-center shadow-sm flex-shrink-0">
              <span className="text-xl">💰</span>
            </div>
            <div>
              <h1 className="text-lg font-extrabold text-surface-900 tracking-tight">DompetKu</h1>
              <p className="text-[10px] font-bold text-brand-500 uppercase tracking-widest">Finance Manager</p>
            </div>
          </div>
          {/* Close button mobile */}
          <button
            onClick={() => setMobileOpen(false)}
            className="lg:hidden w-8 h-8 rounded-lg hover:bg-surface-100 flex items-center justify-center text-surface-400"
          >
            ✕
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-3 space-y-0.5 overflow-y-auto">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.href}
              onClick={() => { router.push(item.href); setMobileOpen(false) }}
              className={cn('nav-link w-full text-left', pathname === item.href && 'nav-link-active')}
            >
              <span className="text-xl leading-none">{item.icon}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        {/* User section */}
        <div className="p-4 border-t border-surface-100">
          <div className="flex items-center gap-3 mb-3 px-2">
            <div className="w-9 h-9 bg-brand-100 rounded-xl flex items-center justify-center text-brand-700 font-bold text-sm flex-shrink-0">
              {(userName || 'U').charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-surface-800 truncate">{userName || 'User'}</p>
              <p className="text-[10px] text-surface-400 font-medium">Free Plan</p>
            </div>
          </div>
          <button onClick={handleLogout} className="btn btn-ghost w-full text-sm text-surface-400 hover:text-red-600 justify-start">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            Keluar
          </button>
        </div>
      </aside>
    </>
  )
}
