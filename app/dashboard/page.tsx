'use client'

import { useEffect, useState, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import type { Wallet, Transaction, Budget, Asset, Debt, RecurringTransaction, Pocket, NetWorthSnapshot } from '@/lib/supabase'
import { formatCurrency, formatShort, formatDate, MONTHS, POCKET_META } from '@/lib/utils'
import AppShell from '@/components/AppShell'
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, AreaChart, Area, XAxis, YAxis, CartesianGrid } from 'recharts'

const PIE_COLORS = ['#ef4444','#f97316','#eab308','#22c55e','#3b82f6','#8b5cf6','#ec4899','#06b6d4']

function daysUntil(dateStr: string): number {
  const today = new Date(); today.setHours(0,0,0,0)
  const due = new Date(dateStr); due.setHours(0,0,0,0)
  return Math.ceil((due.getTime() - today.getTime()) / 86400000)
}

function normalizeRecurringToMonthly(items: RecurringTransaction[]): number {
  return items.filter(r => r.is_active && r.type === 'expense').reduce((s, r) => {
    if (r.frequency === 'monthly') return s + Number(r.amount)
    if (r.frequency === 'yearly') return s + Number(r.amount) / 12
    if (r.frequency === 'weekly') return s + Number(r.amount) * 4.33
    if (r.frequency === 'daily') return s + Number(r.amount) * 30
    return s
  }, 0)
}

