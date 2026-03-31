'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Wallet, Transfer, Pocket, SavingsGoal } from '@/lib/supabase'
import { formatCurrency, formatDate, formatShort, WALLET_ICONS, WALLET_COLORS, POCKET_META } from '@/lib/utils'
import AppShell from '@/components/AppShell'
import Modal from '@/components/Modal'
import { toast } from '@/components/Toast'

type WalletType = 'cash' | 'bank' | 'ewallet' | 'investment'
type WalletForm = { name: string; type: WalletType; pocket: Pocket; balance: string }
type TransferForm = { from_wallet_id: string; to_wallet_id: string; amount: string; note: string; date: string }
type GoalForm = { wallet_id: string; name: string; target_amount: string; target_date: string; icon: string; color: string }

const emptyWalletForm: WalletForm = { name: '', type: 'bank', pocket: 'operasional', balance: '' }
const emptyTForm: TransferForm = { from_wallet_id: '', to_wallet_id: '', amount: '', note: '', date: new Date().toISOString().split('T')[0] }
const emptyGoalForm: GoalForm = { wallet_id: '', name: '', target_amount: '', target_date: '', icon: '🎯', color: '#22c55e' }

const GOAL_ICONS = ['🎯','🏠','🚗','✈️','💍','🎓','🖥️','📱','🏖️','💰','🏋️','🎮','👶','🏥','🛒','🎸']
const GOAL_COLORS = ['#22c55e','#3b82f6','#f59e0b','#ef4444','#a855f7','#ec4899','#06b6d4','#f97316']

function daysUntil(dateStr: string): number {
  const today = new Date(); today.setHours(0,0,0,0)
  const d = new Date(dateStr); d.setHours(0,0,0,0)
  return Math.ceil((d.getTime() - today.getTime()) / 86400000)
}
function monthsUntil(dateStr: string): number {
  const today = new Date()
  const d = new Date(dateStr)
  return Math.max(0, (d.getFullYear() - today.getFullYear()) * 12 + d.getMonth() - today.getMonth())
}

