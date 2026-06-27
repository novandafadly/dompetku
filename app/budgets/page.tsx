'use client'
import { useEffect, useState } from 'react'
import { supabase, filterPersonalTransactions } from '@/lib/supabase'
import type { Budget, Category, Transaction, Wallet } from '@/lib/supabase'
import { formatCurrency, formatShort, MONTHS } from '@/lib/utils'
import AppShell from '@/components/AppShell'
import Modal from '@/components/Modal'
import { toast } from '@/components/Toast'

// ── Types ─────────────────────────────────────────────────
type SavingsAllocation = {
  id: string
  label: string
  wallet_id: string
  amount: number
}

type BudgetPlan = {
  id: string
  period_month: number
  period_year: number
  estimated_income: number
  savings_allocations: SavingsAllocation[]
}

function genId() {
  return Math.random().toString(36).slice(2, 10)
}

export default function BudgetsPage() {
  const [budgets, setBudgets] = useState<Budget[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [tabunganWallets, setTabunganWallets] = useState<Wallet[]>([])
  const [plan, setPlan] = useState<BudgetPlan | null>(null)

  const [activeTab, setActiveTab] = useState<'plan' | 'tracking'>('plan')
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<Budget | null>(null)
  const [showPlanModal, setShowPlanModal] = useState(false)

  const now = new Date()
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1)
  const [selectedYear, setSelectedYear] = useState(now.getFullYear())
  const [form, setForm] = useState({ category_id: '', amount: '' })

  const [planIncome, setPlanIncome] = useState('')
  const [planAllocations, setPlanAllocations] = useState<SavingsAllocation[]>([])

  useEffect(() => { load() }, [selectedMonth, selectedYear])

  function prevMonth() {
    if (selectedMonth === 1) { setSelectedMonth(12); setSelectedYear(y => y - 1) }
    else setSelectedMonth(m => m - 1)
  }
  function nextMonth() {
    if (selectedMonth === 12) { setSelectedMonth(1); setSelectedYear(y => y + 1) }
    else setSelectedMonth(m => m + 1)
  }
  const isCurrentMonth = selectedMonth === now.getMonth() + 1 && selectedYear === now.getFullYear()

  async function load() {
    const startOfMonth = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}-01`
    const endOfMonth = new Date(selectedYear, selectedMonth, 0).toISOString().split('T')[0]
    const { data: { user: sessionUser } } = await supabase.auth.getUser()
    const session = sessionUser ? { user: sessionUser } : null

    const [b, c, t, w, p] = await Promise.all([
      supabase.from('budgets').select('*, categories(*)').eq('period_month', selectedMonth).eq('period_year', selectedYear),
      supabase.from('categories').select('*').eq('type', 'expense').order('name'),
      supabase.from('transactions').select('*, wallets(pocket)').eq('type', 'expense').gte('date', startOfMonth).lte('date', endOfMonth),
      supabase.from('wallets').select('*').eq('is_active', true).eq('pocket', 'tabungan').order('name'),
      session
        ? supabase.from('budget_plan').select('*').eq('period_month', selectedMonth).eq('period_year', selectedYear).eq('user_id', session.user.id).maybeSingle()
        : Promise.resolve({ data: null }),
    ])

    setBudgets((b.data) || [])
    setCategories((c.data) || [])
    setTransactions(filterPersonalTransactions((t.data) || []))
    setTabunganWallets((w.data) || [])
    setPlan((p as any).data || null)
  }

  // ── Budget CRUD ────────────────────────────────────────
  function openAdd() { setEditing(null); setForm({ category_id: '', amount: '' }); setShowModal(true) }
  function openEdit(b: Budget) {
    setEditing(b); setForm({ category_id: b.category_id, amount: String(b.amount) }); setShowModal(true)
  }

  async function saveBudget() {
    const { data: { user } } = await supabase.auth.getUser()
    const session = user ? { user } : null
    if (!session) return
    const amount = Number(form.amount)
    if (!amount || amount <= 0 || !form.category_id) { toast('Lengkapi data!', '⚠️'); return }
    if (editing) {
      const { error } = await supabase.from('budgets').update({ amount, category_id: form.category_id }).eq('id', editing.id)
      if (error) { toast(error.message, '❌'); return }
      toast('Anggaran diperbarui!', '✅')
    } else {
      const { error } = await supabase.from('budgets').insert({
        user_id: session.user.id, category_id: form.category_id, amount,
        period_month: selectedMonth, period_year: selectedYear,
      })
      if (error) {
        toast(error.message.includes('duplicate key') ? 'Budget kategori ini sudah ada!' : error.message, '❌')
        return
      }
      toast('Anggaran ditambahkan!', '🎯')
    }
    setShowModal(false); setEditing(null); setForm({ category_id: '', amount: '' }); load()
  }

  async function deleteBudget(id: string) {
    await supabase.from('budgets').delete().eq('id', id)
    toast('Anggaran dihapus', '🗑️'); load()
  }

  async function copyFromLastMonth() {
    const { data: { user } } = await supabase.auth.getUser()
    const session = user ? { user } : null
    if (!session) return
    const prevM = selectedMonth === 1 ? 12 : selectedMonth - 1
    const prevY = selectedMonth === 1 ? selectedYear - 1 : selectedYear
    const { data: last } = await supabase.from('budgets').select('category_id, amount').eq('user_id', session.user.id).eq('period_month', prevM).eq('period_year', prevY)
    if (!last || last.length === 0) { toast('Tidak ada anggaran bulan sebelumnya', '⚠️'); return }
    const existing = new Set(budgets.map(b => b.category_id))
    const toInsert = last.filter(b => !existing.has(b.category_id)).map(b => ({
      user_id: session.user.id, category_id: b.category_id, amount: b.amount,
      period_month: selectedMonth, period_year: selectedYear,
    }))
    if (toInsert.length === 0) { toast('Semua kategori sudah ada', 'ℹ️'); return }
    const { error } = await supabase.from('budgets').insert(toInsert)
    if (error) { toast(error.message, '❌'); return }
    toast(`${toInsert.length} anggaran disalin!`, '📋'); load()
  }

  // ── Plan CRUD ──────────────────────────────────────────
  function openPlanModal() {
    setPlanIncome(plan ? String(plan.estimated_income) : '')
    setPlanAllocations(plan ? plan.savings_allocations.map(a => ({ ...a, id: a.id || genId() })) : [])
    setShowPlanModal(true)
  }

  function addAllocation() {
    setPlanAllocations(prev => [...prev, { id: genId(), label: '', wallet_id: '', amount: 0 }])
  }

  function updateAllocation(id: string, patch: Partial<SavingsAllocation>) {
    setPlanAllocations(prev => prev.map(a => a.id === id ? { ...a, ...patch } : a))
  }

  function removeAllocation(id: string) {
    setPlanAllocations(prev => prev.filter(a => a.id !== id))
  }

  async function savePlan() {
    const { data: { user } } = await supabase.auth.getUser()
    const session = user ? { user } : null
    if (!session) return
    const income = Number(planIncome)
    if (!income) { toast('Isi estimasi income dulu!', '⚠️'); return }

    const payload = {
      user_id: session.user.id,
      period_month: selectedMonth,
      period_year: selectedYear,
      estimated_income: income,
      savings_allocations: planAllocations.filter(a => a.label && a.amount > 0),
      updated_at: new Date().toISOString(),
    }

    const { error } = plan
      ? await supabase.from('budget_plan').update(payload).eq('id', plan.id)
      : await supabase.from('budget_plan').insert(payload)

    if (error) { toast(error.message, '❌'); return }
    toast('Rencana disimpan!', '✅')
    setShowPlanModal(false); load()
  }

  // ── Computed ───────────────────────────────────────────
  const totalBudget = budgets.reduce((s, b) => s + Number(b.amount), 0)
  const totalSpent = budgets.reduce((s, b) =>
    s + transactions.filter(t => t.category_id === b.category_id).reduce((ss, t) => ss + Number(t.amount), 0), 0)
  const remaining = totalBudget - totalSpent
  const totalSavingsAlloc = (plan?.savings_allocations || []).reduce((s, a) => s + Number(a.amount), 0)
  const totalAllocated = totalBudget + totalSavingsAlloc
  const unallocated = (plan?.estimated_income || 0) - totalAllocated
  const hasPlan = !!plan?.estimated_income

  return (
    <AppShell>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-extrabold text-surface-900">Anggaran</h1>
          <div className="flex items-center gap-2 mt-1">
            <button onClick={prevMonth} className="w-6 h-6 rounded-lg bg-surface-100 hover:bg-surface-200 flex items-center justify-center text-surface-500 text-xs transition-colors">←</button>
            <span className="text-sm font-bold text-surface-700 min-w-[110px] text-center">{MONTHS[selectedMonth - 1]} {selectedYear}</span>
            <button onClick={nextMonth} className="w-6 h-6 rounded-lg bg-surface-100 hover:bg-surface-200 flex items-center justify-center text-surface-500 text-xs transition-colors">→</button>
            {!isCurrentMonth && (
              <button onClick={() => { setSelectedMonth(now.getMonth() + 1); setSelectedYear(now.getFullYear()) }} className="text-[10px] font-bold text-brand-600 bg-brand-50 px-2 py-0.5 rounded-full">Hari ini</button>
            )}
          </div>
        </div>
        <button onClick={openAdd} className="btn btn-primary text-sm py-2 px-3">+ Set Anggaran</button>
      </div>

      {/* Tab */}
      <div className="flex gap-1.5 mb-5 bg-surface-100 p-1 rounded-xl">
        <button onClick={() => setActiveTab('plan')} className={`flex-1 text-xs font-bold py-2 rounded-lg transition-all ${activeTab === 'plan' ? 'bg-white text-surface-900 shadow-sm' : 'text-surface-500'}`}>
          🗂 Rencana
        </button>
        <button onClick={() => setActiveTab('tracking')} className={`flex-1 text-xs font-bold py-2 rounded-lg transition-all ${activeTab === 'tracking' ? 'bg-white text-surface-900 shadow-sm' : 'text-surface-500'}`}>
          📊 Realisasi
        </button>
      </div>

      {/* ── TAB RENCANA ── */}
      {activeTab === 'plan' && (
        <>
          {/* Income card — klik untuk set/edit */}
          <div onClick={openPlanModal} className="card p-5 mb-4 cursor-pointer hover:shadow-md transition-shadow border-2 border-dashed border-surface-200 hover:border-brand-300">
            {hasPlan ? (
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-bold text-surface-400 uppercase mb-1">Estimasi Income</p>
                  <p className="text-2xl font-extrabold text-surface-900 font-mono">{formatCurrency(plan!.estimated_income)}</p>
                </div>
                <span className="text-surface-300 text-sm">✏️</span>
              </div>
            ) : (
              <div className="text-center py-2">
                <p className="text-2xl mb-1">💡</p>
                <p className="text-sm font-bold text-surface-600">Set estimasi income bulan ini</p>
                <p className="text-xs text-surface-400 mt-0.5">untuk mulai zero-based budgeting</p>
              </div>
            )}
          </div>

          {hasPlan && (
            <>
              {/* Zero-based breakdown */}
              <div className="card p-5 mb-4">
                <p className="text-xs font-bold text-surface-500 uppercase tracking-wider mb-4">Rincian Alokasi</p>
                <div className="space-y-2.5">
                  {/* Budget expense rows */}
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-surface-600 flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-red-400 inline-block flex-shrink-0" />
                      Budget Pengeluaran
                      <span className="text-[10px] text-surface-400">({budgets.length} kategori)</span>
                    </span>
                    <span className="font-bold font-mono">{formatCurrency(totalBudget)}</span>
                  </div>

                  {/* Savings allocation rows */}
                  {plan!.savings_allocations.map(a => {
                    const wallet = tabunganWallets.find(w => w.id === a.wallet_id)
                    return (
                      <div key={a.id} className="flex items-center justify-between text-sm">
                        <span className="text-surface-600 flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full bg-green-400 inline-block flex-shrink-0" />
                          {a.label}
                          {wallet && <span className="text-[10px] text-surface-400">({wallet.name})</span>}
                        </span>
                        <span className="font-bold font-mono">{formatCurrency(a.amount)}</span>
                      </div>
                    )
                  })}

                  {plan!.savings_allocations.length === 0 && (
                    <p className="text-[10px] text-surface-300 pl-5">Belum ada alokasi tabungan</p>
                  )}
                </div>

                {/* Sisa */}
                <div className="border-t border-surface-100 pt-3 mt-4 flex items-center justify-between">
                  <span className={`text-sm font-bold ${unallocated === 0 ? 'text-green-600' : unallocated > 0 ? 'text-amber-600' : 'text-red-500'}`}>
                    {unallocated === 0 ? '✅ Semua teralokasi' : unallocated > 0 ? '⏳ Belum dialokasikan' : '⚠️ Melebihi income!'}
                  </span>
                  <span className={`text-lg font-extrabold font-mono ${unallocated === 0 ? 'text-green-600' : unallocated > 0 ? 'text-amber-600' : 'text-red-500'}`}>
                    {unallocated > 0 ? '+' : ''}{formatCurrency(unallocated)}
                  </span>
                </div>
                {unallocated !== 0 && (
                  <p className="text-[10px] text-surface-400 mt-1">
                    {unallocated > 0 ? 'Tambah budget kategori atau alokasi tabungan sampai sisa = 0' : 'Kurangi beberapa pos supaya tidak melebihi income'}
                  </p>
                )}
              </div>

              {/* Progress bar segmented */}
              <div className="card p-4 mb-4">
                <div className="flex justify-between text-[10px] text-surface-400 mb-2">
                  <span>Teralokasi {Math.min(Math.round((totalAllocated / plan!.estimated_income) * 100), 100)}%</span>
                  <span>{formatShort(totalAllocated)} / {formatShort(plan!.estimated_income)}</span>
                </div>
                <div className="h-4 bg-surface-100 rounded-full overflow-hidden flex gap-0.5 p-0.5">
                  {totalBudget > 0 && (
                    <div className="h-full rounded-full bg-red-400 transition-all" style={{ width: `${Math.min((totalBudget / plan!.estimated_income) * 100, 100)}%` }} />
                  )}
                  {totalSavingsAlloc > 0 && (
                    <div className="h-full rounded-full bg-green-400 transition-all" style={{ width: `${Math.min((totalSavingsAlloc / plan!.estimated_income) * 100, 100)}%` }} />
                  )}
                </div>
                <div className="flex gap-4 mt-2">
                  <span className="text-[10px] text-surface-400 flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-red-400" /> Pengeluaran {formatShort(totalBudget)}</span>
                  <span className="text-[10px] text-surface-400 flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-green-400" /> Tabungan {formatShort(totalSavingsAlloc)}</span>
                </div>
              </div>

              <button onClick={openPlanModal} className="btn btn-secondary w-full text-sm mb-5">✏️ Edit Rencana & Alokasi Tabungan</button>
            </>
          )}

          {/* Budget list ringkas */}
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-bold text-surface-500 uppercase tracking-wider">Budget per Kategori</p>
            <button onClick={copyFromLastMonth} className="text-[10px] font-bold text-surface-400 hover:text-brand-600 transition-colors">📋 Salin bulan lalu</button>
          </div>

          {budgets.length > 0 ? (
            <div className="card overflow-hidden divide-y divide-surface-100">
              {budgets.map(b => (
                <div key={b.id} className="flex items-center gap-3 px-4 py-3 group">
                  <span className="text-lg flex-shrink-0">{(b as any).categories?.icon}</span>
                  <span className="flex-1 text-sm text-surface-700">{(b as any).categories?.name}</span>
                  <span className="font-mono font-bold text-sm text-surface-800">{formatCurrency(Number(b.amount))}</span>
                  <button onClick={() => openEdit(b)} className="opacity-0 group-hover:opacity-100 w-7 h-7 rounded hover:bg-brand-50 text-surface-300 hover:text-brand-500 flex items-center justify-center text-xs transition-all">✏️</button>
                  <button onClick={() => deleteBudget(b.id)} className="opacity-0 group-hover:opacity-100 w-7 h-7 rounded hover:bg-red-50 text-surface-300 hover:text-red-500 flex items-center justify-center text-xs transition-all">✕</button>
                </div>
              ))}
            </div>
          ) : (
            <div className="card text-center py-10 text-surface-300 border-dashed border-2 border-surface-200">
              <p className="text-3xl mb-2">🎯</p>
              <p className="text-sm">Belum ada budget kategori untuk {MONTHS[selectedMonth - 1]}.</p>
              <button onClick={openAdd} className="mt-3 btn btn-primary text-sm">+ Set Anggaran</button>
            </div>
          )}
        </>
      )}

      {/* ── TAB REALISASI ── */}
      {activeTab === 'tracking' && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            <div className="metric-card">
              <div className="absolute inset-0 bg-gradient-to-br from-brand-50 to-transparent" />
              <div className="relative">
                <p className="text-xs font-bold text-brand-600 uppercase tracking-wider mb-1">Total Budget</p>
                <p className="text-2xl font-extrabold text-surface-900">{formatShort(totalBudget)}</p>
              </div>
            </div>
            <div className="metric-card">
              <div className="absolute inset-0 bg-gradient-to-br from-red-50 to-transparent" />
              <div className="relative">
                <p className="text-xs font-bold text-red-500 uppercase tracking-wider mb-1">Terpakai</p>
                <p className="text-2xl font-extrabold text-red-500">{formatShort(totalSpent)}</p>
              </div>
            </div>
            <div className="metric-card">
              <div className="absolute inset-0 bg-gradient-to-br from-green-50 to-transparent" />
              <div className="relative">
                <p className="text-xs font-bold text-green-600 uppercase tracking-wider mb-1">Sisa</p>
                <p className={`text-2xl font-extrabold ${remaining >= 0 ? 'text-green-600' : 'text-red-500'}`}>{formatShort(remaining)}</p>
              </div>
            </div>
          </div>

          <div className="flex justify-end mb-3">
            <button onClick={copyFromLastMonth} className="text-xs font-bold text-surface-400 hover:text-brand-600 transition-colors">📋 Salin kategori dari bulan lalu</button>
          </div>

          <div className="space-y-3">
            {budgets.map((b) => {
              const spent = transactions.filter(t => t.category_id === b.category_id).reduce((s, t) => s + Number(t.amount), 0)
              const pct = Math.min((spent / Number(b.amount)) * 100, 100)
              const over = spent > Number(b.amount)
              return (
                <div key={b.id} className="card p-5 group">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">{(b as any).categories?.icon}</span>
                      <span className="font-semibold text-surface-800">{(b as any).categories?.name}</span>
                      {over && <span className="text-[10px] bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-bold">Over!</span>}
                    </div>
                    <div className="flex items-center gap-1">
                      <button onClick={() => openEdit(b)} className="opacity-0 group-hover:opacity-100 w-7 h-7 rounded-lg hover:bg-brand-50 text-surface-400 hover:text-brand-600 flex items-center justify-center text-xs transition-all">✏️</button>
                      <button onClick={() => deleteBudget(b.id)} className="opacity-0 group-hover:opacity-100 w-7 h-7 rounded-lg hover:bg-red-50 text-surface-400 hover:text-red-500 flex items-center justify-center text-xs transition-all">✕</button>
                    </div>
                  </div>
                  <div className="progress-bar mb-2">
                    <div className="progress-fill" style={{ width: `${pct}%`, background: over ? '#ef4444' : pct > 70 ? '#f59e0b' : '#22c55e' }} />
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-surface-500">Terpakai: <span className="font-bold font-mono">{formatCurrency(spent)}</span></span>
                    <span className="text-surface-400">Budget: <span className="font-bold font-mono">{formatCurrency(Number(b.amount))}</span></span>
                  </div>
                </div>
              )
            })}
            {budgets.length === 0 && (
              <div className="card text-center py-16 text-surface-300">
                <p className="text-4xl mb-2">🎯</p>
                <p className="text-sm">Belum ada anggaran untuk {MONTHS[selectedMonth - 1]} {selectedYear}.</p>
                <button onClick={openAdd} className="mt-3 btn btn-primary text-sm">+ Set Anggaran</button>
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Modal: Budget kategori ── */}
      <Modal open={showModal} onClose={() => { setShowModal(false); setEditing(null) }} title={editing ? 'Edit Anggaran' : `Set Anggaran — ${MONTHS[selectedMonth - 1]} ${selectedYear}`}>
        <div className="space-y-4">
          <div>
            <label className="label">Kategori Pengeluaran</label>
            <select className="input" value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })} disabled={!!editing}>
              <option value="">Pilih kategori</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Batas Anggaran</label>
            <input className="input" type="number" placeholder="0" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          </div>
          <div className="flex gap-2">
            {editing && <button onClick={() => { deleteBudget(editing.id); setShowModal(false) }} className="btn btn-danger flex-1">Hapus</button>}
            <button onClick={saveBudget} className="btn btn-primary flex-1">{editing ? 'Simpan Perubahan' : 'Simpan'}</button>
          </div>
        </div>
      </Modal>

      {/* ── Modal: Rencana & Alokasi ── */}
      <Modal open={showPlanModal} onClose={() => setShowPlanModal(false)} title={`Rencana ${MONTHS[selectedMonth - 1]} ${selectedYear}`}>
        <div className="space-y-5">
          <div>
            <label className="label">Estimasi Income Bulan Ini</label>
            <input
              className="input text-xl font-bold"
              type="number"
              inputMode="numeric"
              placeholder="6100000"
              value={planIncome}
              onChange={(e) => setPlanIncome(e.target.value)}
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="label mb-0">Alokasi Tabungan</label>
              <button onClick={addAllocation} className="text-xs font-bold text-brand-600 hover:text-brand-700">+ Tambah Pos</button>
            </div>

            {planAllocations.length === 0 && (
              <p className="text-xs text-surface-400 py-2">Belum ada alokasi. Tambah pos seperti Dana Mudik, Healing, dll.</p>
            )}

            <div className="space-y-3">
              {planAllocations.map(a => (
                <div key={a.id} className="p-3 bg-surface-50 rounded-xl space-y-2">
                  <div className="flex gap-2 items-center">
                    <input
                      className="input flex-1 text-sm"
                      placeholder="Nama pos, mis. Dana Mudik"
                      value={a.label}
                      onChange={(e) => updateAllocation(a.id, { label: e.target.value })}
                    />
                    <button onClick={() => removeAllocation(a.id)} className="w-8 h-8 rounded-lg hover:bg-red-50 text-surface-300 hover:text-red-500 flex items-center justify-center text-sm flex-shrink-0">✕</button>
                  </div>
                  <div className="flex gap-2">
                    <select
                      className="input flex-1 text-sm"
                      value={a.wallet_id}
                      onChange={(e) => {
                        const wallet = tabunganWallets.find(w => w.id === e.target.value)
                        updateAllocation(a.id, { wallet_id: e.target.value, label: a.label || wallet?.name || '' })
                      }}
                    >
                      <option value="">— Wallet (opsional) —</option>
                      {tabunganWallets.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                    </select>
                    <input
                      className="input w-32 text-sm font-mono"
                      type="number"
                      inputMode="numeric"
                      placeholder="Nominal"
                      value={a.amount || ''}
                      onChange={(e) => updateAllocation(a.id, { amount: Number(e.target.value) })}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Preview sisa real-time */}
          {planIncome && (
            <div className="p-4 bg-surface-50 rounded-xl space-y-2 text-sm">
              <p className="text-xs font-bold text-surface-500 uppercase mb-3">Preview Alokasi</p>
              <div className="flex justify-between">
                <span className="text-surface-600">Income</span>
                <span className="font-mono font-bold">{formatCurrency(Number(planIncome))}</span>
              </div>
              <div className="flex justify-between text-surface-500">
                <span>− Budget Pengeluaran</span>
                <span className="font-mono text-red-500">−{formatCurrency(totalBudget)}</span>
              </div>
              {planAllocations.filter(a => a.amount > 0).map(a => (
                <div key={a.id} className="flex justify-between text-surface-500">
                  <span>− {a.label || 'Tabungan'}</span>
                  <span className="font-mono text-green-600">−{formatCurrency(a.amount)}</span>
                </div>
              ))}
              <div className="border-t border-surface-200 pt-2 flex justify-between">
                <span className="font-bold">Sisa</span>
                {(() => {
                  const totalSav = planAllocations.reduce((s, a) => s + (Number(a.amount) || 0), 0)
                  const sisa = Number(planIncome) - totalBudget - totalSav
                  return (
                    <span className={`font-mono font-bold ${sisa === 0 ? 'text-green-600' : sisa > 0 ? 'text-amber-600' : 'text-red-500'}`}>
                      {sisa > 0 ? '+' : ''}{formatCurrency(sisa)}
                    </span>
                  )
                })()}
              </div>
            </div>
          )}

          <button onClick={savePlan} className="btn btn-primary w-full">Simpan Rencana</button>
        </div>
      </Modal>
    </AppShell>
  )
}
