'use client'

import { useEffect, useState, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import type { Wallet, Transaction, Budget, Asset, CreditCard, Debt, Category } from '@/lib/supabase'
import { formatCurrency, formatShort, formatDate, MONTHS } from '@/lib/utils'
import AppShell from '@/components/AppShell'
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts'

const PIE_COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899', '#06b6d4']

export default function DashboardPage() {
  const [wallets, setWallets] = useState<Wallet[]>([])
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [budgets, setBudgets] = useState<Budget[]>([])
  const [assets, setAssets] = useState<Asset[]>([])
  const [cards, setCards] = useState<CreditCard[]>([])
  const [debts, setDebts] = useState<Debt[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadAll()
  }, [])

  async function loadAll() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return

    const now = new Date()
    const startOfMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`

    const [w, t, b, a, c, d] = await Promise.all([
      supabase.from('wallets').select('*').eq('is_active', true),
      supabase.from('transactions').select('*, categories(*), wallets(*)').gte('date', startOfMonth).order('date', { ascending: false }),
      supabase.from('budgets').select('*, categories(*)').eq('period_month', now.getMonth() + 1).eq('period_year', now.getFullYear()),
      supabase.from('assets').select('*'),
      supabase.from('credit_cards').select('*'),
      supabase.from('debts').select('*').eq('is_completed', false),
    ])

    setWallets(w.data || [])
    setTransactions(t.data || [])
    setBudgets(b.data || [])
    setAssets(a.data || [])
    setCards(c.data || [])
    setDebts(d.data || [])
    setLoading(false)
  }

  const totalBalance = useMemo(() => wallets.reduce((s, w) => s + Number(w.balance), 0), [wallets])
  const totalAssets = useMemo(() => assets.reduce((s, a) => s + Number(a.value), 0), [assets])
  const totalDebt = useMemo(() => debts.filter(d => d.type === 'debt').reduce((s, d) => s + Number(d.total_amount) - Number(d.paid_amount), 0), [debts])
  const netWorth = totalBalance + totalAssets - totalDebt

  const monthlyIncome = useMemo(() => transactions.filter(t => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0), [transactions])
  const monthlyExpense = useMemo(() => transactions.filter(t => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0), [transactions])

  const expenseByCategory = useMemo(() => {
    const map: Record<string, { name: string; value: number; icon: string }> = {}
    transactions.filter(t => t.type === 'expense').forEach(t => {
      const cat = t.categories
      const key = cat?.name || 'Lainnya'
      if (!map[key]) map[key] = { name: key, value: 0, icon: cat?.icon || '📦' }
      map[key].value += Number(t.amount)
    })
    return Object.values(map).sort((a, b) => b.value - a.value)
  }, [transactions])

  const recentTx = transactions.slice(0, 8)

  return (
    <AppShell>
      <div className="mb-6">
        <h1 className="text-2xl font-extrabold text-surface-900">Dashboard</h1>
        <p className="text-sm text-surface-400 mt-0.5">{MONTHS[new Date().getMonth()]} {new Date().getFullYear()}</p>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="card p-5 h-28 animate-pulse bg-surface-100" />
          ))}
        </div>
      ) : (
        <>
          {/* Metric Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <div className="metric-card">
              <div className="absolute inset-0 bg-gradient-to-br from-brand-50 to-transparent" />
              <div className="relative">
                <p className="text-xs font-bold text-brand-600 uppercase tracking-wider mb-1">Net Worth</p>
                <p className="text-2xl font-extrabold text-surface-900">{formatShort(netWorth)}</p>
                <p className="text-xs text-surface-400 mt-1">Saldo + Aset - Utang</p>
              </div>
            </div>
            <div className="metric-card">
              <div className="absolute inset-0 bg-gradient-to-br from-emerald-50 to-transparent" />
              <div className="relative">
                <p className="text-xs font-bold text-emerald-600 uppercase tracking-wider mb-1">Total Saldo</p>
                <p className="text-2xl font-extrabold text-surface-900">{formatShort(totalBalance)}</p>
                <p className="text-xs text-surface-400 mt-1">{wallets.length} dompet aktif</p>
              </div>
            </div>
            <div className="metric-card">
              <div className="absolute inset-0 bg-gradient-to-br from-green-50 to-transparent" />
              <div className="relative">
                <p className="text-xs font-bold text-green-600 uppercase tracking-wider mb-1">Pemasukan</p>
                <p className="text-2xl font-extrabold text-green-600">{formatShort(monthlyIncome)}</p>
                <p className="text-xs text-surface-400 mt-1">Bulan ini</p>
              </div>
            </div>
            <div className="metric-card">
              <div className="absolute inset-0 bg-gradient-to-br from-red-50 to-transparent" />
              <div className="relative">
                <p className="text-xs font-bold text-red-500 uppercase tracking-wider mb-1">Pengeluaran</p>
                <p className="text-2xl font-extrabold text-red-500">{formatShort(monthlyExpense)}</p>
                <p className="text-xs text-surface-400 mt-1">Bulan ini</p>
              </div>
            </div>
          </div>

          {/* Charts & Lists */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
            {/* Expense Breakdown */}
            <div className="card p-6">
              <h3 className="text-sm font-bold text-surface-900 mb-4">Pengeluaran per Kategori</h3>
              {expenseByCategory.length > 0 ? (
                <>
                  <div className="h-48">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={expenseByCategory} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={75} innerRadius={45} paddingAngle={3} strokeWidth={0}>
                          {expenseByCategory.map((_, i) => (
                            <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(val: number) => formatCurrency(val)} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="space-y-2 mt-2">
                    {expenseByCategory.slice(0, 5).map((cat, i) => (
                      <div key={cat.name} className="flex items-center gap-2 text-xs">
                        <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                        <span className="flex-1 text-surface-600 truncate">{cat.icon} {cat.name}</span>
                        <span className="font-mono font-semibold text-surface-800">{formatShort(cat.value)}</span>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="h-48 flex items-center justify-center text-surface-300 text-sm">
                  Belum ada pengeluaran bulan ini
                </div>
              )}
            </div>

            {/* Wallets Overview */}
            <div className="card p-6">
              <h3 className="text-sm font-bold text-surface-900 mb-4">Dompet</h3>
              <div className="space-y-3">
                {wallets.length > 0 ? wallets.map((w) => (
                  <div key={w.id} className="flex items-center gap-3 p-3 rounded-xl bg-surface-50">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl" style={{ background: (w.color || '#3b82f6') + '18' }}>
                      {w.icon || '💳'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-surface-800 truncate">{w.name}</p>
                      <p className="text-[10px] font-bold text-surface-400 uppercase">{w.type}</p>
                    </div>
                    <p className="text-sm font-bold font-mono text-surface-900">{formatShort(Number(w.balance))}</p>
                  </div>
                )) : (
                  <div className="text-center py-8 text-surface-300 text-sm">Belum ada dompet</div>
                )}
              </div>
            </div>

            {/* Budget Progress */}
            <div className="card p-6">
              <h3 className="text-sm font-bold text-surface-900 mb-4">Anggaran Bulan Ini</h3>
              <div className="space-y-4">
                {budgets.length > 0 ? budgets.map((b) => {
                  const spent = transactions.filter(t => t.type === 'expense' && t.category_id === b.category_id).reduce((s, t) => s + Number(t.amount), 0)
                  const pct = Math.min((spent / Number(b.amount)) * 100, 100)
                  const over = spent > Number(b.amount)
                  return (
                    <div key={b.id}>
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="font-semibold text-surface-700">{b.categories?.icon} {b.categories?.name}</span>
                        <span className={`font-mono font-bold ${over ? 'text-red-500' : 'text-surface-500'}`}>
                          {formatShort(spent)} / {formatShort(Number(b.amount))}
                        </span>
                      </div>
                      <div className="progress-bar">
                        <div className="progress-fill" style={{
                          width: `${pct}%`,
                          background: over ? '#ef4444' : pct > 70 ? '#f59e0b' : '#22c55e',
                        }} />
                      </div>
                    </div>
                  )
                }) : (
                  <div className="text-center py-8 text-surface-300 text-sm">Belum ada anggaran</div>
                )}
              </div>
            </div>
          </div>

          {/* Recent Transactions */}
          <div className="card p-6">
            <h3 className="text-sm font-bold text-surface-900 mb-4">Transaksi Terbaru</h3>
            {recentTx.length > 0 ? (
              <div className="space-y-2">
                {recentTx.map((tx) => (
                  <div key={tx.id} className="flex items-center gap-3 p-3 rounded-xl hover:bg-surface-50 transition-colors">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center text-lg" style={{
                      background: tx.type === 'income' ? '#dcfce7' : '#fee2e2',
                    }}>
                      {tx.categories?.icon || (tx.type === 'income' ? '💰' : '💸')}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-surface-800 truncate">{tx.description || tx.categories?.name || 'Transaksi'}</p>
                      <p className="text-[10px] text-surface-400">{formatDate(tx.date)} · {tx.wallets?.name}</p>
                    </div>
                    <p className={`text-sm font-bold font-mono ${tx.type === 'income' ? 'text-green-600' : 'text-red-500'}`}>
                      {tx.type === 'income' ? '+' : '-'}{formatShort(Number(tx.amount))}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-12 text-surface-300 text-sm">Belum ada transaksi bulan ini</div>
            )}
          </div>
        </>
      )}
    </AppShell>
  )
}