export default function WalletsPage() {
  const [wallets, setWallets] = useState<Wallet[]>([])
  const [transfers, setTransfers] = useState<Transfer[]>([])
  const [goals, setGoals] = useState<SavingsGoal[]>([])
  const [showWalletModal, setShowWalletModal] = useState(false)
  const [showTransferModal, setShowTransferModal] = useState(false)
  const [showGoalModal, setShowGoalModal] = useState(false)
  const [editingWallet, setEditingWallet] = useState<Wallet | null>(null)
  const [editingTransfer, setEditingTransfer] = useState<Transfer | null>(null)
  const [editingGoal, setEditingGoal] = useState<SavingsGoal | null>(null)
  const [form, setForm] = useState<WalletForm>(emptyWalletForm)
  const [tForm, setTForm] = useState<TransferForm>(emptyTForm)
  const [gForm, setGForm] = useState<GoalForm>(emptyGoalForm)

  useEffect(() => { load() }, [])

  async function load() {
    const [w, t, g] = await Promise.all([
      supabase.from('wallets').select('*').eq('is_active', true).order('pocket').order('created_at'),
      supabase.from('transfers').select('*').order('date', { ascending: false }).order('created_at', { ascending: false }).limit(30),
      supabase.from('savings_goals').select('*, wallets(*)').order('is_completed').order('created_at'),
    ])
    setWallets(w.data || [])
    setTransfers(t.data || [])
    setGoals(g.data || [])
  }

  // ── Wallet CRUD ──────────────────────────────────────────
  function openAddWallet() { setEditingWallet(null); setForm(emptyWalletForm); setShowWalletModal(true) }
  function openEditWallet(w: Wallet) {
    setEditingWallet(w)
    setForm({ name: w.name, type: w.type as WalletType, pocket: (w.pocket || 'operasional') as Pocket, balance: String(w.balance) })
    setShowWalletModal(true)
  }

  async function saveWallet() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return
    if (!form.name) { toast('Nama dompet wajib diisi!', '⚠️'); return }
    const payload = {
      name: form.name, type: form.type, pocket: form.pocket,
      balance: Number(form.balance) || 0,
      icon: WALLET_ICONS[form.type], color: WALLET_COLORS[form.type],
    }
    if (editingWallet) {
      // Update langsung — balance diset manual, tidak lewat trigger
      const { error } = await supabase.from('wallets').update(payload).eq('id', editingWallet.id)
      if (error) { toast(error.message, '❌'); return }
      toast('Dompet diperbarui!', '✅')
    } else {
      const { error } = await supabase.from('wallets').insert({ ...payload, user_id: session.user.id })
      if (error) { toast(error.message, '❌'); return }
      toast('Dompet ditambahkan!', '💳')
    }
    setShowWalletModal(false); setEditingWallet(null); setForm(emptyWalletForm); load()
  }

  async function deleteWallet(id: string) {
    if (!confirm('Hapus dompet ini?')) return
    await supabase.from('wallets').delete().eq('id', id)
    toast('Dompet dihapus', '🗑️'); load()
  }

  // ── Transfer CRUD ─────────────────────────────────────────
  // Trigger DB handle balance otomatis:
  // INSERT → kurangi from, tambah to
  // DELETE → tambah from, kurangi to
  // Untuk EDIT: DELETE lama + INSERT baru supaya trigger jalan dua kali dengan benar
  function openAddTransfer() { setEditingTransfer(null); setTForm(emptyTForm); setShowTransferModal(true) }
  function openEditTransfer(t: Transfer) {
    setEditingTransfer(t)
    setTForm({ from_wallet_id: t.from_wallet_id, to_wallet_id: t.to_wallet_id, amount: String(t.amount), note: t.note || '', date: t.date })
    setShowTransferModal(true)
  }

  async function saveTransfer() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return
    if (tForm.from_wallet_id === tForm.to_wallet_id) { toast('Pilih dompet berbeda!', '⚠️'); return }
    const amount = Number(tForm.amount)
    if (!amount || amount <= 0) { toast('Jumlah tidak valid!', '⚠️'); return }

    if (editingTransfer) {
      // DELETE dulu → trigger reverse balance lama
      const { error: delError } = await supabase.from('transfers').delete().eq('id', editingTransfer.id)
      if (delError) { toast(delError.message, '❌'); return }

      // INSERT baru → trigger apply balance baru
      const { error: insError } = await supabase.from('transfers').insert({
        user_id: session.user.id,
        from_wallet_id: tForm.from_wallet_id,
        to_wallet_id: tForm.to_wallet_id,
        amount,
        note: tForm.note || null,
        date: tForm.date,
      })
      if (insError) { toast(insError.message, '❌'); return }
      toast('Transfer diperbarui!', '✅')
    } else {
      // INSERT → trigger otomatis kurangi from, tambah to
      const { error } = await supabase.from('transfers').insert({
        user_id: session.user.id,
        from_wallet_id: tForm.from_wallet_id,
        to_wallet_id: tForm.to_wallet_id,
        amount,
        note: tForm.note || null,
        date: tForm.date,
      })
      if (error) { toast(error.message, '❌'); return }
      toast('Transfer berhasil!', '⇄')
    }
    setShowTransferModal(false); setEditingTransfer(null); setTForm(emptyTForm); load()
  }

  async function deleteTransfer(id: string) {
    if (!confirm('Hapus transfer ini?')) return
    // Trigger DB otomatis reverse balance saat DELETE
    await supabase.from('transfers').delete().eq('id', id)
    toast('Transfer dihapus', '🗑️'); load()
  }

  // ── Savings Goal CRUD ─────────────────────────────────────
  function openAddGoal(walletId?: string) {
    setEditingGoal(null)
    setGForm({ ...emptyGoalForm, wallet_id: walletId || '' })
    setShowGoalModal(true)
  }
  function openEditGoal(g: SavingsGoal) {
    setEditingGoal(g)
    setGForm({ wallet_id: g.wallet_id, name: g.name, target_amount: String(g.target_amount), target_date: g.target_date || '', icon: g.icon, color: g.color })
    setShowGoalModal(true)
  }
  async function saveGoal() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return
    if (!gForm.name || !gForm.target_amount || !gForm.wallet_id) { toast('Lengkapi nama, target, dan dompet!', '⚠️'); return }
    const payload = { wallet_id: gForm.wallet_id, name: gForm.name, target_amount: Number(gForm.target_amount), target_date: gForm.target_date || null, icon: gForm.icon, color: gForm.color }
    if (editingGoal) {
      const { error } = await supabase.from('savings_goals').update(payload).eq('id', editingGoal.id)
      if (error) { toast(error.message, '❌'); return }
      toast('Goal diperbarui!', '✅')
    } else {
      const { error } = await supabase.from('savings_goals').insert({ ...payload, user_id: session.user.id })
      if (error) { toast(error.message, '❌'); return }
      toast('Goal ditambahkan!', '🎯')
    }
    setShowGoalModal(false); setEditingGoal(null); setGForm(emptyGoalForm); load()
  }
  async function deleteGoal(id: string) {
    if (!confirm('Hapus goal ini?')) return
    await supabase.from('savings_goals').delete().eq('id', id)
    toast('Goal dihapus', '🗑️'); load()
  }
  async function toggleGoalComplete(g: SavingsGoal) {
    await supabase.from('savings_goals').update({ is_completed: !g.is_completed }).eq('id', g.id)
    toast(!g.is_completed ? '🎉 Goal tercapai!' : 'Goal dibuka kembali', !g.is_completed ? '🎉' : '🔄')
    load()
  }

  // ── Derived data ──────────────────────────────────────────
  const pocketTotals = (['operasional', 'tabungan', 'kantor'] as Pocket[]).map(p => ({
    pocket: p,
    total: wallets.filter(w => w.pocket === p).reduce((s, w) => s + Number(w.balance), 0),
    wallets: wallets.filter(w => w.pocket === p),
  }))
  const totalBalance = wallets.reduce((s, w) => s + Number(w.balance), 0)
  const tabunganWallets = wallets.filter(w => w.pocket === 'tabungan')

  function GoalCard({ goal }: { goal: SavingsGoal }) {
    const wallet = wallets.find(w => w.id === goal.wallet_id)
    const current = Number(wallet?.balance || 0)
    const target = Number(goal.target_amount)
    const pct = Math.min((current / target) * 100, 100)
    const remaining = Math.max(target - current, 0)
    const days = goal.target_date ? daysUntil(goal.target_date) : null
    const months = goal.target_date ? monthsUntil(goal.target_date) : null
    const monthlyNeeded = months && months > 0 ? remaining / months : null
    const isAchieved = current >= target
    return (
      <div className={`card p-5 group relative overflow-hidden ${goal.is_completed ? 'opacity-60' : ''}`}>
        <div className="absolute top-0 left-0 w-1 h-full rounded-l-2xl" style={{ background: goal.color }} />
        <div className="flex items-start justify-between mb-3 pl-2">
          <div className="flex items-center gap-2">
            <span className="text-2xl">{goal.icon}</span>
            <div>
              <p className="font-bold text-surface-800">{goal.name}</p>
              <p className="text-[10px] text-surface-400">{wallet?.name || '—'}</p>
            </div>
          </div>
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            {!goal.is_completed && (
              <button onClick={() => openEditGoal(goal)} className="w-7 h-7 rounded-lg hover:bg-brand-50 text-surface-400 hover:text-brand-600 flex items-center justify-center text-xs">✏️</button>
            )}
            <button onClick={() => toggleGoalComplete(goal)} className="w-7 h-7 rounded-lg hover:bg-green-50 text-surface-400 hover:text-green-600 flex items-center justify-center text-xs" title={goal.is_completed ? 'Buka kembali' : 'Tandai selesai'}>
              {goal.is_completed ? '↩' : '✓'}
            </button>
            <button onClick={() => deleteGoal(goal.id)} className="w-7 h-7 rounded-lg hover:bg-red-50 text-surface-400 hover:text-red-500 flex items-center justify-center text-xs">✕</button>
          </div>
        </div>
        <div className="pl-2">
          <div className="flex justify-between items-end mb-1">
            <span className="text-xs text-surface-500">Terkumpul</span>
            <span className="text-sm font-bold font-mono" style={{ color: goal.color }}>{pct.toFixed(0)}%</span>
          </div>
          <div className="h-3 bg-surface-100 rounded-full overflow-hidden mb-1">
            <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: goal.color }} />
          </div>
          <div className="flex justify-between text-xs text-surface-500">
            <span className="font-mono font-semibold" style={{ color: goal.color }}>{formatShort(current)}</span>
            <span className="font-mono">{formatShort(target)}</span>
          </div>
        </div>
        {!goal.is_completed && (
          <div className="mt-3 pt-3 border-t border-surface-100 pl-2 grid grid-cols-2 gap-2">
            <div>
              <p className="text-[10px] text-surface-400">Kurang</p>
              <p className="text-sm font-bold font-mono text-surface-800">{remaining > 0 ? formatShort(remaining) : '🎉 Tercapai!'}</p>
            </div>
            {goal.target_date && (
              <div>
                <p className="text-[10px] text-surface-400">Sisa waktu</p>
                <p className={`text-sm font-bold ${days! < 0 ? 'text-red-500' : days! < 30 ? 'text-amber-600' : 'text-surface-800'}`}>
                  {days! < 0 ? `${Math.abs(days!)}h terlambat` : days === 0 ? 'Hari ini!' : `${days}h lagi`}
                </p>
              </div>
            )}
            {monthlyNeeded && monthlyNeeded > 0 && (
              <div className="col-span-2">
                <p className="text-[10px] text-surface-400">Perlu menabung / bulan</p>
                <p className="text-sm font-bold font-mono text-brand-600">{formatShort(monthlyNeeded)}</p>
              </div>
            )}
          </div>
        )}
        {(goal.is_completed || isAchieved) && (
          <div className="mt-3 pt-3 border-t border-surface-100 pl-2">
            <p className="text-sm font-bold text-green-600">🎉 Goal tercapai!</p>
          </div>
        )}
      </div>
    )
  }

  return (
    <AppShell>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-extrabold text-surface-900">Dompet & Saldo</h1>
          <p className="text-sm text-surface-400">Total semua: {formatCurrency(totalBalance)}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={openAddTransfer} className="btn btn-secondary">⇄ Transfer</button>
          <button onClick={openAddWallet} className="btn btn-primary">+ Tambah</button>
        </div>
      </div>

      {/* Pocket Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        {pocketTotals.map(({ pocket, total, wallets: pw }) => {
          const meta = POCKET_META[pocket]
          return (
            <div key={pocket} className={`card p-5 border-l-4 ${pocket === 'operasional' ? 'border-l-blue-400' : pocket === 'tabungan' ? 'border-l-green-400' : 'border-l-purple-400'}`}>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xl">{meta.icon}</span>
                <div>
                  <p className={`text-xs font-bold uppercase tracking-wider ${meta.color}`}>{meta.label}</p>
                  <p className="text-[10px] text-surface-400">{pw.length} dompet</p>
                </div>
              </div>
              <p className="text-2xl font-extrabold text-surface-900 font-mono">{formatCurrency(total)}</p>
              <p className="text-[10px] text-surface-400 mt-1">{meta.desc}</p>
            </div>
          )
        })}
      </div>

      {/* Wallets grouped by pocket */}
      {(['operasional', 'tabungan', 'kantor'] as Pocket[]).map(pocket => {
        const pWallets = wallets.filter(w => w.pocket === pocket)
        if (pWallets.length === 0) return null
        const meta = POCKET_META[pocket]
        const isTabungan = pocket === 'tabungan'
        const pocketGoals = goals.filter(g => pWallets.some(w => w.id === g.wallet_id))
        return (
          <div key={pocket} className="mb-10">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-lg">{meta.icon}</span>
              <h2 className={`text-sm font-bold uppercase tracking-wider ${meta.color}`}>{meta.label}</h2>
              <div className={`h-px flex-1 ${pocket === 'operasional' ? 'bg-blue-100' : pocket === 'tabungan' ? 'bg-green-100' : 'bg-purple-100'}`} />
              {isTabungan && (
                <button onClick={() => openAddGoal()} className="btn text-xs py-1.5 px-3 bg-green-50 text-green-700 border border-green-200 hover:bg-green-100">+ Goal</button>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
              {pWallets.map((w) => {
                const walletGoals = goals.filter(g => g.wallet_id === w.id && !g.is_completed)
                const nearestGoal = walletGoals[0]
                const goalPct = nearestGoal ? Math.min((Number(w.balance) / Number(nearestGoal.target_amount)) * 100, 100) : null
                return (
                  <div key={w.id} className="card-hover p-5 relative overflow-hidden group">
                    <div className="absolute top-0 right-0 w-24 h-24 rounded-full opacity-10" style={{ background: w.color || '#3b82f6', transform: 'translate(30%, -30%)' }} />
                    <div className="flex items-start justify-between mb-4">
                      <div className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl" style={{ background: (w.color || '#3b82f6') + '18' }}>
                        {w.icon || '💳'}
                      </div>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        {isTabungan && (
                          <button onClick={() => openAddGoal(w.id)} className="w-7 h-7 rounded-lg hover:bg-green-50 text-surface-400 hover:text-green-600 flex items-center justify-center text-xs" title="Tambah goal">🎯</button>
                        )}
                        <button onClick={() => openEditWallet(w)} className="w-7 h-7 rounded-lg hover:bg-brand-50 text-surface-400 hover:text-brand-600 flex items-center justify-center text-xs">✏️</button>
                        <button onClick={() => deleteWallet(w.id)} className="w-7 h-7 rounded-lg hover:bg-red-50 text-surface-400 hover:text-red-500 flex items-center justify-center text-xs">✕</button>
                      </div>
                    </div>
                    <p className="text-sm font-semibold text-surface-800">{w.name}</p>
                    <p className="text-[10px] font-bold text-surface-400 uppercase tracking-wider mb-2">{w.type}</p>
                    <p className="text-xl font-extrabold font-mono text-surface-900">{formatCurrency(Number(w.balance))}</p>
                    {nearestGoal && goalPct !== null && (
                      <div className="mt-3 pt-3 border-t border-surface-100">
                        <div className="flex justify-between items-center mb-1">
                          <span className="text-[10px] text-surface-500">{nearestGoal.icon} {nearestGoal.name}</span>
                          <span className="text-[10px] font-bold" style={{ color: nearestGoal.color }}>{goalPct.toFixed(0)}%</span>
                        </div>
                        <div className="h-1.5 bg-surface-100 rounded-full overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${goalPct}%`, background: nearestGoal.color }} />
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
            {isTabungan && pocketGoals.length > 0 && (
              <div>
                <p className="text-xs font-bold text-surface-500 uppercase tracking-wider mb-3">🎯 Savings Goals</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {pocketGoals.filter(g => !g.is_completed).map(g => <GoalCard key={g.id} goal={g} />)}
                  {pocketGoals.filter(g => g.is_completed).map(g => <GoalCard key={g.id} goal={g} />)}
                </div>
              </div>
            )}
            {isTabungan && pocketGoals.length === 0 && tabunganWallets.length > 0 && (
              <div className="card p-6 text-center border-dashed border-2 border-green-200 bg-green-50/30">
                <p className="text-2xl mb-2">🎯</p>
                <p className="text-sm font-semibold text-surface-600">Belum ada savings goal</p>
                <p className="text-xs text-surface-400 mt-1 mb-3">Set target tabungan untuk rumah, liburan, darurat, dll.</p>
                <button onClick={() => openAddGoal()} className="btn bg-green-600 text-white hover:bg-green-700 text-sm">+ Tambah Goal Pertama</button>
              </div>
            )}
          </div>
        )
      })}

      {wallets.length === 0 && (
        <div className="card text-center py-16 text-surface-300">
          <p className="text-4xl mb-2">💳</p>
          <p className="text-sm">Belum ada dompet. Tambah dompet pertamamu!</p>
        </div>
      )}

      {/* Transfer History */}
      {transfers.length > 0 && (
        <div className="card p-6 mt-2">
          <h3 className="text-sm font-bold text-surface-900 mb-4">Riwayat Transfer</h3>
          <div className="space-y-2">
            {transfers.map((t) => {
              const from = wallets.find(w => w.id === t.from_wallet_id)
              const to = wallets.find(w => w.id === t.to_wallet_id)
              return (
                <div key={t.id} className="flex items-center gap-3 p-3 rounded-xl hover:bg-surface-50 transition-colors group">
                  <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center text-lg flex-shrink-0">⇄</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-surface-800">{from?.name || '?'} → {to?.name || '?'}</p>
                    <p className="text-[10px] text-surface-400">{formatDate(t.date)}{t.note ? ` · ${t.note}` : ''}</p>
                  </div>
                  <p className="text-sm font-bold font-mono text-blue-600 flex-shrink-0">{formatCurrency(Number(t.amount))}</p>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity ml-1">
                    <button onClick={() => openEditTransfer(t)} className="w-7 h-7 rounded-lg hover:bg-brand-50 text-surface-400 hover:text-brand-600 flex items-center justify-center text-xs">✏️</button>
                    <button onClick={() => deleteTransfer(t.id)} className="w-7 h-7 rounded-lg hover:bg-red-50 text-surface-400 hover:text-red-500 flex items-center justify-center text-xs">✕</button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Modals ── */}
      {/* Wallet Modal */}
      <Modal open={showWalletModal} onClose={() => { setShowWalletModal(false); setEditingWallet(null) }} title={editingWallet ? 'Edit Dompet' : 'Tambah Dompet'}>
        <div className="space-y-4">
          <div>
            <label className="label">Nama Dompet</label>
            <input className="input" placeholder="mis. BCA, GoPay, Dana Darurat" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <label className="label">Jenis Pocket</label>
            <div className="grid grid-cols-3 gap-2">
              {(['operasional', 'tabungan', 'kantor'] as Pocket[]).map(p => {
                const meta = POCKET_META[p]
                return (
                  <button key={p} onClick={() => setForm({ ...form, pocket: p })}
                    className={`btn flex-col py-3 gap-1 text-xs ${form.pocket === p ? `${meta.bg} ${meta.color} border border-current/30` : 'btn-secondary'}`}>
                    <span className="text-xl">{meta.icon}</span>
                    <span className="font-bold">{meta.label}</span>
                  </button>
                )
              })}
            </div>
            <p className="text-[11px] text-surface-400 mt-1.5">{POCKET_META[form.pocket].desc}</p>
          </div>
          <div>
            <label className="label">Tipe Akun</label>
            <select className="input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as WalletType })}>
              <option value="cash">💵 Cash</option>
              <option value="bank">🏦 Bank</option>
              <option value="ewallet">📱 E-Wallet</option>
              <option value="investment">📈 Investasi</option>
            </select>
          </div>
          <div>
            <label className="label">{editingWallet ? 'Saldo Saat Ini' : 'Saldo Awal'}</label>
            <input className="input" type="number" placeholder="0" value={form.balance} onChange={(e) => setForm({ ...form, balance: e.target.value })} />
            {editingWallet && (
              <p className="text-[11px] text-amber-600 mt-1">⚠️ Mengubah saldo langsung akan menimpa saldo saat ini tanpa mencatat transaksi.</p>
            )}
          </div>
          <div className="flex gap-2">
            {editingWallet && <button onClick={() => { deleteWallet(editingWallet.id); setShowWalletModal(false) }} className="btn btn-danger flex-1">Hapus</button>}
            <button onClick={saveWallet} className="btn btn-primary flex-1">{editingWallet ? 'Simpan' : 'Tambah Dompet'}</button>
          </div>
        </div>
      </Modal>

      {/* Transfer Modal */}
      <Modal open={showTransferModal} onClose={() => { setShowTransferModal(false); setEditingTransfer(null) }} title={editingTransfer ? 'Edit Transfer' : 'Transfer Antar Dompet'}>
        <div className="space-y-4">
          {editingTransfer && (
            <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl text-xs text-blue-800 flex gap-2">
              <span>ℹ️</span>
              <span>Saldo dompet lama akan dikembalikan otomatis, lalu saldo dompet baru disesuaikan.</span>
            </div>
          )}
          <div>
            <label className="label">Dari</label>
            <select className="input" value={tForm.from_wallet_id} onChange={(e) => setTForm({ ...tForm, from_wallet_id: e.target.value })}>
              <option value="">Pilih dompet asal</option>
              {wallets.map(w => <option key={w.id} value={w.id}>{POCKET_META[w.pocket as Pocket]?.icon} {w.name} ({formatCurrency(Number(w.balance))})</option>)}
            </select>
          </div>
          <div>
            <label className="label">Ke</label>
            <select className="input" value={tForm.to_wallet_id} onChange={(e) => setTForm({ ...tForm, to_wallet_id: e.target.value })}>
              <option value="">Pilih dompet tujuan</option>
              {wallets.map(w => <option key={w.id} value={w.id}>{POCKET_META[w.pocket as Pocket]?.icon} {w.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Jumlah</label>
            <input className="input" type="number" placeholder="0" value={tForm.amount} onChange={(e) => setTForm({ ...tForm, amount: e.target.value })} />
          </div>
          <div>
            <label className="label">Tanggal</label>
            <input className="input" type="date" value={tForm.date} onChange={(e) => setTForm({ ...tForm, date: e.target.value })} />
          </div>
          <div>
            <label className="label">Catatan (opsional)</label>
            <input className="input" placeholder="mis. Top up tabungan darurat" value={tForm.note} onChange={(e) => setTForm({ ...tForm, note: e.target.value })} />
          </div>
          <div className="flex gap-2">
            {editingTransfer && <button onClick={() => { deleteTransfer(editingTransfer.id); setShowTransferModal(false) }} className="btn btn-danger flex-1">Hapus</button>}
            <button onClick={saveTransfer} className="btn btn-primary flex-1">{editingTransfer ? 'Simpan' : 'Transfer'}</button>
          </div>
        </div>
      </Modal>

      {/* Savings Goal Modal */}
      <Modal open={showGoalModal} onClose={() => { setShowGoalModal(false); setEditingGoal(null) }} title={editingGoal ? 'Edit Savings Goal' : 'Tambah Savings Goal'}>
        <div className="space-y-4">
          <div>
            <label className="label">Dompet Tabungan</label>
            <select className="input" value={gForm.wallet_id} onChange={(e) => setGForm({ ...gForm, wallet_id: e.target.value })}>
              <option value="">Pilih dompet tabungan</option>
              {tabunganWallets.map(w => <option key={w.id} value={w.id}>{w.icon} {w.name} ({formatCurrency(Number(w.balance))})</option>)}
            </select>
          </div>
          <div>
            <label className="label">Nama Goal</label>
            <input className="input" placeholder="mis. DP Rumah, Dana Darurat, Liburan Jepang" value={gForm.name} onChange={(e) => setGForm({ ...gForm, name: e.target.value })} />
          </div>
          <div>
            <label className="label">Target Jumlah</label>
            <input className="input text-lg font-bold" type="number" placeholder="0" value={gForm.target_amount} onChange={(e) => setGForm({ ...gForm, target_amount: e.target.value })} />
          </div>
          <div>
            <label className="label">Target Tanggal (opsional)</label>
            <input className="input" type="date" value={gForm.target_date} onChange={(e) => setGForm({ ...gForm, target_date: e.target.value })} />
            {gForm.target_date && gForm.target_amount && gForm.wallet_id && (() => {
              const wallet = wallets.find(w => w.id === gForm.wallet_id)
              const current = Number(wallet?.balance || 0)
              const remaining = Math.max(Number(gForm.target_amount) - current, 0)
              const months = monthsUntil(gForm.target_date)
              if (months > 0 && remaining > 0) return (
                <p className="text-xs text-brand-600 mt-1.5 font-semibold">
                  💡 Perlu menabung <span className="font-mono">{formatShort(remaining / months)}</span>/bulan selama {months} bulan
                </p>
              )
            })()}
          </div>
          <div>
            <label className="label">Icon</label>
            <div className="grid grid-cols-8 gap-1.5 p-3 bg-surface-50 rounded-xl">
              {GOAL_ICONS.map(icon => (
                <button key={icon} onClick={() => setGForm({ ...gForm, icon })}
                  className={`w-9 h-9 rounded-lg flex items-center justify-center text-xl transition-all ${gForm.icon === icon ? 'bg-brand-100 ring-2 ring-brand-400 scale-110' : 'hover:bg-surface-200'}`}>
                  {icon}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="label">Warna</label>
            <div className="flex gap-2 flex-wrap">
              {GOAL_COLORS.map(c => (
                <button key={c} onClick={() => setGForm({ ...gForm, color: c })}
                  className="w-9 h-9 rounded-xl border-2 transition-all"
                  style={{ background: c, borderColor: gForm.color === c ? '#fff' : 'transparent', boxShadow: gForm.color === c ? `0 0 0 2px ${c}` : 'none' }} />
              ))}
            </div>
          </div>
          {gForm.name && gForm.target_amount && (
            <div className="p-3 rounded-xl border-l-4 bg-surface-50" style={{ borderColor: gForm.color }}>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xl">{gForm.icon}</span>
                <span className="font-bold text-surface-800 text-sm">{gForm.name}</span>
              </div>
              <div className="h-2 bg-surface-200 rounded-full overflow-hidden">
                {gForm.wallet_id && (() => {
                  const wallet = wallets.find(w => w.id === gForm.wallet_id)
                  const pct = Math.min((Number(wallet?.balance || 0) / Number(gForm.target_amount)) * 100, 100)
                  return <div className="h-full rounded-full" style={{ width: `${pct}%`, background: gForm.color }} />
                })()}
              </div>
              <p className="text-[10px] text-surface-400 mt-1">Target: {formatShort(Number(gForm.target_amount))}</p>
            </div>
          )}
          <div className="flex gap-2">
            {editingGoal && <button onClick={() => { deleteGoal(editingGoal.id); setShowGoalModal(false) }} className="btn btn-danger flex-1">Hapus</button>}
            <button onClick={saveGoal} className="btn btn-primary flex-1">{editingGoal ? 'Simpan' : 'Buat Goal'}</button>
          </div>
        </div>
      </Modal>
    </AppShell>
  )
}
