'use client'

import { useEffect, useState, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import type { Budget, Category, Transaction } from '@/lib/supabase'
import { formatCurrency, formatShort, MONTHS } from '@/lib/utils'
import AppShell from '@/components/AppShell'
import Modal from '@/components/Modal'
import { toast } from '@/components/Toast'

export default function BudgetsPage() {
  const [budgets, setBudgets] = useState<Budget[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<Budget | null>(null)
  const now = new Date()
  const [form, setForm] = useState({ category_id: '', amount: '' })

  useEffect(() => { load() }, [])

  async function load() {
    const startOfMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
    const [b, c, t] = await Promise.all([
      supabase.from('budgets').select('*, categories(*)').eq('period_month', now.getMonth() + 1).eq('period_year', now.getFullYear()),
      supabase.from('categories').select('*').eq('type', 'expense').order('name'),
      supabase.from('transactions').select('*').eq('type', 'expense').gte('date', startOfMonth),
    ])
    setBudgets(b.data || [])
    setCategories(c.data || [])
    setTransactions(t.data || [])
  }

  function openAdd() {
    setEditing(null)
    setForm({ category_id: '', amount: '' })
    setShowModal(true)
  }

  function openEdit(b: Budget) {
    setEditing(b)
    setForm({ category_id: b.category_id, amount: String(b.amount) })
    setShowModal(true)
  }

  async function saveBudget() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return
    const amount = Number(form.amount)
    if (!amount || !form.category_id) { toast('Lengkapi data!', '⚠️'); return }

    if (editing) {
      const { error } = await supabase.from('budgets').update({ amount, category_id: form.category_id }).eq('id', editing.id)
      if (error) { toast(error.message, '❌'); return }
      toast('Anggaran diperbarui!', '✅')
    } else {
      const { error } = await supabase.from('budgets').insert({
        user_id: session.user.id,
        category_id: form.category_id,
        amount,
        period_month: now.getMonth() + 1,
        period_year: now.getFullYear(),
      })
      if (error) {
        const isDupe = error.message.includes('duplicate key')
        toast(isDupe ? 'Budget untuk kategori ini sudah ada!' : error.message, '❌')
        return
      }
      toast('Anggaran ditambahkan!', '🎯')
    }
    setShowModal(false)
    setEditing(null)
    setForm({ category_id: '', amount: '' })
    load()
  }

  async function deleteBudget(id: string) {
    await supabase.from('budgets').delete().eq('id', id)
    toast('Anggaran dihapus', '🗑️')
    load()
  }

  const totalBudget = budgets.reduce((s, b) => s + Number(b.amount), 0)
  const totalSpent = budgets.reduce((s, b) => {
    return s + transactions.filter(t => t.category_id === b.category_id).reduce((ss, t) => ss + Number(t.amount), 0)
  }, 0)
  const remaining = totalBudget - totalSpent

  return (
    <AppShell>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-extrabold text-surface-900">Anggaran</h1>
          <p className="text-sm text-surface-400">{MONTHS[now.getMonth()]} {now.getFullYear()}</p>
        </div>
        <button onClick={openAdd} className="btn btn-primary">+ Set Anggaran</button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="metric-card">
          <div className="absolute inset-0 bg-gradient-to-br from-brand-50 to-transparent" />
          <div className="relative">
            <p className="text-xs font-bold text-brand-600 uppercase tracking-wider mb-1">Total Budget</p>
            <p className="text-2xl font-extrabold text-surface-900">{formatShort(totalBudget)}</p>
          </div>
        </div>
        <div className="metric-card">
          <div className="absolute inset-0 bg-gradient-to-br from-red-50 to-transparent" />
          <div className="relative">
            <p className="text-xs font-bold text-red-500 uppercase tracking-wider mb-1">Terpakai</p>
            <p className="text-2xl font-extrabold text-red-500">{formatShort(totalSpent)}</p>
          </div>
        </div>
        <div className="metric-card">
          <div className="absolute inset-0 bg-gradient-to-br from-green-50 to-transparent" />
          <div className="relative">
            <p className="text-xs font-bold text-green-600 uppercase tracking-wider mb-1">Sisa</p>
            <p className={`text-2xl font-extrabold ${remaining >= 0 ? 'text-green-600' : 'text-red-500'}`}>{formatShort(remaining)}</p>
          </div>
        </div>
      </div>

      {/* Budget List */}
      <div className="space-y-3">
        {budgets.map((b) => {
          const spent = transactions.filter(t => t.category_id === b.category_id).reduce((s, t) => s + Number(t.amount), 0)
          const pct = Math.min((spent / Number(b.amount)) * 100, 100)
          const over = spent > Number(b.amount)
          return (
            <div key={b.id} className="card p-5 group">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-lg">{b.categories?.icon}</span>
                  <span className="font-semibold text-surface-800">{b.categories?.name}</span>
                  {over && <span className="badge bg-red-100 text-red-700">Over Budget!</span>}
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => openEdit(b)} className="opacity-0 group-hover:opacity-100 w-7 h-7 rounded-lg hover:bg-brand-50 text-surface-400 hover:text-brand-600 flex items-center justify-center text-xs transition-all">✏️</button>
                  <button onClick={() => deleteBudget(b.id)} className="opacity-0 group-hover:opacity-100 w-7 h-7 rounded-lg hover:bg-red-50 text-surface-400 hover:text-red-500 flex items-center justify-center text-xs transition-all">✕</button>
                </div>
              </div>
              <div className="progress-bar mb-2">
                <div className="progress-fill" style={{
                  width: `${pct}%`,
                  background: over ? '#ef4444' : pct > 70 ? '#f59e0b' : '#22c55e',
                }} />
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-surface-500">Terpakai: <span className="font-bold font-mono">{formatCurrency(spent)}</span></span>
                <span className="text-surface-400">Budget: <span className="font-bold font-mono">{formatCurrency(Number(b.amount))}</span></span>
              </div>
            </div>
          )
        })}
        {budgets.length === 0 && (
          <div className="card text-center py-16 text-surface-300">
            <p className="text-4xl mb-2">🎯</p>
            <p className="text-sm">Belum ada anggaran. Set anggaran bulanan per kategori!</p>
          </div>
        )}
      </div>

      <Modal open={showModal} onClose={() => { setShowModal(false); setEditing(null) }} title={editing ? 'Edit Anggaran' : 'Set Anggaran'}>
        <div className="space-y-4">
          <div>
            <label className="label">Kategori Pengeluaran</label>
            <select className="input" value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })} disabled={!!editing}>
              <option value="">Pilih kategori</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Batas Anggaran</label>
            <input className="input" type="number" placeholder="0" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          </div>
          <div className="flex gap-2">
            {editing && (
              <button onClick={() => { deleteBudget(editing.id); setShowModal(false) }} className="btn btn-danger flex-1">Hapus</button>
            )}
            <button onClick={saveBudget} className="btn btn-primary flex-1">{editing ? 'Simpan Perubahan' : 'Simpan'}</button>
          </div>
        </div>
      </Modal>
    </AppShell>
  )
}
