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
  type: 'income' | 'expense'
  amount: string
  description: string
  date: string
  is_reimbursable: boolean
  trip_id: string
}

const emptyForm: FormState = {
  wallet_id: '', category_id: '', type: 'expense', amount: '',
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
      supabase.from('transactions').select('*, categories(*), wallets(*)').order('date', { ascending: false }).order('created_at', { ascending: false }).limit(300),
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
  function isKantorTx(tx: Transaction) {
    return (tx as any).wallets?.pocket === 'kantor'
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

  // ── Tab switch helper ─────────────────────────────────────
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
    const isInvest = form.type === 'expense' && form.category_id && isInvestmentCategory(form.category_id)
    const selectedWallet = wallets.find(w => w.id === form.wallet_id)
    const isKantor = selectedWallet?.pocket === 'kantor'
    const reimbursable = !isKantor && (form as any).is_reimbursable
    const tripId = (!isKantor && form.type === 'expense' && form.trip_id) ? form.trip_id : null

    if (editing) {
      const { error: delError } = await supabase.from('transactions').delete().eq('id', editing.id)
      if (delError) { toast(delError.message, '❌'); return }
      const { error: insError } = await supabase.from('transactions').insert({
        user_id: session.user.id,
        wallet_id: form.wallet_id,
        category_id: form.category_id || null,
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

  async function markReimbursed(tx: Transaction) {
    const already = !!(tx as any).reimbursed_at
    await supabase.from('transactions').update({
      reimbursed_at: already ? null : new Date().toISOString(),
    }).eq('id', tx.id)
    toast(already ? 'Ditandai belum direimburse' : '✅ Ditandai sudah direimburse!', already ? '🔄' : '✅')
    load()
  }

  // ── Computed ──────────────────────────────────────────────
  const personalTxs = useMemo(() => transactions.filter(t => (t as any).wallets?.pocket !== 'kantor'), [transactions])
  const kantorTxs = useMemo(() => transactions.filter(t => (t as any).wallets?.pocket === 'kantor'), [transactions])
  const reimburseTxs = useMemo(() => transactions.filter(t =>
    (t as any).is_reimbursable && (t as any).wallets?.pocket !== 'kantor'
  ), [transactions])

  const pendingReimburse = reimburseTxs.filter(t => !(t as any).reimbursed_at)
  const doneReimburse = reimburseTxs.filter(t => !!(t as any).reimbursed_at)
  const totalPendingReimburse = pendingReimburse.reduce((s, t) => s + Number(t.amount), 0)

  const baseTxs = activeTab === 'kantor' ? kantorTxs : activeTab === 'reimburse' ? reimburseTxs : personalTxs

  // Wallet options sesuai tab aktif
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
        (t as any).wallets?.name?.toLowerCase().includes(q)
    }
    return true
  }), [baseTxs, search, filterType, filterCat, filterWallet, filterDateFrom, filterDateTo])

  const filteredCats = categories.filter(c => !form.type || c.type === form.type)
  const totalIncome = useMemo(() => filtered.filter(t => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0), [filtered])
  const totalExpense = useMemo(() => filtered.filter(t => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0), [filtered])

  const personalIncome = useMemo(() => personalTxs.filter(t => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0), [personalTxs])
  const personalExpense = useMemo(() => personalTxs.filter(t => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0), [personalTxs])
  const kantorIncome = useMemo(() => kantorTxs.filter(t => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0), [kantorTxs])
  const kantorExpense = useMemo(() => kantorTxs.filter(t => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0), [kantorTxs])

  const kantorWallets = wallets.filter(w => w.pocket === 'kantor')
  const selectedWalletPocket = wallets.find(w => w.id === form.wallet_id)?.pocket

  function getTripBadge(tx: Transaction) {
    const tripId = (tx as any).trip_id
    if (!tripId) return null
    const trip = trips.find(t => t.id === tripId)
    return trip ? `${trip.emoji} ${trip.name}` : null
  }

  function resetFilters() {
    setFilterType('')
    setFilterCat('')
    setFilterWallet('')
    setFilterDateFrom('')
    setFilterDateTo('')
    setSearch('')
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
        <div
          className="card p-3 mb-4 bg-amber-50 border border-amber-200 flex items-center gap-3 cursor-pointer"
          onClick={() => switchTab('reimburse')}
        >
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
        <button
          onClick={() => switchTab('personal')}
          className={`flex-1 text-xs font-bold py-2 rounded-lg transition-all ${activeTab === 'personal' ? 'bg-white text-surface-900 shadow-sm' : 'text-surface-500'}`}
        >
          👤 Pribadi
        </button>
        <button
          onClick={() => switchTab('kantor')}
          className={`flex-1 text-xs font-bold py-2 rounded-lg transition-all ${activeTab === 'kantor' ? 'bg-white text-surface-900 shadow-sm' : 'text-surface-500'}`}
        >
          🏢 Kas Kantor
        </button>
        <button
          onClick={() => switchTab('reimburse')}
          className={`flex-1 text-xs font-bold py-2 rounded-lg transition-all relative ${activeTab === 'reimburse' ? 'bg-white text-surface-900 shadow-sm' : 'text-surface-500'}`}
        >
          💼 Reimburse
          {pendingReimburse.length > 0 && (
            <span className="absolute -top-1 -right-1 w-4 h-4 bg-amber-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center">
              {pendingReimburse.length}
            </span>
          )}
        </button>
      </div>

      {/* Tab summaries */}
      {activeTab === 'personal' && (
        <div className="grid grid-cols-2 gap-2 mb-4">
          <div className="card p-3">
            <p className="text-[10px] font-bold text-green-600 uppercase mb-1">Pemasukan Pribadi</p>
            <p className="text-base font-extrabold text-green-600 font-mono">{formatCurrency(personalIncome)}</p>
          </div>
          <div className="card p-3">
            <p className="text-[10px] font-bold text-red-500 uppercase mb-1">Pengeluaran Pribadi</p>
            <p className="text-base font-extrabold text-red-500 font-mono">{formatCurrency(personalExpense)}</p>
          </div>
        </div>
      )}

      {activeTab === 'kantor' && (
        <>
          {/* Kas Kantor summary cards */}
          <div className="grid grid-cols-2 gap-2 mb-3">
            <div className="card p-3">
              <p className="text-[10px] font-bold text-green-600 uppercase mb-1">Pemasukan Kantor</p>
              <p className="text-base font-extrabold text-green-600 font-mono">{formatCurrency(kantorIncome)}</p>
            </div>
            <div className="card p-3">
              <p className="text-[10px] font-bold text-purple-600 uppercase mb-1">Pengeluaran Kantor</p>
              <p className="text-base font-extrabold text-purple-600 font-mono">{formatCurrency(kantorExpense)}</p>
            </div>
          </div>
          {/* Per-wallet breakdown */}
          {kantorWallets.length > 0 && (
            <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
              {kantorWallets.map(w => (
                <div
                  key={w.id}
                  className={`card p-3 flex-shrink-0 min-w-[140px] cursor-pointer transition-all ${filterWallet === w.id ? 'ring-2 ring-purple-400' : ''}`}
                  onClick={() => setFilterWallet(filterWallet === w.id ? '' : w.id)}
                >
                  <p className="text-[10px] font-bold text-purple-600 uppercase mb-1">{w.name}</p>
                  <p className="text-base font-extrabold font-mono text-surface-900">{formatCurrency(Number(w.balance))}</p>
                  <p className="text-[10px] text-surface-400">{kantorTxs.filter(t => t.wallet_id === w.id).length} transaksi</p>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {activeTab === 'reimburse' && (
        <div className="grid grid-cols-2 gap-2 mb-4">
          <div className="card p-3 bg-amber-50 border border-amber-200">
            <p className="text-[10px] font-bold text-amber-700 uppercase mb-1">Belum Direimburse</p>
            <p className="text-base font-extrabold text-amber-700 font-mono">{formatCurrency(totalPendingReimburse)}</p>
            <p className="text-[10px] text-amber-600">{pendingReimburse.length} transaksi</p>
          </div>
          <div className="card p-3 bg-green-50 border border-green-200">
            <p className="text-[10px] font-bold text-green-700 uppercase mb-1">Sudah Direimburse</p>
            <p className="text-base font-extrabold text-green-700 font-mono">
              {formatCurrency(doneReimburse.reduce((s, t) => s + Number(t.amount), 0))}
            </p>
            <p className="text-[10px] text-green-600">{doneReimburse.length} transaksi</p>
          </div>
        </div>
      )}

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
          className={`btn min-w-0 px-3 relative ${activeFilterCount > 0 ? 'btn-primary' : 'btn-secondary'}`}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4h18M6 8h12M9 12h6" />
          </svg>
          {activeFilterCount > 0 && (
            <span className="absolute -top-1 -right-1 w-4 h-4 bg-white text-blue-600 text-[9px] font-extrabold rounded-full flex items-center justify-center shadow">
              {activeFilterCount}
            </span>
          )}
        </button>
      </div>

      {/* Filter panel — 3 filter rows */}
      {showFilters && (
        <div className="card p-3 mb-3 space-y-2">
          {/* Row 1: Tipe & Kategori */}
          <div className="flex gap-2">
            <select
              className="input flex-1 text-sm"
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
            >
              <option value="">Semua Tipe</option>
              <option value="income">💰 Pemasukan</option>
              <option value="expense">💸 Pengeluaran</option>
            </select>
            <select
              className="input flex-1 text-sm"
              value={filterCat}
              onChange={(e) => setFilterCat(e.target.value)}
            >
              <option value="">Semua Kategori</option>
              {categories.map(c => (
                <option key={c.id} value={c.id}>{c.icon} {c.name}</option>
              ))}
            </select>
          </div>

          {/* Row 2: Wallet */}
          <select
            className="input w-full text-sm"
            value={filterWallet}
            onChange={(e) => setFilterWallet(e.target.value)}
          >
            <option value="">Semua Dompet / Bank</option>
            {walletOptions.map(w => (
              <option key={w.id} value={w.id}>
                {w.pocket === 'kantor' ? '🏢' : w.pocket === 'tabungan' ? '💰' : '👤'} {w.name}
              </option>
            ))}
          </select>

          {/* Row 3: Tanggal */}
          <div className="flex gap-2 items-center">
            <div className="flex-1">
              <label className="text-[10px] font-bold text-surface-400 uppercase mb-1 block">Dari</label>
              <input
                className="input w-full text-sm"
                type="date"
                value={filterDateFrom}
                onChange={(e) => setFilterDateFrom(e.target.value)}
              />
            </div>
            <div className="text-surface-300 text-sm mt-4">—</div>
            <div className="flex-1">
              <label className="text-[10px] font-bold text-surface-400 uppercase mb-1 block">Sampai</label>
              <input
                className="input w-full text-sm"
                type="date"
                value={filterDateTo}
                onChange={(e) => setFilterDateTo(e.target.value)}
              />
            </div>
          </div>

          {/* Shortcut tanggal */}
          <div className="flex gap-1.5 flex-wrap">
            {[
              { label: 'Bulan ini', action: () => {
                const now = new Date()
                setFilterDateFrom(`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`)
                setFilterDateTo(new Date().toISOString().split('T')[0])
              }},
              { label: 'Bulan lalu', action: () => {
                const now = new Date()
                const first = new Date(now.getFullYear(), now.getMonth()-1, 1)
                const last = new Date(now.getFullYear(), now.getMonth(), 0)
                setFilterDateFrom(first.toISOString().split('T')[0])
                setFilterDateTo(last.toISOString().split('T')[0])
              }},
              { label: '7 hari', action: () => {
                const to = new Date()
                const from = new Date(); from.setDate(from.getDate()-7)
                setFilterDateFrom(from.toISOString().split('T')[0])
                setFilterDateTo(to.toISOString().split('T')[0])
              }},
              { label: '30 hari', action: () => {
                const to = new Date()
                const from = new Date(); from.setDate(from.getDate()-30)
                setFilterDateFrom(from.toISOString().split('T')[0])
                setFilterDateTo(to.toISOString().split('T')[0])
              }},
            ].map(s => (
              <button
                key={s.label}
                onClick={s.action}
                className="text-[10px] font-bold px-2 py-1 rounded-lg bg-surface-100 text-surface-500 hover:bg-surface-200 transition-colors"
              >
                {s.label}
              </button>
            ))}
          </div>

          {hasFilters && (
            <button onClick={resetFilters} className="btn btn-secondary text-xs w-full">
              Reset Semua Filter
            </button>
          )}
        </div>
      )}

      {/* Active filter summary + totals */}
      {hasFilters && (
        <div className="grid grid-cols-2 gap-2 mb-3">
          <div className="card p-3 flex items-center justify-between">
            <span className="text-xs text-green-600 font-bold">Masuk</span>
            <span className="font-mono font-bold text-sm text-green-600">
              {new Intl.NumberFormat('id-ID', { notation: 'compact', style: 'currency', currency: 'IDR', maximumFractionDigits: 1 }).format(totalIncome)}
            </span>
          </div>
          <div className="card p-3 flex items-center justify-between">
            <span className="text-xs text-red-500 font-bold">Keluar</span>
            <span className="font-mono font-bold text-sm text-red-500">
              {new Intl.NumberFormat('id-ID', { notation: 'compact', style: 'currency', currency: 'IDR', maximumFractionDigits: 1 }).format(totalExpense)}
            </span>
          </div>
        </div>
      )}

      {/* Result count */}
      {hasFilters && (
        <p className="text-[10px] text-surface-400 mb-2 px-1">
          Menampilkan {filtered.length} dari {baseTxs.length} transaksi
        </p>
      )}

      {/* Transactions List */}
      <div className="card overflow-hidden">
        {filtered.length > 0 ? (
          <div className="divide-y divide-surface-100">
            {filtered.map((tx) => {
              const isKantor = (tx as any).wallets?.pocket === 'kantor'
              const isPendingReimburse = (tx as any).is_reimbursable && !(tx as any).reimbursed_at
              const isDoneReimburse = (tx as any).is_reimbursable && !!(tx as any).reimbursed_at
              const tripBadge = getTripBadge(tx)
              return (
                <div key={tx.id} className="flex items-center gap-3 px-4 py-3.5 active:bg-surface-50 transition-colors">
                  <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center text-lg flex-shrink-0 cursor-pointer"
                    style={{ background: isKantor ? '#f3e8ff' : tx.type === 'income' ? '#dcfce7' : '#fee2e2' }}
                    onClick={() => openEdit(tx)}
                  >
                    {isKantor ? '🏢' : (tx as any).categories?.icon || (tx.type === 'income' ? '💰' : '💸')}
                  </div>
                  <div className="flex-1 min-w-0 cursor-pointer" onClick={() => openEdit(tx)}>
                    <p className="text-sm font-semibold text-surface-800 truncate">
                      {tx.description || (tx as any).categories?.name || 'Transaksi'}
                    </p>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <p className="text-[10px] text-surface-400">{formatDate(tx.date)} · {(tx as any).wallets?.name}</p>
                      {(tx as any).debt_id && <span className="bg-surface-100 text-surface-500 px-1.5 rounded text-[9px]">🤝 Utang/Piutang</span>}
                      {isPendingReimburse && <span className="bg-amber-100 text-amber-700 px-1.5 rounded text-[9px] font-bold">⏳ Belum reimburse</span>}
                      {isDoneReimburse && <span className="bg-green-100 text-green-700 px-1.5 rounded text-[9px] font-bold">✅ Sudah reimburse</span>}
                      {tripBadge && <span className="bg-blue-50 text-blue-700 px-1.5 rounded text-[9px] font-bold">{tripBadge}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <p
                      className={`text-sm font-bold font-mono ${tx.type === 'income' ? 'text-green-600' : isKantor ? 'text-purple-600' : 'text-red-500'}`}
                      onClick={() => openEdit(tx)}
                    >
                      {tx.type === 'income' ? '+' : '-'}{new Intl.NumberFormat('id-ID', { notation: 'compact', style: 'currency', currency: 'IDR', maximumFractionDigits: 1 }).format(Number(tx.amount))}
                    </p>
                    {(tx as any).is_reimbursable && (
                      <button
                        onClick={() => markReimbursed(tx)}
                        className={`w-7 h-7 rounded-lg flex items-center justify-center text-sm transition-all ${(tx as any).reimbursed_at ? 'bg-green-100 text-green-600' : 'bg-amber-100 text-amber-600 hover:bg-amber-200'}`}
                        title={(tx as any).reimbursed_at ? 'Sudah direimburse — klik untuk batal' : 'Tandai sudah direimburse'}
                      >
                        {(tx as any).reimbursed_at ? '✓' : '○'}
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="text-center py-16 text-surface-300">
            <p className="text-4xl mb-2">{activeTab === 'kantor' ? '🏢' : activeTab === 'reimburse' ? '💼' : '📝'}</p>
            <p className="text-sm">
              {hasFilters ? 'Tidak ada transaksi yang cocok dengan filter' :
               activeTab === 'kantor' ? 'Belum ada transaksi kas kantor' :
               activeTab === 'reimburse' ? 'Tidak ada transaksi reimburse' :
               'Belum ada transaksi pribadi'}
            </p>
            {hasFilters && (
              <button onClick={resetFilters} className="mt-3 text-xs text-blue-500 font-bold">Reset filter</button>
            )}
          </div>
        )}
      </div>

      {/* Add/Edit Modal */}
      <Modal open={showAdd} onClose={() => { setShowAdd(false); setEditing(null) }} title={editing ? 'Edit Transaksi' : 'Tambah Transaksi'}>
        <div className="space-y-4">
          {editing && (editing as any).debt_id && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800 flex gap-2">
              <span>⚠️</span>
              <span>Transaksi ini terhubung ke catatan utang/piutang. Sebaiknya ubah langsung dari halaman Utang & Piutang.</span>
            </div>
          )}
          {selectedWalletPocket === 'kantor' && (
            <div className="p-3 bg-purple-50 border border-purple-200 rounded-xl text-xs text-purple-800 flex gap-2">
              <span>🏢</span>
              <span>Transaksi ini akan <strong>tidak dihitung</strong> ke keuangan pribadi kamu.</span>
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
            <select className="input" value={form.wallet_id} onChange={(e) => setForm({ ...form, wallet_id: e.target.value, is_reimbursable: false })}>
              <option value="">Pilih dompet</option>
              {wallets.map(w => (
                <option key={w.id} value={w.id}>
                  {w.pocket === 'kantor' ? '🏢' : w.pocket === 'tabungan' ? '💰' : '👤'} {w.name}
                </option>
              ))}
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
          {form.type === 'expense' && selectedWalletPocket !== 'kantor' && trips.length > 0 && (
            <div>
              <label className="label">🧳 Tag ke Trip (opsional)</label>
              <select
                className="input"
                value={form.trip_id}
                onChange={(e) => setForm({ ...form, trip_id: e.target.value })}
              >
                <option value="">— Tidak terhubung trip —</option>
                {trips.map(t => (
                  <option key={t.id} value={t.id}>
                    {t.emoji} {t.name} ({t.start_date}{t.end_date ? ` – ${t.end_date}` : ''})
                  </option>
                ))}
              </select>
              {form.trip_id && (
                <p className="text-[10px] text-blue-600 mt-1">✓ Transaksi ini akan muncul di ringkasan trip tersebut</p>
              )}
            </div>
          )}
          {selectedWalletPocket && selectedWalletPocket !== 'kantor' && form.type === 'expense' && (
            <button
              onClick={() => setForm({ ...form, is_reimbursable: !(form as any).is_reimbursable })}
              className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-all text-left ${(form as any).is_reimbursable ? 'bg-amber-50 border-amber-300' : 'bg-surface-50 border-surface-200'}`}
            >
              <div className={`w-10 h-6 rounded-full transition-all flex-shrink-0 relative ${(form as any).is_reimbursable ? 'bg-amber-500' : 'bg-surface-300'}`}>
                <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${(form as any).is_reimbursable ? 'left-5' : 'left-1'}`} />
              </div>
              <div>
                <p className={`text-xs font-bold ${(form as any).is_reimbursable ? 'text-amber-800' : 'text-surface-600'}`}>
                  🏢 Ini pengeluaran untuk keperluan kantor
                </p>
                <p className="text-[10px] text-surface-400 mt-0.5">Pakai dompet pribadi, nanti reimburse dari kantor</p>
              </div>
            </button>
          )}
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
