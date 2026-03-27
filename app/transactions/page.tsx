'use client'

import { useEffect, useState, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import type { Transaction, Wallet, Category } from '@/lib/supabase'
import { formatCurrency, formatDate } from '@/lib/utils'
import AppShell from '@/components/AppShell'
import Modal from '@/components/Modal'
import { toast } from '@/components/Toast'

export default function TransactionsPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [wallets, setWallets] = useState<Wallet[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [showAdd, setShowAdd] = useState(false)
  const [search, setSearch] = useState('')
  const [filterType, setFilterType] = useState('')
  const [filterCat, setFilterCat] = useState('')
  const [form, setForm] = useState({ wallet_id: '', category_id: '', type: 'expense', amount: '', description: '', date: new Date().toISOString().split('T')[0] })

  useEffect(() => { load() }, [])

  async function load() {
    const [t, w, c] = await Promise.all([
      supabase.from('transactions').select('*, categories(*), wallets(*)').order('date', { ascending: false }).limit(200),
      supabase.from('wallets').select('*').eq('is_active', true),
      supabase.from('categories').select('*').order('name'),
    ])
    setTransactions(t.data || [])
    setWallets(w.data || [])
    setCategories(c.data || [])
  }

  async function addTransaction() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return
    const amount = Number(form.amount)
    if (!amount || !form.wallet_id) { toast('Lengkapi data!', '⚠️'); return }

    const { error } = await supabase.from('transactions').insert({
      user_id: session.user.id,
      wallet_id: form.wallet_id,
      category_id: form.category_id || null,
      type: form.type,
      amount,
      description: form.description || null,
      date: form.date,
    })
    if (error) { toast(error.message, '❌'); return }
    toast(`${form.type === 'income' ? 'Pemasukan' : 'Pengeluaran'} ditambahkan!`, form.type === 'income' ? '💰' : '💸')
    setShowAdd(false)
    setForm({ wallet_id: '', category_id: '', type: 'expense', amount: '', description: '', date: new Date().toISOString().split('T')[0] })
    load()
  }

  async function deleteTx(id: string) {
    if (!confirm('Hapus transaksi ini?')) return
    await supabase.from('transactions').delete().eq('id', id)
    toast('Transaksi dihapus', '🗑️')
    load()
  }

  const filtered = useMemo(() => {
    return transactions.filter(t => {
      if (filterType && t.type !== filterType) return false
      if (filterCat && t.category_id !== filterCat) return false
      if (search) {
        const q = search.toLowerCase()
        return (t.description?.toLowerCase().includes(q) || t.categories?.name?.toLowerCase().includes(q) || t.wallets?.name?.toLowerCase().includes(q))
      }
      return true
    })
  }, [transactions, search, filterType, filterCat])

  const filteredCats = categories.filter(c => !form.type || c.type === form.type)

  return (
    <AppShell>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-extrabold text-surface-900">Transaksi</h1>
          <p className="text-sm text-surface-400">{transactions.length} transaksi</p>
        </div>
        <button onClick={() => setShowAdd(true)} className="btn btn-primary">+ Tambah</button>
      </div>

      {/* Filters */}
      <div className="card p-4 mb-6">
        <div className="flex flex-wrap gap-3">
          <input className="input flex-1 min-w-[200px]" placeholder="🔍 Cari transaksi..." value={search} onChange={(e) => setSearch(e.target.value)} />
          <select className="input w-auto" value={filterType} onChange={(e) => setFilterType(e.target.value)}>
            <option value="">Semua Tipe</option>
            <option value="income">Pemasukan</option>
            <option value="expense">Pengeluaran</option>
          </select>
          <select className="input w-auto" value={filterCat} onChange={(e) => setFilterCat(e.target.value)}>
            <option value="">Semua Kategori</option>
            {categories.map(c => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
          </select>
        </div>
      </div>

      {/* Transactions List */}
      <div className="card overflow-hidden">
        {filtered.length > 0 ? (
          <div className="divide-y divide-surface-100">
            {filtered.map((tx) => (
              <div key={tx.id} className="flex items-center gap-3 p-4 hover:bg-surface-50 transition-colors">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center text-lg flex-shrink-0" style={{
                  background: tx.type === 'income' ? '#dcfce7' : '#fee2e2',
                }}>
                  {tx.categories?.icon || (tx.type === 'income' ? '💰' : '💸')}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-surface-800 truncate">{tx.description || tx.categories?.name || 'Transaksi'}</p>
                  <div className="flex items-center gap-2 text-[10px] text-surface-400">
                    <span>{formatDate(tx.date)}</span>
                    <span>·</span>
                    <span>{tx.wallets?.name}</span>
                    {tx.categories && <><span>·</span><span>{tx.categories.name}</span></>}
                  </div>
                </div>
                <p className={`text-sm font-bold font-mono flex-shrink-0 ${tx.type === 'income' ? 'text-green-600' : 'text-red-500'}`}>
                  {tx.type === 'income' ? '+' : '-'}{formatCurrency(Number(tx.amount))}
                </p>
                <button onClick={() => deleteTx(tx.id)} className="text-surface-300 hover:text-red-500 text-xs ml-2 flex-shrink-0">✕</button>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-16 text-surface-300">
            <p className="text-4xl mb-2">📝</p>
            <p className="text-sm">Belum ada transaksi</p>
          </div>
        )}
      </div>

      {/* Add Transaction Modal */}
      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="Tambah Transaksi">
        <div className="space-y-4">
          <div>
            <label className="label">Tipe</label>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setForm({ ...form, type: 'expense', category_id: '' })} className={`btn ${form.type === 'expense' ? 'bg-red-50 text-red-700 border-red-200 border' : 'btn-secondary'}`}>💸 Pengeluaran</button>
              <button onClick={() => setForm({ ...form, type: 'income', category_id: '' })} className={`btn ${form.type === 'income' ? 'bg-green-50 text-green-700 border-green-200 border' : 'btn-secondary'}`}>💰 Pemasukan</button>
            </div>
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
            <label className="label">Keterangan</label>
            <input className="input" placeholder="mis. Makan siang" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          <div>
            <label className="label">Tanggal</label>
            <input className="input" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          </div>
          <button onClick={addTransaction} className="btn btn-primary w-full">Simpan</button>
        </div>
      </Modal>
    </AppShell>
  )
}
