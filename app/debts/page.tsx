'use client'

import { useEffect, useState, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import type { Debt } from '@/lib/supabase'
import { formatCurrency, formatShort, formatDate } from '@/lib/utils'
import AppShell from '@/components/AppShell'
import Modal from '@/components/Modal'
import { toast } from '@/components/Toast'

export default function DebtsPage() {
  const [debts, setDebts] = useState<Debt[]>([])
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ type: 'debt', person_name: '', total_amount: '', paid_amount: '', description: '', due_date: '' })

  useEffect(() => { load() }, [])

  async function load() {
    const { data } = await supabase.from('debts').select('*').order('is_completed').order('due_date')
    setDebts(data || [])
  }

  async function addDebt() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return
    const { error } = await supabase.from('debts').insert({
      user_id: session.user.id,
      type: form.type,
      person_name: form.person_name,
      total_amount: Number(form.total_amount) || 0,
      paid_amount: Number(form.paid_amount) || 0,
      description: form.description || null,
      due_date: form.due_date || null,
    })
    if (error) { toast(error.message, '❌'); return }
    toast(`${form.type === 'debt' ? 'Utang' : 'Piutang'} ditambahkan!`, '🤝')
    setShowAdd(false)
    setForm({ type: 'debt', person_name: '', total_amount: '', paid_amount: '', description: '', due_date: '' })
    load()
  }

  async function toggleComplete(id: string, current: boolean) {
    await supabase.from('debts').update({ is_completed: !current }).eq('id', id)
    toast(!current ? 'Ditandai selesai!' : 'Dibuka kembali', !current ? '✅' : '🔄')
    load()
  }

  async function deleteDebt(id: string) {
    if (!confirm('Hapus data ini?')) return
    await supabase.from('debts').delete().eq('id', id)
    toast('Data dihapus', '🗑️')
    load()
  }

  const debtsList = debts.filter(d => d.type === 'debt')
  const receivablesList = debts.filter(d => d.type === 'receivable')
  const totalDebt = debtsList.filter(d => !d.is_completed).reduce((s, d) => s + Number(d.total_amount) - Number(d.paid_amount), 0)
  const totalReceivable = receivablesList.filter(d => !d.is_completed).reduce((s, d) => s + Number(d.total_amount) - Number(d.paid_amount), 0)
  const netPosition = totalReceivable - totalDebt

  function DebtCard({ d }: { d: Debt }) {
    const remaining = Number(d.total_amount) - Number(d.paid_amount)
    const pct = Number(d.total_amount) > 0 ? (Number(d.paid_amount) / Number(d.total_amount)) * 100 : 0
    const isOverdue = d.due_date && new Date(d.due_date) < new Date() && !d.is_completed
    return (
      <div className={`card p-5 ${d.is_completed ? 'opacity-50' : ''}`}>
        <div className="flex items-start justify-between mb-2">
          <div className="flex items-center gap-2">
            <button onClick={() => toggleComplete(d.id, d.is_completed)} className={`w-5 h-5 rounded-md border-2 flex items-center justify-center text-[10px] transition-all ${d.is_completed ? 'bg-green-500 border-green-500 text-white' : 'border-surface-300 hover:border-brand-500'}`}>
              {d.is_completed && '✓'}
            </button>
            <span className="font-semibold text-surface-800">{d.person_name}</span>
            {isOverdue && <span className="badge bg-red-100 text-red-700 text-[10px]">JATUH TEMPO</span>}
          </div>
          <button onClick={() => deleteDebt(d.id)} className="text-surface-300 hover:text-red-500 text-xs">✕</button>
        </div>
        {d.description && <p className="text-xs text-surface-400 mb-2">{d.description}</p>}
        <div className="progress-bar mb-2">
          <div className="progress-fill" style={{ width: `${pct}%`, background: d.type === 'debt' ? '#ef4444' : '#22c55e' }} />
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-surface-500">Dibayar: <span className="font-bold font-mono">{formatShort(Number(d.paid_amount))}</span></span>
          <span className="text-surface-500">Total: <span className="font-bold font-mono">{formatShort(Number(d.total_amount))}</span></span>
        </div>
        <div className="flex justify-between text-xs mt-1">
          <span className="text-surface-400">Sisa: <span className="font-bold font-mono">{formatShort(remaining)}</span></span>
          {d.due_date && <span className="text-surface-400">{formatDate(d.due_date)}</span>}
        </div>
      </div>
    )
  }

  return (
    <AppShell>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-extrabold text-surface-900">Utang & Piutang</h1>
          <p className="text-sm text-surface-400">Posisi bersih: <span className={netPosition >= 0 ? 'text-green-600' : 'text-red-500'}>{formatCurrency(netPosition)}</span></p>
        </div>
        <button onClick={() => setShowAdd(true)} className="btn btn-primary">+ Tambah</button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="metric-card">
          <div className="absolute inset-0 bg-gradient-to-br from-red-50 to-transparent" />
          <div className="relative">
            <p className="text-xs font-bold text-red-500 uppercase tracking-wider mb-1">Total Utang</p>
            <p className="text-2xl font-extrabold text-red-500">{formatShort(totalDebt)}</p>
          </div>
        </div>
        <div className="metric-card">
          <div className="absolute inset-0 bg-gradient-to-br from-green-50 to-transparent" />
          <div className="relative">
            <p className="text-xs font-bold text-green-600 uppercase tracking-wider mb-1">Total Piutang</p>
            <p className="text-2xl font-extrabold text-green-600">{formatShort(totalReceivable)}</p>
          </div>
        </div>
        <div className="metric-card">
          <div className="absolute inset-0 bg-gradient-to-br from-brand-50 to-transparent" />
          <div className="relative">
            <p className="text-xs font-bold text-brand-600 uppercase tracking-wider mb-1">Posisi Bersih</p>
            <p className={`text-2xl font-extrabold ${netPosition >= 0 ? 'text-green-600' : 'text-red-500'}`}>{formatShort(netPosition)}</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Utang */}
        <div>
          <h3 className="text-sm font-bold text-red-500 uppercase tracking-wider mb-3">💸 Utang ({debtsList.length})</h3>
          <div className="space-y-3">
            {debtsList.map(d => <DebtCard key={d.id} d={d} />)}
            {debtsList.length === 0 && <div className="card text-center py-8 text-surface-300 text-sm">Tidak ada utang</div>}
          </div>
        </div>

        {/* Piutang */}
        <div>
          <h3 className="text-sm font-bold text-green-600 uppercase tracking-wider mb-3">💰 Piutang ({receivablesList.length})</h3>
          <div className="space-y-3">
            {receivablesList.map(d => <DebtCard key={d.id} d={d} />)}
            {receivablesList.length === 0 && <div className="card text-center py-8 text-surface-300 text-sm">Tidak ada piutang</div>}
          </div>
        </div>
      </div>

      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="Tambah Utang/Piutang">
        <div className="space-y-4">
          <div>
            <label className="label">Tipe</label>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setForm({ ...form, type: 'debt' })} className={`btn ${form.type === 'debt' ? 'bg-red-50 text-red-700 border-red-200 border' : 'btn-secondary'}`}>💸 Utang</button>
              <button onClick={() => setForm({ ...form, type: 'receivable' })} className={`btn ${form.type === 'receivable' ? 'bg-green-50 text-green-700 border-green-200 border' : 'btn-secondary'}`}>💰 Piutang</button>
            </div>
          </div>
          <div><label className="label">Nama Orang/Pihak</label><input className="input" placeholder="mis. Budi" value={form.person_name} onChange={(e) => setForm({ ...form, person_name: e.target.value })} /></div>
          <div><label className="label">Total</label><input className="input" type="number" placeholder="0" value={form.total_amount} onChange={(e) => setForm({ ...form, total_amount: e.target.value })} /></div>
          <div><label className="label">Sudah Dibayar</label><input className="input" type="number" placeholder="0" value={form.paid_amount} onChange={(e) => setForm({ ...form, paid_amount: e.target.value })} /></div>
          <div><label className="label">Keterangan</label><input className="input" placeholder="Opsional" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
          <div><label className="label">Jatuh Tempo</label><input className="input" type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} /></div>
          <button onClick={addDebt} className="btn btn-primary w-full">Simpan</button>
        </div>
      </Modal>
    </AppShell>
  )
}
