'use client'

import { useEffect, useState, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import type { Transaction, RecurringTransaction } from '@/lib/supabase'
import { formatCurrency, formatShort, MONTHS } from '@/lib/utils'
import AppShell from '@/components/AppShell'
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'

const CAT_COLORS = ['#ef4444','#f97316','#eab308','#22c55e','#3b82f6','#8b5cf6','#ec4899','#06b6d4','#f43f5e','#84cc16']

function startOfMonth(y: number, m: number) { return `${y}-${String(m).padStart(2,'0')}-01` }
function endOfMonth(y: number, m: number) { return new Date(y, m, 0).toISOString().split('T')[0] }

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
  const [loading, setLoading] = useState(true)
  const now = new Date()
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1)
  const [selectedYear, setSelectedYear] = useState(now.getFullYear())

  useEffect(() => { load() }, [])

  async function load() {
    const sixMonthsAgo = new Date(); sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5); sixMonthsAgo.setDate(1)
    const [t, r] = await Promise.all([
      supabase.from('transactions').select('*, categories(*), wallets(*)').gte('date', sixMonthsAgo.toISOString().split('T')[0]).order('date'),
      supabase.from('recurring_transactions').select('*'),
    ])
    setTransactions(t.data || [])
    setRecurring(r.data || [])
    setLoading(false)
  }

  const monthlyData = useMemo(() => {
    return Array.from({ length: 6 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1)
      const y = d.getFullYear(); const m = d.getMonth() + 1
      const tx = transactions.filter(t => t.date >= startOfMonth(y, m) && t.date <= endOfMonth(y, m))
      const income = tx.filter(t => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0)
      const expense = tx.filter(t => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0)
      return { label: MONTHS[m-1].slice(0,3), income, expense, cashflow: income - expense, year: y, month: m }
    })
  }, [transactions])

  const selTx = useMemo(() => transactions.filter(t => t.date >= startOfMonth(selectedYear, selectedMonth) && t.date <= endOfMonth(selectedYear, selectedMonth)), [transactions, selectedMonth, selectedYear])
  const selIncome = useMemo(() => selTx.filter(t => t.type === 'income').reduce((s,t) => s+Number(t.amount),0), [selTx])
  const selExpense = useMemo(() => selTx.filter(t => t.type === 'expense').reduce((s,t) => s+Number(t.amount),0), [selTx])

  const prevMonth = selectedMonth === 1 ? 12 : selectedMonth - 1
  const prevYear = selectedMonth === 1 ? selectedYear - 1 : selectedYear
  const prevTx = useMemo(() => transactions.filter(t => t.date >= startOfMonth(prevYear, prevMonth) && t.date <= endOfMonth(prevYear, prevMonth)), [transactions, prevMonth, prevYear])
  const prevIncome = prevTx.filter(t => t.type==='income').reduce((s,t)=>s+Number(t.amount),0)
  const prevExpense = prevTx.filter(t => t.type==='expense').reduce((s,t)=>s+Number(t.amount),0)

  const recurringMonthly = useMemo(() => normalizeRecurringToMonthly(recurring), [recurring])
  const freeCashflow = selIncome - selExpense - recurringMonthly

  const expByCat = useMemo(() => {
    const map: Record<string, { name: string; value: number; icon: string }> = {}
    selTx.filter(t => t.type==='expense').forEach(t => {
      const key = t.categories?.name || 'Lainnya'
      if (!map[key]) map[key] = { name: key, value: 0, icon: t.categories?.icon || '📦' }
      map[key].value += Number(t.amount)
    })
    return Object.values(map).sort((a,b) => b.value - a.value)
  }, [selTx])

  const topExpenses = useMemo(() => [...selTx].filter(t=>t.type==='expense').sort((a,b)=>Number(b.amount)-Number(a.amount)).slice(0,5), [selTx])

  function pctChange(curr: number, prev: number) {
    if (prev === 0) return curr > 0 ? 100 : 0
    return ((curr - prev) / prev) * 100
  }

  const monthOptions = Array.from({length:6},(_,i) => {
    const d = new Date(now.getFullYear(), now.getMonth()-i, 1)
    return { year: d.getFullYear(), month: d.getMonth()+1, label: `${MONTHS[d.getMonth()]} ${d.getFullYear()}` }
  })

  if (loading) return <AppShell><div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-4 border-brand-200 border-t-brand-600 rounded-full animate-spin" /></div></AppShell>

  return (
    <AppShell>
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <div>
          <h1 className="text-xl sm:text-2xl font-extrabold text-surface-900">Laporan</h1>
          <p className="text-xs text-surface-400">Analitik keuangan bulanan</p>
        </div>
        <select className="input w-auto text-sm" value={`${selectedYear}-${selectedMonth}`}
          onChange={e => { const [y,m] = e.target.value.split('-'); setSelectedYear(Number(y)); setSelectedMonth(Number(m)) }}>
          {monthOptions.map(o => <option key={`${o.year}-${o.month}`} value={`${o.year}-${o.month}`}>{o.label}</option>)}
        </select>
      </div>

      {/* Free Cashflow Hero */}
      <div className={`card p-5 mb-4 border-l-4 ${freeCashflow>=0?'border-l-green-400 bg-green-50/30':'border-l-red-400 bg-red-50/30'}`}>
        <p className="text-xs font-bold uppercase tracking-wider text-surface-500 mb-1">Free Cashflow</p>
        <p className={`text-3xl sm:text-4xl font-extrabold font-mono mb-2 ${freeCashflow>=0?'text-green-600':'text-red-500'}`}>
          {freeCashflow>=0?'+':''}{formatShort(freeCashflow)}
        </p>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-surface-500">
          <span>Masuk <span className="font-bold text-green-600">+{formatShort(selIncome)}</span></span>
          <span>Keluar <span className="font-bold text-red-500">-{formatShort(selExpense)}</span></span>
          <span>Rutin <span className="font-bold text-amber-600">-{formatShort(recurringMonthly)}</span></span>
        </div>
      </div>

      {/* Metrics row */}
      <div className="grid grid-cols-3 gap-2 sm:gap-4 mb-4">
        {[
          { label: 'Pemasukan', val: selIncome, prev: prevIncome, color: 'text-green-600', up: true },
          { label: 'Pengeluaran', val: selExpense, prev: prevExpense, color: 'text-red-500', up: false },
          { label: 'Cashflow', val: selIncome-selExpense, prev: prevIncome-prevExpense, color: selIncome-selExpense>=0?'text-brand-600':'text-red-500', up: true },
        ].map(m => {
          const chg = pctChange(m.val, m.prev)
          const good = m.up ? chg >= 0 : chg <= 0
          return (
            <div key={m.label} className="card p-3 sm:p-4">
              <p className="text-[10px] font-bold text-surface-400 uppercase mb-1">{m.label}</p>
              <p className={`text-base sm:text-xl font-extrabold ${m.color} font-mono`}>{formatShort(m.val)}</p>
              <p className={`text-[10px] font-semibold mt-0.5 ${good?'text-green-500':'text-red-400'}`}>
                {chg>=0?'↑':'↓'}{Math.abs(chg).toFixed(0)}% vs lalu
              </p>
            </div>
          )
        })}
      </div>

      {/* 6-Month Bar Chart */}
      <div className="card p-4 sm:p-6 mb-4">
        <h3 className="text-sm font-bold text-surface-900 mb-4">Tren 6 Bulan</h3>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={monthlyData} barGap={2} margin={{ left: -10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
            <YAxis tickFormatter={v => formatShort(v)} tick={{ fontSize: 9, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={50} />
            <Tooltip formatter={(v: number, n: string) => [formatCurrency(v), n==='income'?'Masuk':n==='expense'?'Keluar':'Cashflow']} contentStyle={{ borderRadius:12, border:'1px solid #e2e8f0', fontSize:11 }} />
            <Legend formatter={v=>v==='income'?'Masuk':v==='expense'?'Keluar':'Cashflow'} iconType="circle" wrapperStyle={{ fontSize:11 }} />
            <Bar dataKey="income" fill="#22c55e" radius={[3,3,0,0]} name="income" />
            <Bar dataKey="expense" fill="#ef4444" radius={[3,3,0,0]} name="expense" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Cashflow Line */}
      <div className="card p-4 sm:p-6 mb-4">
        <h3 className="text-sm font-bold text-surface-900 mb-1">Tren Cashflow</h3>
        <p className="text-[10px] text-surface-400 mb-4">Semakin tinggi = semakin sehat</p>
        <ResponsiveContainer width="100%" height={140}>
          <LineChart data={monthlyData} margin={{ left: -10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
            <YAxis tickFormatter={v=>formatShort(v)} tick={{ fontSize:9, fill:'#94a3b8' }} axisLine={false} tickLine={false} width={50} />
            <Tooltip formatter={(v:number) => [formatCurrency(v),'Cashflow']} contentStyle={{ borderRadius:12, border:'1px solid #e2e8f0', fontSize:11 }} />
            <Line type="monotone" dataKey="cashflow" stroke="#3b82f6" strokeWidth={2.5} dot={{ r:3, fill:'#3b82f6' }} activeDot={{ r:5 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Expense by Category */}
      <div className="card p-4 sm:p-6 mb-4">
        <h3 className="text-sm font-bold text-surface-900 mb-4">Pengeluaran per Kategori — {MONTHS[selectedMonth-1]}</h3>
        {expByCat.length > 0 ? (
          <div className="space-y-3">
            {expByCat.map((cat, i) => {
              const pct = selExpense > 0 ? (cat.value / selExpense) * 100 : 0
              return (
                <div key={cat.name}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="font-semibold text-surface-700 truncate mr-2">{cat.icon} {cat.name}</span>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <span className="text-surface-400">{pct.toFixed(0)}%</span>
                      <span className="font-mono font-bold text-surface-800">{formatShort(cat.value)}</span>
                    </div>
                  </div>
                  <div className="h-2 bg-surface-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ width:`${pct}%`, background: CAT_COLORS[i%CAT_COLORS.length] }} />
                  </div>
                </div>
              )
            })}
          </div>
        ) : <p className="text-center py-8 text-surface-300 text-sm">Tidak ada pengeluaran</p>}
      </div>

      {/* Top 5 */}
      <div className="card p-4 sm:p-6 mb-4">
        <h3 className="text-sm font-bold text-surface-900 mb-4">Top 5 Pengeluaran Terbesar</h3>
        {topExpenses.length > 0 ? (
          <div className="space-y-2">
            {topExpenses.map((tx, i) => (
              <div key={tx.id} className="flex items-center gap-3 p-3 rounded-xl bg-surface-50">
                <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-surface-500 bg-surface-200 flex-shrink-0">{i+1}</div>
                <div className="w-9 h-9 rounded-xl flex items-center justify-center text-base flex-shrink-0 bg-red-50">{tx.categories?.icon || '💸'}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-surface-800 truncate">{tx.description || tx.categories?.name || 'Pengeluaran'}</p>
                  <p className="text-[10px] text-surface-400">{tx.wallets?.name}</p>
                </div>
                <p className="text-sm font-bold font-mono text-red-500 flex-shrink-0">-{formatShort(Number(tx.amount))}</p>
              </div>
            ))}
          </div>
        ) : <p className="text-center py-8 text-surface-300 text-sm">Tidak ada transaksi</p>}
      </div>

      {/* Monthly comparison table - scrollable */}
      <div className="card p-4 sm:p-6">
        <h3 className="text-sm font-bold text-surface-900 mb-4">Perbandingan Bulanan</h3>
        <div className="overflow-x-auto -mx-1">
          <table className="w-full text-xs min-w-[320px]">
            <thead>
              <tr className="border-b border-surface-100">
                <th className="text-left py-2 pr-3 font-bold text-surface-400 uppercase tracking-wider whitespace-nowrap">Bulan</th>
                <th className="text-right py-2 px-2 font-bold text-surface-400 uppercase tracking-wider whitespace-nowrap">Masuk</th>
                <th className="text-right py-2 px-2 font-bold text-surface-400 uppercase tracking-wider whitespace-nowrap">Keluar</th>
                <th className="text-right py-2 pl-2 font-bold text-surface-400 uppercase tracking-wider whitespace-nowrap">Cashflow</th>
              </tr>
            </thead>
            <tbody>
              {[...monthlyData].reverse().map((m, i) => {
                const isSelected = m.month === selectedMonth && m.year === selectedYear
                return (
                  <tr key={i} onClick={() => { setSelectedMonth(m.month); setSelectedYear(m.year) }}
                    className={`border-b border-surface-50 cursor-pointer ${isSelected?'bg-brand-50':'active:bg-surface-50'}`}>
                    <td className={`py-2.5 pr-3 font-semibold whitespace-nowrap ${isSelected?'text-brand-700':'text-surface-700'}`}>
                      {isSelected && '→ '}{MONTHS[m.month-1].slice(0,3)} {m.year}
                    </td>
                    <td className="py-2.5 px-2 text-right font-mono text-green-600 font-semibold">{formatShort(m.income)}</td>
                    <td className="py-2.5 px-2 text-right font-mono text-red-500 font-semibold">{formatShort(m.expense)}</td>
                    <td className={`py-2.5 pl-2 text-right font-mono font-bold ${m.cashflow>=0?'text-brand-600':'text-red-500'}`}>
                      {m.cashflow>=0?'+':''}{formatShort(m.cashflow)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="text-[10px] text-surface-400 mt-2">Ketuk baris untuk lihat detail bulan tersebut</p>
      </div>
    </AppShell>
  )
}
