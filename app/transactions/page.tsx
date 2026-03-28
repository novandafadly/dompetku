'use client'

import { useEffect, useState, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import type { Transaction, Wallet, Category } from '@/lib/supabase'
import { formatCurrency, formatDate } from '@/lib/utils'
import AppShell from '@/components/AppShell'
import Modal from '@/components/Modal'
import { toast } from '@/components/Toast'

type FormState = {
  wallet_id: string
  category_id: string
  type: 'income' | 'expense'
  amount: string
  description: string
  date: string
}

const emptyForm: FormState = {
  wallet_id: '',
  category_id: '',
  type: 'expense',
  amount: '',
  description: '',
  date: new Date().toISOString().split('T')[0],
}

export default function TransactionsPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [wallets, setWallets] = useState<Wallet[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [showAdd, setShowAdd] = useState(false)
  const [editing, setEditing] = useState<Transaction | null>(null)
  const [search, setSearch] = useState('')
  const [filterType, setFilterType] = useState('')
  const [filterCat, setFilterCat] = useState('')
  const [form, setForm] = useState<FormState>(emptyForm)

  useEffect(() => { load() }, [])

  async function load() {
    const [t, w, c] = await Promise.all([
      supabase.from('transactions').select('*, categories(*), wallets(*)').order('date', { ascending: false }).order('created_at', { ascending: false }).limit(300),
      supabase.from('wallets').select('*').eq('is_active', true),
      supabase.from('categories').select('*').order('name'),
    ])
    setTransactions(t.data || [])
    setWallets(w.data || [])
    setCategories(c.data || [])
  }

  function openAdd() {
    setEditing(null)
    setForm(emptyForm)
    setShowAdd(true)
  }

  function openEdit(tx: Transaction) {
    setEditing(tx)
    setForm({
      wallet_id: tx.wallet_id,
      category_id: tx.category_id || '',
      type: tx.type,
      amount: String(tx.amount),
      description: tx.description || '',
      date: tx.date,
    })
    setShowAdd(true)
  }

  // Check if selected category is investment-related
  function isInvestmentCategory(catId: string): boolean {
    const cat = categories.find(c => c.id === catId)
    if (!cat) return false
    const name = cat.name.toLowerCase()
    return name.includes('invest') || name.includes('saham') || name.includes('reksa') || name.includes('obligasi') || name.includes('crypto')
  }

  // Auto-create or update asset when investment expense is added
  async function handleInvestmentAutoLink(session: any, amount: number, description: string, date: string) {
    const catName = categories.find(c => c.id === form.category_id)?.name || 'Investasi'
    const assetName = description || catName

    // Check if an asset with this name already exists (non-ticker based)
    const { data: existing } = await supabase
      .from('assets')
      .select('id, value')
      .eq('user_id', session.user.id)
      .eq('name', assetName)
      .eq('type', 'investment')
      .is('ticker', null)
      .maybeSingle()

    if (existing) {
      // Update existing asset value
      await supabase.from('assets').update({
        value: Number(existing.value) + amount,
        updated_at: new Date().toISOString(),
      }).eq('id', existing.id)
      toast(`Aset "${assetName}" diperbarui +${new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(amount)}`, '📈')
    } else {
      // Create new asset
      await supabase.from('assets').insert({
        user_id: session.user.id,
        name: assetName,
        type: 'investment',
        value: amount,
        purchase_date: date,
        description: `Auto dari transaksi ${catName}`,
        ticker: null,
        qty: 0,
        avg_price: 0,
        current_price: 0,
      })
      toast(`Aset "${assetName}" otomatis ditambahkan!`, '🏦')
    }
  }

  async function saveTransaction() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return
    const amount = Number(form.amount)
    if (!amount || !form.wallet_id) { toast('Lengkapi data!', '⚠️'); return }

    const isInvest = form.type === 'expense' && form.category_id && isInvestmentCategory(form.category_id)

    if (editing) {
      const { error } = await supabase.from('transactions').update({
        wallet_id: form.wallet_id,
        category_id: form.category_id || null,
        type: form.type,
        amount,
        description: form.description || null,
        date: form.date,
      }).eq('id', editing.id)
      if (error) { toast(error.message, '❌'); return }
      toast('Transaksi diperbarui!', '✅')
    } else {
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

      // Auto-link to assets if investment category
      if (isInvest) {
        await handleInvestmentAutoLink(session, amount, form.description, form.date)
      }
    }

    setShowAdd(false)
    setEditing(null)
    setForm(emptyForm)
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

  const totalIncome = useMemo(() => filtered.filter(t => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0), [filtered])
  const totalExpense = useMemo(() => filtered.filter(t => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0), [filtered])

  return (
    <AppShell>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-extrabold text-surface-900">Transaksi</h1>
          <p className="text-sm text-surface-400">{transactions.length} transaksi</p>
        </div>
        <button onClick={openAdd} className="btn btn-primary">+ Tambah</button>
      </div>

      {/* Summary bar */}
      {(filterType || filterCat || search) && (
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="card p-3 flex items-center gap-2">
            <span className="text-green-500 font-bold text-xs uppercase">Pemasukan</span>
            <span className="font-mono font-bold text-green-600 ml-auto">{formatCurrency(totalIncome)}</span>
          </div>
          <div className="card p-3 flex items-center gap-2">
            <span className="text-red-500 font-bold text-xs uppercase">Pengeluaran</span>
            <span className="font-mono font-bold text-red-500 ml-auto">{formatCurrency(totalExpense)}</span>
          </div>
        </div>
      )}

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
              <div key={tx.id} className="flex items-center gap-3 p-4 hover:bg-surface-50 transition-colors group">
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
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity ml-1">
                  <button onClick={() => openEdit(tx)} className="w-7 h-7 rounded-lg hover:bg-brand-50 hover:text-brand-600 flex items-center justify-center text-surface-400 text-xs transition-colors">✏️</button>
                  <button onClick={() => deleteTx(tx.id)} className="w-7 h-7 rounded-lg hover:bg-red-50 hover:text-red-500 flex items-center justify-center text-surface-400 text-xs transition-colors">✕</button>
                </div>
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

      {/* Add/Edit Transaction Modal */}
      <Modal open={showAdd} onClose={() => { setShowAdd(false); setEditing(null) }} title={editing ? 'Edit Transaksi' : 'Tambah Transaksi'}>
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
          {/* Auto-link indicator */}
          {!editing && form.type === 'expense' && form.category_id && isInvestmentCategory(form.category_id) && (
            <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800">
              <span className="text-base">📈</span>
              <span>Transaksi ini akan <strong>otomatis tercatat di Aset Investasi</strong> dengan nama "{form.description || categories.find(c => c.id === form.category_id)?.name}".</span>
            </div>
          )}
          <div className="flex gap-2">
            {editing && (
              <button onClick={() => { deleteTx(editing.id); setShowAdd(false) }} className="btn btn-danger flex-1">Hapus</button>
            )}
            <button onClick={saveTransaction} className="btn btn-primary flex-1">{editing ? 'Simpan Perubahan' : 'Simpan'}</button>
          </div>
        </div>
      </Modal>
    </AppShell>
  )
}
