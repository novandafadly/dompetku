'use client'

import { useEffect, useState, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import type { RecurringTransaction, Wallet, Category } from '@/lib/supabase'
import { formatCurrency, formatDate, FREQUENCY_META, DAYS } from '@/lib/utils'
import AppShell from '@/components/AppShell'
import Modal from '@/components/Modal'
import { toast } from '@/components/Toast'

type RForm = {
  wallet_id: string
  category_id: string
  type: 'income' | 'expense'
  amount: string
  description: string
  frequency: 'daily' | 'weekly' | 'monthly' | 'yearly'
  day_of_month: string
  day_of_week: string
  next_due: string
  is_active: boolean
  auto_execute: boolean
}

const emptyForm: RForm = {
  wallet_id: '', category_id: '', type: 'expense', amount: '', description: '',
  frequency: 'monthly', day_of_month: String(new Date().getDate()), day_of_week: '1',
  next_due: new Date().toISOString().split('T')[0], is_active: true, auto_execute: false,
}

function daysUntil(dateStr: string): number {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const due = new Date(dateStr); due.setHours(0, 0, 0, 0)
  return Math.ceil((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
}

function computeNextDue(frequency: string, current: string, dayOfMonth?: string): string {
  const d = new Date(current)
  switch (frequency) {
    case 'daily': d.setDate(d.getDate() + 1); break
    case 'weekly': d.setDate(d.getDate() + 7); break
    case 'monthly':
      d.setMonth(d.getMonth() + 1)
      if (dayOfMonth) d.setDate(Number(dayOfMonth))
      break
    case 'yearly': d.setFullYear(d.getFullYear() + 1); break
  }
  return d.toISOString().split('T')[0]
}

export default function RecurringPage() {
  const [items, setItems] = useState<RecurringTransaction[]>([])
  const [wallets, setWallets] = useState<Wallet[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<RecurringTransaction | null>(null)
  const [executing, setExecuting] = useState<string | null>(null)
  const [form, setForm] = useState<RForm>(emptyForm)

  useEffect(() => { load() }, [])

  async function load() {
    const [r, w, c] = await Promise.all([
      supabase.from('recurring_transactions').select('*, wallets(*), categories(*)').order('next_due'),
      supabase.from('wallets').select('*').eq('is_active', true),
      supabase.from('categories').select('*').order('name'),
    ])
    setItems(r.data || [])
    setWallets(w.data || [])
    setCategories(c.data || [])
  }

  function openAdd() {
    setEditing(null); setForm(emptyForm); setShowModal(true)
  }

  function openEdit(r: RecurringTransaction) {
    setEditing(r)
    setForm({
      wallet_id: r.wallet_id || '', category_id: r.category_id || '', type: r.type,
      amount: String(r.amount), description: r.description || '',
      frequency: r.frequency, day_of_month: String(r.day_of_month || new Date().getDate()),
      day_of_week: String(r.day_of_week ?? 1), next_due: r.next_due,
      is_active: r.is_active, auto_execute: r.auto_execute,
    })
    setShowModal(true)
  }

  async function save() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return
    const amount = Number(form.amount)
    if (!amount || !form.wallet_id) { toast('Lengkapi jumlah & dompet!', '⚠️'); return }

    const payload = {
      wallet_id: form.wallet_id,
      category_id: form.category_id || null,
      type: form.type,
      amount,
      description: form.description || null,
      frequency: form.frequency,
      day_of_month: form.frequency === 'monthly' ? Number(form.day_of_month) : null,
      day_of_week: form.frequency === 'weekly' ? Number(form.day_of_week) : null,
      next_due: form.next_due,
      is_active: form.is_active,
      auto_execute: form.auto_execute,
    }

    if (editing) {
      const { error } = await supabase.from('recurring_transactions').update(payload).eq('id', editing.id)
      if (error) { toast(error.message, '❌'); return }
      toast('Tagihan rutin diperbarui!', '✅')
    } else {
      const { error } = await supabase.from('recurring_transactions').insert({ ...payload, user_id: session.user.id })
      if (error) { toast(error.message, '❌'); return }
      toast('Tagihan rutin ditambahkan!', '🔄')
    }
    setShowModal(false); setEditing(null); setForm(emptyForm); load()
  }

  async function deleteItem(id: string) {
    if (!confirm('Hapus tagihan rutin ini?')) return
    await supabase.from('recurring_transactions').delete().eq('id', id)
    toast('Dihapus', '🗑️'); load()
  }

  async function toggleActive(item: RecurringTransaction) {
    await supabase.from('recurring_transactions').update({ is_active: !item.is_active }).eq('id', item.id)
    toast(item.is_active ? 'Dinonaktifkan' : 'Diaktifkan', item.is_active ? '⏸️' : '▶️'); load()
  }

  // Execute = create actual transaction + advance next_due
  async function executeNow(item: RecurringTransaction) {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return
    setExecuting(item.id)
    try {
      const { error } = await supabase.from('transactions').insert({
        user_id: session.user.id,
        wallet_id: item.wallet_id,
        category_id: item.category_id,
        type: item.type,
        amount: item.amount,
        description: item.description || `Rutin: ${item.wallets?.name}`,
        date: new Date().toISOString().split('T')[0],
      })
      if (error) { toast(error.message, '❌'); return }

      const nextDue = computeNextDue(item.frequency, item.next_due, String(item.day_of_month || ''))
      await supabase.from('recurring_transactions').update({
        last_executed: new Date().toISOString().split('T')[0],
        next_due: nextDue,
      }).eq('id', item.id)

      toast(`✅ Transaksi "${item.description || 'Rutin'}" dicatat! Next: ${formatDate(nextDue)}`, '💸')
      load()
    } finally {
      setExecuting(null)
    }
  }

  const overdue = items.filter(i => i.is_active && daysUntil(i.next_due) < 0)
  const upcoming = items.filter(i => i.is_active && daysUntil(i.next_due) >= 0 && daysUntil(i.next_due) <= 7)
  const inactive = items.filter(i => !i.is_active)

  const totalMonthlyExpense = useMemo(() => items.filter(i => i.is_active && i.type === 'expense').reduce((s, i) => {
    if (i.frequency === 'monthly') return s + Number(i.amount)
    if (i.frequency === 'yearly') return s + Number(i.amount) / 12
    if (i.frequency === 'weekly') return s + Number(i.amount) * 4.33
    if (i.frequency === 'daily') return s + Number(i.amount) * 30
    return s
  }, 0), [items])

  const filteredCats = categories.filter(c => c.type === form.type)

  function DueTag({ item }: { item: RecurringTransaction }) {
    const days = daysUntil(item.next_due)
    if (days < 0) return <span className="badge bg-red-100 text-red-700">Terlambat {Math.abs(days)}h</span>
    if (days === 0) return <span className="badge bg-orange-100 text-orange-700">Hari ini!</span>
    if (days <= 3) return <span className="badge bg-amber-100 text-amber-700">{days} hari lagi</span>
    return <span className="badge bg-surface-100 text-surface-500">{formatDate(item.next_due)}</span>
  }

  function ItemCard({ item }: { item: RecurringTransaction }) {
    const isExec = executing === item.id
    const days = daysUntil(item.next_due)
    const isOverdue = days < 0
    return (
      <div className={`card p-4 group ${!item.is_active ? 'opacity-50' : ''}`}>
        <div className="flex items-start gap-3">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-lg flex-shrink-0 ${item.type === 'income' ? 'bg-green-50' : 'bg-red-50'}`}>
            {item.categories?.icon || (item.type === 'income' ? '💰' : '💸')}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-0.5">
              <p className="text-sm font-semibold text-surface-800">{item.description || item.categories?.name || 'Tagihan Rutin'}</p>
              <DueTag item={item} />
            </div>
            <div className="flex items-center gap-2 text-[10px] text-surface-400 flex-wrap">
              <span>{FREQUENCY_META[item.frequency]?.icon} {FREQUENCY_META[item.frequency]?.label}</span>
              <span>·</span>
              <span>{item.wallets?.name}</span>
              {item.last_executed && <><span>·</span><span>Terakhir: {formatDate(item.last_executed)}</span></>}
            </div>
          </div>
          <div className="flex flex-col items-end gap-1 flex-shrink-0">
            <p className={`text-sm font-bold font-mono ${item.type === 'income' ? 'text-green-600' : 'text-red-500'}`}>
              {item.type === 'income' ? '+' : '-'}{formatCurrency(Number(item.amount))}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 mt-3 pt-3 border-t border-surface-100">
          <button
            onClick={() => executeNow(item)}
            disabled={isExec || !item.is_active}
            className="btn btn-primary py-1.5 text-xs flex-1 disabled:opacity-50"
          >
            {isExec ? '⏳ Memproses...' : '▶ Jalankan Sekarang'}
          </button>
          <button onClick={() => openEdit(item)} className="btn btn-secondary py-1.5 text-xs px-3">✏️</button>
          <button onClick={() => toggleActive(item)} className="btn btn-secondary py-1.5 text-xs px-3" title={item.is_active ? 'Nonaktifkan' : 'Aktifkan'}>
            {item.is_active ? '⏸' : '▶'}
          </button>
          <button onClick={() => deleteItem(item.id)} className="btn py-1.5 text-xs px-3 hover:bg-red-50 hover:text-red-600 btn-secondary">✕</button>
        </div>
      </div>
    )
  }

  return (
    <AppShell>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-extrabold text-surface-900">Tagihan Rutin</h1>
          <p className="text-sm text-surface-400">Estimasi pengeluaran rutin/bulan: {formatCurrency(totalMonthlyExpense)}</p>
        </div>
        <button onClick={openAdd} className="btn btn-primary">+ Tambah</button>
      </div>

      {/* Overdue alert */}
      {overdue.length > 0 && (
        <div className="card p-4 border-l-4 border-l-red-400 mb-4 bg-red-50/50">
          <p className="text-sm font-bold text-red-700 mb-2">⚠️ {overdue.length} tagihan terlambat dijalankan</p>
          <div className="space-y-2">
            {overdue.map(i => <ItemCard key={i.id} item={i} />)}
          </div>
        </div>
      )}

      {/* Upcoming in 7 days */}
      {upcoming.length > 0 && (
        <div className="mb-6">
          <h3 className="text-xs font-bold text-amber-600 uppercase tracking-wider mb-3">📅 Jatuh Tempo 7 Hari Ke Depan</h3>
          <div className="space-y-3">
            {upcoming.map(i => <ItemCard key={i.id} item={i} />)}
          </div>
        </div>
      )}

      {/* All active */}
      {items.filter(i => i.is_active && daysUntil(i.next_due) > 7).length > 0 && (
        <div className="mb-6">
          <h3 className="text-xs font-bold text-surface-500 uppercase tracking-wider mb-3">🔄 Semua Tagihan Aktif</h3>
          <div className="space-y-3">
            {items.filter(i => i.is_active && daysUntil(i.next_due) > 7).map(i => <ItemCard key={i.id} item={i} />)}
          </div>
        </div>
      )}

      {/* Inactive */}
      {inactive.length > 0 && (
        <div>
          <h3 className="text-xs font-bold text-surface-400 uppercase tracking-wider mb-3">⏸ Nonaktif</h3>
          <div className="space-y-3">
            {inactive.map(i => <ItemCard key={i.id} item={i} />)}
          </div>
        </div>
      )}

      {items.length === 0 && (
        <div className="card text-center py-20 text-surface-300">
          <p className="text-5xl mb-3">🔄</p>
          <p className="font-semibold text-surface-500">Belum ada tagihan rutin</p>
          <p className="text-sm mt-1">Tambahkan tagihan seperti langganan Netflix, cicilan, atau gaji.</p>
        </div>
      )}

      {/* Modal */}
      <Modal open={showModal} onClose={() => { setShowModal(false); setEditing(null) }} title={editing ? 'Edit Tagihan Rutin' : 'Tambah Tagihan Rutin'}>
        <div className="space-y-4">
          <div>
            <label className="label">Tipe</label>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setForm({ ...form, type: 'expense', category_id: '' })} className={`btn ${form.type === 'expense' ? 'bg-red-50 text-red-700 border-red-200 border' : 'btn-secondary'}`}>💸 Pengeluaran</button>
              <button onClick={() => setForm({ ...form, type: 'income', category_id: '' })} className={`btn ${form.type === 'income' ? 'bg-green-50 text-green-700 border-green-200 border' : 'btn-secondary'}`}>💰 Pemasukan</button>
            </div>
          </div>
          <div>
            <label className="label">Nama / Keterangan</label>
            <input className="input" placeholder="mis. Netflix, Cicilan KPR, Gaji" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          <div>
            <label className="label">Jumlah</label>
            <input className="input text-lg font-bold" type="number" placeholder="0" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          </div>
          <div>
            <label className="label">Dompet</label>
            <select className="input" value={form.wallet_id} onChange={(e) => setForm({ ...form, wallet_id: e.target.value })}>
              <option value="">Pilih dompet</option>
              {wallets.map(w => <option key={w.id} value={w.id}>{w.icon} {w.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Kategori</label>
            <select className="input" value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })}>
              <option value="">Pilih kategori</option>
              {filteredCats.map(c => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Frekuensi</label>
            <div className="grid grid-cols-4 gap-2">
              {(['daily', 'weekly', 'monthly', 'yearly'] as const).map(f => (
                <button key={f} onClick={() => setForm({ ...form, frequency: f })}
                  className={`btn text-xs py-2 flex-col gap-0.5 ${form.frequency === f ? 'btn-primary' : 'btn-secondary'}`}>
                  <span>{FREQUENCY_META[f].icon}</span>
                  <span>{FREQUENCY_META[f].label}</span>
                </button>
              ))}
            </div>
          </div>
          {form.frequency === 'monthly' && (
            <div>
              <label className="label">Tanggal setiap bulan</label>
              <input className="input" type="number" min="1" max="31" placeholder="1-31" value={form.day_of_month} onChange={(e) => setForm({ ...form, day_of_month: e.target.value })} />
            </div>
          )}
          {form.frequency === 'weekly' && (
            <div>
              <label className="label">Hari setiap minggu</label>
              <select className="input" value={form.day_of_week} onChange={(e) => setForm({ ...form, day_of_week: e.target.value })}>
                {DAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="label">Jatuh Tempo Pertama / Berikutnya</label>
            <input className="input" type="date" value={form.next_due} onChange={(e) => setForm({ ...form, next_due: e.target.value })} />
          </div>
          <div className="flex items-center justify-between p-3 bg-surface-50 rounded-xl">
            <div>
              <p className="text-sm font-semibold text-surface-800">Aktif</p>
              <p className="text-xs text-surface-400">Nonaktifkan untuk pause sementara</p>
            </div>
            <button onClick={() => setForm({ ...form, is_active: !form.is_active })}
              className={`w-12 h-6 rounded-full transition-colors relative ${form.is_active ? 'bg-brand-500' : 'bg-surface-300'}`}>
              <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${form.is_active ? 'left-7' : 'left-1'}`} />
            </button>
          </div>
          <div className="flex gap-2">
            {editing && <button onClick={() => { deleteItem(editing.id); setShowModal(false) }} className="btn btn-danger flex-1">Hapus</button>}
            <button onClick={save} className="btn btn-primary flex-1">{editing ? 'Simpan' : 'Tambah'}</button>
          </div>
        </div>
      </Modal>
    </AppShell>
  )
}
