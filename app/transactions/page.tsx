'use client'
import { useEffect, useState, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import type { Transaction, Wallet, Category } from '@/lib/supabase'
import { formatCurrency, formatDate } from '@/lib/utils'
import AppShell from '@/components/AppShell'
import Modal from '@/components/Modal'
import { toast } from '@/components/Toast'

type FormState = {
  wallet_id: string; category_id: string; type: 'income' | 'expense'
  amount: string; description: string; date: string
}
const emptyForm: FormState = {
  wallet_id: '', category_id: '', type: 'expense', amount: '',
  description: '', date: new Date().toISOString().split('T')[0],
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
  const [showFilters, setShowFilters] = useState(false)
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

  // ── Helper: ambil saldo wallet fresh dari DB ──────────────
  async function getFreshWallet(walletId: string): Promise<Wallet | null> {
    const { data } = await supabase.from('wallets').select('*').eq('id', walletId).single()
    return data || null
  }

  // ── Helper: adjust balance wallet ────────────────────────
  // delta positif = tambah, negatif = kurangi
  async function adjustBalance(walletId: string, delta: number) {
    const wallet = await getFreshWallet(walletId)
    if (!wallet) return
    await supabase.from('wallets').update({ balance: Number(wallet.balance) + delta }).eq('id', walletId)
  }

  function isInvestmentCategory(catId: string): boolean {
    const cat = categories.find(c => c.id === catId)
    if (!cat) return false
    const name = cat.name.toLowerCase()
    return name.includes('invest') || name.includes('saham') || name.includes('reksa') || name.includes('obligasi') || name.includes('crypto')
  }

  async function handleInvestmentAutoLink(session: any, amount: number, description: string, date: string) {
    const catName = categories.find(c => c.id === form.category_id)?.name || 'Investasi'
    const assetName = description || catName
    const { data: existing } = await supabase.from('assets').select('id, value').eq('user_id', session.user.id).eq('name', assetName).eq('type', 'investment').is('ticker', null).maybeSingle()
    if (existing) {
      await supabase.from('assets').update({ value: Number(existing.value) + amount }).eq('id', existing.id)
      toast(`Aset "${assetName}" +${formatCurrency(amount)}`, '📈')
    } else {
      await supabase.from('assets').insert({ user_id: session.user.id, name: assetName, type: 'investment', value: amount, purchase_date: date, description: `Auto dari transaksi ${catName}`, ticker: null, qty: 0, avg_price: 0, current_price: 0 })
      toast(`Aset "${assetName}" otomatis ditambahkan!`, '🏦')
    }
  }

  function openAdd() { setEditing(null); setForm(emptyForm); setShowAdd(true) }
  function openEdit(tx: Transaction) {
    setEditing(tx)
    setForm({ wallet_id: tx.wallet_id, category_id: tx.category_id || '', type: tx.type, amount: String(tx.amount), description: tx.description || '', date: tx.date })
    setShowAdd(true)
  }

  async function saveTransaction() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return
    const amount = Number(form.amount)
    if (!amount || !form.wallet_id) { toast('Lengkapi data!', '⚠️'); return }
    const isInvest = form.type === 'expense' && form.category_id && isInvestmentCategory(form.category_id)

    if (editing) {
      // Cek apakah ini transaksi dari debt — kalau iya, skip wallet adjustment
      // karena sudah dihandle di debt page
      const isDebtTx = !!(editing as any).debt_id

      if (!isDebtTx) {
        // 1. Reverse balance wallet LAMA
        //    income lama → kurangi, expense lama → tambah
        const oldDelta = editing.type === 'income' ? -Number(editing.amount) : Number(editing.amount)
        await adjustBalance(editing.wallet_id, oldDelta)

        // 2. Apply balance wallet BARU
        //    income baru → tambah, expense baru → kurangi
        const newDelta = form.type === 'income' ? amount : -amount
        await adjustBalance(form.wallet_id, newDelta)
      }

      const { error } = await supabase.from('transactions').update({
        wallet_id: form.wallet_id, category_id: form.category_id || null,
        type: form.type, amount, description: form.description || null, date: form.date
      }).eq('id', editing.id)
      if (error) { toast(error.message, '❌'); return }
      toast('Transaksi diperbarui!', '✅')
    } else {
      // ADD — insert transaksi dan adjust balance
      const { error } = await supabase.from('transactions').insert({
        user_id: session.user.id, wallet_id: form.wallet_id,
        category_id: form.category_id || null, type: form.type,
        amount, description: form.description || null, date: form.date,
      })
      if (error) { toast(error.message, '❌'); return }

      // Adjust wallet balance
      const delta = form.type === 'income' ? amount : -amount
      await adjustBalance(form.wallet_id, delta)

      toast(form.type === 'income' ? 'Pemasukan ditambahkan! 💰' : 'Pengeluaran ditambahkan! 💸')
      if (isInvest) await handleInvestmentAutoLink(session, amount, form.description, form.date)
    }
    setShowAdd(false); setEditing(null); setForm(emptyForm); load()
  }

  async function deleteTx(id: string) {
    if (!confirm('Hapus transaksi ini?')) return

    // Ambil data transaksi yang akan dihapus
    const tx = transactions.find(t => t.id === id)
    if (tx) {
      const isDebtTx = !!(tx as any).debt_id
      if (!isDebtTx) {
        // Reverse balance: income → kurangi, expense → tambah
        const delta = tx.type === 'income' ? -Number(tx.amount) : Number(tx.amount)
        await adjustBalance(tx.wallet_id, delta)
      }
    }

    await supabase.from('transactions').delete().eq('id', id)
    toast('Transaksi dihapus', '🗑️'); load()
  }

  const filtered = useMemo(() => transactions.filter(t => {
    if (filterType && t.type !== filterType) return false
    if (filterCat && t.category_id !== filterCat) return false
    if (search) {
      const q = search.toLowerCase()
      return t.description?.toLowerCase().includes(q) || t.categories?.name?.toLowerCase().includes(q) || t.wallets?.name?.toLowerCase().includes(q)
    }
    return true
  }), [transactions, search, filterType, filterCat])

  const filteredCats = categories.filter(c => !form.type || c.type === form.type)
  const totalIncome = useMemo(() => filtered.filter(t => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0), [filtered])
  const totalExpense = useMemo(() => filtered.filter(t => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0), [filtered])
  const hasFilters = !!(filterType || filterCat || search)

  return (
    <AppShell>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-extrabold text-surface-900">Transaksi</h1>
          <p className="text-xs text-surface-400">{transactions.length} transaksi</p>
        </div>
        <button onClick={openAdd} className="btn btn-primary py-2.5 px-4 text-sm">+ Tambah</button>
      </div>

      {/* Search + filter toggle */}
      <div className="flex gap-2 mb-3">
        <input
          className="input flex-1 text-sm"
          placeholder="🔍 Cari transaksi..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={`btn min-w-0 px-3 ${(filterType || filterCat) ? 'btn-primary' : 'btn-secondary'}`}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4h18M6 8h12M9 12h6" />
          </svg>
          {(filterType || filterCat) && <span className="text-xs">•</span>}
        </button>
      </div>

      {/* Collapsible filters */}
      {showFilters && (
        <div className="card p-3 mb-3 flex flex-col sm:flex-row gap-2">
          <select className="input flex-1 text-sm" value={filterType} onChange={(e) => setFilterType(e.target.value)}>
            <option value="">Semua Tipe</option>
            <option value="income">Pemasukan</option>
            <option value="expense">Pengeluaran</option>
          </select>
          <select className="input flex-1 text-sm" value={filterCat} onChange={(e) => setFilterCat(e.target.value)}>
            <option value="">Semua Kategori</option>
            {categories.map(c => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
          </select>
          {hasFilters && (
            <button onClick={() => { setFilterType(''); setFilterCat(''); setSearch('') }} className="btn btn-secondary text-xs">Reset</button>
          )}
        </div>
      )}

      {/* Summary bar when filtered */}
      {hasFilters && (
        <div className="grid grid-cols-2 gap-2 mb-3">
          <div className="card p-3 flex items-center justify-between">
            <span className="text-xs text-green-600 font-bold">Masuk</span>
            <span className="font-mono font-bold text-sm text-green-600">{new Intl.NumberFormat('id-ID', { notation: 'compact', style: 'currency', currency: 'IDR', maximumFractionDigits: 1 }).format(totalIncome)}</span>
          </div>
          <div className="card p-3 flex items-center justify-between">
            <span className="text-xs text-red-500 font-bold">Keluar</span>
            <span className="font-mono font-bold text-sm text-red-500">{new Intl.NumberFormat('id-ID', { notation: 'compact', style: 'currency', currency: 'IDR', maximumFractionDigits: 1 }).format(totalExpense)}</span>
          </div>
        </div>
      )}

      {/* Transactions List */}
      <div className="card overflow-hidden">
        {filtered.length > 0 ? (
          <div className="divide-y divide-surface-100">
            {filtered.map((tx) => (
              <div key={tx.id} className="flex items-center gap-3 px-4 py-3.5 active:bg-surface-50 transition-colors" onClick={() => openEdit(tx)}>
                <div className="w-10 h-10 rounded-xl flex items-center justify-center text-lg flex-shrink-0" style={{ background: tx.type === 'income' ? '#dcfce7' : '#fee2e2' }}>
                  {tx.categories?.icon || (tx.type === 'income' ? '💰' : '💸')}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-surface-800 truncate">{tx.description || tx.categories?.name || 'Transaksi'}</p>
                  <p className="text-[10px] text-surface-400 truncate">
                    {formatDate(tx.date)} · {tx.wallets?.name}
                    {/* Tampilkan badge kalau ini transaksi dari debt */}
                    {(tx as any).debt_id && <span className="ml-1 bg-surface-100 text-surface-500 px-1.5 rounded text-[9px]">🤝 Utang/Piutang</span>}
                  </p>
                </div>
                <p className={`text-sm font-bold font-mono flex-shrink-0 ${tx.type === 'income' ? 'text-green-600' : 'text-red-500'}`}>
                  {tx.type === 'income' ? '+' : '-'}{new Intl.NumberFormat('id-ID', { notation: 'compact', style: 'currency', currency: 'IDR', maximumFractionDigits: 1 }).format(Number(tx.amount))}
                </p>
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

      {/* Add/Edit Modal */}
      <Modal open={showAdd} onClose={() => { setShowAdd(false); setEditing(null) }} title={editing ? 'Edit Transaksi' : 'Tambah Transaksi'}>
        <div className="space-y-4">
          {/* Warning kalau transaksi dari debt */}
          {editing && (editing as any).debt_id && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800 flex gap-2">
              <span>⚠️</span>
              <span>Transaksi ini terhubung ke catatan utang/piutang. Perubahan wallet tidak akan mempengaruhi saldo — ubah langsung dari halaman Utang & Piutang.</span>
            </div>
          )}
          <div>
            <label className="label">Tipe</label>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setForm({ ...form, type: 'expense', category_id: '' })} className={`btn ${form.type === 'expense' ? 'bg-red-50 text-red-700 border-red-200 border' : 'btn-secondary'}`}>💸 Pengeluaran</button>
              <button onClick={() => setForm({ ...form, type: 'income', category_id: '' })} className={`btn ${form.type === 'income' ? 'bg-green-50 text-green-700 border-green-200 border' : 'btn-secondary'}`}>💰 Pemasukan</button>
            </div>
          </div>
          <div>
            <label className="label">Jumlah</label>
            <input className="input text-xl font-bold" type="number" inputMode="numeric" placeholder="0" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
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
          {!editing && form.type === 'expense' && form.category_id && isInvestmentCategory(form.category_id) && (
            <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800">
              <span>📈</span>
              <span>Akan <strong>otomatis tercatat di Aset</strong> dengan nama "{form.description || categories.find(c => c.id === form.category_id)?.name}".</span>
            </div>
          )}
          <div className="flex gap-2 pt-1">
            {editing && <button onClick={() => { deleteTx(editing.id); setShowAdd(false) }} className="btn btn-danger flex-1">Hapus</button>}
            <button onClick={saveTransaction} className="btn btn-primary flex-1">{editing ? 'Simpan' : 'Tambah'}</button>
          </div>
        </div>
      </Modal>
    </AppShell>
  )
}
