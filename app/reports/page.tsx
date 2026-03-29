'use client'

import { useEffect, useState, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import type { Transaction, Category, RecurringTransaction, Wallet } from '@/lib/supabase'
import { formatCurrency, formatShort, MONTHS } from '@/lib/utils'
import AppShell from '@/components/AppShell'
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell, Legend
} from 'recharts'

const CAT_COLORS = ['#ef4444','#f97316','#eab308','#22c55e','#3b82f6','#8b5cf6','#ec4899','#06b6d4','#f43f5e','#84cc16']

function startOfMonth(year: number, month: number) {
  return `${year}-${String(month).padStart(2, '0')}-01`
}
function endOfMonth(year: number, month: number) {
  return new Date(year, month, 0).toISOString().split('T')[0]
}

type MonthlyData = {
  label: string
  income: number
  expense: number
  cashflow: number
  year: number
  month: number
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

export default function ReportsPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [recurring, setRecurring] = useState<RecurringTransaction[]>([])
  const [wallets, setWallets] = useState<Wallet[]>([])
  const [loading, setLoading] = useState(true)

  const now = new Date()
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1)
  const [selectedYear, setSelectedYear] = useState(now.getFullYear())

  useEffect(() => { load() }, [])

  async function load() {
    // Load last 6 months of transactions + recurring
    const sixMonthsAgo = new Date()
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5)
    sixMonthsAgo.setDate(1)
    const fromDate = sixMonthsAgo.toISOString().split('T')[0]

    const [t, r, w] = await Promise.all([
      supabase.from('transactions').select('*, categories(*), wallets(*)').gte('date', fromDate).order('date'),
      supabase.from('recurring_transactions').select('*, wallets(*), categories(*)'),
      supabase.from('wallets').select('*').eq('is_active', true),
    ])
    setTransactions(t.data || [])
    setRecurring(r.data || [])
    setWallets(w.data || [])
    setLoading(false)
  }

  // Build last 6 months data
  const monthlyData = useMemo((): MonthlyData[] => {
    const result: MonthlyData[] = []
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const year = d.getFullYear()
      const month = d.getMonth() + 1
      const start = startOfMonth(year, month)
      const end = endOfMonth(year, month)
      const monthTx = transactions.filter(t => t.date >= start && t.date <= end)
      const income = monthTx.filter(t => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0)
      const expense = monthTx.filter(t => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0)
      result.push({ label: MONTHS[month - 1].slice(0, 3), income, expense, cashflow: income - expense, year, month })
    }
    return result
  }, [transactions])

  // Selected month data
  const selectedTx = useMemo(() =>
    transactions.filter(t => {
      const start = startOfMonth(selectedYear, selectedMonth)
      const end = endOfMonth(selectedYear, selectedMonth)
      return t.date >= start && t.date <= end
    }), [transactions, selectedMonth, selectedYear])

  const selectedIncome = useMemo(() => selectedTx.filter(t => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0), [selectedTx])
  const selectedExpense = useMemo(() => selectedTx.filter(t => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0), [selectedTx])

  // Previous month for comparison
  const prevMonth = selectedMonth === 1 ? 12 : selectedMonth - 1
  const prevYear = selectedMonth === 1 ? selectedYear - 1 : selectedYear
  const prevTx = useMemo(() =>
    transactions.filter(t => {
      const start = startOfMonth(prevYear, prevMonth)
      const end = endOfMonth(prevYear, prevMonth)
      return t.date >= start && t.date <= end
    }), [transactions, prevMonth, prevYear])
  const prevIncome = prevTx.filter(t => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0)
  const prevExpense = prevTx.filter(t => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0)

  // Free cashflow
  const recurringMonthly = useMemo(() => normalizeRecurringToMonthly(recurring), [recurring])
  const freeCashflow = selectedIncome - selectedExpense - recurringMonthly
  const grossCashflow = selectedIncome - selectedExpense

  // Expense by category for selected month
  const expByCat = useMemo(() => {
    const map: Record<string, { name: string; value: number; icon: string }> = {}
    selectedTx.filter(t => t.type === 'expense').forEach(t => {
      const key = t.categories?.name || 'Lainnya'
      if (!map[key]) map[key] = { name: key, value: 0, icon: t.categories?.icon || '📦' }
      map[key].value += Number(t.amount)
    })
    return Object.values(map).sort((a, b) => b.value - a.value)
  }, [selectedTx])

  // Income by category
  const incByCat = useMemo(() => {
    const map: Record<string, { name: string; value: number; icon: string }> = {}
    selectedTx.filter(t => t.type === 'income').forEach(t => {
      const key = t.categories?.name || 'Lainnya'
      if (!map[key]) map[key] = { name: key, value: 0, icon: t.categories?.icon || '💰' }
      map[key].value += Number(t.amount)
    })
    return Object.values(map).sort((a, b) => b.value - a.value)
  }, [selectedTx])

  // Top expenses
  const topExpenses = useMemo(() =>
    [...selectedTx].filter(t => t.type === 'expense').sort((a, b) => Number(b.amount) - Number(a.amount)).slice(0, 5)
  , [selectedTx])

  function pctChange(curr: number, prev: number) {
    if (prev === 0) return curr > 0 ? 100 : 0
    return ((curr - prev) / prev) * 100
  }

  const incomeChg = pctChange(selectedIncome, prevIncome)
  const expenseChg = pctChange(selectedExpense, prevExpense)

  const monthOptions = []
  for (let i = 0; i < 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    monthOptions.push({ year: d.getFullYear(), month: d.getMonth() + 1, label: `${MONTHS[d.getMonth()]} ${d.getFullYear()}` })
  }

  const formatTooltipIDR = (v: number) => formatShort(v)

  if (loading) return (
    <AppShell>
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-brand-200 border-t-brand-600 rounded-full animate-spin" />
      </div>
    </AppShell>
  )

  return (
    <AppShell>
      {/* Header */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-surface-900">Laporan & Analitik</h1>
          <p className="text-sm text-surface-400">Ringkasan keuangan bulanan</p>
        </div>
        <select
          className="input w-auto"
          value={`${selectedYear}-${selectedMonth}`}
          onChange={(e) => {
            const [y, m] = e.target.value.split('-')
            setSelectedYear(Number(y)); setSelectedMonth(Number(m))
          }}
        >
          {monthOptions.map(o => (
            <option key={`${o.year}-${o.month}`} value={`${o.year}-${o.month}`}>{o.label}</option>
          ))}
        </select>
      </div>

      {/* Free Cashflow Hero Card */}
      <div className={`card p-6 mb-6 border-l-4 ${freeCashflow >= 0 ? 'border-l-green-400 bg-green-50/30' : 'border-l-red-400 bg-red-50/30'}`}>
        <p className="text-xs font-bold uppercase tracking-wider text-surface-500 mb-1">Free Cashflow Bulan Ini</p>
        <p className={`text-4xl font-extrabold font-mono mb-2 ${freeCashflow >= 0 ? 'text-green-600' : 'text-red-500'}`}>
          {freeCashflow >= 0 ? '+' : ''}{formatCurrency(freeCashflow)}
        </p>
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-surface-500">
          <span>Pemasukan <span className="font-bold font-mono text-green-600">+{formatShort(selectedIncome)}</span></span>
          <span>Pengeluaran <span className="font-bold font-mono text-red-500">-{formatShort(selectedExpense)}</span></span>
          <span>Tagihan Rutin <span className="font-bold font-mono text-amber-600">-{formatShort(recurringMonthly)}</span></span>
        </div>
        <p className="text-[11px] text-surface-400 mt-2">
          = Cashflow kotor <span className="font-mono font-semibold">{formatShort(grossCashflow)}</span> dikurangi estimasi tagihan rutin <span className="font-mono font-semibold">{formatShort(recurringMonthly)}</span>/bulan
        </p>
      </div>

      {/* Summary Metrics with MoM comparison */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="metric-card">
          <div className="absolute inset-0 bg-gradient-to-br from-green-50 to-transparent" />
          <div className="relative">
            <p className="text-xs font-bold text-green-600 uppercase tracking-wider mb-1">Pemasukan</p>
            <p className="text-2xl font-extrabold text-green-600">{formatShort(selectedIncome)}</p>
            <div className={`flex items-center gap-1 text-xs mt-1 font-semibold ${incomeChg >= 0 ? 'text-green-500' : 'text-red-400'}`}>
              <span>{incomeChg >= 0 ? '↑' : '↓'} {Math.abs(incomeChg).toFixed(0)}%</span>
              <span className="text-surface-400 font-normal">vs bulan lalu</span>
            </div>
          </div>
        </div>
        <div className="metric-card">
          <div className="absolute inset-0 bg-gradient-to-br from-red-50 to-transparent" />
          <div className="relative">
            <p className="text-xs font-bold text-red-500 uppercase tracking-wider mb-1">Pengeluaran</p>
            <p className="text-2xl font-extrabold text-red-500">{formatShort(selectedExpense)}</p>
            <div className={`flex items-center gap-1 text-xs mt-1 font-semibold ${expenseChg <= 0 ? 'text-green-500' : 'text-red-400'}`}>
              <span>{expenseChg >= 0 ? '↑' : '↓'} {Math.abs(expenseChg).toFixed(0)}%</span>
              <span className="text-surface-400 font-normal">vs bulan lalu</span>
            </div>
          </div>
        </div>
        <div className="metric-card">
          <div className={`absolute inset-0 bg-gradient-to-br ${grossCashflow >= 0 ? 'from-brand-50' : 'from-red-50'} to-transparent`} />
          <div className="relative">
            <p className="text-xs font-bold text-brand-600 uppercase tracking-wider mb-1">Cashflow Kotor</p>
            <p className={`text-2xl font-extrabold ${grossCashflow >= 0 ? 'text-brand-700' : 'text-red-500'}`}>{grossCashflow >= 0 ? '+' : ''}{formatShort(grossCashflow)}</p>
            <p className="text-xs text-surface-400 mt-1">{selectedTx.length} transaksi</p>
          </div>
        </div>
      </div>

      {/* 6-Month Trend */}
      <div className="card p-6 mb-6">
        <h3 className="text-sm font-bold text-surface-900 mb-5">Tren 6 Bulan Terakhir</h3>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={monthlyData} barGap={4}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
            <YAxis tickFormatter={v => formatShort(v)} tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={60} />
            <Tooltip formatter={(v: number, name: string) => [formatCurrency(v), name === 'income' ? 'Pemasukan' : name === 'expense' ? 'Pengeluaran' : 'Cashflow']} labelFormatter={l => `Bulan: ${l}`} contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }} />
            <Legend formatter={v => v === 'income' ? 'Pemasukan' : v === 'expense' ? 'Pengeluaran' : 'Cashflow'} iconType="circle" />
            <Bar dataKey="income" fill="#22c55e" radius={[4, 4, 0, 0]} name="income" />
            <Bar dataKey="expense" fill="#ef4444" radius={[4, 4, 0, 0]} name="expense" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Cashflow Line */}
      <div className="card p-6 mb-6">
        <h3 className="text-sm font-bold text-surface-900 mb-1">Cashflow Bulanan</h3>
        <p className="text-xs text-surface-400 mb-5">Semakin tinggi garis hijau, semakin sehat kondisi keuangan</p>
        <ResponsiveContainer width="100%" height={180}>
          <LineChart data={monthlyData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
            <YAxis tickFormatter={v => formatShort(v)} tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={60} />
            <Tooltip formatter={(v: number) => [formatCurrency(v), 'Cashflow']} contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }} />
            <Line type="monotone" dataKey="cashflow" stroke="#3b82f6" strokeWidth={2.5} dot={{ r: 4, fill: '#3b82f6' }} activeDot={{ r: 6 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Expense & Income breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Expense by category */}
        <div className="card p-6">
          <h3 className="text-sm font-bold text-surface-900 mb-4">
            Pengeluaran per Kategori — {MONTHS[selectedMonth - 1]}
          </h3>
          {expByCat.length > 0 ? (
            <div className="space-y-3">
              {expByCat.map((cat, i) => {
                const pct = (cat.value / selectedExpense) * 100
                return (
                  <div key={cat.name}>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="font-semibold text-surface-700">{cat.icon} {cat.name}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-surface-400">{pct.toFixed(0)}%</span>
                        <span className="font-mono font-bold text-surface-800">{formatShort(cat.value)}</span>
                      </div>
                    </div>
                    <div className="h-2 bg-surface-100 rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: CAT_COLORS[i % CAT_COLORS.length] }} />
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="text-center py-8 text-surface-300 text-sm">Tidak ada pengeluaran</div>
          )}
        </div>

        {/* Income by category */}
        <div className="card p-6">
          <h3 className="text-sm font-bold text-surface-900 mb-4">
            Pemasukan per Kategori — {MONTHS[selectedMonth - 1]}
          </h3>
          {incByCat.length > 0 ? (
            <div className="space-y-3">
              {incByCat.map((cat, i) => {
                const pct = (cat.value / selectedIncome) * 100
                return (
                  <div key={cat.name}>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="font-semibold text-surface-700">{cat.icon} {cat.name}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-surface-400">{pct.toFixed(0)}%</span>
                        <span className="font-mono font-bold text-surface-800">{formatShort(cat.value)}</span>
                      </div>
                    </div>
                    <div className="h-2 bg-surface-100 rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: '#22c55e' }} />
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="text-center py-8 text-surface-300 text-sm">Tidak ada pemasukan</div>
          )}
        </div>
      </div>

      {/* Top 5 transactions */}
      <div className="card p-6 mb-6">
        <h3 className="text-sm font-bold text-surface-900 mb-4">Top 5 Pengeluaran Terbesar — {MONTHS[selectedMonth - 1]}</h3>
        {topExpenses.length > 0 ? (
          <div className="space-y-2">
            {topExpenses.map((tx, i) => (
              <div key={tx.id} className="flex items-center gap-3 p-3 rounded-xl bg-surface-50">
                <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-surface-500 bg-surface-200 flex-shrink-0">
                  {i + 1}
                </div>
                <div className="w-9 h-9 rounded-xl flex items-center justify-center text-lg flex-shrink-0 bg-red-50">
                  {tx.categories?.icon || '💸'}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-surface-800 truncate">{tx.description || tx.categories?.name || 'Pengeluaran'}</p>
                  <p className="text-[10px] text-surface-400">{tx.wallets?.name} · {tx.date}</p>
                </div>
                <p className="text-sm font-bold font-mono text-red-500 flex-shrink-0">-{formatShort(Number(tx.amount))}</p>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-8 text-surface-300 text-sm">Tidak ada transaksi</div>
        )}
      </div>

      {/* Month comparison table */}
      <div className="card p-6">
        <h3 className="text-sm font-bold text-surface-900 mb-4">Perbandingan Bulanan</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-surface-100">
                <th className="text-left py-2 pr-4 font-bold text-surface-400 uppercase tracking-wider">Bulan</th>
                <th className="text-right py-2 px-3 font-bold text-surface-400 uppercase tracking-wider">Pemasukan</th>
                <th className="text-right py-2 px-3 font-bold text-surface-400 uppercase tracking-wider">Pengeluaran</th>
                <th className="text-right py-2 pl-3 font-bold text-surface-400 uppercase tracking-wider">Cashflow</th>
              </tr>
            </thead>
            <tbody>
              {[...monthlyData].reverse().map((m, i) => {
                const isSelected = m.month === selectedMonth && m.year === selectedYear
                return (
                  <tr key={i} onClick={() => { setSelectedMonth(m.month); setSelectedYear(m.year) }}
                    className={`border-b border-surface-50 cursor-pointer transition-colors ${isSelected ? 'bg-brand-50' : 'hover:bg-surface-50'}`}>
                    <td className={`py-2.5 pr-4 font-semibold ${isSelected ? 'text-brand-700' : 'text-surface-700'}`}>
                      {isSelected && <span className="mr-1">→</span>}{MONTHS[m.month - 1]} {m.year}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-green-600 font-semibold">{formatShort(m.income)}</td>
                    <td className="py-2.5 px-3 text-right font-mono text-red-500 font-semibold">{formatShort(m.expense)}</td>
                    <td className={`py-2.5 pl-3 text-right font-mono font-bold ${m.cashflow >= 0 ? 'text-brand-600' : 'text-red-500'}`}>
                      {m.cashflow >= 0 ? '+' : ''}{formatShort(m.cashflow)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="text-[10px] text-surface-400 mt-2">Klik baris untuk melihat detail bulan tersebut</p>
      </div>
    </AppShell>
  )
}