export default function DashboardPage() {
  const [wallets, setWallets] = useState<Wallet[]>([])
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [budgets, setBudgets] = useState<Budget[]>([])
  const [assets, setAssets] = useState<Asset[]>([])
  const [debts, setDebts] = useState<Debt[]>([])
  const [recurring, setRecurring] = useState<RecurringTransaction[]>([])
  const [snapshots, setSnapshots] = useState<NetWorthSnapshot[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { loadAll() }, [])

  async function loadAll() {
    const now = new Date()
    const startOfMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
    const sixMonthsAgo = new Date(); sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5); sixMonthsAgo.setDate(1)

    const [w, t, b, a, d, r, s] = await Promise.all([
      supabase.from('wallets').select('*').eq('is_active', true),
      supabase.from('transactions').select('*, categories(*), wallets(*)').gte('date', startOfMonth).order('date', { ascending: false }),
      supabase.from('budgets').select('*, categories(*)').eq('period_month', now.getMonth() + 1).eq('period_year', now.getFullYear()),
      supabase.from('assets').select('*'),
      supabase.from('debts').select('*').eq('is_completed', false),
      supabase.from('recurring_transactions').select('*, wallets(*), categories(*)').eq('is_active', true).order('next_due'),
      supabase.from('net_worth_snapshots').select('*').gte('snapshot_date', sixMonthsAgo.toISOString().split('T')[0]).order('snapshot_date'),
    ])

    setWallets(w.data || [])
    setTransactions(t.data || [])
    setBudgets(b.data || [])
    setAssets(a.data || [])
    setDebts(d.data || [])
    setRecurring(r.data || [])
    setSnapshots(s.data || [])
    setLoading(false) // UI ready — snapshot jalan di background, tidak block render

    // Fire-and-forget: tidak perlu await, tidak affect loading time
    saveSnapshot(w.data || [], a.data || [], d.data || [])
  }

  async function saveSnapshot(w: Wallet[], a: Asset[], d: Debt[]) {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return
    const totalBalance = w.filter(x => x.pocket !== 'kantor').reduce((s, x) => s + Number(x.balance), 0)
    const totalAssets = a.reduce((s, x) => s + Number(x.value), 0)
    const totalDebt = d.filter(x => x.type === 'debt').reduce((s, x) => s + Number(x.total_amount) - Number(x.paid_amount), 0)
    const today = new Date().toISOString().split('T')[0]
    await supabase.from('net_worth_snapshots').upsert({
      user_id: session.user.id,
      snapshot_date: today,
      total_balance: totalBalance,
      total_assets: totalAssets,
      total_debt: totalDebt,
    }, { onConflict: 'user_id,snapshot_date' })
  }

  const pocketTotals = useMemo(() => (['operasional', 'tabungan', 'kantor'] as Pocket[]).map(p => ({
    pocket: p,
    total: wallets.filter(w => w.pocket === p).reduce((s, w) => s + Number(w.balance), 0),
  })), [wallets])

  const operasionalTotal = pocketTotals.find(p => p.pocket === 'operasional')?.total || 0
  const totalBalance = useMemo(() => wallets.filter(w => w.pocket !== 'kantor').reduce((s, w) => s + Number(w.balance), 0), [wallets])
  const totalAssets = useMemo(() => assets.reduce((s, a) => s + Number(a.value), 0), [assets])
  const totalDebt = useMemo(() => debts.filter(d => d.type === 'debt').reduce((s, d) => s + Number(d.total_amount) - Number(d.paid_amount), 0), [debts])
  const netWorth = totalBalance + totalAssets - totalDebt

  const personalTx = useMemo(() => transactions.filter(t => (t as any).wallets?.pocket !== 'kantor'), [transactions])
  const monthlyIncome = useMemo(() => personalTx.filter(t => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0), [personalTx])
  const monthlyExpense = useMemo(() => personalTx.filter(t => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0), [personalTx])
  const recurringMonthly = useMemo(() => normalizeRecurringToMonthly(recurring), [recurring])
  const freeCashflow = monthlyIncome - monthlyExpense - recurringMonthly

  const expenseByCategory = useMemo(() => {
    const map: Record<string, { name: string; value: number; icon: string }> = {}
    personalTx.filter(t => t.type === 'expense').forEach(t => {
      const key = t.categories?.name || 'Lainnya'
      if (!map[key]) map[key] = { name: key, value: 0, icon: t.categories?.icon || '📦' }
      map[key].value += Number(t.amount)
    })
    return Object.values(map).sort((a, b) => b.value - a.value)
  }, [personalTx])

  const upcomingRecurring = recurring.filter(r => daysUntil(r.next_due) <= 7)

  // Net worth chart data — combine snapshots + today
  const nwChartData = useMemo(() => {
    const today = new Date().toISOString().split('T')[0]
    const todaySnap = { snapshot_date: today, net_worth: netWorth }
    const all = [...snapshots.filter(s => s.snapshot_date !== today), todaySnap]
    return all.map(s => ({
      label: new Date(s.snapshot_date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }),
      value: s.net_worth,
    }))
  }, [snapshots, netWorth])

  const firstNW = nwChartData[0]?.value || 0
  const nwChange = netWorth - firstNW
  const nwChangePct = firstNW !== 0 ? (nwChange / Math.abs(firstNW)) * 100 : 0

  const recentTx = personalTx.slice(0, 8)

  return (
    <AppShell>
      <div className="mb-6">
        <h1 className="text-2xl font-extrabold text-surface-900">Dashboard</h1>
        <p className="text-sm text-surface-400 mt-0.5">{MONTHS[new Date().getMonth()]} {new Date().getFullYear()}</p>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <div key={i} className="card p-5 h-28 animate-pulse bg-surface-100" />)}
        </div>
      ) : (
        <>
          {/* Recurring alerts */}
          {upcomingRecurring.length > 0 && (
            <div className="card p-4 mb-6 border-l-4 border-l-amber-400 bg-amber-50/40">
              <p className="text-sm font-bold text-amber-700 mb-2">🔔 {upcomingRecurring.length} tagihan rutin jatuh tempo dalam 7 hari</p>
              <div className="flex flex-wrap gap-2">
                {upcomingRecurring.map(r => {
                  const days = daysUntil(r.next_due)
                  return (
                    <div key={r.id} className="flex items-center gap-1.5 px-3 py-1.5 bg-white rounded-xl border border-amber-200 text-xs">
                      <span>{r.categories?.icon || '💸'}</span>
                      <span className="font-semibold text-surface-800">{r.description || r.categories?.name}</span>
                      <span className="font-mono text-surface-500">{formatCurrency(Number(r.amount))}</span>
                      <span className={`font-bold ${days < 0 ? 'text-red-600' : days === 0 ? 'text-orange-600' : 'text-amber-600'}`}>
                        {days < 0 ? `${Math.abs(days)}h lalu` : days === 0 ? 'Hari ini' : `${days}h lagi`}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Net Worth + Timeline */}
          <div className="card p-6 mb-6">
            <div className="flex items-start justify-between mb-4 flex-wrap gap-2">
              <div>
                <p className="text-xs font-bold text-surface-400 uppercase tracking-wider mb-1">Net Worth</p>
                <p className="text-3xl font-extrabold text-surface-900">{formatShort(netWorth)}</p>
                {nwChartData.length > 1 && (
                  <div className={`flex items-center gap-1 text-xs mt-1 font-semibold ${nwChange >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                    <span>{nwChange >= 0 ? '↑' : '↓'} {formatShort(Math.abs(nwChange))}</span>
                    <span className="text-surface-400 font-normal">({nwChangePct >= 0 ? '+' : ''}{nwChangePct.toFixed(1)}%) sejak {nwChartData[0]?.label}</span>
                  </div>
                )}
              </div>
              <div className="flex gap-4 text-xs text-surface-500">
                <div><p className="text-[10px] uppercase font-bold text-surface-400 mb-0.5">Saldo</p><p className="font-mono font-semibold">{formatShort(totalBalance)}</p></div>
                <div><p className="text-[10px] uppercase font-bold text-surface-400 mb-0.5">Aset</p><p className="font-mono font-semibold">{formatShort(totalAssets)}</p></div>
                <div><p className="text-[10px] uppercase font-bold text-red-400 mb-0.5">Utang</p><p className="font-mono font-semibold text-red-500">-{formatShort(totalDebt)}</p></div>
              </div>
            </div>
            {nwChartData.length > 1 ? (
              <ResponsiveContainer width="100%" height={130}>
                <AreaChart data={nwChartData}>
                  <defs>
                    <linearGradient id="nwGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.15} />
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={v => formatShort(v)} tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={55} />
                  <Tooltip formatter={(v: number) => [formatCurrency(v), 'Net Worth']} contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }} />
                  <Area type="monotone" dataKey="value" stroke="#3b82f6" strokeWidth={2} fill="url(#nwGrad)" dot={{ r: 3, fill: '#3b82f6' }} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-20 flex items-center justify-center text-xs text-surface-300">Grafik muncul setelah beberapa hari data terkumpul</div>
            )}
          </div>

          {/* Free Cashflow + Pocket Row */}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-6">
            <div className={`card p-5 border-l-4 ${freeCashflow >= 0 ? 'border-l-green-400' : 'border-l-red-400'} sm:col-span-1`}>
              <p className="text-xs font-bold text-surface-400 uppercase tracking-wider mb-1">Free Cashflow</p>
              <p className={`text-xl font-extrabold font-mono ${freeCashflow >= 0 ? 'text-green-600' : 'text-red-500'}`}>{freeCashflow >= 0 ? '+' : ''}{formatShort(freeCashflow)}</p>
              <p className="text-[10px] text-surface-400 mt-1">Setelah tagihan rutin</p>
            </div>
            {pocketTotals.map(({ pocket, total }) => {
              const meta = POCKET_META[pocket]
              return (
                <div key={pocket} className={`card p-5 border-l-4 ${pocket === 'operasional' ? 'border-l-blue-400' : pocket === 'tabungan' ? 'border-l-green-400' : 'border-l-purple-400'}`}>
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className="text-base">{meta.icon}</span>
                    <p className={`text-xs font-bold uppercase tracking-wider ${meta.color}`}>{meta.label}</p>
                  </div>
                  <p className="text-xl font-extrabold text-surface-900">{formatShort(total)}</p>
                  {pocket === 'operasional' && <p className="text-[10px] text-surface-400 mt-0.5">← Bisa dipakai</p>}
                </div>
              )
            })}
          </div>

          {/* Charts & Lists */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
            {/* Expense Breakdown */}
            <div className="card p-6">
              <h3 className="text-sm font-bold text-surface-900 mb-4">Pengeluaran per Kategori</h3>
              {expenseByCategory.length > 0 ? (
                <>
                  <div className="h-44">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={expenseByCategory} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={72} innerRadius={42} paddingAngle={3} strokeWidth={0}>
                          {expenseByCategory.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                        </Pie>
                        <Tooltip formatter={(val: number) => formatCurrency(val)} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="space-y-1.5 mt-1">
                    {expenseByCategory.slice(0, 4).map((cat, i) => (
                      <div key={cat.name} className="flex items-center gap-2 text-xs">
                        <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                        <span className="flex-1 text-surface-600 truncate">{cat.icon} {cat.name}</span>
                        <span className="font-mono font-semibold text-surface-800">{formatShort(cat.value)}</span>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="h-44 flex items-center justify-center text-surface-300 text-sm">Belum ada pengeluaran</div>
              )}
            </div>

            {/* Dompet per Pocket */}
            <div className="card p-6">
              <h3 className="text-sm font-bold text-surface-900 mb-1">Dompet</h3>
              <p className="text-xs text-surface-400 mb-3">Bisa dipakai: <span className="font-bold text-blue-600">{formatShort(operasionalTotal)}</span></p>
              <div className="space-y-2 overflow-y-auto max-h-52">
                {(['operasional', 'tabungan', 'kantor'] as Pocket[]).map(pocket => {
                  const pWallets = wallets.filter(w => w.pocket === pocket)
                  if (pWallets.length === 0) return null
                  const meta = POCKET_META[pocket]
                  return (
                    <div key={pocket}>
                      <p className={`text-[10px] font-bold uppercase tracking-wider mb-1 ${meta.color}`}>{meta.icon} {meta.label}</p>
                      {pWallets.map(w => (
                        <div key={w.id} className="flex items-center gap-2 px-3 py-2 rounded-xl bg-surface-50 mb-1">
                          <span className="text-sm">{w.icon || '💳'}</span>
                          <span className="text-xs font-semibold text-surface-700 flex-1 truncate">{w.name}</span>
                          <span className="text-xs font-bold font-mono text-surface-900">{formatShort(Number(w.balance))}</span>
                        </div>
                      ))}
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Budget Progress */}
            <div className="card p-6">
              <h3 className="text-sm font-bold text-surface-900 mb-4">Anggaran Bulan Ini</h3>
              <div className="space-y-3 overflow-y-auto max-h-52">
                {budgets.length > 0 ? budgets.map((b) => {
                  const spent = transactions.filter(t => t.type === 'expense' && t.category_id === b.category_id).reduce((s, t) => s + Number(t.amount), 0)
                  const pct = Math.min((spent / Number(b.amount)) * 100, 100)
                  const over = spent > Number(b.amount)
                  return (
                    <div key={b.id}>
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="font-semibold text-surface-700 truncate">{b.categories?.icon} {b.categories?.name}</span>
                        <span className={`font-mono font-bold flex-shrink-0 ml-2 ${over ? 'text-red-500' : 'text-surface-500'}`}>
                          {formatShort(spent)}/{formatShort(Number(b.amount))}
                        </span>
                      </div>
                      <div className="progress-bar">
                        <div className="progress-fill" style={{ width: `${pct}%`, background: over ? '#ef4444' : pct > 70 ? '#f59e0b' : '#22c55e' }} />
                      </div>
                    </div>
                  )
                }) : <div className="text-center py-8 text-surface-300 text-sm">Belum ada anggaran</div>}
              </div>
            </div>
          </div>

          {/* Recent Transactions */}
          <div className="card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-surface-900">Transaksi Terbaru</h3>
              <a href="/reports" className="text-xs text-brand-600 font-semibold hover:underline">Lihat laporan →</a>
            </div>
            {recentTx.length > 0 ? (
              <div className="space-y-2">
                {recentTx.map((tx) => (
                  <div key={tx.id} className="flex items-center gap-3 p-3 rounded-xl hover:bg-surface-50 transition-colors">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center text-lg flex-shrink-0" style={{ background: tx.type === 'income' ? '#dcfce7' : '#fee2e2' }}>
                      {tx.categories?.icon || (tx.type === 'income' ? '💰' : '💸')}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-surface-800 truncate">{tx.description || tx.categories?.name || 'Transaksi'}</p>
                      <p className="text-[10px] text-surface-400">{formatDate(tx.date)} · {tx.wallets?.name}</p>
                    </div>
                    <p className={`text-sm font-bold font-mono flex-shrink-0 ${tx.type === 'income' ? 'text-green-600' : 'text-red-500'}`}>
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
