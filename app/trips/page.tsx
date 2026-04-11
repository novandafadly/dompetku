'use client'

import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import type { Session } from '@supabase/supabase-js'

interface Trip {
  id: string
  name: string
  emoji: string
  start_date: string
  end_date: string | null
  notes: string | null
  created_at: string
}

interface TxCategory {
  name: string
  icon: string
}

interface TxWallet {
  name: string
  pocket: string
}

interface Tx {
  id: string
  wallet_id: string
  category_id: string | null
  type: 'income' | 'expense'
  amount: number
  description: string | null
  date: string
  trip_id: string | null
  categories?: TxCategory | null
  wallets?: TxWallet | null
}

interface CatBreakdown {
  name: string
  icon: string
  total: number
  count: number
}

interface TripStats {
  totalExpense: number
  totalIncome: number
  breakdown: CatBreakdown[]
  count: number
}

function fmtCurrency(n: number): string {
  return 'Rp ' + Math.abs(n).toLocaleString('id-ID', { maximumFractionDigits: 0 })
}

function fmtShort(n: number): string {
  if (n >= 1000000) return 'Rp ' + (n / 1000000).toFixed(1) + 'jt'
  if (n >= 1000) return 'Rp ' + (n / 1000).toFixed(0) + 'rb'
  return fmtCurrency(n)
}

function fmtDateRange(start: string, end: string | null): string {
  const s = new Date(start)
  if (!end) return s.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })
  const e = new Date(end)
  const mo: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }
  if (s.getFullYear() === e.getFullYear()) {
    if (s.getMonth() === e.getMonth()) {
      return s.getDate() + '-' + e.getDate() + ' ' + s.toLocaleDateString('id-ID', { month: 'short', year: 'numeric' })
    }
    return s.toLocaleDateString('id-ID', mo) + ' - ' + e.toLocaleDateString('id-ID', { ...mo, year: 'numeric' })
  }
  return s.toLocaleDateString('id-ID', { ...mo, year: 'numeric' }) + ' - ' + e.toLocaleDateString('id-ID', { ...mo, year: 'numeric' })
}

function getDays(start: string, end: string | null): number {
  if (!end) return 1
  const diff = new Date(end).getTime() - new Date(start).getTime()
  return Math.max(1, Math.round(diff / 86400000) + 1)
}

function calcStats(txs: Tx[]): TripStats {
  const expenses = txs.filter(function(t) { return t.type === 'expense' })
  const totalExpense = expenses.reduce(function(s, t) { return s + Number(t.amount) }, 0)
  const totalIncome = txs.filter(function(t) { return t.type === 'income' }).reduce(function(s, t) { return s + Number(t.amount) }, 0)
  const catMap = new Map<string, CatBreakdown>()
  expenses.forEach(function(t) {
    const key = (t.categories && t.categories.name) ? t.categories.name : 'Lainnya'
    const icon = (t.categories && t.categories.icon) ? t.categories.icon : '📦'
    const cur = catMap.get(key) || { name: key, icon: icon, total: 0, count: 0 }
    cur.total += Number(t.amount)
    cur.count++
    catMap.set(key, cur)
  })
  const breakdown = Array.from(catMap.values()).sort(function(a, b) { return b.total - a.total })
  return { totalExpense, totalIncome, breakdown, count: expenses.length }
}

function buildOrQuery(trip: Trip): string {
  const start = trip.start_date
  const end = trip.end_date
  const dateFilter = end
    ? 'and(date.gte.' + start + ',date.lte.' + end + ')'
    : 'and(date.gte.' + start + ',date.lte.' + start + ')'
  return dateFilter + ',trip_id.eq.' + trip.id
}

function SimpleModal(props: { open: boolean; onClose: () => void; children: React.ReactNode }) {
  if (!props.open) return null
  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40"
      onClick={props.onClose}
    >
      <div
        className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-5 shadow-2xl"
        onClick={function(e) { e.stopPropagation() }}
      >
        {props.children}
      </div>
    </div>
  )
}

const EMOJI_LIST = [
  { key: 'airplane', val: '\u2708\uFE0F' },
  { key: 'beach', val: '\uD83C\uDFD6\uFE0F' },
  { key: 'mountain', val: '\u26F0\uFE0F' },
  { key: 'tent', val: '\uD83C\uDFD5\uFE0F' },
  { key: 'car', val: '\uD83D\uDE97' },
  { key: 'train', val: '\uD83D\uDE82' },
  { key: 'ship', val: '\uD83D\uDEF3\uFE0F' },
  { key: 'globe', val: '\uD83C\uDF0F' },
  { key: 'luggage', val: '\uD83E\uDDF3' },
]

