'use client'

import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import type { Session } from '@supabase/supabase-js'

// --- Types --------------------------------------------------------------------

interface Trip {
  id: string
  name: string
  emoji: string
  start_date: string
  end_date: string | null
  notes: string | null
  created_at: string
}

interface Transaction {
  id: string
  wallet_id: string
  category_id: string | null
  type: 'income' | 'expense'
  amount: number
  description: string | null
  date: string
  trip_id: string | null
  categories?: { name: string; icon: string } | null
  wallets?: { name: string; icon: string } | null
}

interface CategoryBreakdown {
  name: string
  icon: string
  total: number
  count: number
}

// --- Helpers ------------------------------------------------------------------

const fmt = (n: number) =>
  'Rp ' +
  Math.abs(n)
    .toLocaleString('id-ID', { maximumFractionDigits: 0 })

const fmtShort = (n: number) => {
  if (n >= 1_000_000) return `Rp ${(n / 1_000_000).toFixed(1)}jt`
  if (n >= 1_000) return `Rp ${(n / 1_000).toFixed(0)}rb`
  return fmt(n)
}

function formatDateRange(start: string, end: string | null): string {
  const s = new Date(start)
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }
  if (!end) return s.toLocaleDateString('id-ID', { ...opts, year: 'numeric' })
  const e = new Date(end)
  if (s.getFullYear() === e.getFullYear()) {
    if (s.getMonth() === e.getMonth())
      return `${s.getDate()}–${e.getDate()} ${s.toLocaleDateString('id-ID', { month: 'short', year: 'numeric' })}`
    return `${s.toLocaleDateString('id-ID', opts)} – ${e.toLocaleDateString('id-ID', { ...opts, year: 'numeric' })}`
  }
  return `${s.toLocaleDateString('id-ID', { ...opts, year: 'numeric' })} – ${e.toLocaleDateString('id-ID', { ...opts, year: 'numeric' })}`
}

function tripDays(start: string, end: string | null): number {
  if (!end) return 1
  const diff = new Date(end).getTime() - new Date(start).getTime()
  return Math.max(1, Math.round(diff / 86400000) + 1)
}

// --- Modal --------------------------------------------------------------------

function Modal({ open, onClose, children }: { open: boolean; onClose: () => void; children: React.ReactNode }) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-5 shadow-2xl" onClick={e => e.stopPropagation()}>
        {children}
      </div>
    </div>
  )
}

// --- Main Component -----------------------------------------------------------

