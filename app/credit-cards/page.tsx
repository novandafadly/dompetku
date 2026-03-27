'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { CreditCard } from '@/lib/supabase'
import { formatCurrency, formatShort } from '@/lib/utils'
import AppShell from '@/components/AppShell'
import Modal from '@/components/Modal'
import { toast } from '@/components/Toast'

const CARD_COLORS = ['#1e293b', '#1e3a5f', '#312e81', '#4c1d95', '#831843', '#7c2d12']

export default function CreditCardsPage() {
  const [cards, setCards] = useState<CreditCard[]>([])
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ name: '', bank: '', card_limit: '', used_amount: '', billing_date: '', due_date: '', color: CARD_COLORS[0] })

  useEffect(() => { load() }, [])

  async function load() {
    const { data } = await supabase.from('credit_cards').select('*').order('created_at')
    setCards(data || [])
  }

  async function addCard() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return
    const { error } = await supabase.from('credit_cards').insert({
      user_id: session.user.id,
      name: form.name,
      bank: form.bank,
      card_limit: Number(form.card_limit) || 0,
      used_amount: Number(form.used_amount) || 0,
      billing_date: Number(form.billing_date) || null,
      due_date: Number(form.due_date) || null,
      color: form.color,
    })
    if (error) { toast(error.message, '❌'); return }
    toast('Kartu kredit ditambahkan!', '💎')
    setShowAdd(false)
    setForm({ name: '', bank: '', card_limit: '', used_amount: '', billing_date: '', due_date: '', color: CARD_COLORS[0] })
    load()
  }

  async function deleteCard(id: string) {
    if (!confirm('Hapus kartu kredit ini?')) return
    await supabase.from('credit_cards').delete().eq('id', id)
    toast('Kartu dihapus', '🗑️')
    load()
  }

  const totalLimit = cards.reduce((s, c) => s + Number(c.card_limit), 0)
  const totalUsed = cards.reduce((s, c) => s + Number(c.used_amount), 0)

  return (
    <AppShell>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-extrabold text-surface-900">Kartu Kredit</h1>
          <p className="text-sm text-surface-400">Terpakai: {formatCurrency(totalUsed)} / {formatCurrency(totalLimit)}</p>
        </div>
        <button onClick={() => setShowAdd(true)} className="btn btn-primary">+ Tambah Kartu</button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {cards.map((card) => {
          const utilization = Number(card.card_limit) > 0 ? (Number(card.used_amount) / Number(card.card_limit)) * 100 : 0
          const isHigh = utilization > 70
          return (
            <div key={card.id} className="relative">
              {/* Credit card visual */}
              <div className="rounded-2xl p-6 text-white relative overflow-hidden h-48 flex flex-col justify-between" style={{ background: card.color || '#1e293b' }}>
                <div className="absolute inset-0 opacity-10" style={{ background: 'radial-gradient(circle at 80% 20%, white 0%, transparent 60%)' }} />
                <div className="relative flex justify-between items-start">
                  <div>
                    <p className="text-xs font-bold opacity-70 uppercase tracking-widest">{card.bank}</p>
                    <p className="text-sm font-bold mt-0.5">{card.name}</p>
                  </div>
                  <button onClick={() => deleteCard(card.id)} className="text-white/40 hover:text-white/80 text-xs">✕</button>
                </div>
                <div className="relative">
                  <p className="text-[10px] font-bold opacity-50 uppercase">Limit</p>
                  <p className="text-lg font-extrabold font-mono">{formatCurrency(Number(card.card_limit))}</p>
                </div>
                <div className="relative flex items-center gap-3">
                  {card.billing_date && <div className="text-[10px]"><span className="opacity-50">Tagihan:</span> <span className="font-bold">Tgl {card.billing_date}</span></div>}
                  {card.due_date && <div className="text-[10px]"><span className="opacity-50">Jatuh tempo:</span> <span className="font-bold">Tgl {card.due_date}</span></div>}
                </div>
              </div>

              {/* Utilization bar */}
              <div className="card -mt-4 relative z-10 mx-3 p-4">
                <div className="flex items-center justify-between text-xs mb-2">
                  <span className="font-semibold text-surface-700">Pemakaian</span>
                  <span className={`font-bold font-mono ${isHigh ? 'text-red-500' : 'text-surface-600'}`}>{utilization.toFixed(0)}%</span>
                </div>
                <div className="progress-bar">
                  <div className="progress-fill" style={{
                    width: `${Math.min(utilization, 100)}%`,
                    background: isHigh ? '#ef4444' : utilization > 50 ? '#f59e0b' : '#22c55e',
                  }} />
                </div>
                <div className="flex justify-between text-[10px] text-surface-400 mt-1">
                  <span>Terpakai: {formatShort(Number(card.used_amount))}</span>
                  <span>Sisa: {formatShort(Number(card.card_limit) - Number(card.used_amount))}</span>
                </div>
                {isHigh && <p className="text-[10px] text-red-500 font-bold mt-1.5">⚠️ Utilisasi tinggi! Pertimbangkan untuk mengurangi pemakaian.</p>}
              </div>
            </div>
          )
        })}
        {cards.length === 0 && (
          <div className="col-span-full card text-center py-16 text-surface-300">
            <p className="text-4xl mb-2">💎</p>
            <p className="text-sm">Belum ada kartu kredit tercatat</p>
          </div>
        )}
      </div>

      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="Tambah Kartu Kredit">
        <div className="space-y-4">
          <div><label className="label">Nama Kartu</label><input className="input" placeholder="mis. Visa Platinum" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div><label className="label">Bank</label><input className="input" placeholder="mis. BCA, Mandiri" value={form.bank} onChange={(e) => setForm({ ...form, bank: e.target.value })} /></div>
          <div><label className="label">Limit Kartu</label><input className="input" type="number" placeholder="0" value={form.card_limit} onChange={(e) => setForm({ ...form, card_limit: e.target.value })} /></div>
          <div><label className="label">Pemakaian Saat Ini</label><input className="input" type="number" placeholder="0" value={form.used_amount} onChange={(e) => setForm({ ...form, used_amount: e.target.value })} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">Tgl Tagihan</label><input className="input" type="number" min="1" max="31" placeholder="25" value={form.billing_date} onChange={(e) => setForm({ ...form, billing_date: e.target.value })} /></div>
            <div><label className="label">Tgl Jatuh Tempo</label><input className="input" type="number" min="1" max="31" placeholder="10" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} /></div>
          </div>
          <div>
            <label className="label">Warna Kartu</label>
            <div className="flex gap-2">
              {CARD_COLORS.map((c) => (
                <button key={c} onClick={() => setForm({ ...form, color: c })} className="w-8 h-8 rounded-lg border-2 transition-all" style={{ background: c, borderColor: form.color === c ? '#fff' : 'transparent', boxShadow: form.color === c ? `0 0 0 2px ${c}` : 'none' }} />
              ))}
            </div>
          </div>
          <button onClick={addCard} className="btn btn-primary w-full">Simpan</button>
        </div>
      </Modal>
    </AppShell>
  )
}
