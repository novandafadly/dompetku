'use client'
import { useEffect } from 'react'
import { supabase } from '@/lib/supabase'

export default function TrialExpiredPage() {
  useEffect(() => {
    // Sign out di client side, bukan di middleware
    supabase.auth.signOut()
  }, [])

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-brand-50 via-white to-surface-100 p-4">
      <div className="card p-10 max-w-md w-full text-center">
        <div style={{ fontSize: '48px', marginBottom: '16px' }}>⏰</div>
        <h1 className="text-2xl font-extrabold text-surface-900 mb-3">Akses Trial Habis</h1>
        <p className="text-surface-500 text-sm leading-relaxed mb-8">
          Periode trial 1 hari kamu sudah berakhir dan semua data telah dihapus otomatis.
          Daftar ulang untuk mencoba kembali.
        </p>
        <a href="/auth" className="btn btn-primary w-full py-3 text-base">
          Kembali ke Login
        </a>
      </div>
    </div>
  )
}
