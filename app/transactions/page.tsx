'use client'
import { useEffect, useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import type { Transaction, Wallet, Category } from '@/lib/supabase'
import { formatCurrency, formatDate } from '@/lib/utils'
import AppShell from '@/components/AppShell'
import Modal from '@/components/Modal'
import { toast } from '@/components/Toast'

type Trip = {
  id: string
  name: string
  emoji: string
  start_date: string
  end_date: string | null
}

type FormState = {
  wallet_id: string
  category_id: string
  subcategory_id: string
  type: 'income' | 'expense'
  amount: string
  description: string
  date: string
  is_reimbursable: boolean
  trip_id: string
}

const emptyForm: FormState = {
  wallet_id: '', category_id: '', subcategory_id: '', type: 'expense', amount: '',
  description: '', date: new Date().toISOString().split('T')[0],
  is_reimbursable: false,
  trip_id: '',
}

type ViewTab = 'personal' | 'kantor' | 'reimburse'

export default function TransactionsPage() {
  const router = useRouter()
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [wallets, setWallets] = useState<Wallet[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [trips, setTrips] = useState<Trip[]>([])
  const [showAdd, setShowAdd] = useState(false)
  const [editing, setEditing] = useState<Transaction | null>(null)
  const [reimburseTarget, setReimburseTarget] = useState<Transaction | null>(null)
  const [reimburseForm, setReimburseForm] = useState({ wallet_id: '', date: new Date().toISOString().split('T')[0] })
  const [search, setSearch] = useState('')
  const [filterType, setFilterType] = useState('')
  const [filterCat, setFilterCat] = useState('')
  const [filterWallet, setFilterWallet] = useState('')
  const [filterDateFrom, setFilterDateFrom] = useState('')
  const [filterDateTo, setFilterDateTo] = useState('')
  const [showFilters, setShowFilters] = useState(false)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [activeTab, setActiveTab] = useState<ViewTab>('personal')

  useEffect(() => { load() }, [])

  async function load() {
    const { data: { session } } = await supabase.auth.getSession()
    const [t, w, c, tr] = await Promise.all([
      supabase.from('transactions')
        .select('*, categories(*), wallets(*), subcategories:subcategory_id(id,name,icon,color)')
        .order('date', { ascending: false }).order('created_at', { ascending: false }).limit(300),
      supabase.from('wallets').select('*').eq('is_active', true),
      supabase.from('categories').select('*').order('name'),
      session
        ? supabase.from('trips').select('id, name, emoji, start_date, end_date').eq('user_id', session.user.id).order('start_date', { ascending: false })
        : Promise.resolve({ data: [] }),
    ])
    setTransactions((t.data) || [])
    setWallets((w.data) || [])
    setCategories((c.data) || [])
    setTrips((tr as any).data || [])
  }

  // ── Helpers ───────────────────────────────────────────────
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

  // ── Subcategory helpers ───────────────────────────────────
  // Parents = categories with no parent_id
  const parentCategories = useMemo(() =>
    categories.filter(c => !(c as any).parent_id),
    [categories]
  )

  // Subs of selected parent
  const subcategories = useMemo(() =>
    categories.filter(c => (c as any).parent_id === form.category_id),
    [categories, form.category_id]
  )

  const hasSubs = subcategories.length > 0

  // Tab switch helper
  function switchTab(tab: ViewTab) {
    setActiveTab(tab)
    setFilterWallet('')
    setFilterCat('')
    setFilterType('')
    setFilterDateFrom('')
    setFilterDateTo('')
    setSearch('')
  }

  // ── CRUD ──────────────────────────────────────────────────
  function openAdd() {
    setEditing(null)
    const kantorWallet = wallets.find(w => w.pocket === 'kantor')
    setForm({
      ...emptyForm,
      wallet_id: activeTab === 'kantor' && kantorWallet ? kantorWallet.id : '',
    })
    setShowAdd(true)
  }

  function openEdit(tx: Transaction) {
    setEditing(tx)
    setForm({
      wallet_id: tx.wallet_id,
      category_id: tx.category_id || '',
      subcategory_id: (tx as any).subcategory_id || '',
      type: tx.type,
      amount: String(tx.amount),
      description: tx.description || '',
      date: tx.date,
      is_reimbursable: (tx as any).is_reimbursable || false,
      trip_id: (tx as any).trip_id || '',
    })
    setShowAdd(true)
  }

  async function saveTransaction() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return
    const amount = Number(form.amount)
    if (!amount || !form.wallet_id) { toast('Lengkapi data!', '⚠️'); return }

    // Validasi subcategory wajib jika ada sub
    if (hasSubs && !form.subcategory_id) {
      toast('Pilih subkategori terlebih dahulu!', '⚠️'); return
    }

    const isInvest = form.type === 'expense' && form.category_id && isInvestmentCategory(form.category_id)
    const selectedWallet = wallets.find(w => w.id === form.wallet_id)
    const isKantor = selectedWallet?.pocket === 'kantor'
    const reimbursable = !isKantor && (form as any).is_reimbursable
    const tripId = (!isKantor && form.trip_id) ? form.trip_id : null

    if (editing) {
      const { error: delError } = await supabase.from('transactions').delete().eq('id', editing.id)
      if (delError) { toast(delError.message, '❌'); return }
      const { error: insError } = await supabase.from('transactions').insert({
        user_id: session.user.id,
        wallet_id: form.wallet_id,
        category_id: form.category_id || null,
        subcategory_id: form.subcategory_id || null,
        type: form.type,
        amount,
        description: form.description || null,
        date: form.date,
        is_reimbursable: reimbursable,
        reimbursed_at: (editing as any).reimbursed_at || null,
        trip_id: tripId,
        ...((editing as any).debt_id ? { debt_id: (editing as any).debt_id } : {}),
      })
      if (insError) { toast(insError.message, '❌'); return }
      toast('Transaksi diperbarui!', '✅')
    } else {
      const { error } = await supabase.from('transactions').insert({
        user_id: session.user.id,
        wallet_id: form.wallet_id,
        category_id: form.category_id || null,
        subcategory_id: form.subcategory_id || null,
        type: form.type,
        amount,
        description: form.description || null,
        date: form.date,
        is_reimbursable: reimbursable,
        trip_id: tripId,
      })
      if (error) { toast(error.message, '❌'); return }
      toast(isKantor ? 'Transaksi kas kantor dicatat! 🏢' : form.type === 'income' ? 'Pemasukan ditambahkan! 💰' : 'Pengeluaran ditambahkan! 💸')
      if (isInvest) await handleInvestmentAutoLink(session, amount, form.description, form.date)
    }
    setShowAdd(false); setEditing(null); setForm(emptyForm); load()
  }

  async function deleteTx(id: string) {
    if (!confirm('Hapus transaksi ini?')) return
    await supabase.from('transactions').delete().eq('id', id)
    toast('Transaksi dihapus', '🗑️'); load()
  }

  function openReimburseModal(tx: Transaction) {
    if (!!(tx as any).reimbursed_at) { undoReimburse(tx); return }
    setReimburseTarget(tx)
    setReimburseForm({ wallet_id: '', date: new Date().toISOString().split('T')[0] })
  }

  async function undoReimburse(tx: Transaction) {
    await supabase.from('transactions').update({ reimbursed_at: null }).eq('id', tx.id)
    toast('Ditandai belum direimburse', '🔄')
    load()
  }

  async function confirmReimburse() {
    if (!reimburseTarget) return
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return
    if (!reimburseForm.wallet_id) { toast('Pilih wallet tujuan dulu!', '⚠️'); return }
    const tx = reimburseTarget
    const amount = Number(tx.amount)
    const desc = tx.description || (tx as any).categories?.name || 'Transaksi'
    const { error: updateErr } = await supabase.from('transactions').update({ reimbursed_at: new Date().toISOString() }).eq('id', tx.id)
    if (updateErr) { toast(updateErr.message, '❌'); return }
    const { error: insertErr } = await supabase.from('transactions').insert({
      user_id: session.user.id,
      wallet_id: reimburseForm.wallet_id,
      type: 'income',
      amount,
      description: `Reimburse: ${desc}`,
      date: reimburseForm.date,
      category_id: null,
      is_reimbursable: false,
    })
    if (insertErr) { toast(insertErr.message, '❌'); return }
    toast('✅ Reimburse dicatat & masuk ke wallet!', '💰')
    setReimburseTarget(null)
    load()
  }

  // ── Computed ──────────────────────────────────────────────
  const personalTxs = useMemo(() => transactions.filter(t => (t as any).wallets?.pocket !== 'kantor'), [transactions])
  const kantorTxs = useMemo(() => transactions.filter(t => (t as any).wallets?.pocket === 'kantor'), [transactions])
  const reimburseTxs = useMemo(() => transactions.filter(t =>
    (t as any).is_reimbursable && (t as any).wallets?.pocket !== 'kantor'
  ), [transactions])

  const pendingReimburse = reimburseTxs.filter(t => !(t as any).reimbursed_at)
  const totalPendingReimburse = pendingReimburse.reduce((s, t) => s + Number(t.amount), 0)

  const baseTxs = activeTab === 'kantor' ? kantorTxs : activeTab === 'reimburse' ? reimburseTxs : personalTxs

  const walletOptions = useMemo(() => {
    if (activeTab === 'kantor') return wallets.filter(w => w.pocket === 'kantor')
    if (activeTab === 'personal') return wallets.filter(w => w.pocket !== 'kantor')
    return wallets
  }, [activeTab, wallets])

  const hasFilters = !!(filterType || filterCat || search || filterWallet || filterDateFrom || filterDateTo)
  const activeFilterCount = [filterType, filterCat, filterWallet, filterDateFrom || filterDateTo].filter(Boolean).length

  const filtered = useMemo(() => baseTxs.filter(t => {
    if (filterType && t.type !== filterType) return false
    if (filterCat && t.category_id !== filterCat) return false
    if (filterWallet && t.wallet_id !== filterWallet) return false
    if (filterDateFrom && t.date < filterDateFrom) return false
    if (filterDateTo && t.date > filterDateTo) return false
    if (search) {
      const q = search.toLowerCase()
      return t.description?.toLowerCase().includes(q) ||
        (t as any).categories?.name?.toLowerCase().includes(q) ||
        (t as any).wallets?.name?.toLowerCase().includes(q) ||
        (t as any).subcategories?.name?.toLowerCase().includes(q)
    }
    return true
  }), [baseTxs, search, filterType, filterCat, filterWallet, filterDateFrom, filterDateTo])

  // For filter dropdown: only show parent categories
  const filterParentCats = useMemo(() =>
    categories.filter(c => !(c as any).parent_id && c.type !== 'income'),
    [categories]
  )

  const totalIncome = useMemo(() => filtered.filter(t => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0), [filtered])
  const totalExpense = useMemo(() => filtered.filter(t => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0), [filtered])

  const personalIncome = useMemo(() => personalTxs.filter(t => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0), [personalTxs])
  const personalExpense = useMemo(() => personalTxs.filter(t => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0), [personalTxs])
  const kantorIncome = useMemo(() => kantorTxs.filter(t => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0), [kantorTxs])
  const kantorExpense = useMemo(() => kantorTxs.filter(t => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0), [kantorTxs])

  const kantorWallets = wallets.filter(w => w.pocket === 'kantor')
  const selectedWalletPocket = wallets.find(w => w.id === form.wallet_id)?.pocket

  // Filter cats for form — only parents (picker handles subs)
  const filteredParentCats = useMemo(() =>
    parentCategories.filter(c => !form.type || c.type === form.type),
    [parentCategories, form.type]
  )

  function getTripBadge(tx: Transaction) {
    const tripId = (tx as any).trip_id
    if (!tripId) return null
    const trip = trips.find(t => t.id === tripId)
    return trip ? `${trip.emoji} ${trip.name}` : null
  }

  function resetFilters() {
    setFilterType(''); setFilterCat(''); setFilterWallet('')
    setFilterDateFrom(''); setFilterDateTo(''); setSearch('')
  }

  return (
    <AppShell>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-extrabold text-surface-900">Transaksi</h1>
          <p className="text-xs text-surface-400">{personalTxs.length} pribadi · {kantorTxs.length} kantor</p>
        </div>
        <button onClick={openAdd} className="btn btn-primary py-2.5 px-4 text-sm">+ Tambah</button>
      </div>

      {/* Trip shortcut */}
      <button
        onClick={() => router.push('/trips')}
        className="w-full card p-3 mb-3 flex items-center gap-3 active:bg-surface-50 transition-colors text-left"
      >
        <div className="w-9 h-9 rounded-xl bg-blue-50 flex items-center justify-center text-lg flex-shrink-0">🧳</div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-surface-800">Trip & Healing</p>
          <p className="text-[10px] text-surface-400">Lihat rekap pengeluaran per trip</p>
        </div>
        <span className="text-surface-300 text-sm">→</span>
      </button>

      {/* Reimburse alert */}
      {pendingReimburse.length > 0 && (
        <div className="card p-3 mb-4 bg-amber-50 border border-amber-200 flex items-center gap-3 cursor-pointer" onClick={() => switchTab('reimburse')}>
          <span className="text-xl">🏢</span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-amber-800">{pendingReimburse.length} transaksi belum direimburse</p>
            <p className="text-xs text-amber-600">Total: {formatCurrency(totalPendingReimburse)}</p>
          </div>
          <span className="text-amber-500 text-xs font-bold">Lihat →</span>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1.5 mb-4 bg-surface-100 p-1 rounded-xl">
        {(['personal', 'kantor', 'reimburse'] as ViewTab[]).map(t => (
          <button key={t} onClick={() => switchTab(t)}
            className={`flex-1 text-xs font-bold py-2 rounded-lg transition-all relative ${activeTab === t ? 'bg-white text-surface-900 shadow-sm' : 'text-surface-500'}`}>
            {t === 'personal' ? '👤 Pribadi' : t === 'kantor' ? '🏢 Kas Kantor' : '💼 Reimburse'}
            {t === 'reimburse' && pendingReimburse.length > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 bg-amber-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center">{pendingReimburse.length}</span>
            )}
          </button>
        ))}
      </div>

      {/* Summary cards */}
      {activeTab === 'personal' && (
        <div className="grid grid-cols-2 gap-2 mb-4">
          <div className="card p-3"><p className="text-[10px] font-bold text-green-600 uppercase mb-1">Pemasukan</p><p className="text-base font-extrabold text-green-600 font-mono">{formatCurrency(personalIncome)}</p></div>
          <div className="card p-3"><p className="text-[10px] font-bold text-red-500 uppercase mb-1">Pengeluaran</p><p className="text-base font-extrabold text-red-500 font-mono">{formatCurrency(personalExpense)}</p></div>
        </div>
      )}
      {activeTab === 'kantor' && (
        <div className="grid grid-cols-2 gap-2 mb-4">
          <div className="card p-3"><p className="text-[10px] font-bold text-green-600 uppercase mb-1">Pemasukan Kantor</p><p className="text-base font-extrabold text-green-600 font-mono">{formatCurrency(kantorIncome)}</p></div>
          <div className="card p-3"><p className="text-[10px] font-bold text-purple-600 uppercase mb-1">Pengeluaran Kantor</p><p className="text-base font-extrabold text-purple-600 font-mono">{formatCurrency(kantorExpense)}</p></div>
        </div>
      )}

      {/* Search & Filter */}
      <div className="flex gap-2 mb-3">
        <input
          className="input flex-1 text-sm"
          placeholder="Cari transaksi..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={`btn text-sm relative ${showFilters ? 'btn-primary' : 'btn-secondary'}`}
        >
          🔽{activeFilterCount > 0 && <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white text-[9px] rounded-full flex items-center justify-center">{activeFilterCount}</span>}
        </button>
      </div>

      {showFilters && (
        <div className="card p-4 mb-3 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <select className="input text-sm" value={filterType} onChange={e => setFilterType(e.target.value)}>
              <option value="">Semua tipe</option>
              <option value="expense">Pengeluaran</option>
              <option value="income">Pemasukan</option>
            </select>
            <select className="input text-sm" value={filterCat} onChange={e => setFilterCat(e.target.value)}>
              <option value="">Semua kategori</option>
              {filterParentCats.map(c => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
            </select>
            <select className="input text-sm" value={filterWallet} onChange={e => setFilterWallet(e.target.value)}>
              <option value="">Semua dompet</option>
              {walletOptions.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input className="input text-sm" type="date" value={filterDateFrom} onChange={e => setFilterDateFrom(e.target.value)} placeholder="Dari" />
            <input className="input text-sm" type="date" value={filterDateTo} onChange={e => setFilterDateTo(e.target.value)} placeholder="Sampai" />
          </div>
          {hasFilters && <button onClick={resetFilters} className="text-xs text-red-500 font-bold">✕ Reset filter</button>}
        </div>
      )}

      {/* Transaction list */}
      <div className="space-y-2">
        {filtered.length > 0 ? filtered.map(tx => {
          const sub = (tx as any).subcategories
          const tripBadge = getTripBadge(tx)
          const isReimb = (tx as any).is_reimbursable
          const isDone = !!(tx as any).reimbursed_at
          return (
            <div key={tx.id} className="card p-4 flex items-center gap-3 group active:bg-surface-50 transition-colors cursor-pointer" onClick={() => openEdit(tx)}>
              <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl flex-shrink-0"
                style={{ background: ((tx as any).categories?.color || '#64748b') + '22' }}>
                {(tx as any).categories?.icon || (tx.type === 'income' ? '💰' : '💸')}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-surface-800 truncate">
                  {tx.description || (tx as any).categories?.name || (tx.type === 'income' ? 'Pemasukan' : 'Pengeluaran')}
                </p>
                <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                  {/* Category + subcategory */}
                  {(tx as any).categories?.name && (
                    <span className="text-[10px] text-surface-400">
                      {(tx as any).categories.name}
                      {sub?.name && <span className="text-surface-300"> › {sub.icon} {sub.name}</span>}
                    </span>
                  )}
                  {tripBadge && <span className="text-[9px] bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded-full font-medium">{tripBadge}</span>}
                  {isReimb && <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold ${isDone ? 'bg-green-50 text-green-600' : 'bg-amber-50 text-amber-600'}`}>{isDone ? '✅ Reimburse' : '⏳ Belum reimburse'}</span>}
                </div>
                <p className="text-[10px] text-surface-400 mt-0.5">{formatDate(tx.date)} · {(tx as any).wallets?.name}</p>
              </div>
              <div className="text-right flex-shrink-0">
                <p className={`text-sm font-extrabold font-mono ${tx.type === 'income' ? 'text-green-600' : 'text-red-500'}`}>
                  {tx.type === 'income' ? '+' : '-'}{formatCurrency(Number(tx.amount))}
                </p>
                {isReimb && activeTab !== 'reimburse' && (
                  <button
                    onClick={e => { e.stopPropagation(); openReimburseModal(tx) }}
                    className="text-[9px] font-bold text-amber-600 hover:text-amber-700 mt-0.5 block"
                  >
                    {isDone ? 'Undo' : 'Reimburse'}
                  </button>
                )}
              </div>
            </div>
          )
        }) : (
          <div className="card text-center py-16 text-surface-300">
            <p className="text-4xl mb-2">📭</p>
            <p className="text-sm">
              {hasFilters ? 'Tidak ada transaksi yang cocok dengan filter' :
               activeTab === 'kantor' ? 'Belum ada transaksi kas kantor' :
               activeTab === 'reimburse' ? 'Tidak ada transaksi reimburse' :
               'Belum ada transaksi pribadi'}
            </p>
            {hasFilters && <button onClick={resetFilters} className="mt-3 text-xs text-blue-500 font-bold">Reset filter</button>}
          </div>
        )}
      </div>

      {/* Add/Edit Modal */}
      <Modal open={showAdd} onClose={() => { setShowAdd(false); setEditing(null) }} title={editing ? 'Edit Transaksi' : 'Tambah Transaksi'}>
        <div className="space-y-4">
          {editing && (editing as any).debt_id && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800 flex gap-2">
              <span>⚠️</span><span>Transaksi ini terhubung ke catatan utang/piutang.</span>
            </div>
          )}
          {selectedWalletPocket === 'kantor' && (
            <div className="p-3 bg-purple-50 border border-purple-200 rounded-xl text-xs text-purple-800 flex gap-2">
              <span>🏢</span><span>Transaksi ini tidak dihitung ke keuangan pribadi kamu.</span>
            </div>
          )}

          {/* Tipe */}
          <div>
            <label className="label">Tipe</label>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setForm({ ...form, type: 'expense', category_id: '', subcategory_id: '' })} className={`btn ${form.type === 'expense' ? 'bg-red-50 text-red-700 border-red-200 border' : 'btn-secondary'}`}>💸 Pengeluaran</button>
              <button onClick={() => setForm({ ...form, type: 'income', category_id: '', subcategory_id: '' })} className={`btn ${form.type === 'income' ? 'bg-green-50 text-green-700 border-green-200 border' : 'btn-secondary'}`}>💰 Pemasukan</button>
            </div>
          </div>

          {/* Jumlah */}
          <div>
            <label className="label">Jumlah</label>
            <input className="input text-xl font-bold" type="number" inputMode="numeric" placeholder="0" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} />
          </div>

          {/* Dompet */}
          <div>
            <label className="label">Dompet</label>
            <select className="input" value={form.wallet_id} onChange={e => setForm({ ...form, wallet_id: e.target.value, is_reimbursable: false })}>
              <option value="">Pilih dompet</option>
              {wallets.map(w => (
                <option key={w.id} value={w.id}>
                  {w.pocket === 'kantor' ? '🏢' : w.pocket === 'tabungan' ? '💰' : '👤'} {w.name}
                </option>
              ))}
            </select>
          </div>

          {/* Kategori — 2-level picker */}
          <div className="space-y-2">
            <div>
              <label className="label">Kategori</label>
              <select
                className="input"
                value={form.category_id}
                onChange={e => setForm({ ...form, category_id: e.target.value, subcategory_id: '' })}
              >
                <option value="">Pilih kategori</option>
                {filteredParentCats.map(c => (
                  <option key={c.id} value={c.id}>{c.icon} {c.name}</option>
                ))}
              </select>
            </div>

            {/* Subkategori — muncul setelah pilih parent */}
            {form.category_id && hasSubs && (
              <div>
                <label className="label">
                  Subkategori <span className="text-red-400">*</span>
                </label>
                <div className="grid grid-cols-2 gap-1.5 p-2 bg-surface-50 rounded-xl border border-surface-100">
                  {subcategories.map(sub => {
                    const parent = categories.find(c => c.id === form.category_id)
                    return (
                      <button
                        key={sub.id}
                        type="button"
                        onClick={() => setForm({ ...form, subcategory_id: sub.id })}
                        className={`flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium transition-all text-left
                          ${form.subcategory_id === sub.id
                            ? 'text-white shadow-sm'
                            : 'bg-white text-surface-600 hover:bg-surface-100 border border-surface-100'
                          }`}
                        style={form.subcategory_id === sub.id ? { background: parent?.color || '#3b82f6' } : {}}
                      >
                        <span className="text-base flex-shrink-0">{sub.icon}</span>
                        <span className="truncate text-xs leading-tight">{sub.name}</span>
                      </button>
                    )
                  })}
                </div>
                {!form.subcategory_id && (
                  <p className="text-xs text-red-400 mt-1">Pilih subkategori untuk melanjutkan</p>
                )}
              </div>
            )}
          </div>

          {/* Keterangan */}
          <div>
            <label className="label">Keterangan</label>
            <input className="input" placeholder="mis. Makan siang, Grab ke kantor..." value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
          </div>

          {/* Tanggal */}
          <div>
            <label className="label">Tanggal</label>
            <input className="input" type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} />
          </div>

          {/* Trip tag */}
          {selectedWalletPocket !== 'kantor' && trips.length > 0 && (
            <div>
              <label className="label">🧳 Tag ke Trip (opsional)</label>
              <select className="input" value={form.trip_id} onChange={e => setForm({ ...form, trip_id: e.target.value })}>
                <option value="">— Tidak terhubung trip —</option>
                {trips.map(t => (
                  <option key={t.id} value={t.id}>{t.emoji} {t.name} ({t.start_date}{t.end_date ? ` – ${t.end_date}` : ''})</option>
                ))}
              </select>
            </div>
          )}

          {/* Reimburse toggle */}
          {selectedWalletPocket && selectedWalletPocket !== 'kantor' && form.type === 'expense' && (
            <button
              onClick={() => setForm({ ...form, is_reimbursable: !(form as any).is_reimbursable })}
              className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-all text-left ${(form as any).is_reimbursable ? 'bg-amber-50 border-amber-300' : 'bg-surface-50 border-surface-200'}`}
            >
              <div className={`w-10 h-6 rounded-full transition-all flex-shrink-0 relative ${(form as any).is_reimbursable ? 'bg-amber-500' : 'bg-surface-300'}`}>
                <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${(form as any).is_reimbursable ? 'left-5' : 'left-1'}`} />
              </div>
              <div>
                <p className={`text-xs font-bold ${(form as any).is_reimbursable ? 'text-amber-800' : 'text-surface-600'}`}>🏢 Ini pengeluaran untuk keperluan kantor</p>
                <p className="text-[10px] text-surface-400 mt-0.5">Pakai dompet pribadi, nanti reimburse dari kantor</p>
              </div>
            </button>
          )}

          {/* Investasi auto-link notice */}
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

      {/* Reimburse Modal */}
      <Modal open={!!reimburseTarget} onClose={() => setReimburseTarget(null)} title="Konfirmasi Reimburse">
        {reimburseTarget && (
          <div className="space-y-4">
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl">
              <p className="text-xs text-amber-700 font-bold mb-0.5">Transaksi yang direimburse:</p>
              <p className="text-sm font-semibold text-surface-800">{reimburseTarget.description || (reimburseTarget as any).categories?.name || 'Transaksi'}</p>
              <p className="text-xs text-surface-500">{formatDate(reimburseTarget.date)} · {(reimburseTarget as any).wallets?.name}</p>
              <p className="text-lg font-extrabold text-amber-700 font-mono mt-1">{formatCurrency(Number(reimburseTarget.amount))}</p>
            </div>
            <div>
              <label className="label">Masuk ke wallet mana?</label>
              <select className="input" value={reimburseForm.wallet_id} onChange={e => setReimburseForm({ ...reimburseForm, wallet_id: e.target.value })}>
                <option value="">Pilih wallet</option>
                {wallets.filter(w => w.pocket !== 'kantor').map(w => (
                  <option key={w.id} value={w.id}>{w.pocket === 'tabungan' ? '💰' : '👤'} {w.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Tanggal diterima</label>
              <input className="input" type="date" value={reimburseForm.date} onChange={e => setReimburseForm({ ...reimburseForm, date: e.target.value })} />
            </div>
            <div className="p-3 bg-green-50 border border-green-200 rounded-xl text-xs text-green-800 flex gap-2">
              <span>💡</span>
              <span>Akan otomatis dibuat transaksi <strong>pemasukan {formatCurrency(Number(reimburseTarget.amount))}</strong>.</span>
            </div>
            <div className="flex gap-2 pt-1">
              <button onClick={() => setReimburseTarget(null)} className="btn btn-secondary flex-1">Batal</button>
              <button onClick={confirmReimburse} className="btn btn-primary flex-1">✅ Konfirmasi</button>
            </div>
          </div>
        )}
      </Modal>
    </AppShell>
  )
}