export default function TripPage() {
  const [session, setSession] = useState<Session | null>(null)
  const [trips, setTrips] = useState<Trip[]>([])
  const [selectedTrip, setSelectedTrip] = useState<Trip | null>(null)
  const [txs, setTxs] = useState<Tx[]>([])
  const [allTxs, setAllTxs] = useState<Tx[]>([])
  const [loading, setLoading] = useState(true)
  const [txLoading, setTxLoading] = useState(false)
  const [activeTab, setActiveTab] = useState<'summary' | 'transactions'>('summary')
  const [compareMode, setCompareMode] = useState(false)
  const [compareTrip, setCompareTrip] = useState<Trip | null>(null)
  const [compareTxs, setCompareTxs] = useState<Tx[]>([])
  const [showForm, setShowForm] = useState(false)
  const [showTagModal, setShowTagModal] = useState(false)
  const [editTrip, setEditTrip] = useState<Trip | null>(null)
  const [delConfirm, setDelConfirm] = useState<Trip | null>(null)
  const [formName, setFormName] = useState('')
  const [formEmoji, setFormEmoji] = useState('airplane')
  const [formStart, setFormStart] = useState('')
  const [formEnd, setFormEnd] = useState('')
  const [formNotes, setFormNotes] = useState('')

  useEffect(function() {
    supabase.auth.getSession().then(function(res) { setSession(res.data.session) })
    const sub = supabase.auth.onAuthStateChange(function(_, s) { setSession(s) })
    return function() { sub.data.subscription.unsubscribe() }
  }, [])

  const loadTrips = useCallback(async function() {
    if (!session) return
    setLoading(true)
    const res = await supabase
      .from('trips')
      .select('*')
      .eq('user_id', session.user.id)
      .order('start_date', { ascending: false })
    setTrips(res.data || [])
    setLoading(false)
  }, [session])

  useEffect(function() { loadTrips() }, [loadTrips])

  const loadTripTxs = useCallback(async function(trip: Trip) {
    if (!session) return
    setTxLoading(true)
    const orQuery = buildOrQuery(trip)
    const res = await supabase
      .from('transactions')
      .select('*, categories(name, icon), wallets(name, pocket)')
      .eq('user_id', session.user.id)
      .or(orQuery)
      .order('date', { ascending: false })
    const data = (res.data || []) as Tx[]
    const seen = new Set<string>()
    const deduped = data.filter(function(t) {
      if (seen.has(t.id)) return false
      seen.add(t.id)
      return true
    }).filter(function(t) {
      return !(t.wallets && t.wallets.pocket === 'kantor')
    })
    setTxs(deduped)
    setTxLoading(false)
  }, [session])

  useEffect(function() {
    if (selectedTrip) loadTripTxs(selectedTrip)
  }, [selectedTrip, loadTripTxs])

  useEffect(function() {
    async function load() {
      if (!compareTrip || !session) return
      const orQuery = buildOrQuery(compareTrip)
      const res = await supabase
        .from('transactions')
        .select('*, categories(name, icon), wallets(name, pocket)')
        .eq('user_id', session.user.id)
        .or(orQuery)
        .order('date', { ascending: false })
      const data = (res.data || []) as Tx[]
      const seen = new Set<string>()
      const deduped = data.filter(function(t) {
        if (seen.has(t.id)) return false
        seen.add(t.id)
        return true
      })
      setCompareTxs(deduped)
    }
    load()
  }, [compareTrip, session])

  async function loadAllTxs() {
    if (!session) return
    const res = await supabase
      .from('transactions')
      .select('*, categories(name, icon), wallets(name, pocket)')
      .eq('user_id', session.user.id)
      .eq('type', 'expense')
      .order('date', { ascending: false })
      .limit(100)
    setAllTxs((res.data || []) as Tx[])
  }

  function openAdd() {
    setEditTrip(null)
    setFormName('')
    setFormEmoji('airplane')
    setFormStart('')
    setFormEnd('')
    setFormNotes('')
    setShowForm(true)
  }

  function openEdit(trip: Trip) {
    setEditTrip(trip)
    setFormName(trip.name)
    const found = EMOJI_LIST.find(function(e) { return e.val === trip.emoji })
    setFormEmoji(found ? found.key : 'airplane')
    setFormStart(trip.start_date)
    setFormEnd(trip.end_date || '')
    setFormNotes(trip.notes || '')
    setShowForm(true)
  }

  async function saveTrip() {
    if (!session || !formName || !formStart) return
    const found = EMOJI_LIST.find(function(e) { return e.key === formEmoji })
    const payload = {
      user_id: session.user.id,
      name: formName.trim(),
      emoji: found ? found.val : EMOJI_LIST[0].val,
      start_date: formStart,
      end_date: formEnd || null,
      notes: formNotes || null,
    }
    if (editTrip) {
      await supabase.from('trips').update(payload).eq('id', editTrip.id)
    } else {
      await supabase.from('trips').insert(payload)
    }
    setShowForm(false)
    loadTrips()
  }

  async function deleteTrip(trip: Trip) {
    await supabase.from('trips').delete().eq('id', trip.id)
    setDelConfirm(null)
    if (selectedTrip && selectedTrip.id === trip.id) setSelectedTrip(null)
    loadTrips()
  }

  async function toggleTag(tx: Tx) {
    if (!selectedTrip) return
    const isTagged = tx.trip_id === selectedTrip.id
    await supabase
      .from('transactions')
      .update({ trip_id: isTagged ? null : selectedTrip.id })
      .eq('id', tx.id)
    loadTripTxs(selectedTrip)
    loadAllTxs()
  }

  const stats = selectedTrip ? calcStats(txs) : null
  const compareStats = compareTrip ? calcStats(compareTxs) : null
  const days = selectedTrip ? getDays(selectedTrip.start_date, selectedTrip.end_date) : 1
  const compareDays = compareTrip ? getDays(compareTrip.start_date, compareTrip.end_date) : 1

  return (
    <div className="min-h-screen bg-surface-50 pb-24">
      <div className="max-w-2xl mx-auto px-4 pt-16 lg:pt-6">

        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-xl font-extrabold text-surface-900">Trip &amp; Healing</h1>
            <p className="text-xs text-surface-400">{trips.length} trip tercatat</p>
          </div>
          <button onClick={openAdd} className="btn btn-primary py-2 px-4 text-sm">
            + Buat Trip
          </button>
        </div>

        {loading && (
          <div className="text-center py-12 text-surface-400 text-sm">Memuat...</div>
        )}

        {!loading && trips.length === 0 && (
          <div className="text-center py-16">
            <p className="text-4xl mb-3">🗺️</p>
            <p className="text-surface-400 text-sm">Belum ada trip. Yuk catat perjalananmu!</p>
          </div>
        )}

        {!loading && trips.length > 0 && (
          <div className="space-y-2 mb-4">
            {trips.map(function(trip) {
              const isSelected = selectedTrip !== null && selectedTrip.id === trip.id
              return (
                <div
                  key={trip.id}
                  onClick={function() { setSelectedTrip(isSelected ? null : trip) }}
                  className={'card p-3 cursor-pointer transition-all ' + (isSelected ? 'ring-2 ring-brand-500' : '')}
                >
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">{trip.emoji}</span>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm text-surface-800 truncate">{trip.name}</p>
                      <p className="text-[11px] text-surface-400">
                        {fmtDateRange(trip.start_date, trip.end_date)} &middot; {getDays(trip.start_date, trip.end_date)} hari
                      </p>
                    </div>
                    <div className="flex gap-1">
                      <button
                        onClick={function(e) { e.stopPropagation(); openEdit(trip) }}
                        className="p-1 text-surface-400 hover:text-surface-700"
                      >
                        ✏️
                      </button>
                      <button
                        onClick={function(e) { e.stopPropagation(); setDelConfirm(trip) }}
                        className="p-1 text-surface-400 hover:text-red-500"
                      >
                        🗑️
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {selectedTrip && (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-surface-900 flex-1">
                {selectedTrip.emoji} {selectedTrip.name}
              </h2>
              <button
                onClick={function() {
                  const next = !compareMode
                  setCompareMode(next)
                  if (!next) { setCompareTrip(null); setCompareTxs([]) }
                }}
                className={'btn-ghost text-xs px-2 py-1 ' + (compareMode ? 'text-brand-600' : '')}
              >
                {compareMode ? 'Tutup Compare' : 'Compare'}
              </button>
            </div>

            {compareMode && (
              <div>
                <label className="label text-xs">Bandingkan dengan:</label>
                <select
                  className="input text-sm"
                  value={compareTrip ? compareTrip.id : ''}
                  onChange={function(e) {
                    const found = trips.find(function(x) { return x.id === e.target.value })
                    setCompareTrip(found || null)
                  }}
                >
                  <option value="">-- Pilih trip --</option>
                  {trips.filter(function(t) { return t.id !== selectedTrip.id }).map(function(t) {
                    return <option key={t.id} value={t.id}>{t.emoji} {t.name}</option>
                  })}
                </select>
              </div>
            )}

            <div className="flex gap-1 bg-surface-100 p-1 rounded-xl">
              <button
                onClick={function() { setActiveTab('summary') }}
                className={'flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all ' + (activeTab === 'summary' ? 'bg-brand-600 text-white' : 'text-surface-500')}
              >
                Ringkasan
              </button>
              <button
                onClick={function() { setActiveTab('transactions') }}
                className={'flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all ' + (activeTab === 'transactions' ? 'bg-brand-600 text-white' : 'text-surface-500')}
              >
                Transaksi
              </button>
            </div>

            {txLoading && (
              <div className="text-center py-8 text-sm text-surface-400">Memuat transaksi...</div>
            )}

            {!txLoading && activeTab === 'summary' && stats !== null && (
              <SummarySection
                trip={selectedTrip}
                stats={stats}
                days={days}
                compareTrip={compareTrip}
                compareStats={compareStats}
                compareDays={compareDays}
              />
            )}

            {!txLoading && activeTab === 'transactions' && (
              <TxSection
                txs={txs}
                trip={selectedTrip}
                onTagPress={function() { loadAllTxs(); setShowTagModal(true) }}
              />
            )}
          </div>
        )}

      </div>

      <SimpleModal open={showForm} onClose={function() { setShowForm(false) }}>
        <h2 className="font-bold text-base text-surface-900 mb-4">
          {editTrip ? 'Edit Trip' : 'Buat Trip Baru'}
        </h2>
        <div className="space-y-3">
          <div>
            <label className="label">Ikon</label>
            <div className="flex flex-wrap gap-2 mt-1">
              {EMOJI_LIST.map(function(e) {
                return (
                  <button
                    key={e.key}
                    onClick={function() { setFormEmoji(e.key) }}
                    className={'text-xl p-1.5 rounded-lg border-2 transition-all ' + (formEmoji === e.key ? 'border-brand-500 bg-brand-50' : 'border-transparent')}
                  >
                    {e.val}
                  </button>
                )
              })}
            </div>
          </div>
          <div>
            <label className="label">Nama Trip</label>
            <input
              className="input"
              placeholder="contoh: Liburan Bali 2025"
              value={formName}
              onChange={function(e) { setFormName(e.target.value) }}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label">Tanggal Mulai</label>
              <input
                type="date"
                className="input"
                value={formStart}
                onChange={function(e) { setFormStart(e.target.value) }}
              />
            </div>
            <div>
              <label className="label">Tanggal Selesai</label>
              <input
                type="date"
                className="input"
                value={formEnd}
                onChange={function(e) { setFormEnd(e.target.value) }}
              />
            </div>
          </div>
          <div>
            <label className="label">Catatan (opsional)</label>
            <input
              className="input"
              placeholder="Destinasi, tujuan, dll..."
              value={formNotes}
              onChange={function(e) { setFormNotes(e.target.value) }}
            />
          </div>
          <button
            onClick={saveTrip}
            disabled={!formName || !formStart}
            className="btn btn-primary w-full"
          >
            {editTrip ? 'Simpan Perubahan' : 'Buat Trip'}
          </button>
        </div>
      </SimpleModal>

      <SimpleModal open={showTagModal} onClose={function() { setShowTagModal(false) }}>
        <h2 className="font-bold text-sm text-surface-900 mb-1">Tag Transaksi Manual</h2>
        <p className="text-[11px] text-surface-400 mb-3">
          Tambah transaksi di luar rentang tanggal trip ini.
        </p>
        <div className="space-y-2 max-h-72 overflow-y-auto">
          {allTxs.map(function(tx) {
            if (!selectedTrip) return null
            const inRange = tx.date >= selectedTrip.start_date &&
              (selectedTrip.end_date === null || tx.date <= selectedTrip.end_date)
            const isTagged = tx.trip_id === selectedTrip.id
            if (inRange && !isTagged) return null
            return (
              <div key={tx.id} className="flex items-center gap-2 p-2 rounded-lg bg-surface-50">
                <span className="text-base">{tx.categories ? tx.categories.icon : '📦'}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-surface-800 truncate">
                    {tx.description || (tx.categories ? tx.categories.name : 'Transaksi')}
                  </p>
                  <p className="text-[10px] text-surface-400">{tx.date} &middot; {fmtCurrency(Number(tx.amount))}</p>
                </div>
                <button
                  onClick={function() { toggleTag(tx) }}
                  className={'text-xs px-2 py-1 rounded-lg font-semibold transition-all ' + (isTagged ? 'bg-brand-100 text-brand-700' : 'bg-surface-200 text-surface-500')}
                >
                  {isTagged ? 'Tagged' : '+ Tag'}
                </button>
              </div>
            )
          })}
        </div>
        <button onClick={function() { setShowTagModal(false) }} className="btn btn-primary w-full mt-3">
          Selesai
        </button>
      </SimpleModal>

      <SimpleModal open={delConfirm !== null} onClose={function() { setDelConfirm(null) }}>
        <p className="text-sm font-semibold text-surface-900 mb-1">
          Hapus trip {delConfirm ? '"' + delConfirm.name + '"' : ''}?
        </p>
        <p className="text-xs text-surface-400 mb-4">
          Data trip dihapus. Transaksi yang ditag tidak ikut terhapus.
        </p>
        <div className="flex gap-2">
          <button onClick={function() { setDelConfirm(null) }} className="btn-ghost flex-1">Batal</button>
          <button
            onClick={function() { if (delConfirm) deleteTrip(delConfirm) }}
            className="flex-1 py-2 rounded-xl bg-red-500 text-white text-sm font-semibold"
          >
            Hapus
          </button>
        </div>
      </SimpleModal>

    </div>
  )
}

function SummarySection(props: {
  trip: Trip
  stats: TripStats
  days: number
  compareTrip: Trip | null
  compareStats: TripStats | null
  compareDays: number
}) {
  const perDay = props.days > 0 ? props.stats.totalExpense / props.days : 0
  const comparePerDay = props.compareDays > 0 && props.compareStats ? props.compareStats.totalExpense / props.compareDays : 0
  const hasCompare = props.compareTrip !== null && props.compareStats !== null

  return (
    <div className="space-y-3">
      <div className={hasCompare ? 'grid grid-cols-2 gap-2' : ''}>
        <StatCard trip={props.trip} stats={props.stats} days={props.days} perDay={perDay} primary={true} />
        {hasCompare && props.compareStats && props.compareTrip && (
          <StatCard trip={props.compareTrip} stats={props.compareStats} days={props.compareDays} perDay={comparePerDay} primary={false} />
        )}
      </div>

      {hasCompare && props.compareStats && (
        <div className="card p-3 bg-blue-50 border border-blue-200">
          <p className="text-[11px] font-bold text-blue-700 uppercase mb-2">Selisih</p>
          <DiffRow label="Total Expense" a={props.stats.totalExpense} b={props.compareStats.totalExpense} />
          <DiffRow label="Per Hari" a={perDay} b={comparePerDay} />
        </div>
      )}

      {props.stats.breakdown.length > 0 && (
        <div className="card p-3">
          <p className="text-[11px] font-bold text-surface-400 uppercase mb-3">Breakdown Kategori</p>
          <div className="space-y-2">
            {props.stats.breakdown.map(function(cat, i) {
              const pct = props.stats.totalExpense > 0 ? (cat.total / props.stats.totalExpense) * 100 : 0
              return (
                <div key={i}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm">{cat.icon}</span>
                    <span className="text-xs text-surface-800 flex-1">{cat.name}</span>
                    <span className="text-xs font-semibold font-mono text-surface-800">{fmtShort(cat.total)}</span>
                    <span className="text-[10px] text-surface-400 w-8 text-right">{pct.toFixed(0)}%</span>
                  </div>
                  <div className="h-1.5 bg-surface-200 rounded-full overflow-hidden">
                    <div className="h-full bg-brand-500 rounded-full" style={{ width: pct + '%' }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {props.stats.count === 0 && (
        <div className="text-center py-8 text-sm text-surface-400">
          Belum ada pengeluaran di rentang tanggal ini.
        </div>
      )}
    </div>
  )
}

function StatCard(props: { trip: Trip; stats: TripStats; days: number; perDay: number; primary: boolean }) {
  return (
    <div className={'card p-3 ' + (props.primary ? 'ring-2 ring-brand-500' : '')}>
      <p className="text-[10px] font-bold text-surface-400 uppercase truncate mb-2">{props.trip.emoji} {props.trip.name}</p>
      <p className="text-[11px] text-surface-400">Total Expense</p>
      <p className="text-base font-extrabold text-red-600 font-mono leading-tight">{fmtShort(props.stats.totalExpense)}</p>
      <div className="mt-2 pt-2 border-t border-surface-100 space-y-1">
        <div className="flex justify-between text-[10px]">
          <span className="text-surface-400">Durasi</span>
          <span className="font-semibold text-surface-800">{props.days} hari</span>
        </div>
        <div className="flex justify-between text-[10px]">
          <span className="text-surface-400">Per hari</span>
          <span className="font-semibold text-surface-800 font-mono">{fmtShort(props.perDay)}</span>
        </div>
        <div className="flex justify-between text-[10px]">
          <span className="text-surface-400">Transaksi</span>
          <span className="font-semibold text-surface-800">{props.stats.count}x</span>
        </div>
      </div>
    </div>
  )
}

function DiffRow(props: { label: string; a: number; b: number }) {
  const diff = props.a - props.b
  const pct = props.b > 0 ? Math.abs((diff / props.b) * 100).toFixed(0) : null
  const color = diff > 0 ? 'text-red-600' : diff < 0 ? 'text-green-600' : 'text-surface-400'
  return (
    <div className="flex items-center justify-between text-xs mb-1">
      <span className="text-blue-700">{props.label}</span>
      <span className={'font-semibold font-mono ' + color}>
        {diff > 0 ? '+' : diff < 0 ? '-' : ''}{fmtShort(Math.abs(diff))}
        {pct && <span className="text-[10px] font-normal ml-1">({pct}%)</span>}
      </span>
    </div>
  )
}

function TxSection(props: { txs: Tx[]; trip: Trip; onTagPress: () => void }) {
  const expenses = props.txs.filter(function(t) { return t.type === 'expense' })
  const income = props.txs.filter(function(t) { return t.type === 'income' })

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-surface-400">{props.txs.length} transaksi</p>
        <button onClick={props.onTagPress} className="btn-ghost text-xs px-2 py-1">+ Tag Manual</button>
      </div>

      {props.txs.length === 0 && (
        <div className="text-center py-8 text-sm text-surface-400">
          Belum ada transaksi di rentang waktu ini.
        </div>
      )}

      {expenses.length > 0 && (
        <div>
          <p className="text-[10px] font-bold text-surface-400 uppercase mb-2">Pengeluaran</p>
          <div className="space-y-1.5">
            {expenses.map(function(tx) { return <TxRow key={tx.id} tx={tx} trip={props.trip} /> })}
          </div>
        </div>
      )}

      {income.length > 0 && (
        <div>
          <p className="text-[10px] font-bold text-surface-400 uppercase mb-2 mt-3">Pemasukan</p>
          <div className="space-y-1.5">
            {income.map(function(tx) { return <TxRow key={tx.id} tx={tx} trip={props.trip} /> })}
          </div>
        </div>
      )}
    </div>
  )
}

function TxRow(props: { tx: Tx; trip: Trip }) {
  const tx = props.tx
  const trip = props.trip
  const isManual = tx.trip_id === trip.id
  const inRange = tx.date >= trip.start_date && (trip.end_date === null || tx.date <= trip.end_date)
  return (
    <div className="flex items-center gap-2 p-2.5 rounded-xl bg-white border border-surface-100">
      <span className="text-base">{tx.categories ? tx.categories.icon : '📦'}</span>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-surface-800 truncate">
          {tx.description || (tx.categories ? tx.categories.name : 'Transaksi')}
        </p>
        <p className="text-[10px] text-surface-400">
          {tx.date}
          {isManual && !inRange && <span className="ml-1 text-brand-600">tag manual</span>}
        </p>
      </div>
      <span className={'text-xs font-bold font-mono ' + (tx.type === 'expense' ? 'text-red-600' : 'text-green-600')}>
        {tx.type === 'expense' ? '-' : '+'}{fmtShort(Number(tx.amount))}
      </span>
    </div>
  )
}