export default function TripPage() {
  const [session, setSession] = useState<Session | null>(null)
  const [trips, setTrips] = useState<Trip[]>([])
  const [selectedTrip, setSelectedTrip] = useState<Trip | null>(null)
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [allUserTx, setAllUserTx] = useState<Transaction[]>([]) // for manual tagging
  const [loading, setLoading] = useState(true)
  const [txLoading, setTxLoading] = useState(false)
  const [compareMode, setCompareMode] = useState(false)
  const [compareTrip, setCompareTrip] = useState<Trip | null>(null)
  const [compareTx, setCompareTx] = useState<Transaction[]>([])
  const [activeTab, setActiveTab] = useState<'summary' | 'transactions'>('summary')
  const [showTripModal, setShowTripModal] = useState(false)
  const [showTagModal, setShowTagModal] = useState(false)
  const [editingTrip, setEditingTrip] = useState<Trip | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<Trip | null>(null)

  const emptyForm = { name: '', emoji: '✈️', start_date: '', end_date: '', notes: '' }
  const [form, setForm] = useState(emptyForm)

  const EMOJIS = ['✈️', '🏖️', '⛰️', '🏕️', '🚗', '🚂', '🛳️', '🏔️', '🌏', '🎡', '🏝️', '🧳']

  // -- Auth --
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, s) => setSession(s))
    return () => subscription.unsubscribe()
  }, [])

  // -- Load trips --
  const loadTrips = useCallback(async () => {
    if (!session) return
    setLoading(true)
    const { data } = await supabase
      .from('trips')
      .select('*')
      .eq('user_id', session.user.id)
      .order('start_date', { ascending: false })
    setTrips(data || [])
    setLoading(false)
  }, [session])

  useEffect(() => { loadTrips() }, [loadTrips])

  // -- Load transactions for a trip --
  const loadTripTransactions = useCallback(async (trip: Trip) => {
    if (!session) return
    setTxLoading(true)

    // Transactions by date range OR manually tagged to this trip
    const { data } = await supabase
      .from('transactions')
      .select('*, categories(name, icon), wallets(name, icon)')
      .eq('user_id', session.user.id)
      .or(
        'and(date.gte.' + trip.start_date + ',' + (trip.end_date ? 'date.lte.' + trip.end_date : 'date.gte.' + trip.start_date) + '),trip_id.eq.' + trip.id
      )
      .neq('wallets.pocket', 'kantor') // exclude kantor pocket
      .order('date', { ascending: false })

    // Deduplicate
    const seen = new Set<string>()
    const deduped = (data || []).filter((t: Transaction) => {
      if (seen.has(t.id)) return false
      seen.add(t.id)
      return true
    })
    setTransactions(deduped)
    setTxLoading(false)
  }, [session])

  useEffect(() => {
    if (selectedTrip) loadTripTransactions(selectedTrip)
  }, [selectedTrip, loadTripTransactions])

  // -- Load compare trip transactions --
  useEffect(() => {
    const load = async () => {
      if (!compareTrip || !session) return
      const { data } = await supabase
        .from('transactions')
        .select('*, categories(name, icon), wallets(name, icon)')
        .eq('user_id', session.user.id)
        .or(
          'and(date.gte.' + compareTrip.start_date + ',' + (compareTrip.end_date ? 'date.lte.' + compareTrip.end_date : 'date.gte.' + compareTrip.start_date) + '),trip_id.eq.' + compareTrip.id
        )
        .order('date', { ascending: false })
      const seen = new Set<string>()
      const deduped = (data || []).filter((t: Transaction) => {
        if (seen.has(t.id)) return false
        seen.add(t.id)
        return true
      })
      setCompareTx(deduped)
    }
    load()
  }, [compareTrip, session])

  // -- Load all user transactions for manual tagging --
  const loadAllUserTx = useCallback(async () => {
    if (!session || !selectedTrip) return
    const { data } = await supabase
      .from('transactions')
      .select('*, categories(name, icon), wallets(name, icon)')
      .eq('user_id', session.user.id)
      .eq('type', 'expense')
      .order('date', { ascending: false })
      .limit(100)
    setAllUserTx(data || [])
  }, [session, selectedTrip])

  // -- Stats helper --
  function calcStats(txs: Transaction[]) {
    const expenses = txs.filter(t => t.type === 'expense')
    const income = txs.filter(t => t.type === 'income')
    const totalExpense = expenses.reduce((s, t) => s + Number(t.amount), 0)
    const totalIncome = income.reduce((s, t) => s + Number(t.amount), 0)

    const catMap = new Map<string, CategoryBreakdown>()
    for (const t of expenses) {
      const key = t.categories?.name || 'Lainnya'
      const icon = t.categories?.icon || '📦'
      const cur = catMap.get(key) || { name: key, icon, total: 0, count: 0 }
      cur.total += Number(t.amount)
      cur.count++
      catMap.set(key, cur)
    }
    const breakdown = Array.from(catMap.values()).sort((a, b) => b.total - a.total)

    return { totalExpense, totalIncome, breakdown, count: expenses.length }
  }

  // -- Save trip --
  async function saveTrip() {
    if (!session || !form.name || !form.start_date) return
    const payload = {
      user_id: session.user.id,
      name: form.name.trim(),
      emoji: form.emoji,
      start_date: form.start_date,
      end_date: form.end_date || null,
      notes: form.notes || null,
    }
    if (editingTrip) {
      await supabase.from('trips').update(payload).eq('id', editingTrip.id)
    } else {
      await supabase.from('trips').insert(payload)
    }
    setShowTripModal(false)
    setEditingTrip(null)
    setForm(emptyForm)
    loadTrips()
    if (editingTrip && selectedTrip?.id === editingTrip.id) {
      const { data } = await supabase.from('trips').select('*').eq('id', editingTrip.id).single()
      if (data) setSelectedTrip(data)
    }
  }

  async function deleteTrip(trip: Trip) {
    await supabase.from('trips').delete().eq('id', trip.id)
    setDeleteConfirm(null)
    if (selectedTrip?.id === trip.id) setSelectedTrip(null)
    loadTrips()
  }

  // -- Toggle manual tag --
  async function toggleTag(tx: Transaction) {
    if (!selectedTrip) return
    const isTagged = tx.trip_id === selectedTrip.id
    await supabase
      .from('transactions')
      .update({ trip_id: isTagged ? null : selectedTrip.id })
      .eq('id', tx.id)
    loadTripTransactions(selectedTrip)
    loadAllUserTx()
  }

  // -- Render --
  const stats = selectedTrip ? calcStats(transactions) : null
  const compareStats = compareTrip ? calcStats(compareTx) : null
  const days = selectedTrip ? tripDays(selectedTrip.start_date, selectedTrip.end_date) : 1

  return (
    <div className="bg-surface-50 min-h-screen">
    <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-4 pt-16 lg:pt-6 pb-24">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-extrabold text-surface-900">🧳 Trip & Healing</h1>
          <p className="text-xs text-surface-400">{trips.length} trip tercatat</p>
        </div>
        <button
          onClick={() => { setEditingTrip(null); setForm(emptyForm); setShowTripModal(true) }}
          className="btn btn-primary py-2.5 px-4 text-sm"
        >
          + Buat Trip
        </button>
      </div>
        {/* Trip list */}
        {loading ? (
          <div className="text-center py-12 text-surface-400 text-sm">Memuat...</div>
        ) : trips.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-4xl mb-3">🗺️</p>
            <p className="text-surface-400 text-sm">Belum ada trip. Yuk catat perjalananmu!</p>
          </div>
        ) : (
          <div className="space-y-2">
            {trips.map(trip => (
              <div
                key={trip.id}
                onClick={() => setSelectedTrip(trip.id === selectedTrip?.id ? null : trip)}
                className={`card p-3 cursor-pointer transition-all ${selectedTrip?.id === trip.id ? 'ring-2 ring-brand-500' : ''}`}
              >
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{trip.emoji}</span>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm text-surface-900 truncate">{trip.name}</p>
                    <p className="text-[11px] text-surface-400">
                      {formatDateRange(trip.start_date, trip.end_date)} · {tripDays(trip.start_date, trip.end_date)} hari
                    </p>
                  </div>
                  <div className="flex gap-1.5">
                    <button
                      onClick={e => {
                        e.stopPropagation()
                        setEditingTrip(trip)
                        setForm({ name: trip.name, emoji: trip.emoji, start_date: trip.start_date, end_date: trip.end_date || '', notes: trip.notes || '' })
                        setShowTripModal(true)
                      }}
                      className="text-surface-400 hover:text-surface-900 text-sm p-1"
                    >✏️</button>
                    <button
                      onClick={e => { e.stopPropagation(); setDeleteConfirm(trip) }}
                      className="text-surface-400 hover:text-red-500 text-sm p-1"
                    >🗑️</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Trip detail */}
        {selectedTrip && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 pt-2">
              <h2 className="text-base font-bold text-surface-900 flex-1">{selectedTrip.emoji} {selectedTrip.name}</h2>
              {/* Compare toggle */}
              <button
                onClick={() => { setCompareMode(!compareMode); if (compareMode) { setCompareTrip(null); setCompareTx([]) } }}
                className={`btn-ghost text-xs px-2 py-1 ${compareMode ? 'text-brand-600' : ''}`}
              >
                {compareMode ? '✕ Tutup Compare' : '⚖️ Compare'}
              </button>
            </div>

            {/* Compare selector */}
            {compareMode && (
              <div>
                <label className="label text-xs">Bandingkan dengan:</label>
                <select
                  className="input text-sm"
                  value={compareTrip?.id || ''}
                  onChange={e => {
                    const t = trips.find(x => x.id === e.target.value)
                    setCompareTrip(t || null)
                  }}
                >
                  <option value="">-- Pilih trip --</option>
                  {trips.filter(t => t.id !== selectedTrip.id).map(t => (
                    <option key={t.id} value={t.id}>{t.emoji} {t.name}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Tabs */}
            <div className="flex gap-1 bg-white rounded-xl p-1">
              {(['summary', 'transactions'] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all ${activeTab === tab ? 'bg-brand-600 text-white' : 'text-surface-400'}`}
                >
                  {tab === 'summary' ? '📊 Ringkasan' : '📋 Transaksi'}
                </button>
              ))}
            </div>

            {txLoading ? (
              <div className="text-center py-8 text-sm text-surface-400">Memuat transaksi...</div>
            ) : activeTab === 'summary' ? (
              <SummaryTab
                trip={selectedTrip}
                stats={stats!}
                days={days}
                compareTrip={compareTrip}
                compareStats={compareStats}
                compareDays={compareTrip ? tripDays(compareTrip.start_date, compareTrip.end_date) : 1}
              />
            ) : (
              <TransactionTab
                transactions={transactions}
                trip={selectedTrip}
                onTagPress={() => { loadAllUserTx(); setShowTagModal(true) }}
              />
            )}
          </div>
        )}
      </div>

      {/* -- Modals -- */}

      {/* Trip form modal */}
      <Modal open={showTripModal} onClose={() => { setShowTripModal(false); setEditingTrip(null) }}>
        <h2 className="font-bold text-base text-surface-900 mb-4">{editingTrip ? 'Edit Trip' : 'Buat Trip Baru'}</h2>
        <div className="space-y-3">
          {/* Emoji picker */}
          <div>
            <label className="label">Ikon</label>
            <div className="flex flex-wrap gap-2 mt-1">
              {EMOJIS.map(e => (
                <button
                  key={e}
                  onClick={() => setForm(f => ({ ...f, emoji: e }))}
                  className={`text-xl p-1.5 rounded-lg border-2 transition-all ${form.emoji === e ? 'border-brand-500 bg-brand-50' : 'border-transparent'}`}
                >
                  {e}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="label">Nama Trip</label>
            <input className="input" placeholder="contoh: Liburan Bali 2025" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label">Tanggal Mulai</label>
              <input type="date" className="input" value={form.start_date} onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))} />
            </div>
            <div>
              <label className="label">Tanggal Selesai</label>
              <input type="date" className="input" value={form.end_date} onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))} />
            </div>
          </div>

          <div>
            <label className="label">Catatan (opsional)</label>
            <input className="input" placeholder="Destinasi, tujuan, dll..." value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
          </div>

          <button
            onClick={saveTrip}
            disabled={!form.name || !form.start_date}
            className="btn w-full"
          >
            {editingTrip ? 'Simpan Perubahan' : 'Buat Trip'}
          </button>
        </div>
      </Modal>

      {/* Tag modal */}
      <Modal open={showTagModal} onClose={() => setShowTagModal(false)}>
        <h2 className="font-bold text-sm text-surface-900 mb-1">Tag Transaksi Manual</h2>
        <p className="text-[11px] text-surface-400 mb-3">
          Transaksi di luar rentang tanggal trip yang ingin kamu masukkan ke trip ini.
        </p>
        <div className="space-y-2 max-h-72 overflow-y-auto">
          {allUserTx
            .filter(t => {
              // exclude transactions already in date range
              const d = t.date
              const inRange = d >= selectedTrip!.start_date && (!selectedTrip!.end_date || d <= selectedTrip!.end_date)
              return !inRange || t.trip_id === selectedTrip!.id
            })
            .map(tx => {
              const isTagged = tx.trip_id === selectedTrip?.id
              const inRange = tx.date >= selectedTrip!.start_date && (!selectedTrip!.end_date || tx.date <= selectedTrip!.end_date)
              if (inRange && !isTagged) return null // already in by date, not manually tagged elsewhere
              return (
                <div key={tx.id} className="flex items-center gap-2 p-2 rounded-lg bg-surface-50">
                  <span className="text-base">{tx.categories?.icon || '📦'}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-surface-900 truncate">{tx.description || tx.categories?.name || 'Transaksi'}</p>
                    <p className="text-[10px] text-surface-400">{tx.date} · {fmt(Number(tx.amount))}</p>
                  </div>
                  <button
                    onClick={() => toggleTag(tx)}
                    className={`text-xs px-2 py-1 rounded-lg font-semibold transition-all ${isTagged ? 'bg-brand-100 text-brand-700' : 'bg-white text-surface-400'}`}
                  >
                    {isTagged ? '✓ Tagged' : '+ Tag'}
                  </button>
                </div>
              )
            })}
        </div>
        <button onClick={() => setShowTagModal(false)} className="btn w-full mt-3">Selesai</button>
      </Modal>

      {/* Delete confirm */}
      <Modal open={!!deleteConfirm} onClose={() => setDeleteConfirm(null)}>
        <p className="text-sm font-semibold text-surface-900 mb-1">Hapus trip "{deleteConfirm?.name}"?</p>
        <p className="text-xs text-surface-400 mb-4">Data trip akan dihapus. Transaksi yang sudah ditag ke trip ini tidak ikut terhapus.</p>
        <div className="flex gap-2">
          <button onClick={() => setDeleteConfirm(null)} className="btn-ghost flex-1">Batal</button>
          <button onClick={() => deleteTrip(deleteConfirm!)} className="flex-1 py-2 rounded-xl bg-red-500 text-white text-sm font-semibold">Hapus</button>
        </div>
      </Modal>
    </div>
    </div>
  )
}

// --- Summary Tab --------------------------------------------------------------

interface TripStats {
  totalExpense: number
  totalIncome: number
  breakdown: CategoryBreakdown[]
  count: number
}

function SummaryTab({
  trip, stats, days,
  compareTrip, compareStats, compareDays,
}: {
  trip: Trip
  stats: TripStats
  days: number
  compareTrip: Trip | null
  compareStats: TripStats | null
  compareDays: number
}) {
  const perDay = days > 0 ? stats.totalExpense / days : 0
  const comparePerDay = compareDays > 0 && compareStats ? compareStats.totalExpense / compareDays : 0

  return (
    <div className="space-y-3">
      {/* Main cards */}
      <div className={`grid gap-2 ${compareTrip && compareStats ? 'grid-cols-2' : 'grid-cols-1'}`}>
        <TripStatCard
          trip={trip}
          stats={stats}
          days={days}
          perDay={perDay}
          highlighted
        />
        {compareTrip && compareStats && (
          <TripStatCard
            trip={compareTrip}
            stats={compareStats}
            days={compareDays}
            perDay={comparePerDay}
          />
        )}
      </div>

      {/* Perbandingan diff */}
      {compareTrip && compareStats && (
        <div className="card p-3 bg-blue-50 dark:bg-blue-950/20 border border-blue-200">
          <p className="text-[11px] font-bold text-blue-700 uppercase mb-2">⚖️ Selisih</p>
          <div className="space-y-1.5">
            <DiffRow label="Total Expense" a={stats.totalExpense} b={compareStats.totalExpense} />
            <DiffRow label="Per Hari" a={perDay} b={comparePerDay} />
          </div>
        </div>
      )}

      {/* Kategori breakdown */}
      {stats.breakdown.length > 0 && (
        <div className="card p-3">
          <p className="text-[11px] font-bold text-surface-400 uppercase mb-3">📊 Breakdown Kategori</p>
          <div className="space-y-2">
            {stats.breakdown.map((cat, i) => {
              const pct = stats.totalExpense > 0 ? (cat.total / stats.totalExpense) * 100 : 0
              const compareCat = compareStats?.breakdown.find(c => c.name === cat.name)
              return (
                <div key={i}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm">{cat.icon}</span>
                    <span className="text-xs text-surface-900 flex-1">{cat.name}</span>
                    <span className="text-xs font-semibold font-mono text-surface-900">{fmtShort(cat.total)}</span>
                    {compareTrip && compareCat && (
                      <span className="text-[10px] text-surface-400 font-mono ml-1">vs {fmtShort(compareCat.total)}</span>
                    )}
                    <span className="text-[10px] text-surface-400 w-8 text-right">{pct.toFixed(0)}%</span>
                  </div>
                  <div className="h-1.5 bg-surface-200 rounded-full overflow-hidden">
                    <div className="h-full bg-brand-500 rounded-full" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {stats.count === 0 && (
        <div className="text-center py-8 text-sm text-surface-400">
          Belum ada pengeluaran di rentang tanggal trip ini.
        </div>
      )}
    </div>
  )
}

function TripStatCard({ trip, stats, days, perDay, highlighted }: {
  trip: Trip; stats: TripStats; days: number; perDay: number; highlighted?: boolean
}) {
  return (
    <div className={`card p-3 ${highlighted ? 'ring-2 ring-brand-500' : ''}`}>
      <p className="text-[10px] font-bold text-surface-400 uppercase truncate mb-2">{trip.emoji} {trip.name}</p>
      <p className="text-[11px] text-surface-400">Total Expense</p>
      <p className="text-base font-extrabold text-red-600 font-mono leading-tight">{fmtShort(stats.totalExpense)}</p>
      <div className="mt-2 pt-2 border-t border-surface-200 space-y-1">
        <div className="flex justify-between text-[10px]">
          <span className="text-surface-400">Durasi</span>
          <span className="font-semibold text-surface-900">{days} hari</span>
        </div>
        <div className="flex justify-between text-[10px]">
          <span className="text-surface-400">Per hari</span>
          <span className="font-semibold text-surface-900 font-mono">{fmtShort(perDay)}</span>
        </div>
        <div className="flex justify-between text-[10px]">
          <span className="text-surface-400">Transaksi</span>
          <span className="font-semibold text-surface-900">{stats.count}x</span>
        </div>
      </div>
    </div>
  )
}

function DiffRow({ label, a, b }: { label: string; a: number; b: number }) {
  const diff = a - b
  const pct = b > 0 ? Math.abs((diff / b) * 100).toFixed(0) : '—'
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-blue-700">{label}</span>
      <span className={`font-semibold font-mono ${diff > 0 ? 'text-red-600' : diff < 0 ? 'text-green-600' : 'text-surface-400'}`}>
        {diff > 0 ? '+' : diff < 0 ? '-' : ''}{fmtShort(Math.abs(diff))}
        {b > 0 && <span className="text-[10px] font-normal ml-1">({pct}%)</span>}
      </span>
    </div>
  )
}

// --- Transaction Tab -----------------------------------------------------------

function TransactionTab({ transactions, trip, onTagPress }: {
  transactions: Transaction[]
  trip: Trip
  onTagPress: () => void
}) {
  const expenses = transactions.filter(t => t.type === 'expense')
  const income = transactions.filter(t => t.type === 'income')

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-surface-400">{transactions.length} transaksi ditemukan</p>
        <button onClick={onTagPress} className="btn-ghost text-xs px-2 py-1">+ Tag Manual</button>
      </div>

      {transactions.length === 0 && (
        <div className="text-center py-8 text-sm text-surface-400">
          Belum ada transaksi di rentang waktu ini.
        </div>
      )}

      {expenses.length > 0 && (
        <div>
          <p className="text-[10px] font-bold text-surface-400 uppercase mb-2">💸 Pengeluaran</p>
          <div className="space-y-1.5">
            {expenses.map(tx => (
              <TxRow key={tx.id} tx={tx} trip={trip} />
            ))}
          </div>
        </div>
      )}

      {income.length > 0 && (
        <div>
          <p className="text-[10px] font-bold text-surface-400 uppercase mb-2 mt-3">💰 Pemasukan</p>
          <div className="space-y-1.5">
            {income.map(tx => (
              <TxRow key={tx.id} tx={tx} trip={trip} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function TxRow({ tx, trip }: { tx: Transaction; trip: Trip }) {
  const isManualTag = tx.trip_id === trip.id
  const inRange = tx.date >= trip.start_date && (!trip.end_date || tx.date <= trip.end_date)

  return (
    <div className="flex items-center gap-2 p-2.5 rounded-xl bg-white">
      <span className="text-base">{tx.categories?.icon || '📦'}</span>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-surface-900 truncate">{tx.description || tx.categories?.name || 'Transaksi'}</p>
        <p className="text-[10px] text-surface-400">
          {tx.date} · {tx.wallets?.name || '—'}
          {isManualTag && !inRange && <span className="ml-1 text-brand-600">• tag manual</span>}
        </p>
      </div>
      <span className={`text-xs font-bold font-mono ${tx.type === 'expense' ? 'text-red-600' : 'text-green-600'}`}>
        {tx.type === 'expense' ? '-' : '+'}{fmtShort(Number(tx.amount))}
      </span>
    </div>
  )
}
