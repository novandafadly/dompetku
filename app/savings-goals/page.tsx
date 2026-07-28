'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Wallet } from '@/lib/supabase'
import { formatCurrency, formatShort, formatDate } from '@/lib/utils'
import AppShell from '@/components/AppShell'
import Modal from '@/components/Modal'
import { toast } from '@/components/Toast'

type AssetLite = {
  id: string
  name: string
  icon?: string
  value: number
}

type SavingsGoal = {
  id: string
  user_id: string
  wallet_id: string | null // legacy single-wallet column, kept for backward compat / first-linked convenience
  asset_id: string | null
  name: string
  target_amount: number
  current_amount: number
  target_date: string | null
  icon: string
  color: string
  is_completed: boolean
  notes: string | null
  created_at: string
  assets?: AssetLite
}

// Riwayat top up / pencairan per goal — sekarang bisa diedit & dihapus langsung
type GoalHistory = {
  id: string
  date: string
  amount: number
  kind: 'topup' | 'withdraw'
  source: 'transfer' | 'transaction'
  from_wallet_id: string | null
  to_wallet_id: string | null
  wallet_name?: string // dompet asal (topup) atau tujuan (withdraw), untuk display
  note?: string | null
}

type TargetType = 'wallet' | 'asset'

type GoalForm = {
  target_type: TargetType
  wallet_ids: string[] // multi-select
  asset_id: string
  name: string
  target_amount: string
  target_date: string
  icon: string
  color: string
  notes: string
}

type TopUpForm = {
  amount: string
  from_wallet_id: string
  to_wallet_id: string // pilih dompet target mana yang menerima (kalau linked > 1)
  date: string
}

type WithdrawForm = {
  amount: string
  from_wallet_id: string // dari dompet linked mana yang ditarik (kalau linked > 1)
  to_wallet_id: string
  date: string
}

type EditHistoryForm = {
  amount: string
  date: string
  wallet_id: string // to_wallet (topup) atau from_wallet (withdraw) yang bisa dipindah
  note: string
}

const GOAL_ICONS = ['🎯','🏠','🚗','✈️','💍','🎓','💻','📱','🏖️','💰','🏋️','🎮','👶','🐶','🌿','⚕️','🎸','🛵']
const GOAL_COLORS = ['#22c55e','#3b82f6','#f59e0b','#ef4444','#8b5cf6','#ec4899','#06b6d4','#f97316','#14b8a6','#6366f1']

const emptyForm: GoalForm = {
  target_type: 'wallet', wallet_ids: [], asset_id: '', name: '', target_amount: '',
  target_date: '', icon: '🎯', color: '#22c55e', notes: '',
}

const today = () => new Date().toISOString().split('T')[0]

function daysLeft(dateStr: string): number {
  const now = new Date(); now.setHours(0, 0, 0, 0)
  const target = new Date(dateStr); target.setHours(0, 0, 0, 0)
  return Math.ceil((target.getTime() - now.getTime()) / 86400000)
}

