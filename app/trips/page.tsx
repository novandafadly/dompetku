'use client'

import { useEffect, useState, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import type { Transaction, Wallet, Category } from '@/lib/supabase'
import { formatCurrency, formatDate, formatShort } from '@/lib/utils'
import AppShell from '@/components/AppShell'
import Modal from '@/components/Modal'
import { toast } from '@/components/Toast'

type Trip = {
  id: string
  user_id: string
  name: string
  emoji: string
  destination: string | null
  start_date: string | null   // OPTIONAL
  end_date: string | null     // OPTIONAL
  budget: number | null
  notes: string | null
  created_at: string
}

type TripForm = {
  name: string; emoji: string; destination: string
  start_date: string; end_date: string; budget: string; notes: string
}

const TRIP_EMOJIS = ['🧳','✈️','🏖️','🏔️','🗺️','🚢','🚗','🚆','🏕️','🌏','🎡','🏟️']
const emptyTripForm: TripForm = { name:'', emoji:'🧳', destination:'', start_date:'', end_date:'', budget:'', notes:'' }

export default function TripsPage() {
  const [trips, setTrips] = useState<Trip[]>([])
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [wallets, setWallets] = useState<Wallet[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  // excludedMap: trip_id -> Set of excluded transaction_ids (DB-persisted)
  const [excludedMap, setExcludedMap] = useState<Record<string, Set<string>>>({})

  const [showTripModal, setShowTripModal] = useState(false)
  const [editingTrip, setEditingTrip] = useState<Trip | null>(null)
  const [selectedTrip, setSelectedTrip] = useState<Trip | null>(null)
  const [showDetail, setShowDetail] = useState(false)
  const [showExcludeModal, setShowExcludeModal] = useState(false)
  const [showAddTxModal, setShowAddTxModal] = useState(false)
  const [tripForm, setTripForm] = useState<TripForm>(emptyTripForm)
  const [loading, setLoading] = useState(true)

  const [addTxForm, setAddTxForm] = useState({
    wallet_id: '', category_id: '', type: 'expense' as 'expense' | 'income',
    amount: '', description: '',
    date: new Date().toISOString().split('T')[0],
  })

  useEffect(() => { load() }, [])

  async function load() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return

    const [tr, tx, w, c, excl] = await Promise.all([
      supabase.from('trips').select('*').eq('user_id', session.user.id).order('created_at', { ascending: false }),
      supabase.from('transactions').select('*').order('date', { ascending: false }).limit(500),
      supabase.from('wallets').select('*').eq('is_active', true).order('name'),
      supabase.from('categories').select('*').order('name'),
      supabase.from('trip_excluded_transactions').select('trip_id, transaction_id').eq('user_id', session.user.id),
    ])

    // JS join — hindari PostgREST embedded join yang tidak reliable
    const walletMap: Record<string, any> = {}
    const catMap: Record<string, any> = {}
    ;(w.data || []).forEach((x: any) => { walletMap[x.id] = x })
    ;(c.data || []).forEach((x: any) => { catMap[x.id] = x })
    const txWithJoins = (tx.data || []).map((t: any) => ({
      ...t,
      wallets: walletMap[t.wallet_id] || null,
      categories: catMap[t.category_id] || null,
      subcategories: t.subcategory_id ? catMap[t.subcategory_id] || null : null,
    }))

    setTrips(tr.data || [])
    setTransactions(txWithJoins)
    setWallets(w.data || [])
    setCategories(c.data || [])

    // Build excludedMap from DB
    const map: Record<string, Set<string>> = {}
    for (const row of (excl.data || [])) {
      if (!map[row.trip_id]) map[row.trip_id] = new Set()
      map[row.trip_id].add(row.transaction_id)
    }
    setExcludedMap(map)
    setLoading(false)
  }

  // ── Which transactions belong to a trip ───────────────────
  // Includes: explicitly tagged (trip_id=trip.id) OR date in range (expense & income)
  // Excludes: overridden via trip_excluded_transactions, kantor pocket
  function getTripTransactions(trip: Trip): Transaction[] {
    const excluded = excludedMap[trip.id] || new Set<string>()
    return transactions.filter(tx => {
      if (excluded.has(tx.id)) return false
      if ((tx as any).wallets?.pocket === 'kantor') return false
      // Explicitly tagged to this trip — always include
      if ((tx as any).trip_id === trip.id) return true
      // Tagged to a different trip — skip
      if ((tx as any).trip_id && (tx as any).trip_id !== trip.id) return false
      // Date-range auto-include (expense & income)
      if (trip.start_date || trip.end_date) {
        if (trip.start_date && tx.date < trip.start_date) return false
        if (trip.end_date && tx.date > trip.end_date) return false
        return true
      }
      return false
    })
  }

  // ── Toggle exclude — persisted to DB ──────────────────────
  async function toggleExclude(tripId: string, txId: string) {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return
    const isExcluded = (excludedMap[tripId] || new Set()).has(txId)

    if (isExcluded) {
      await supabase.from('trip_excluded_transactions')
        .delete().eq('trip_id', tripId).eq('transaction_id', txId)
      toast('Transaksi dimasukkan kembali ke trip', '✅')
    } else {
      await supabase.from('trip_excluded_transactions')
        .insert({ trip_id: tripId, transaction_id: txId, user_id: session.user.id })
      toast('Transaksi dikecualikan dari trip', '🚫')
    }

    // Optimistic UI update
    setExcludedMap(prev => {
      const next = { ...prev }
      if (!next[tripId]) next[tripId] = new Set()
      else next[tripId] = new Set(next[tripId])
      if (isExcluded) next[tripId].delete(txId)
      else next[tripId].add(txId)
      return next
    })
  }

  // ── Trip CRUD ─────────────────────────────────────────────
  function openAddTrip() { setEditingTrip(null); setTripForm(emptyTripForm); setShowTripModal(true) }

  function openEditTrip(trip: Trip) {
    setEditingTrip(trip)
    setTripForm({
      name: trip.name, emoji: trip.emoji || '🧳',
      destination: trip.destination || '',
      start_date: trip.start_date || '', end_date: trip.end_date || '',
      budget: trip.budget ? String(trip.budget) : '', notes: trip.notes || '',
    })
    setShowTripModal(true)
  }

  async function saveTrip() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return
    if (!tripForm.name.trim()) { toast('Nama trip wajib diisi!', '⚠️'); return }

    const payload = {
      name: tripForm.name.trim(), emoji: tripForm.emoji,
      destination: tripForm.destination || null,
      start_date: tripForm.start_date || null,
      end_date: tripForm.end_date || null,
      budget: Number(tripForm.budget) || null,
      notes: tripForm.notes || null,
    }

    if (editingTrip) {
      const { error } = await supabase.from('trips').update(payload).eq('id', editingTrip.id)
      if (error) { toast(error.message, '❌'); return }
      toast('Trip diperbarui!', '✅')
    } else {
      const { error } = await supabase.from('trips').insert({ ...payload, user_id: session.user.id })
      if (error) { toast(error.message, '❌'); return }
      toast('Trip ditambahkan!', '🧳')
    }
    setShowTripModal(false); setEditingTrip(null); load()
  }

  async function deleteTrip(id: string) {
    if (!confirm('Hapus trip ini? Transaksi yang ditag tidak akan terhapus.')) return
    // ON DELETE CASCADE hapus trip_excluded_transactions otomatis
    await supabase.from('trips').delete().eq('id', id)
    setExcludedMap(prev => { const next = { ...prev }; delete next[id]; return next })
    if (selectedTrip?.id === id) setSelectedTrip(null)
    toast('Trip dihapus', '🗑️'); load()
  }

  function openDetail(trip: Trip) { setSelectedTrip(trip); setShowDetail(true) }

  // ── Add manual tx to trip ─────────────────────────────────
  async function saveAddTx() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session || !selectedTrip) return
    const amount = Number(addTxForm.amount)
    if (!amount || !addTxForm.wallet_id) { toast('Lengkapi jumlah & dompet!', '⚠️'); return }

    const { error } = await supabase.from('transactions').insert({
      user_id: session.user.id, wallet_id: addTxForm.wallet_id,
      category_id: addTxForm.category_id || null, type: addTxForm.type, amount,
      description: addTxForm.description || null, date: addTxForm.date,
      trip_id: selectedTrip.id,
    })
    if (error) { toast(error.message, '❌'); return }
    toast(addTxForm.type === 'income' ? 'Pemasukan trip dicatat! 💰' : 'Pengeluaran trip dicatat! 💸')
    setShowAddTxModal(false)
    setAddTxForm({ wallet_id:'', category_id:'', type:'expense', amount:'', description:'', date: new Date().toISOString().split('T')[0] })
    load()
    setTimeout(() => setShowDetail(true), 400)
  }

  // ── Status ────────────────────────────────────────────────
  function tripStatus(trip: Trip): 'upcoming'|'ongoing'|'done'|'nodates' {
    if (!trip.start_date && !trip.end_date) return 'nodates'
    const today = new Date().toISOString().split('T')[0]
    if (trip.start_date && trip.start_date > today) return 'upcoming'
    if (!trip.end_date || trip.end_date >= today) return 'ongoing'
    return 'done'
  }

  function StatusBadge({ trip }: { trip: Trip }) {
    const s = tripStatus(trip)
    const cfg = {
      upcoming: { cls: 'bg-blue-100 text-blue-700', label: '📅 Upcoming' },
      ongoing:  { cls: 'bg-green-100 text-green-700', label: '🟢 Berlangsung' },
      done:     { cls: 'bg-surface-100 text-surface-500', label: '✓ Selesai' },
      nodates:  { cls: 'bg-amber-100 text-amber-700', label: '🔖 Open Trip' },
    }
    return <span className={`badge ${cfg[s].cls}`}>{cfg[s].label}</span>
  }

  // ── Detail data ───────────────────────────────────────────
  const detailTxs = useMemo(() =>
    selectedTrip ? getTripTransactions(selectedTrip) : [],
    [selectedTrip, transactions, excludedMap]
  )
  const detailExpense = useMemo(() => detailTxs.filter(t => t.type === 'expense').reduce((s,t) => s + Number(t.amount), 0), [detailTxs])
  const detailIncome = useMemo(() => detailTxs.filter(t => t.type === 'income').reduce((s,t) => s + Number(t.amount), 0), [detailTxs])
  const detailNet = detailExpense - detailIncome  // positif = boncos, negatif = surplus

  const expByCat = useMemo(() => {
    const map: Record<string, {name:string; icon:string; value:number; type:string}> = {}
    detailTxs.filter(t => t.type === 'expense').forEach(t => {
      const key = (t as any).categories?.name || 'Lainnya'
      if (!map[key]) map[key] = { name:key, icon:(t as any).categories?.icon||'📦', value:0, type:'expense' }
      map[key].value += Number(t.amount)
    })
    return Object.values(map).sort((a,b) => b.value - a.value)
  }, [detailTxs])

  // All date-range txs (including excluded) for override modal
  const allRangeTxs = useMemo(() => {
    if (!selectedTrip) return []
    return transactions.filter(tx => {
      if ((tx as any).wallets?.pocket === 'kantor') return false
      if ((tx as any).trip_id === selectedTrip.id) return true
      if ((tx as any).trip_id && (tx as any).trip_id !== selectedTrip.id) return false
      if (selectedTrip.start_date || selectedTrip.end_date) {
        if (selectedTrip.start_date && tx.date < selectedTrip.start_date) return false
        if (selectedTrip.end_date && tx.date > selectedTrip.end_date) return false
        return true
      }
      return false
    })
  }, [selectedTrip, transactions])

  const personalWallets = wallets.filter(w => w.pocket !== 'kantor')

  function dateRangeHint() {
    if (!tripForm.start_date && !tripForm.end_date)
      return '🔖 Tanpa tanggal: hanya transaksi yang ditag manual yang dihitung.'
    if (tripForm.start_date && !tripForm.end_date)
      return '📅 Semua transaksi mulai tanggal ini masuk otomatis (bisa di-exclude).'
    return '📅 Transaksi di rentang tanggal ini masuk otomatis (bisa di-exclude).'
  }

  return (
    <AppShell>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl sm:text-2xl font-extrabold text-surface-900">Trip & Healing</h1>
          <p className="text-xs text-surface-400">{trips.length} trip tercatat</p>
        </div>
        <button onClick={openAddTrip} className="btn btn-primary py-2.5 px-4 text-sm">+ Trip</button>
      </div>

      {loading ? (
        <div className="space-y-4">
          {[...Array(3)].map((_,i) => <div key={i} className="card p-5 h-28 animate-pulse bg-surface-100" />)}
        </div>
      ) : trips.length > 0 ? (
        <div className="space-y-3">
          {trips.map(trip => {
            const tripTxs = getTripTransactions(trip)
            const expense = tripTxs.filter(t => t.type === 'expense').reduce((s,t) => s + Number(t.amount), 0)
            const income = tripTxs.filter(t => t.type === 'income').reduce((s,t) => s + Number(t.amount), 0)
            const net = expense - income
            const budgetPct = trip.budget && expense > 0 ? Math.min((expense / Number(trip.budget)) * 100, 100) : 0
            const over = trip.budget && expense > Number(trip.budget)
            const excCount = (excludedMap[trip.id] || new Set()).size

            return (
              <div key={trip.id} className="card p-4 cursor-pointer active:bg-surface-50 transition-colors" onClick={() => openDetail(trip)}>
                <div className="flex items-start gap-3 mb-3">
                  <div className="w-12 h-12 rounded-xl bg-blue-50 flex items-center justify-center text-2xl flex-shrink-0">{trip.emoji}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-0.5">
                      <p className="text-sm font-bold text-surface-900">{trip.name}</p>
                      <StatusBadge trip={trip} />
                    </div>
                    {trip.destination && <p className="text-xs text-surface-500 mb-0.5">📍 {trip.destination}</p>}
                    <p className="text-[10px] text-surface-400">
                      {trip.start_date && trip.end_date ? `${formatDate(trip.start_date)} – ${formatDate(trip.end_date)}`
                        : trip.start_date ? `Mulai ${formatDate(trip.start_date)}`
                        : trip.end_date ? `Sampai ${formatDate(trip.end_date)}`
                        : 'Tanggal fleksibel'}
                      {excCount > 0 && <span className="ml-2 text-amber-500">· {excCount} dikecualikan</span>}
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className={`text-base font-extrabold font-mono ${net > 0 ? 'text-red-500' : net < 0 ? 'text-green-600' : 'text-surface-900'}`}>
                      {net > 0 ? '-' : net < 0 ? '+' : ''}{formatShort(Math.abs(net))}
                    </p>
                    <p className="text-[10px] text-surface-400">{net > 0 ? 'boncos' : net < 0 ? 'surplus' : 'impas'}</p>
                  </div>
                </div>
                {/* Mini income/expense row jika ada keduanya */}
                {income > 0 && (
                  <div className="flex gap-3 text-[10px] mb-2 px-0.5">
                    <span className="text-red-500">Keluar: <span className="font-bold font-mono">{formatShort(expense)}</span></span>
                    <span className="text-green-600">Masuk: <span className="font-bold font-mono">{formatShort(income)}</span></span>
                  </div>
                )}
                {trip.budget && (
                  <div>
                    <div className="flex justify-between text-[10px] mb-1">
                      <span className={`font-semibold ${over ? 'text-red-500' : 'text-surface-500'}`}>
                        {over ? '⚠️ Over budget!' : `Budget: ${formatShort(Number(trip.budget))}`}
                      </span>
                      <span className="text-surface-400">{budgetPct.toFixed(0)}%</span>
                    </div>
                    <div className="progress-bar">
                      <div className="progress-fill" style={{ width:`${budgetPct}%`, background: over?'#ef4444':budgetPct>75?'#f59e0b':'#22c55e' }} />
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      ) : (
        <div className="card text-center py-20 text-surface-300">
          <p className="text-5xl mb-3">🧳</p>
          <p className="font-semibold text-surface-500">Belum ada trip</p>
          <p className="text-sm mt-1">Buat trip untuk tracking pengeluaran perjalanan</p>
        </div>
      )}

      {/* ── Add/Edit Trip Modal ── */}
      <Modal open={showTripModal} onClose={() => { setShowTripModal(false); setEditingTrip(null) }} title={editingTrip ? 'Edit Trip' : 'Tambah Trip'}>
        <div className="space-y-4">
          <div>
            <label className="label">Emoji</label>
            <div className="flex flex-wrap gap-2">
              {TRIP_EMOJIS.map(e => (
                <button key={e} onClick={() => setTripForm({...tripForm, emoji:e})}
                  className={`w-10 h-10 text-xl rounded-xl flex items-center justify-center transition-all ${tripForm.emoji===e?'bg-brand-100 ring-2 ring-brand-400':'hover:bg-surface-100'}`}>
                  {e}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="label">Nama Trip</label>
            <input className="input" placeholder="mis. Bali Trip, Family Vacation" value={tripForm.name} onChange={e => setTripForm({...tripForm, name:e.target.value})} />
          </div>
          <div>
            <label className="label">Destinasi <span className="text-surface-400 font-normal">(opsional)</span></label>
            <input className="input" placeholder="mis. Bali, Yogyakarta, Singapore" value={tripForm.destination} onChange={e => setTripForm({...tripForm, destination:e.target.value})} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Tgl Mulai <span className="text-surface-400 font-normal text-[10px]">(opsional)</span></label>
              <input className="input" type="date" value={tripForm.start_date} onChange={e => setTripForm({...tripForm, start_date:e.target.value})} />
            </div>
            <div>
              <label className="label">Tgl Selesai <span className="text-surface-400 font-normal text-[10px]">(opsional)</span></label>
              <input className="input" type="date" value={tripForm.end_date} min={tripForm.start_date||undefined} onChange={e => setTripForm({...tripForm, end_date:e.target.value})} />
            </div>
          </div>
          <p className="text-[10px] text-surface-400 -mt-2 px-1">{dateRangeHint()}</p>
          <div>
            <label className="label">Budget <span className="text-surface-400 font-normal">(opsional)</span></label>
            <input className="input" type="number" inputMode="numeric" placeholder="0" value={tripForm.budget} onChange={e => setTripForm({...tripForm, budget:e.target.value})} />
          </div>
          <div>
            <label className="label">Catatan <span className="text-surface-400 font-normal">(opsional)</span></label>
            <input className="input" placeholder="Itinerary, tujuan, dll." value={tripForm.notes} onChange={e => setTripForm({...tripForm, notes:e.target.value})} />
          </div>
          <div className="flex gap-2 pt-1">
            {editingTrip && <button onClick={() => { deleteTrip(editingTrip.id); setShowTripModal(false) }} className="btn btn-danger flex-1">Hapus</button>}
            <button onClick={saveTrip} className="btn btn-primary flex-1">{editingTrip ? 'Simpan' : 'Buat Trip'}</button>
          </div>
        </div>
      </Modal>

      {/* ── Trip Detail Modal ── */}
      <Modal open={showDetail && !!selectedTrip} onClose={() => { setShowDetail(false); setSelectedTrip(null) }}
        title={selectedTrip ? `${selectedTrip.emoji} ${selectedTrip.name}` : ''}>
        {selectedTrip && (
          <div className="space-y-4">
            <div className="p-3 bg-blue-50 rounded-xl text-xs space-y-1.5">
              {selectedTrip.destination && (
                <div className="flex justify-between">
                  <span className="text-surface-500">Destinasi</span>
                  <span className="font-bold">📍 {selectedTrip.destination}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-surface-500">Periode</span>
                <span className="font-bold">
                  {selectedTrip.start_date && selectedTrip.end_date
                    ? `${formatDate(selectedTrip.start_date)} – ${formatDate(selectedTrip.end_date)}`
                    : selectedTrip.start_date ? `Mulai ${formatDate(selectedTrip.start_date)}`
                    : selectedTrip.end_date ? `Sampai ${formatDate(selectedTrip.end_date)}`
                    : 'Tanggal fleksibel'}
                </span>
              </div>
              <div className="border-t border-blue-100 my-1" />
              <div className="flex justify-between">
                <span className="text-red-500 font-semibold">💸 Total Keluar</span>
                <span className="font-bold font-mono text-red-500">{formatCurrency(detailExpense)}</span>
              </div>
              {detailIncome > 0 && (
                <div className="flex justify-between">
                  <span className="text-green-600 font-semibold">💰 Total Masuk</span>
                  <span className="font-bold font-mono text-green-600">+{formatCurrency(detailIncome)}</span>
                </div>
              )}
              <div className="flex justify-between border-t border-blue-100 pt-1 mt-1">
                <span className={`font-bold ${detailNet > 0 ? 'text-red-600' : detailNet < 0 ? 'text-green-600' : 'text-surface-600'}`}>
                  {detailNet > 0 ? '📉 Boncos' : detailNet < 0 ? '🎉 Surplus' : '⚖️ Impas'}
                </span>
                <span className={`font-extrabold font-mono ${detailNet > 0 ? 'text-red-600' : detailNet < 0 ? 'text-green-600' : 'text-surface-600'}`}>
                  {detailNet > 0 ? '-' : detailNet < 0 ? '+' : ''}{formatCurrency(Math.abs(detailNet))}
                </span>
              </div>
              {selectedTrip.budget && (
                <div className="flex justify-between border-t border-blue-100 pt-1">
                  <span className="text-surface-500">Budget</span>
                  <span className={`font-bold font-mono ${detailExpense>Number(selectedTrip.budget)?'text-red-500':'text-green-600'}`}>
                    {formatCurrency(Number(selectedTrip.budget))} {detailExpense>Number(selectedTrip.budget)?'⚠️':'✅'}
                  </span>
                </div>
              )}
              {(excludedMap[selectedTrip.id]||new Set()).size > 0 && (
                <div className="flex justify-between">
                  <span className="text-amber-600">Dikecualikan</span>
                  <span className="font-bold text-amber-600">{(excludedMap[selectedTrip.id]||new Set()).size} transaksi</span>
                </div>
              )}
            </div>

            {expByCat.length > 0 && (
              <div>
                <p className="text-xs font-bold text-surface-600 mb-2">Breakdown per Kategori</p>
                <div className="space-y-2">
                  {expByCat.map(cat => {
                    const pct = detailExpense > 0 ? (cat.value/detailExpense)*100 : 0
                    return (
                      <div key={cat.name}>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="font-semibold text-surface-700">{cat.icon} {cat.name}</span>
                          <div className="flex items-center gap-2">
                            <span className="text-surface-400">{pct.toFixed(0)}%</span>
                            <span className="font-mono font-bold">{formatShort(cat.value)}</span>
                          </div>
                        </div>
                        <div className="progress-bar h-1.5">
                          <div className="progress-fill" style={{ width:`${pct}%`, background:'#3b82f6' }} />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-bold text-surface-600">Transaksi ({detailTxs.length})</p>
                <button onClick={() => { setShowDetail(false); setShowAddTxModal(true) }} className="text-xs font-bold text-brand-600">+ Tambah</button>
              </div>
              {detailTxs.length > 0 ? (
                <div className="space-y-2 max-h-56 overflow-y-auto">
                  {detailTxs.map(tx => {
                    const isTagged = (tx as any).trip_id === selectedTrip.id
                    const isIncome = tx.type === 'income'
                    return (
                      <div key={tx.id} className={`flex items-center gap-2 p-2.5 rounded-xl ${isIncome ? 'bg-green-50' : 'bg-surface-50'}`}>
                        <div className={`w-8 h-8 rounded-xl border flex items-center justify-center text-sm flex-shrink-0 ${isIncome ? 'bg-green-100 border-green-200' : 'bg-white border-surface-100'}`}>
                          {(tx as any).categories?.icon || (isIncome ? '💰' : '💸')}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-surface-800 truncate">
                            {tx.description || (tx as any).categories?.name || (isIncome ? 'Pemasukan' : 'Pengeluaran')}
                          </p>
                          <p className="text-[10px] text-surface-400">
                            {formatDate(tx.date)} · {(tx as any).wallets?.name}
                            {isTagged && <span className="ml-1 text-brand-500 font-bold">✓</span>}
                          </p>
                        </div>
                        <p className={`text-xs font-bold font-mono flex-shrink-0 ${isIncome ? 'text-green-600' : 'text-red-500'}`}>
                          {isIncome ? '+' : '-'}{formatShort(Number(tx.amount))}
                        </p>
                        <button
                          onClick={() => toggleExclude(selectedTrip.id, tx.id)}
                          title="Keluarkan dari trip"
                          className="w-7 h-7 rounded-lg bg-red-50 text-red-400 hover:bg-red-100 hover:text-red-600 flex items-center justify-center text-xs flex-shrink-0"
                        >✕</button>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="text-center py-6 text-surface-300 text-sm">
                  {(selectedTrip.start_date || selectedTrip.end_date)
                    ? 'Belum ada transaksi di periode ini'
                    : 'Tag transaksi dari halaman Transaksi, atau tambah di sini'}
                </div>
              )}
            </div>

            <div className="flex gap-2 pt-1">
              <button onClick={() => { setShowDetail(false); openEditTrip(selectedTrip) }} className="btn btn-secondary flex-1">✏️ Edit</button>
              {(selectedTrip.start_date || selectedTrip.end_date) && (
                <button onClick={() => { setShowDetail(false); setShowExcludeModal(true) }} className="btn btn-secondary flex-1">🔧 Override Transaksi</button>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* ── Override Modal: full list of date-range txs ── */}
      <Modal open={showExcludeModal && !!selectedTrip} onClose={() => { setShowExcludeModal(false); setShowDetail(true) }} title="Override Transaksi Trip">
        {selectedTrip && (
          <div className="space-y-3">
            <div className="p-3 bg-amber-50 rounded-xl text-xs text-amber-800">
              💡 Transaksi di bawah masuk otomatis karena tanggalnya ada di periode trip. Tap <strong>Exclude</strong> untuk mengeluarkannya dari rekap ini — tidak akan menghapus transaksi asli.
            </div>
            <div className="space-y-2 max-h-[60vh] overflow-y-auto">
              {allRangeTxs.length === 0 ? (
                <div className="text-center py-8 text-surface-300 text-sm">Tidak ada transaksi di periode trip ini</div>
              ) : allRangeTxs.map(tx => {
                const isExcluded = (excludedMap[selectedTrip.id] || new Set()).has(tx.id)
                const isTagged = (tx as any).trip_id === selectedTrip.id
                const isIncome = tx.type === 'income'
                return (
                  <div key={tx.id} className={`flex items-center gap-2 p-3 rounded-xl border transition-all ${isExcluded ? 'border-red-200 bg-red-50' : isIncome ? 'border-green-100 bg-green-50' : 'border-surface-100 bg-white'}`}>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-semibold truncate ${isExcluded ? 'line-through text-surface-400' : 'text-surface-800'}`}>
                        {(tx as any).categories?.icon} {tx.description || (tx as any).categories?.name || (isIncome ? 'Pemasukan' : 'Pengeluaran')}
                      </p>
                      <p className="text-[10px] text-surface-400">
                        {formatDate(tx.date)} · {(tx as any).wallets?.name}
                        {isTagged && <span className="ml-1 text-brand-500 font-bold">· Tagged</span>}
                        {isExcluded && <span className="ml-1 text-red-400 font-bold">· Dikecualikan</span>}
                      </p>
                    </div>
                    <p className={`text-xs font-bold font-mono flex-shrink-0 ${isIncome ? 'text-green-600' : 'text-red-500'}`}>
                      {isIncome ? '+' : '-'}{formatShort(Number(tx.amount))}
                    </p>
                    <button
                      onClick={() => toggleExclude(selectedTrip.id, tx.id)}
                      className={`text-xs font-bold flex-shrink-0 px-2.5 py-1.5 rounded-xl transition-all ${isExcluded ? 'bg-green-100 text-green-700 hover:bg-green-200' : 'bg-red-50 text-red-500 hover:bg-red-100'}`}
                    >
                      {isExcluded ? '↩ Masukkan' : '✕ Exclude'}
                    </button>
                  </div>
                )
              })}
            </div>
            <button onClick={() => { setShowExcludeModal(false); setShowDetail(true) }} className="btn btn-primary w-full">Selesai</button>
          </div>
        )}
      </Modal>

      {/* ── Add Tx to Trip Modal ── */}
      <Modal open={showAddTxModal && !!selectedTrip} onClose={() => { setShowAddTxModal(false); setShowDetail(true) }} title={`Catat Transaksi — ${selectedTrip?.name}`}>
        {selectedTrip && (
          <div className="space-y-4">
            <div>
              <label className="label">Tipe</label>
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => setAddTxForm({...addTxForm, type:'expense', category_id:''})}
                  className={`btn ${addTxForm.type==='expense' ? 'bg-red-50 text-red-700 border border-red-200' : 'btn-secondary'}`}>💸 Pengeluaran</button>
                <button onClick={() => setAddTxForm({...addTxForm, type:'income', category_id:''})}
                  className={`btn ${addTxForm.type==='income' ? 'bg-green-50 text-green-700 border border-green-200' : 'btn-secondary'}`}>💰 Pemasukan</button>
              </div>
            </div>
            <div>
              <label className="label">Jumlah</label>
              <input className="input text-xl font-bold" type="number" inputMode="numeric" placeholder="0" value={addTxForm.amount} onChange={e => setAddTxForm({...addTxForm, amount:e.target.value})} />
            </div>
            <div>
              <label className="label">Dompet</label>
              <select className="input" value={addTxForm.wallet_id} onChange={e => setAddTxForm({...addTxForm, wallet_id:e.target.value})}>
                <option value="">Pilih dompet</option>
                {personalWallets.map(w => <option key={w.id} value={w.id}>{w.icon||'💳'} {w.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Kategori <span className="text-surface-400 font-normal">(opsional)</span></label>
              <select className="input" value={addTxForm.category_id} onChange={e => setAddTxForm({...addTxForm, category_id:e.target.value})}>
                <option value="">Pilih kategori</option>
                {categories.filter(c => c.type === addTxForm.type).map(c => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Keterangan</label>
              <input className="input" placeholder={addTxForm.type==='income' ? 'mis. Uang saku dinas, Per diem' : 'mis. Makan malam, Tiket masuk'} value={addTxForm.description} onChange={e => setAddTxForm({...addTxForm, description:e.target.value})} />
            </div>
            <div>
              <label className="label">Tanggal</label>
              <input className="input" type="date" value={addTxForm.date} onChange={e => setAddTxForm({...addTxForm, date:e.target.value})} />
            </div>
            <div className={`p-3 rounded-xl text-xs flex gap-2 ${addTxForm.type==='income' ? 'bg-green-50 text-green-700' : 'bg-blue-50 text-blue-700'}`}>
              <span>🧳</span>
              <span>Akan otomatis ditag ke trip <strong>{selectedTrip.name}</strong>.</span>
            </div>
            <div className="flex gap-2">
              <button onClick={() => { setShowAddTxModal(false); setShowDetail(true) }} className="btn btn-secondary flex-1">Batal</button>
              <button onClick={saveAddTx} className="btn btn-primary flex-1">Simpan</button>
            </div>
          </div>
        )}
      </Modal>
    </AppShell>
  )
}
