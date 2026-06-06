'use client'

import { useEffect, useState, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import type { Wallet } from '@/lib/supabase'
import { formatCurrency, formatShort, formatDate } from '@/lib/utils'
import AppShell from '@/components/AppShell'
import Modal from '@/components/Modal'
import { toast } from '@/components/Toast'

type SavingsGoal = {
  id: string
  user_id: string
  wallet_id: string
  name: string
  target_amount: number
  current_amount: number
  target_date: string | null
  icon: string
  color: string
  is_completed: boolean
  notes: string | null
  created_at: string
  wallets?: Wallet
}

type GoalForm = {
  wallet_id: string
  name: string
  target_amount: string
  current_amount: string
  target_date: string
  icon: string
  color: string
  notes: string
}

type TopUpForm = {
  amount: string
  from_wallet_id: string
}

const GOAL_ICONS = ['🎯','🏠','🚗','✈️','💍','🎓','💻','📱','🏖️','💰','🏋️','🎮','👶','🐶','🌿','⚕️','🎸','🛵']
const GOAL_COLORS = ['#22c55e','#3b82f6','#f59e0b','#ef4444','#8b5cf6','#ec4899','#06b6d4','#f97316','#14b8a6','#6366f1']

const emptyForm: GoalForm = {
  wallet_id: '', name: '', target_amount: '', current_amount: '0',
  target_date: '', icon: '🎯', color: '#22c55e', notes: '',
}

function daysLeft(dateStr: string): number {
  const today = new Date(); today.setHours(0,0,0,0)
  const target = new Date(dateStr); target.setHours(0,0,0,0)
  return Math.ceil((target.getTime() - today.getTime()) / 86400000)
}

export default function SavingsGoalsPage() {
  const [goals, setGoals] = useState<SavingsGoal[]>([])
  const [wallets, setWallets] = useState<Wallet[]>([])
  const [showModal, setShowModal] = useState(false)
  const [showTopUp, setShowTopUp] = useState(false)
  const [editing, setEditing] = useState<SavingsGoal | null>(null)
  const [selectedGoal, setSelectedGoal] = useState<SavingsGoal | null>(null)
  const [form, setForm] = useState<GoalForm>(emptyForm)
  const [topUpForm, setTopUpForm] = useState<TopUpForm>({ amount: '', from_wallet_id: '' })
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'active' | 'done'>('active')

  useEffect(() => { load() }, [])

  async function load() {
    const [g, w] = await Promise.all([
      supabase.from('savings_goals').select('*, wallets(*)').order('created_at', { ascending: false }),
      supabase.from('wallets').select('*').eq('is_active', true).order('name'),
    ])
    setGoals((g.data as any) || [])
    setWallets(w.data || [])
    setLoading(false)
  }

  function openAdd() {
    setEditing(null)
    setForm(emptyForm)
    setShowModal(true)
  }

  function openEdit(g: SavingsGoal) {
    setEditing(g)
    setForm({
      wallet_id: g.wallet_id,
      name: g.name,
      target_amount: String(g.target_amount),
      current_amount: String(g.current_amount),
      target_date: g.target_date || '',
      icon: g.icon || '🎯',
      color: g.color || '#22c55e',
      notes: g.notes || '',
    })
    setShowModal(true)
  }

  async function saveGoal() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return
    if (!form.name.trim()) { toast('Nama tujuan wajib diisi!', '⚠️'); return }
    if (!form.target_amount || Number(form.target_amount) <= 0) { toast('Target harus lebih dari 0!', '⚠️'); return }
    if (!form.wallet_id) { toast('Pilih dompet target!', '⚠️'); return }

    const current = Number(form.current_amount) || 0
    const target = Number(form.target_amount)
    const isCompleted = current >= target

    const payload = {
      wallet_id: form.wallet_id,
      name: form.name.trim(),
      target_amount: target,
      current_amount: current,
      target_date: form.target_date || null,
      icon: form.icon,
      color: form.color,
      notes: form.notes || null,
      is_completed: isCompleted,
    }

    if (editing) {
      const { error } = await supabase.from('savings_goals').update(payload).eq('id', editing.id)
      if (error) { toast(error.message, '❌'); return }
      toast('Tujuan diperbarui!', '✅')
    } else {
      const { error } = await supabase.from('savings_goals').insert({ ...payload, user_id: session.user.id })
      if (error) { toast(error.message, '❌'); return }
      toast('Tujuan tabungan ditambahkan!', '🎯')
    }
    setShowModal(false); setEditing(null); load()
  }

  async function deleteGoal(id: string) {
    if (!confirm('Hapus tujuan tabungan ini?')) return
    await supabase.from('savings_goals').delete().eq('id', id)
    toast('Tujuan dihapus', '🗑️'); load()
  }

  function openTopUp(goal: SavingsGoal) {
    setSelectedGoal(goal)
    setTopUpForm({ amount: '', from_wallet_id: '' })
    setShowTopUp(true)
  }

  async function doTopUp() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session || !selectedGoal) return
    const amount = Number(topUpForm.amount)
    if (!amount || amount <= 0) { toast('Masukkan jumlah!', '⚠️'); return }

    const newAmount = Number(selectedGoal.current_amount) + amount
    const isCompleted = newAmount >= Number(selectedGoal.target_amount)

    // Update savings goal
    await supabase.from('savings_goals').update({
      current_amount: newAmount,
      is_completed: isCompleted,
    }).eq('id', selectedGoal.id)

    // Jika ada wallet sumber, catat sebagai transaksi
    if (topUpForm.from_wallet_id) {
      await supabase.from('transactions').insert({
        user_id: session.user.id,
        wallet_id: topUpForm.from_wallet_id,
        type: 'expense',
        amount,
        description: `Tabungan: ${selectedGoal.name}`,
        date: new Date().toISOString().split('T')[0],
      })
    }

    if (isCompleted) toast(`🎉 Target "${selectedGoal.name}" tercapai!`, '🎯')
    else toast(`Ditambahkan ${formatCurrency(amount)}!`, '💰')

    setShowTopUp(false); load()
  }

  async function toggleComplete(goal: SavingsGoal) {
    await supabase.from('savings_goals').update({ is_completed: !goal.is_completed }).eq('id', goal.id)
    toast(goal.is_completed ? 'Ditandai belum selesai' : '🎉 Ditandai selesai!', goal.is_completed ? '🔄' : '✅')
    load()
  }

  const activeGoals = goals.filter(g => !g.is_completed)
  const doneGoals = goals.filter(g => g.is_completed)
  const totalTarget = activeGoals.reduce((s, g) => s + Number(g.target_amount), 0)
  const totalSaved = activeGoals.reduce((s, g) => s + Number(g.current_amount), 0)

  function GoalCard({ goal }: { goal: SavingsGoal }) {
    const pct = Math.min((Number(goal.current_amount) / Number(goal.target_amount)) * 100, 100)
    const remaining = Number(goal.target_amount) - Number(goal.current_amount)
    const dl = goal.target_date ? daysLeft(goal.target_date) : null
    const isOverdue = dl !== null && dl < 0 && !goal.is_completed
    const monthlyNeeded = dl && dl > 0 && remaining > 0
      ? Math.ceil(remaining / (dl / 30))
      : null

    return (
      <div className="card p-4 group">
        <div className="flex items-start gap-3 mb-3">
          <div className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl flex-shrink-0"
            style={{ background: goal.color + '20' }}>
            {goal.icon}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <p className="text-sm font-bold text-surface-900 truncate">{goal.name}</p>
              {goal.is_completed && <span className="badge bg-green-100 text-green-700">✓ Selesai</span>}
              {isOverdue && <span className="badge bg-red-100 text-red-600">Terlambat</span>}
            </div>
            <p className="text-xs text-surface-500">{(goal.wallets as any)?.name || '—'}</p>
            {goal.target_date && (
              <p className={`text-[10px] font-semibold mt-0.5 ${isOverdue ? 'text-red-500' : dl! <= 30 ? 'text-amber-600' : 'text-surface-400'}`}>
                {isOverdue ? `⚠️ Lewat ${Math.abs(dl!)} hari` : `📅 ${dl} hari lagi (${formatDate(goal.target_date)})`}
              </p>
            )}
          </div>
          <div className="text-right flex-shrink-0">
            <p className="text-sm font-extrabold font-mono" style={{ color: goal.color }}>
              {formatShort(Number(goal.current_amount))}
            </p>
            <p className="text-[10px] text-surface-400">dari {formatShort(Number(goal.target_amount))}</p>
          </div>
        </div>

        {/* Progress bar */}
        <div className="mb-3">
          <div className="flex justify-between text-[10px] mb-1">
            <span className="text-surface-400">{pct.toFixed(0)}% tercapai</span>
            {remaining > 0 && <span className="text-surface-500">Sisa: <span className="font-bold">{formatShort(remaining)}</span></span>}
          </div>
          <div className="progress-bar h-3 rounded-full">
            <div className="progress-fill rounded-full transition-all duration-700"
              style={{ width: `${pct}%`, background: goal.color }} />
          </div>
          {monthlyNeeded && (
            <p className="text-[10px] text-surface-400 mt-1">
              Perlu nabung ~<span className="font-semibold">{formatShort(monthlyNeeded)}/bulan</span> untuk tepat waktu
            </p>
          )}
        </div>

        {/* Actions */}
        {!goal.is_completed && (
          <div className="flex gap-2">
            <button onClick={() => openTopUp(goal)} className="btn btn-primary text-xs flex-1 py-2">
              + Top Up
            </button>
            <button onClick={() => openEdit(goal)} className="btn btn-secondary text-xs w-10 p-0">✏️</button>
            <button onClick={() => toggleComplete(goal)} className="btn btn-secondary text-xs w-10 p-0" title="Tandai selesai">✓</button>
            <button onClick={() => deleteGoal(goal.id)} className="btn btn-secondary text-xs w-10 p-0 hover:bg-red-50 hover:text-red-500">✕</button>
          </div>
        )}
        {goal.is_completed && (
          <div className="flex gap-2">
            <button onClick={() => toggleComplete(goal)} className="btn btn-secondary text-xs flex-1 py-2">Tandai Belum Selesai</button>
            <button onClick={() => deleteGoal(goal.id)} className="btn btn-secondary text-xs w-10 p-0 hover:bg-red-50 hover:text-red-500">✕</button>
          </div>
        )}
      </div>
    )
  }

  return (
    <AppShell>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl sm:text-2xl font-extrabold text-surface-900">Tujuan Tabungan</h1>
          <p className="text-xs text-surface-400">{activeGoals.length} aktif · {doneGoals.length} selesai</p>
        </div>
        <button onClick={openAdd} className="btn btn-primary py-2.5 px-4 text-sm">+ Tambah</button>
      </div>

      {/* Summary */}
      {activeGoals.length > 0 && (
        <div className="grid grid-cols-3 gap-2 mb-5">
          <div className="card p-3 text-center">
            <p className="text-[10px] font-bold text-surface-400 uppercase mb-1">Total Target</p>
            <p className="text-base font-extrabold font-mono text-surface-900">{formatShort(totalTarget)}</p>
          </div>
          <div className="card p-3 text-center">
            <p className="text-[10px] font-bold text-surface-400 uppercase mb-1">Sudah Terkumpul</p>
            <p className="text-base font-extrabold font-mono text-green-600">{formatShort(totalSaved)}</p>
          </div>
          <div className="card p-3 text-center">
            <p className="text-[10px] font-bold text-surface-400 uppercase mb-1">Sisa</p>
            <p className="text-base font-extrabold font-mono text-amber-600">{formatShort(totalTarget - totalSaved)}</p>
          </div>
        </div>
      )}

      {/* Overall progress */}
      {activeGoals.length > 0 && (
        <div className="card p-4 mb-5">
          <div className="flex justify-between text-xs mb-2">
            <span className="font-bold text-surface-700">Progress Keseluruhan</span>
            <span className="font-bold text-brand-600">
              {totalTarget > 0 ? ((totalSaved / totalTarget) * 100).toFixed(0) : 0}%
            </span>
          </div>
          <div className="progress-bar h-4 rounded-full">
            <div className="progress-fill rounded-full" style={{
              width: `${totalTarget > 0 ? Math.min((totalSaved / totalTarget) * 100, 100) : 0}%`,
              background: 'linear-gradient(90deg, #22c55e, #3b82f6)'
            }} />
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1.5 mb-4 bg-surface-100 p-1 rounded-xl">
        <button onClick={() => setTab('active')}
          className={`flex-1 text-xs font-bold py-2 rounded-lg transition-all ${tab === 'active' ? 'bg-white text-surface-900 shadow-sm' : 'text-surface-500'}`}>
          🎯 Aktif ({activeGoals.length})
        </button>
        <button onClick={() => setTab('done')}
          className={`flex-1 text-xs font-bold py-2 rounded-lg transition-all ${tab === 'done' ? 'bg-white text-surface-900 shadow-sm' : 'text-surface-500'}`}>
          ✅ Selesai ({doneGoals.length})
        </button>
      </div>

      {loading ? (
        <div className="space-y-4">
          {[...Array(3)].map((_, i) => <div key={i} className="card p-5 h-36 animate-pulse bg-surface-100" />)}
        </div>
      ) : (
        <div className="space-y-3">
          {(tab === 'active' ? activeGoals : doneGoals).map(g => <GoalCard key={g.id} goal={g} />)}
          {(tab === 'active' ? activeGoals : doneGoals).length === 0 && (
            <div className="card text-center py-16 text-surface-300">
              <p className="text-4xl mb-2">{tab === 'active' ? '🎯' : '🏆'}</p>
              <p className="font-semibold text-surface-500">
                {tab === 'active' ? 'Belum ada tujuan aktif' : 'Belum ada yang selesai'}
              </p>
              {tab === 'active' && <p className="text-sm mt-1">Tambahkan tujuan tabunganmu!</p>}
            </div>
          )}
        </div>
      )}

      {/* ── Add/Edit Modal ── */}
      <Modal open={showModal} onClose={() => { setShowModal(false); setEditing(null) }}
        title={editing ? 'Edit Tujuan' : 'Tambah Tujuan Tabungan'}>
        <div className="space-y-4">
          {/* Icon & color */}
          <div>
            <label className="label">Icon</label>
            <div className="flex flex-wrap gap-1.5">
              {GOAL_ICONS.map(ic => (
                <button key={ic} onClick={() => setForm({...form, icon: ic})}
                  className={`w-9 h-9 text-xl rounded-xl flex items-center justify-center transition-all ${form.icon === ic ? 'ring-2 ring-brand-400 bg-brand-50' : 'hover:bg-surface-100'}`}>
                  {ic}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="label">Warna</label>
            <div className="flex gap-2">
              {GOAL_COLORS.map(c => (
                <button key={c} onClick={() => setForm({...form, color: c})}
                  className="w-8 h-8 rounded-lg border-2 transition-all"
                  style={{ background: c, borderColor: form.color === c ? '#fff' : 'transparent', boxShadow: form.color === c ? `0 0 0 2px ${c}` : 'none' }} />
              ))}
            </div>
          </div>
          <div>
            <label className="label">Nama Tujuan</label>
            <input className="input" placeholder="mis. DP Rumah, Liburan Eropa, Dana Darurat" value={form.name} onChange={e => setForm({...form, name: e.target.value})} />
          </div>
          <div>
            <label className="label">Dompet Target</label>
            <select className="input" value={form.wallet_id} onChange={e => setForm({...form, wallet_id: e.target.value})}>
              <option value="">Pilih dompet</option>
              {wallets.map(w => <option key={w.id} value={w.id}>{w.icon || '💳'} {w.name} ({formatShort(Number(w.balance))})</option>)}
            </select>
            <p className="text-[10px] text-surface-400 mt-1">Dompet yang dijadikan target tabungan (untuk tracking)</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Target Amount</label>
              <input className="input" type="number" inputMode="numeric" placeholder="0" value={form.target_amount} onChange={e => setForm({...form, target_amount: e.target.value})} />
            </div>
            <div>
              <label className="label">Sudah Terkumpul</label>
              <input className="input" type="number" inputMode="numeric" placeholder="0" value={form.current_amount} onChange={e => setForm({...form, current_amount: e.target.value})} />
            </div>
          </div>
          <div>
            <label className="label">Target Tanggal <span className="text-surface-400 font-normal">(opsional)</span></label>
            <input className="input" type="date" value={form.target_date} onChange={e => setForm({...form, target_date: e.target.value})} />
          </div>
          <div>
            <label className="label">Catatan <span className="text-surface-400 font-normal">(opsional)</span></label>
            <input className="input" placeholder="mis. Untuk beli rumah di BSD" value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} />
          </div>
          <div className="flex gap-2 pt-1">
            {editing && <button onClick={() => { deleteGoal(editing.id); setShowModal(false) }} className="btn btn-danger flex-1">Hapus</button>}
            <button onClick={saveGoal} className="btn btn-primary flex-1">{editing ? 'Simpan' : 'Buat Tujuan'}</button>
          </div>
        </div>
      </Modal>

      {/* ── Top Up Modal ── */}
      <Modal open={showTopUp && !!selectedGoal} onClose={() => setShowTopUp(false)} title={`Top Up — ${selectedGoal?.name}`}>
        {selectedGoal && (
          <div className="space-y-4">
            <div className="p-3 rounded-xl" style={{ background: selectedGoal.color + '15' }}>
              <div className="flex justify-between text-xs mb-2">
                <span className="text-surface-500">Progress saat ini</span>
                <span className="font-bold" style={{ color: selectedGoal.color }}>
                  {((Number(selectedGoal.current_amount) / Number(selectedGoal.target_amount)) * 100).toFixed(0)}%
                </span>
              </div>
              <div className="progress-bar h-2">
                <div className="progress-fill" style={{
                  width: `${Math.min((Number(selectedGoal.current_amount) / Number(selectedGoal.target_amount)) * 100, 100)}%`,
                  background: selectedGoal.color
                }} />
              </div>
              <div className="flex justify-between text-xs mt-2">
                <span className="text-surface-500">Terkumpul: <span className="font-bold">{formatCurrency(Number(selectedGoal.current_amount))}</span></span>
                <span className="text-surface-500">Target: <span className="font-bold">{formatCurrency(Number(selectedGoal.target_amount))}</span></span>
              </div>
            </div>

            <div>
              <label className="label">Jumlah Top Up</label>
              <input className="input text-xl font-bold" type="number" inputMode="numeric" placeholder="0"
                value={topUpForm.amount} onChange={e => setTopUpForm({...topUpForm, amount: e.target.value})} autoFocus />
            </div>

            {/* Quick amounts */}
            <div className="flex gap-2">
              {[100000, 500000, 1000000].map(amt => (
                <button key={amt} onClick={() => setTopUpForm({...topUpForm, amount: String(amt)})}
                  className="btn btn-secondary text-xs flex-1 py-2">
                  {formatShort(amt)}
                </button>
              ))}
              <button onClick={() => {
                const rem = Number(selectedGoal.target_amount) - Number(selectedGoal.current_amount)
                setTopUpForm({...topUpForm, amount: String(rem > 0 ? rem : 0)})
              }} className="btn btn-secondary text-xs flex-1 py-2">Lunas</button>
            </div>

            <div>
              <label className="label">Catat dari Dompet <span className="text-surface-400 font-normal">(opsional)</span></label>
              <select className="input" value={topUpForm.from_wallet_id} onChange={e => setTopUpForm({...topUpForm, from_wallet_id: e.target.value})}>
                <option value="">— Tidak catat transaksi —</option>
                {wallets.map(w => <option key={w.id} value={w.id}>{w.icon || '💳'} {w.name} ({formatShort(Number(w.balance))})</option>)}
              </select>
              {topUpForm.from_wallet_id && (
                <p className="text-[10px] text-surface-400 mt-1">Akan dicatat sebagai pengeluaran di dompet ini</p>
              )}
            </div>

            {Number(topUpForm.amount) > 0 && (
              <div className="p-3 bg-green-50 rounded-xl text-xs">
                <p className="font-semibold text-green-700 mb-1">Setelah top up:</p>
                <p className="text-green-600">
                  {formatCurrency(Number(selectedGoal.current_amount) + Number(topUpForm.amount))} /&nbsp;
                  {formatCurrency(Number(selectedGoal.target_amount))} &nbsp;
                  ({Math.min(((Number(selectedGoal.current_amount) + Number(topUpForm.amount)) / Number(selectedGoal.target_amount)) * 100, 100).toFixed(0)}%)
                  {Number(selectedGoal.current_amount) + Number(topUpForm.amount) >= Number(selectedGoal.target_amount) && ' 🎉 TARGET TERCAPAI!'}
                </p>
              </div>
            )}

            <div className="flex gap-2">
              <button onClick={() => setShowTopUp(false)} className="btn btn-secondary flex-1">Batal</button>
              <button onClick={doTopUp} className="btn btn-primary flex-1">💰 Top Up</button>
            </div>
          </div>
        )}
      </Modal>
    </AppShell>
  )
}