export default function SavingsGoalsPage() {
  const [goals, setGoals] = useState<SavingsGoal[]>([])
  const [goalWallets, setGoalWallets] = useState<Record<string, string[]>>({}) // goal_id -> wallet_id[]
  const [wallets, setWallets] = useState<Wallet[]>([])
  const [assets, setAssets] = useState<AssetLite[]>([])
  const [goalHistories, setGoalHistories] = useState<Record<string, GoalHistory[]>>({})
  const [showModal, setShowModal] = useState(false)
  const [showTopUp, setShowTopUp] = useState(false)
  const [showWithdraw, setShowWithdraw] = useState(false)
  const [expandedHistory, setExpandedHistory] = useState<Record<string, boolean>>({})
  const [editingHistoryId, setEditingHistoryId] = useState<string | null>(null)
  const [editing, setEditing] = useState<SavingsGoal | null>(null)
  const [selectedGoal, setSelectedGoal] = useState<SavingsGoal | null>(null)
  const [form, setForm] = useState<GoalForm>(emptyForm)
  const [topUpForm, setTopUpForm] = useState<TopUpForm>({ amount: '', from_wallet_id: '', to_wallet_id: '', date: today() })
  const [withdrawForm, setWithdrawForm] = useState<WithdrawForm>({ amount: '', from_wallet_id: '', to_wallet_id: '', date: today() })
  const [editHistoryForm, setEditHistoryForm] = useState<EditHistoryForm>({ amount: '', date: '', wallet_id: '', note: '' })
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'active' | 'done'>('active')

  useEffect(() => { load() }, [])

  async function load() {
    const [g, w, a, gw] = await Promise.all([
      supabase.from('savings_goals').select('*').order('created_at', { ascending: false }),
      supabase.from('wallets').select('*').eq('is_active', true).order('name'),
      supabase.from('assets').select('id, name, type, value'),
      supabase.from('savings_goal_wallets').select('savings_goal_id, wallet_id'),
    ])
    const walletList = w.data || []
    const assetList = (a.data as any) || []
    const goalList: SavingsGoal[] = ((g.data as any) || []).map((goal: SavingsGoal) => ({
      ...goal,
      assets: goal.asset_id ? assetList.find((a: AssetLite) => a.id === goal.asset_id) : undefined,
    }))

    const linkMap: Record<string, string[]> = {}
    for (const row of (gw.data || [])) {
      if (!linkMap[row.savings_goal_id]) linkMap[row.savings_goal_id] = []
      linkMap[row.savings_goal_id].push(row.wallet_id)
    }

    setGoals(goalList)
    setWallets(walletList)
    setAssets(assetList)
    setGoalWallets(linkMap)
    setLoading(false)

    await loadAllHistories(goalList, walletList)
  }

  // Progress = jumlah saldo SEMUA wallet yang di-link, atau nilai asset
  function currentAmountOf(goal: SavingsGoal): number {
    if (goal.asset_id) return Number(goal.assets?.value || 0)
    const linkedIds = goalWallets[goal.id] || (goal.wallet_id ? [goal.wallet_id] : [])
    return linkedIds.reduce((sum, wid) => {
      const w = wallets.find(x => x.id === wid)
      return sum + Number(w?.balance || 0)
    }, 0)
  }

  function linkedWalletsOf(goal: SavingsGoal): Wallet[] {
    const ids = goalWallets[goal.id] || (goal.wallet_id ? [goal.wallet_id] : [])
    return wallets.filter(w => ids.includes(w.id))
  }

  async function loadAllHistories(goalList: SavingsGoal[], walletList: Wallet[]) {
    const ids = goalList.map(g => g.id)
    if (ids.length === 0) { setGoalHistories({}); return }
    const [trRes, txRes] = await Promise.all([
      supabase.from('transfers')
        .select('id, date, amount, savings_goal_id, savings_type, from_wallet_id, to_wallet_id, to_asset_id, note')
        .in('savings_goal_id', ids)
        .order('date', { ascending: false }),
      supabase.from('transactions')
        .select('id, date, amount, savings_goal_id, type, wallet_id, description')
        .in('savings_goal_id', ids)
        .order('date', { ascending: false }),
    ])
    const transfers = (trRes.data || []) as any[]
    const transactions = (txRes.data || []) as any[]
    const histories: Record<string, GoalHistory[]> = {}
    ids.forEach(id => { histories[id] = [] })

    for (const tr of transfers) {
      if (!tr.savings_goal_id) continue
      const isTopUp = tr.savings_type === 'topup'
      const walletId = isTopUp ? tr.from_wallet_id : tr.to_wallet_id
      const wallet = walletList.find(w => w.id === walletId)
      histories[tr.savings_goal_id]?.push({
        id: tr.id,
        date: tr.date,
        amount: Number(tr.amount),
        kind: isTopUp ? 'topup' : 'withdraw',
        source: 'transfer',
        from_wallet_id: tr.from_wallet_id,
        to_wallet_id: tr.to_wallet_id,
        wallet_name: wallet?.name,
        note: tr.note,
      })
    }
    for (const tx of transactions) {
      if (!tx.savings_goal_id) continue
      const wallet = walletList.find(w => w.id === tx.wallet_id)
      histories[tx.savings_goal_id]?.push({
        id: tx.id,
        date: tx.date,
        amount: Number(tx.amount),
        kind: tx.type === 'income' ? 'withdraw' : 'topup',
        source: 'transaction',
        from_wallet_id: tx.type === 'expense' ? tx.wallet_id : null,
        to_wallet_id: tx.type === 'income' ? tx.wallet_id : null,
        wallet_name: wallet?.name,
        note: tx.description,
      })
    }
    ids.forEach(id => { histories[id].sort((a, b) => b.date.localeCompare(a.date)) })
    setGoalHistories(histories)
  }

  // ── Add / Edit Goal ──────────────────────────────────────
  function openAdd() {
    setEditing(null)
    setForm(emptyForm)
    setShowModal(true)
  }

  function openEdit(g: SavingsGoal) {
    setEditing(g)
    setForm({
      target_type: g.asset_id ? 'asset' : 'wallet',
      wallet_ids: goalWallets[g.id] || (g.wallet_id ? [g.wallet_id] : []),
      asset_id: g.asset_id || '',
      name: g.name,
      target_amount: String(g.target_amount),
      target_date: g.target_date || '',
      icon: g.icon || '🎯',
      color: g.color || '#22c55e',
      notes: g.notes || '',
    })
    setShowModal(true)
  }

  function toggleWalletInForm(walletId: string) {
    setForm(prev => ({
      ...prev,
      wallet_ids: prev.wallet_ids.includes(walletId)
        ? prev.wallet_ids.filter(id => id !== walletId)
        : [...prev.wallet_ids, walletId],
    }))
  }

  async function saveGoal() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return
    if (!form.name.trim()) { toast('Nama tujuan wajib diisi!', '⚠️'); return }
    if (!form.target_amount || Number(form.target_amount) <= 0) { toast('Target harus lebih dari 0!', '⚠️'); return }
    if (form.target_type === 'wallet' && form.wallet_ids.length === 0) { toast('Pilih minimal 1 dompet target!', '⚠️'); return }
    if (form.target_type === 'asset' && !form.asset_id) { toast('Pilih aset target!', '⚠️'); return }

    const target = Number(form.target_amount)
    const currentNow = form.target_type === 'asset'
      ? Number(assets.find(a => a.id === form.asset_id)?.value || 0)
      : form.wallet_ids.reduce((s, wid) => s + Number(wallets.find(w => w.id === wid)?.balance || 0), 0)
    const isCompleted = currentNow >= target

    const payload = {
      wallet_id: form.target_type === 'wallet' ? (form.wallet_ids[0] || null) : null, // legacy convenience column
      asset_id: form.target_type === 'asset' ? form.asset_id : null,
      name: form.name.trim(),
      target_amount: target,
      target_date: form.target_date || null,
      icon: form.icon,
      color: form.color,
      notes: form.notes || null,
      is_completed: isCompleted,
    }

    let goalId = editing?.id
    if (editing) {
      const { error } = await supabase.from('savings_goals').update(payload).eq('id', editing.id)
      if (error) { toast(error.message, '❌'); return }
      toast('Tujuan diperbarui!', '✅')
    } else {
      const { data, error } = await supabase.from('savings_goals').insert({ ...payload, user_id: session.user.id }).select().single()
      if (error) { toast(error.message, '❌'); return }
      goalId = data.id
      toast('Tujuan tabungan ditambahkan!', '🎯')
    }

    if (goalId) {
      await supabase.from('savings_goal_wallets').delete().eq('savings_goal_id', goalId)
      if (form.target_type === 'wallet' && form.wallet_ids.length > 0) {
        const rows = form.wallet_ids.map(wid => ({ savings_goal_id: goalId, wallet_id: wid, user_id: session.user.id }))
        const { error: linkError } = await supabase.from('savings_goal_wallets').insert(rows)
        if (linkError) { toast(linkError.message, '❌'); return }
      }
    }

    setShowModal(false); setEditing(null); load()
  }

  async function deleteGoal(id: string) {
    if (!confirm('Hapus tujuan tabungan ini? Riwayat top up/pencairan tidak ikut terhapus.')) return
    await supabase.from('savings_goals').delete().eq('id', id) // cascades savings_goal_wallets
    toast('Tujuan dihapus', '🗑️'); load()
  }

  // ── Top Up ────────────────────────────────────────────────
  function openTopUp(goal: SavingsGoal) {
    setSelectedGoal(goal)
    const linked = goalWallets[goal.id] || (goal.wallet_id ? [goal.wallet_id] : [])
    setTopUpForm({ amount: '', from_wallet_id: '', to_wallet_id: linked[0] || '', date: today() })
    setShowTopUp(true)
  }

  async function doTopUp() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session || !selectedGoal) return
    const amount = Number(topUpForm.amount)
    if (!amount || amount <= 0) { toast('Masukkan jumlah!', '⚠️'); return }
    if (!topUpForm.from_wallet_id) { toast('Pilih dompet sumber!', '⚠️'); return }
    if (!topUpForm.date) { toast('Pilih tanggal!', '⚠️'); return }

    if (selectedGoal.asset_id) {
      const { error } = await supabase.from('transfers').insert({
        user_id: session.user.id,
        from_wallet_id: topUpForm.from_wallet_id,
        to_wallet_id: null,
        to_asset_id: selectedGoal.asset_id,
        amount,
        fee: 0,
        description: `Tabungan: ${selectedGoal.name}`,
        note: `Tabungan: ${selectedGoal.name}`,
        date: topUpForm.date,
        savings_goal_id: selectedGoal.id,
        savings_type: 'topup',
      })
      if (error) { toast(error.message, '❌'); return }
      const newValue = Number(selectedGoal.assets?.value || 0) + amount
      const isCompleted = newValue >= Number(selectedGoal.target_amount)
      await supabase.from('savings_goals').update({ is_completed: isCompleted }).eq('id', selectedGoal.id)
      toast(isCompleted ? `🎉 Target "${selectedGoal.name}" tercapai!` : `Ditambahkan ${formatCurrency(amount)}!`, isCompleted ? '🎯' : '💰')
    } else {
      if (!topUpForm.to_wallet_id) { toast('Pilih dompet tujuan!', '⚠️'); return }
      if (topUpForm.from_wallet_id === topUpForm.to_wallet_id) { toast('Dompet sumber tidak boleh sama dengan tujuan!', '⚠️'); return }

      const { error } = await supabase.from('transfers').insert({
        user_id: session.user.id,
        from_wallet_id: topUpForm.from_wallet_id,
        to_wallet_id: topUpForm.to_wallet_id,
        amount,
        fee: 0,
        description: `Tabungan: ${selectedGoal.name}`,
        note: `Tabungan: ${selectedGoal.name}`,
        date: topUpForm.date,
        savings_goal_id: selectedGoal.id,
        savings_type: 'topup',
      })
      if (error) { toast(error.message, '❌'); return }
      const newAmount = currentAmountOf(selectedGoal) + amount
      const isCompleted = newAmount >= Number(selectedGoal.target_amount)
      await supabase.from('savings_goals').update({ is_completed: isCompleted }).eq('id', selectedGoal.id)
      toast(isCompleted ? `🎉 Target "${selectedGoal.name}" tercapai!` : `Ditambahkan ${formatCurrency(amount)}!`, isCompleted ? '🎯' : '💰')
    }
    setShowTopUp(false); load()
  }

  // ── Withdraw ──────────────────────────────────────────────
  function openWithdraw(goal: SavingsGoal) {
    setSelectedGoal(goal)
    const linked = goalWallets[goal.id] || (goal.wallet_id ? [goal.wallet_id] : [])
    setWithdrawForm({ amount: '', from_wallet_id: linked[0] || '', to_wallet_id: '', date: today() })
    setShowWithdraw(true)
  }

  async function doWithdraw() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session || !selectedGoal) return
    const amount = Number(withdrawForm.amount)
    const maxAmount = currentAmountOf(selectedGoal)
    if (!amount || amount <= 0) { toast('Masukkan jumlah!', '⚠️'); return }
    if (amount > maxAmount) { toast(`Maksimal pencairan ${formatCurrency(maxAmount)}!`, '⚠️'); return }
    if (!withdrawForm.to_wallet_id) { toast('Pilih dompet tujuan!', '⚠️'); return }
    if (!withdrawForm.date) { toast('Pilih tanggal!', '⚠️'); return }

    if (selectedGoal.asset_id) {
      const { error: txError } = await supabase.from('transactions').insert({
        user_id: session.user.id,
        wallet_id: withdrawForm.to_wallet_id,
        type: 'income',
        amount,
        description: `Pencairan: ${selectedGoal.name}`,
        date: withdrawForm.date,
        savings_goal_id: selectedGoal.id,
      })
      if (txError) { toast(txError.message, '❌'); return }
      const newValue = Number(selectedGoal.assets?.value || 0) - amount
      const { error: assetError } = await supabase.from('assets').update({ value: Math.max(0, newValue) }).eq('id', selectedGoal.asset_id)
      if (assetError) { toast(assetError.message, '❌'); return }
      await supabase.from('savings_goals').update({ is_completed: false }).eq('id', selectedGoal.id)
      toast(`Dicairkan ${formatCurrency(amount)} ke ${wallets.find(w => w.id === withdrawForm.to_wallet_id)?.name}`, '💸')
    } else {
      if (!withdrawForm.from_wallet_id) { toast('Pilih dompet asal (goal)!', '⚠️'); return }
      if (withdrawForm.to_wallet_id === withdrawForm.from_wallet_id) { toast('Dompet tujuan tidak boleh sama dengan dompet asal!', '⚠️'); return }

      const { error } = await supabase.from('transfers').insert({
        user_id: session.user.id,
        from_wallet_id: withdrawForm.from_wallet_id,
        to_wallet_id: withdrawForm.to_wallet_id,
        amount,
        fee: 0,
        description: `Pencairan: ${selectedGoal.name}`,
        note: `Pencairan: ${selectedGoal.name}`,
        date: withdrawForm.date,
        savings_goal_id: selectedGoal.id,
        savings_type: 'withdraw',
      })
      if (error) { toast(error.message, '❌'); return }
      const newAmount = currentAmountOf(selectedGoal) - amount
      if (newAmount < Number(selectedGoal.target_amount)) {
        await supabase.from('savings_goals').update({ is_completed: false }).eq('id', selectedGoal.id)
      }
      toast(`Dicairkan ${formatCurrency(amount)} ke ${wallets.find(w => w.id === withdrawForm.to_wallet_id)?.name}`, '💸')
    }
    setShowWithdraw(false); load()
  }

  async function toggleComplete(goal: SavingsGoal) {
    await supabase.from('savings_goals').update({ is_completed: !goal.is_completed }).eq('id', goal.id)
    toast(goal.is_completed ? 'Ditandai belum selesai' : '🎉 Ditandai selesai!', goal.is_completed ? '🔄' : '✅')
    load()
  }

  // ── Edit / Delete history entry ───────────────────────────
  function openEditHistory(goal: SavingsGoal, h: GoalHistory) {
    setSelectedGoal(goal)
    setEditingHistoryId(h.id)
    setEditHistoryForm({
      amount: String(h.amount),
      date: h.date,
      wallet_id: h.kind === 'topup' ? (h.to_wallet_id || '') : (h.from_wallet_id || ''),
      note: h.note || '',
    })
  }

  function cancelEditHistory() {
    setEditingHistoryId(null)
  }

  async function saveEditHistory(goal: SavingsGoal, h: GoalHistory) {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return
    const amount = Number(editHistoryForm.amount)
    if (!amount || amount <= 0) { toast('Jumlah tidak valid!', '⚠️'); return }

    if (h.source === 'transaction') {
      // Asset-based topup/withdraw recorded as a transaction — adjust amount/date directly,
      // then recompute asset value by the delta (works for both topup=expense and withdraw=income)
      const oldAmount = h.amount
      const { error } = await supabase.from('transactions').update({
        amount, date: editHistoryForm.date, description: editHistoryForm.note || null,
      }).eq('id', h.id)
      if (error) { toast(error.message, '❌'); return }

      if (goal.asset_id) {
        const asset = assets.find(a => a.id === goal.asset_id)
        const diff = amount - oldAmount
        const delta = h.kind === 'topup' ? diff : -diff // topup adds to asset, withdraw subtracts
        await supabase.from('assets').update({ value: Math.max(0, Number(asset?.value || 0) + delta) }).eq('id', goal.asset_id)
      }
    } else {
      // Transfer-based: delete old (trigger reverses balances) + insert new (trigger applies new balances)
      if (!editHistoryForm.wallet_id) { toast('Pilih dompet!', '⚠️'); return }
      const { error: delErr } = await supabase.from('transfers').delete().eq('id', h.id)
      if (delErr) { toast(delErr.message, '❌'); return }

      const isTopUp = h.kind === 'topup'
      const { error: insErr } = await supabase.from('transfers').insert({
        user_id: session.user.id,
        from_wallet_id: isTopUp ? editHistoryForm.wallet_id : h.from_wallet_id,
        to_wallet_id: isTopUp ? h.to_wallet_id : editHistoryForm.wallet_id,
        amount,
        fee: 0,
        description: editHistoryForm.note || (isTopUp ? `Tabungan: ${goal.name}` : `Pencairan: ${goal.name}`),
        note: editHistoryForm.note || (isTopUp ? `Tabungan: ${goal.name}` : `Pencairan: ${goal.name}`),
        date: editHistoryForm.date,
        savings_goal_id: goal.id,
        savings_type: isTopUp ? 'topup' : 'withdraw',
      })
      if (insErr) { toast(insErr.message, '❌'); return }
    }

    toast('Riwayat diperbarui!', '✅')
    setEditingHistoryId(null)
    await load()

    // Recheck completion status after balance shifts
    const refreshed = goals.find(g => g.id === goal.id)
    if (refreshed) {
      const newAmount = currentAmountOf(refreshed)
      const isCompleted = newAmount >= Number(refreshed.target_amount)
      await supabase.from('savings_goals').update({ is_completed: isCompleted }).eq('id', refreshed.id)
      load()
    }
  }

  async function deleteHistoryEntry(goal: SavingsGoal, h: GoalHistory) {
    if (!confirm(`Hapus riwayat ${h.kind === 'topup' ? 'top up' : 'pencairan'} ${formatCurrency(h.amount)} ini? Saldo dompet terkait akan dikembalikan otomatis.`)) return

    if (h.source === 'transaction') {
      await supabase.from('transactions').delete().eq('id', h.id)
      if (goal.asset_id) {
        const asset = assets.find(a => a.id === goal.asset_id)
        const delta = h.kind === 'topup' ? -h.amount : h.amount // reverse effect
        await supabase.from('assets').update({ value: Math.max(0, Number(asset?.value || 0) + delta) }).eq('id', goal.asset_id)
      }
    } else {
      await supabase.from('transfers').delete().eq('id', h.id)
    }

    toast('Riwayat dihapus, saldo dikembalikan', '🗑️')
    await load()
  }

  const activeGoals = goals.filter(g => !g.is_completed)
  const doneGoals = goals.filter(g => g.is_completed)
  const totalTarget = activeGoals.reduce((s, g) => s + Number(g.target_amount), 0)
  const totalSaved = activeGoals.reduce((s, g) => s + currentAmountOf(g), 0)

  function GoalCard({ goal }: { goal: SavingsGoal }) {
    const current = currentAmountOf(goal)
    const pct = Math.min((current / Number(goal.target_amount)) * 100, 100)
    const remaining = Number(goal.target_amount) - current
    const dl = goal.target_date ? daysLeft(goal.target_date) : null
    const isOverdue = dl !== null && dl < 0 && !goal.is_completed
    const monthlyNeeded = dl && dl > 0 && remaining > 0 ? Math.ceil(remaining / (dl / 30)) : null
    const history = goalHistories[goal.id] || []
    const isHistoryOpen = !!expandedHistory[goal.id]
    const linked = linkedWalletsOf(goal)

    return (
      <div className="card p-4 group">
        {/* Header */}
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
            <p className="text-xs text-surface-500">
              {goal.asset_id
                ? `📈 ${goal.assets?.name || '—'}`
                : linked.length > 0 ? linked.map(w => w.name).join(' + ') : '—'}
            </p>
            {goal.target_date && (
              <p className={`text-[10px] font-semibold mt-0.5 ${isOverdue ? 'text-red-500' : dl! <= 30 ? 'text-amber-600' : 'text-surface-400'}`}>
                {isOverdue ? `⚠️ Lewat ${Math.abs(dl!)} hari` : `📅 ${dl} hari lagi (${formatDate(goal.target_date)})`}
              </p>
            )}
          </div>
          <div className="text-right flex-shrink-0">
            <p className="text-sm font-extrabold font-mono" style={{ color: goal.color }}>
              {formatShort(current)}
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
        {!goal.is_completed ? (
          <div className="flex gap-2 mb-3">
            <button onClick={() => openTopUp(goal)} className="btn btn-primary text-xs flex-1 py-2">💰 Top Up</button>
            <button onClick={() => openWithdraw(goal)} className="btn btn-secondary text-xs flex-1 py-2"
              disabled={current <= 0} title={current <= 0 ? 'Belum ada saldo terkumpul' : 'Cairkan tabungan'}>
              💸 Cairkan
            </button>
            <button onClick={() => openEdit(goal)} className="btn btn-secondary text-xs w-9 p-0">✏️</button>
            <button onClick={() => toggleComplete(goal)} className="btn btn-secondary text-xs w-9 p-0" title="Tandai selesai">✓</button>
            <button onClick={() => deleteGoal(goal.id)} className="btn btn-secondary text-xs w-9 p-0 hover:bg-red-50 hover:text-red-500">✕</button>
          </div>
        ) : (
          <div className="flex gap-2 mb-3">
            <button onClick={() => openWithdraw(goal)} className="btn btn-primary text-xs flex-1 py-2" disabled={current <= 0}>💸 Cairkan</button>
            <button onClick={() => toggleComplete(goal)} className="btn btn-secondary text-xs flex-1 py-2">Buka Kembali</button>
            <button onClick={() => deleteGoal(goal.id)} className="btn btn-secondary text-xs w-9 p-0 hover:bg-red-50 hover:text-red-500">✕</button>
          </div>
        )}

        {/* History toggle */}
        <button
          onClick={() => setExpandedHistory(prev => ({ ...prev, [goal.id]: !prev[goal.id] }))}
          className="w-full flex items-center justify-between text-[11px] font-semibold text-surface-500 hover:text-surface-700 py-1.5 border-t border-surface-100 transition-colors"
        >
          <span>📋 Riwayat ({history.length})</span>
          <span className="text-surface-400">{isHistoryOpen ? '▲' : '▼'}</span>
        </button>

        {/* History list — now editable & deletable */}
        {isHistoryOpen && (
          <div className="mt-2 space-y-1.5">
            {history.length === 0 ? (
              <p className="text-[11px] text-surface-400 text-center py-3">Belum ada riwayat transaksi</p>
            ) : (
              history.map(h => {
                const isEditingThis = editingHistoryId === h.id
                if (isEditingThis) {
                  return (
                    <div key={h.id} className="p-2.5 rounded-lg bg-surface-50 space-y-2">
                      <div className="flex gap-2">
                        <input className="input text-xs font-mono flex-1" type="number" placeholder="Jumlah"
                          value={editHistoryForm.amount} onChange={e => setEditHistoryForm({ ...editHistoryForm, amount: e.target.value })} />
                        <input className="input text-xs flex-1" type="date"
                          value={editHistoryForm.date} onChange={e => setEditHistoryForm({ ...editHistoryForm, date: e.target.value })} />
                      </div>
                      {h.source === 'transfer' && (
                        <select className="input text-xs" value={editHistoryForm.wallet_id}
                          onChange={e => setEditHistoryForm({ ...editHistoryForm, wallet_id: e.target.value })}>
                          <option value="">
                            {h.kind === 'topup' ? '-- Pindah dompet sumber --' : '-- Pindah dompet asal (goal) --'}
                          </option>
                          {(h.kind === 'topup' ? wallets : linkedWalletsOf(goal)).map(w => (
                            <option key={w.id} value={w.id}>{w.icon || '💳'} {w.name}</option>
                          ))}
                        </select>
                      )}
                      <input className="input text-xs" placeholder="Catatan" value={editHistoryForm.note}
                        onChange={e => setEditHistoryForm({ ...editHistoryForm, note: e.target.value })} />
                      <div className="flex gap-2">
                        <button onClick={cancelEditHistory} className="btn btn-secondary text-[11px] flex-1 py-1.5">Batal</button>
                        <button onClick={() => saveEditHistory(goal, h)} className="btn btn-primary text-[11px] flex-1 py-1.5">Simpan</button>
                      </div>
                    </div>
                  )
                }
                return (
                  <div key={h.id} className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg bg-surface-50 group/hist">
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs flex-shrink-0 ${h.kind === 'topup' ? 'bg-green-100' : 'bg-orange-100'}`}>
                      {h.kind === 'topup' ? '↑' : '↓'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] font-semibold text-surface-700">
                        {h.kind === 'topup' ? 'Top Up' : 'Pencairan'}
                        {h.wallet_name && <span className="font-normal text-surface-400"> · {h.kind === 'topup' ? 'dari' : 'ke'} {h.wallet_name}</span>}
                      </p>
                      <p className="text-[10px] text-surface-400">{formatDate(h.date)}</p>
                    </div>
                    <p className={`text-xs font-bold font-mono flex-shrink-0 ${h.kind === 'topup' ? 'text-green-600' : 'text-orange-500'}`}>
                      {h.kind === 'topup' ? '+' : '-'}{formatShort(h.amount)}
                    </p>
                    <div className="flex items-center gap-0.5 opacity-0 group-hover/hist:opacity-100 transition-opacity flex-shrink-0">
                      <button onClick={() => openEditHistory(goal, h)} className="w-6 h-6 rounded hover:bg-brand-50 text-surface-400 hover:text-brand-600 flex items-center justify-center text-[10px]">✏️</button>
                      <button onClick={() => deleteHistoryEntry(goal, h)} className="w-6 h-6 rounded hover:bg-red-50 text-surface-400 hover:text-red-500 flex items-center justify-center text-[10px]">✕</button>
                    </div>
                  </div>
                )
              })
            )}
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

      {/* ── Add/Edit Goal Modal ── */}
      <Modal open={showModal} onClose={() => { setShowModal(false); setEditing(null) }}
        title={editing ? 'Edit Tujuan' : 'Tambah Tujuan Tabungan'}>
        <div className="space-y-4">
          <div>
            <label className="label">Icon</label>
            <div className="flex flex-wrap gap-1.5">
              {GOAL_ICONS.map(ic => (
                <button key={ic} onClick={() => setForm({ ...form, icon: ic })}
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
                <button key={c} onClick={() => setForm({ ...form, color: c })}
                  className="w-8 h-8 rounded-lg border-2 transition-all"
                  style={{ background: c, borderColor: form.color === c ? '#fff' : 'transparent', boxShadow: form.color === c ? `0 0 0 2px ${c}` : 'none' }} />
              ))}
            </div>
          </div>
          <div>
            <label className="label">Nama Tujuan</label>
            <input className="input" placeholder="mis. DP Rumah, Liburan Eropa, Dana Darurat" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <label className="label">Jenis Target</label>
            <div className="flex gap-2">
              <button onClick={() => setForm({ ...form, target_type: 'wallet', asset_id: '' })}
                className={`flex-1 text-xs font-bold py-2 rounded-lg border-2 transition-all ${form.target_type === 'wallet' ? 'border-brand-400 bg-brand-50 text-brand-700' : 'border-surface-200 text-surface-500'}`}>
                💳 Dompet
              </button>
              <button onClick={() => setForm({ ...form, target_type: 'asset', wallet_ids: [] })}
                className={`flex-1 text-xs font-bold py-2 rounded-lg border-2 transition-all ${form.target_type === 'asset' ? 'border-brand-400 bg-brand-50 text-brand-700' : 'border-surface-200 text-surface-500'}`}>
                📈 Aset (RDPU, dll)
              </button>
            </div>
          </div>
          {form.target_type === 'wallet' ? (
            <div>
              <label className="label">Dompet Target <span className="text-surface-400 font-normal">(bisa pilih lebih dari satu)</span></label>
              <div className="space-y-1.5 max-h-48 overflow-y-auto p-1">
                {wallets.map(w => {
                  const checked = form.wallet_ids.includes(w.id)
                  return (
                    <button key={w.id} type="button" onClick={() => toggleWalletInForm(w.id)}
                      className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-xl border text-left transition-all ${checked ? 'border-brand-400 bg-brand-50' : 'border-surface-200 bg-white'}`}>
                      <span className={`w-5 h-5 rounded-md border-2 flex items-center justify-center text-xs flex-shrink-0 ${checked ? 'bg-brand-500 border-brand-500 text-white' : 'border-surface-300'}`}>
                        {checked && '✓'}
                      </span>
                      <span className="text-lg">{w.icon || '💳'}</span>
                      <span className="flex-1 text-sm font-medium text-surface-700">{w.name}</span>
                      <span className="text-xs font-mono text-surface-400">{formatShort(Number(w.balance))}</span>
                    </button>
                  )
                })}
              </div>
              <p className="text-[10px] text-surface-400 mt-1">
                Progress otomatis mengikuti total saldo semua dompet yang dipilih. Saat top up/cairkan, kamu bisa pilih dompet mana pun dari daftar ini.
              </p>
            </div>
          ) : (
            <div>
              <label className="label">Aset Target</label>
              <select className="input" value={form.asset_id} onChange={e => setForm({ ...form, asset_id: e.target.value })}>
                <option value="">Pilih aset</option>
                {assets.map(a => <option key={a.id} value={a.id}>{a.icon || '📈'} {a.name} ({formatShort(Number(a.value))})</option>)}
              </select>
              <p className="text-[10px] text-surface-400 mt-1">Progress otomatis mengikuti nilai aset ini (mis. RDPU)</p>
            </div>
          )}
          <div>
            <label className="label">Target Amount</label>
            <input className="input" type="number" inputMode="numeric" placeholder="0" value={form.target_amount} onChange={e => setForm({ ...form, target_amount: e.target.value })} />
          </div>
          <div>
            <label className="label">Target Tanggal <span className="text-surface-400 font-normal">(opsional)</span></label>
            <input className="input" type="date" value={form.target_date} onChange={e => setForm({ ...form, target_date: e.target.value })} />
          </div>
          <div>
            <label className="label">Catatan <span className="text-surface-400 font-normal">(opsional)</span></label>
            <input className="input" placeholder="mis. Untuk beli rumah di BSD" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
          </div>
          <div className="flex gap-2 pt-1">
            {editing && <button onClick={() => { deleteGoal(editing.id); setShowModal(false) }} className="btn btn-danger flex-1">Hapus</button>}
            <button onClick={saveGoal} className="btn btn-primary flex-1">{editing ? 'Simpan' : 'Buat Tujuan'}</button>
          </div>
        </div>
      </Modal>

      {/* ── Top Up Modal ── */}
      <Modal open={showTopUp && !!selectedGoal} onClose={() => setShowTopUp(false)} title={`💰 Top Up — ${selectedGoal?.name}`}>
        {selectedGoal && (() => {
          const current = currentAmountOf(selectedGoal)
          const linked = linkedWalletsOf(selectedGoal)
          const sourceWallets = wallets.filter(w => !linked.some(l => l.id === w.id))
          return (
            <div className="space-y-4">
              <div className="p-3 rounded-xl" style={{ background: selectedGoal.color + '15' }}>
                <div className="flex justify-between text-xs mb-2">
                  <span className="text-surface-500">Progress saat ini</span>
                  <span className="font-bold" style={{ color: selectedGoal.color }}>
                    {((current / Number(selectedGoal.target_amount)) * 100).toFixed(0)}%
                  </span>
                </div>
                <div className="progress-bar h-2">
                  <div className="progress-fill" style={{
                    width: `${Math.min((current / Number(selectedGoal.target_amount)) * 100, 100)}%`,
                    background: selectedGoal.color
                  }} />
                </div>
                <div className="flex justify-between text-xs mt-2">
                  <span className="text-surface-500">Terkumpul: <span className="font-bold">{formatCurrency(current)}</span></span>
                  <span className="text-surface-500">Target: <span className="font-bold">{formatCurrency(Number(selectedGoal.target_amount))}</span></span>
                </div>
              </div>
              <div>
                <label className="label">Tanggal</label>
                <input className="input" type="date" value={topUpForm.date} onChange={e => setTopUpForm({ ...topUpForm, date: e.target.value })} />
              </div>
              <div>
                <label className="label">Jumlah Top Up</label>
                <input className="input text-xl font-bold" type="number" inputMode="numeric" placeholder="0"
                  value={topUpForm.amount} onChange={e => setTopUpForm({ ...topUpForm, amount: e.target.value })} autoFocus />
              </div>
              <div className="flex gap-2">
                {[100000, 500000, 1000000].map(amt => (
                  <button key={amt} onClick={() => setTopUpForm({ ...topUpForm, amount: String(amt) })}
                    className="btn btn-secondary text-xs flex-1 py-2">{formatShort(amt)}</button>
                ))}
                <button onClick={() => {
                  const rem = Number(selectedGoal.target_amount) - current
                  setTopUpForm({ ...topUpForm, amount: String(rem > 0 ? rem : 0) })
                }} className="btn btn-secondary text-xs flex-1 py-2">Lunas</button>
              </div>
              <div>
                <label className="label">Dari Dompet</label>
                <select className="input" value={topUpForm.from_wallet_id} onChange={e => setTopUpForm({ ...topUpForm, from_wallet_id: e.target.value })}>
                  <option value="">Pilih dompet sumber</option>
                  {(selectedGoal.asset_id ? wallets : sourceWallets).map(w => (
                    <option key={w.id} value={w.id}>{w.icon || '💳'} {w.name} ({formatShort(Number(w.balance))})</option>
                  ))}
                </select>
              </div>
              {!selectedGoal.asset_id && (
                <div>
                  <label className="label">Ke Dompet Target</label>
                  <select className="input" value={topUpForm.to_wallet_id} onChange={e => setTopUpForm({ ...topUpForm, to_wallet_id: e.target.value })}>
                    <option value="">Pilih dompet tujuan</option>
                    {linked.map(w => (
                      <option key={w.id} value={w.id}>{w.icon || '💳'} {w.name} ({formatShort(Number(w.balance))})</option>
                    ))}
                  </select>
                  {linked.length > 1 && (
                    <p className="text-[10px] text-surface-400 mt-1">Goal ini terhubung ke {linked.length} dompet — pilih salah satu sebagai tujuan top up kali ini.</p>
                  )}
                </div>
              )}
              {Number(topUpForm.amount) > 0 && (
                <div className="p-3 bg-green-50 rounded-xl text-xs">
                  <p className="font-semibold text-green-700 mb-1">Setelah top up:</p>
                  <p className="text-green-600">
                    {formatCurrency(current + Number(topUpForm.amount))} / {formatCurrency(Number(selectedGoal.target_amount))}&nbsp;
                    ({Math.min(((current + Number(topUpForm.amount)) / Number(selectedGoal.target_amount)) * 100, 100).toFixed(0)}%)
                    {current + Number(topUpForm.amount) >= Number(selectedGoal.target_amount) && ' 🎉 TARGET TERCAPAI!'}
                  </p>
                </div>
              )}
              <div className="flex gap-2">
                <button onClick={() => setShowTopUp(false)} className="btn btn-secondary flex-1">Batal</button>
                <button onClick={doTopUp} className="btn btn-primary flex-1">💰 Top Up</button>
              </div>
            </div>
          )
        })()}
      </Modal>

      {/* ── Withdraw Modal ── */}
      <Modal open={showWithdraw && !!selectedGoal} onClose={() => setShowWithdraw(false)} title={`💸 Cairkan — ${selectedGoal?.name}`}>
        {selectedGoal && (() => {
          const current = currentAmountOf(selectedGoal)
          const linked = linkedWalletsOf(selectedGoal)
          const targetWallets = wallets.filter(w => !linked.some(l => l.id === w.id))
          const withdrawAmt = Number(withdrawForm.amount)
          return (
            <div className="space-y-4">
              <div className="p-3 rounded-xl bg-orange-50 border border-orange-100">
                <p className="text-xs text-surface-500 mb-0.5">Saldo terkumpul (maks. pencairan)</p>
                <p className="text-xl font-extrabold font-mono text-orange-600">{formatCurrency(current)}</p>
              </div>
              <div>
                <label className="label">Tanggal</label>
                <input className="input" type="date" value={withdrawForm.date} onChange={e => setWithdrawForm({ ...withdrawForm, date: e.target.value })} />
              </div>
              <div>
                <label className="label">Jumlah Pencairan</label>
                <input className="input text-xl font-bold" type="number" inputMode="numeric" placeholder="0"
                  max={current} value={withdrawForm.amount} onChange={e => setWithdrawForm({ ...withdrawForm, amount: e.target.value })} autoFocus />
                {withdrawAmt > current && (
                  <p className="text-xs text-red-500 mt-1">⚠️ Melebihi saldo terkumpul ({formatCurrency(current)})</p>
                )}
              </div>
              <div className="flex gap-2">
                {[25, 50, 75].map(pct => (
                  <button key={pct} onClick={() => setWithdrawForm({ ...withdrawForm, amount: String(Math.floor(current * pct / 100)) })}
                    className="btn btn-secondary text-xs flex-1 py-2">{pct}%</button>
                ))}
                <button onClick={() => setWithdrawForm({ ...withdrawForm, amount: String(current) })}
                  className="btn btn-secondary text-xs flex-1 py-2">Semua</button>
              </div>
              {!selectedGoal.asset_id && (
                <div>
                  <label className="label">Dari Dompet <span className="text-surface-400 font-normal">(mana yang ditarik)</span></label>
                  <select className="input" value={withdrawForm.from_wallet_id} onChange={e => setWithdrawForm({ ...withdrawForm, from_wallet_id: e.target.value })}>
                    <option value="">Pilih dompet asal</option>
                    {linked.map(w => (
                      <option key={w.id} value={w.id}>{w.icon || '💳'} {w.name} ({formatShort(Number(w.balance))})</option>
                    ))}
                  </select>
                  {linked.length > 1 && (
                    <p className="text-[10px] text-surface-400 mt-1">Goal ini terhubung ke {linked.length} dompet — pilih salah satu sebagai sumber pencairan.</p>
                  )}
                </div>
              )}
              <div>
                <label className="label">Ke Dompet</label>
                <select className="input" value={withdrawForm.to_wallet_id} onChange={e => setWithdrawForm({ ...withdrawForm, to_wallet_id: e.target.value })}>
                  <option value="">Pilih dompet tujuan</option>
                  {(selectedGoal.asset_id ? wallets : targetWallets).map(w => (
                    <option key={w.id} value={w.id}>{w.icon || '💳'} {w.name} ({formatShort(Number(w.balance))})</option>
                  ))}
                </select>
                <p className="text-[10px] text-surface-400 mt-1">
                  {selectedGoal.asset_id
                    ? 'Akan dicatat sebagai pemasukan dan mengurangi nilai aset'
                    : 'Akan ditransfer dari dompet goal ke dompet tujuan ini'}
                </p>
              </div>
              {withdrawAmt > 0 && withdrawAmt <= current && (
                <div className="p-3 bg-orange-50 rounded-xl text-xs">
                  <p className="font-semibold text-orange-700 mb-1">Setelah pencairan:</p>
                  <p className="text-orange-600">
                    Sisa tabungan: {formatCurrency(current - withdrawAmt)}&nbsp;
                    ({((current - withdrawAmt) / Number(selectedGoal.target_amount) * 100).toFixed(0)}% dari target)
                  </p>
                </div>
              )}
              <div className="flex gap-2">
                <button onClick={() => setShowWithdraw(false)} className="btn btn-secondary flex-1">Batal</button>
                <button onClick={doWithdraw} className="btn btn-primary flex-1" disabled={withdrawAmt <= 0 || withdrawAmt > current}>
                  💸 Cairkan
                </button>
              </div>
            </div>
          )
        })()}
      </Modal>
    </AppShell>
  )
}
