'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

export default function AuthPage() {
  const router = useRouter()
  const [isLogin, setIsLogin] = useState(true)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    setSuccess('')

    if (isLogin) {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) {
        setError(error.message)
      } else {
        router.replace('/dashboard')
      }
    } else {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: fullName } },
      })
      if (error) {
        setError(error.message)
      } else {
        // Fallback upsert — handle_new_user trigger sudah set ini,
        // tapi upsert ini jaga-jaga kalau trigger delay
        if (data.user) {
          await supabase.from('profiles').upsert({
            id: data.user.id,
            full_name: fullName,
            role: 'trial',
            trial_expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
          }, { onConflict: 'id', ignoreDuplicates: true })
        }
        setSuccess('Akun berhasil dibuat! Kamu mendapatkan akses trial 1 hari. Silakan login.')
        setIsLogin(true)
        setEmail('')
        setPassword('')
        setFullName('')
      }
    }

    setLoading(false)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-brand-50 via-white to-surface-100 p-4">
      {/* Decorative blobs */}
      <div className="fixed top-0 left-0 w-[600px] h-[600px] bg-brand-200/20 rounded-full blur-3xl -translate-x-1/2 -translate-y-1/2 pointer-events-none" />
      <div className="fixed bottom-0 right-0 w-[500px] h-[500px] bg-purple-200/20 rounded-full blur-3xl translate-x-1/3 translate-y-1/3 pointer-events-none" />

      <div className="w-full max-w-md relative z-10">
        {/* Logo */}
        <div className="text-center mb-8 animate-fade-in">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-brand-600 rounded-2xl shadow-lg shadow-brand-200 mb-4">
            <span className="text-3xl">💰</span>
          </div>
          <h1 className="text-3xl font-extrabold text-surface-900 tracking-tight">DompetKu</h1>
          <p className="text-surface-500 mt-1 text-sm">Kelola keuangan pribadi dengan cerdas</p>
        </div>

        {/* Card */}
        <div className="card p-8 animate-slide-up">
          <h2 className="text-xl font-bold text-surface-900 mb-1">
            {isLogin ? 'Masuk ke Akun' : 'Buat Akun Baru'}
          </h2>
          <p className="text-sm text-surface-400 mb-6">
            {isLogin
              ? 'Masukkan email dan password kamu'
              : 'Daftar gratis, dapatkan akses trial 1 hari'}
          </p>

          {/* Trial info banner — hanya saat register */}
          {!isLogin && (
            <div className="bg-brand-50 border border-brand-200 rounded-xl px-4 py-3 mb-4 flex items-start gap-3">
              <span className="text-lg">⏳</span>
              <div>
                <p className="text-sm font-semibold text-brand-700">Akses Trial 1 Hari</p>
                <p className="text-xs text-brand-600 mt-0.5">
                  Coba semua fitur DompetKu selama 24 jam. Data akan dihapus otomatis setelah trial berakhir.
                </p>
              </div>
            </div>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-xl mb-4">
              {error}
            </div>
          )}
          {success && (
            <div className="bg-green-50 border border-green-200 text-green-700 text-sm px-4 py-3 rounded-xl mb-4">
              {success}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {!isLogin && (
              <div>
                <label className="label">Nama Lengkap</label>
                <input
                  type="text"
                  className="input"
                  placeholder="Masukkan nama lengkap"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  required={!isLogin}
                />
              </div>
            )}
            <div>
              <label className="label">Email</label>
              <input
                type="email"
                className="input"
                placeholder="nama@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="label">Password</label>
              <input
                type="password"
                className="input"
                placeholder="Minimal 6 karakter"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
              />
            </div>
            <button
              type="submit"
              className="btn btn-primary w-full py-3 text-base"
              disabled={loading}
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Memproses...
                </span>
              ) : isLogin ? 'Masuk' : 'Daftar & Mulai Trial'}
            </button>
          </form>

          <div className="mt-6 text-center">
            <button
              onClick={() => { setIsLogin(!isLogin); setError(''); setSuccess('') }}
              className="text-sm text-brand-600 hover:text-brand-700 font-semibold"
            >
              {isLogin ? 'Belum punya akun? Daftar gratis' : 'Sudah punya akun? Masuk'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
