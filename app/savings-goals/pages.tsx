'use client'

import { useEffect, useState, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import type { Wallet } from '@/lib/supabase'
import { formatCurrency, formatDate, formatShort } from '@/lib/utils'
import AppShell from '@/components/AppShell'
import Modal from '@/components/Modal'
import { toast } from '@/components/Toast'

// ─── Types ────────────────────────────────────────────────
type Transfer = {
  id: string
  user_id: string
  from_wallet_id: string
  to_wallet_id: string
  amount: number
  fee: number | null
  description: string | null
  date: string
  created_at: string
  from_wallet?: Wallet
  to_wallet?: Wallet
}

type TransferForm = {
  from_wallet_id: string
  to_wallet_id: string
  amount: string
  fee: string
  description: string
  date: string
}

const emptyForm: TransferForm = {
  from_wallet_id: '',
  to_wallet_id: '',
  amount: '',
  fee: '0',
  description: '',
  date: new Date().toISOString().split('T')[0],
}

// ─── Helpers ──────────────────────────────────────────────
function getPocketLabel(pocket?: string) {
  if (pocket === 'kantor') return '🏢'
  if (pocket === 'tabungan') return '💰'
  return '👤'
}

export default function TransfersPage() {
  const [transfers, setTransfers] = useState<Transfer[]>([])
  const [wallets, setWallets] = useState<Wallet[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<TransferForm>(emptyForm)
  const [search, setSearch] = useState('')
  const [filterWallet, setFilterWallet] = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    const [t, w] = await Promise.all([
      supabase
        .from('transfers')
        .select('*, from_wallet:from_wallet_id(id, name, icon, pocket, balance), to_wallet:to_wallet_id(id, name, icon, pocket, balance)')
        .order('date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(200),
      supabase.from('wallets').select('*').eq('is_active', true).order('name'),
    ])
    setTransfers((t.data as any) || [])
    setWallets(w.data || [])
    setLoading(false)
  }

  // ── Open modal for add ────────────────────────────────────
  function openAdd() {
    setEditingId(null)
    setForm(emptyForm)
    setShowModal(true)
  }

  // ── Open modal for edit ───────────────────────────────────
  function openEdit(tr: Transfer) {
    setEditingId(tr.id)
    setForm({
      from_wallet_id: tr.from_wallet_id,
      to_wallet_id: tr.to_wallet_id,
      amount: String(tr.amount),
      fee: String(tr.fee || 0),
      description: tr.description || '',
      date: tr.date,
    })
    setShowModal(true)
  }

  // ── Save transfer ─────────────────────────────────────────
  async function saveTransfer() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return

    const amount = Number(form.amount)
    const fee = Number(form.fee) || 0

    if (!amount || amount <= 0) { toast('Jumlah transfer wajib diisi!', '⚠️'); return }
    if (!form.from_wallet_id) { toast('Pilih dompet asal!', '⚠️'); return }
    if (!form.to_wallet_id) { toast('Pilih dompet tujuan!', '⚠️'); return }
    if (form.from_wallet_id === form.to_wallet_id) { toast('Dompet asal & tujuan harus berbeda!', '⚠️'); return }

    const fromWallet = wallets.find(w => w.id === form.from_wallet_id)
    const toWallet = wallets.find(w => w.id === form.to_wallet_id)
    if (!fromWallet || !toWallet) return

    if (editingId) {
      // Reverse old transfer first
      const old = transfers.find(t => t.id === editingId)
      if (old) {
        // Undo: kembalikan saldo lama
        await supabase.from('wallets').update({ balance: Number(fromWallet.balance) + Number(old.amount) + Number(old.fee || 0) }).eq('id', old.from_wallet_id)
        await supabase.from('wallets').update({ balance: Number(toWallet.balance) - Number(old.amount) }).eq('id', old.to_wallet_id)
        await supabase.from('transfers').delete().eq('id', editingId)
      }
    }

    // Check balance
    if (Number(fromWallet.balance) < amount + fee) {
      const confirm = window.confirm(`Saldo ${fromWallet.name} tidak cukup (${formatCurrency(Number(fromWallet.balance))}). Lanjutkan?`)
      if (!confirm) return
    }

    // Insert transfer
    const { error } = await supabase.from('transfers').insert({
      user_id: session.user.id,
      from_wallet_id: form.from_wallet_id,
      to_wallet_id: form.to_wallet_id,
      amount,
      fee: fee || null,
      description: form.description || null,
      date: form.date,
    })
    if (error) { toast(error.message, '❌'); return }

    // Update wallet balances (biasanya sudah ada DB trigger, ini fallback manual)
    // Kurangi dari wallet asal (amount + fee)
    await supabase.from('wallets')
      .update({ balance: Number(fromWallet.balance) - amount - fee })
      .eq('id', form.from_wallet_id)
    // Tambah ke wallet tujuan (amount saja, tanpa fee)
    await supabase.from('wallets')
      .update({ balance: Number(toWallet.balance) + amount })
      .eq('id', form.to_wallet_id)

    toast(editingId ? 'Transfer diperbarui! ✅' : 'Transfer berhasil dicatat! 🔀')
    setShowModal(false)
    setEditingId(null)
    setForm(emptyForm)
    load()
  }

  // ── Delete transfer ───────────────────────────────────────
  async function deleteTransfer(tr: Transfer) {
    if (!confirm(`Hapus transfer ${formatCurrency(Number(tr.amount))} ini? Saldo dompet akan dikembalikan.`)) return

    const fromWallet = wallets.find(w => w.id === tr.from_wallet_id) || tr.from_wallet
    const toWallet = wallets.find(w => w.id === tr.to_wallet_id) || tr.to_wallet

    // Reverse balance
    if (fromWallet) {
      await supabase.from('wallets')
        .update({ balance: Number(fromWallet.balance) + Number(tr.amount) + Number(tr.fee || 0) })
        .eq('id', tr.from_wallet_id)
    }
    if (toWallet) {
      await supabase.from('wallets')
        .update({ balance: Number(toWallet.balance) - Number(tr.amount) })
        .eq('id', tr.to_wallet_id)
    }

    await supabase.from('transfers').delete().eq('id', tr.id)
    toast('Transfer dihapus & saldo dikembalikan', '🗑️')
    load()
  }

  // ── Computed ──────────────────────────────────────────────
  const filtered = useMemo(() => {
    return transfers.filter(tr => {
      if (filterWallet && tr.from_wallet_id !== filterWallet && tr.to_wallet_id !== filterWallet) return false
      if (search) {
        const q = search.toLowerCase()
        return (
          tr.description?.toLowerCase().includes(q) ||
          (tr.from_wallet as any)?.name?.toLowerCase().includes(q) ||
          (tr.to_wallet as any)?.name?.toLowerCase().includes(q)
        )
      }
      return true
    })
  }, [transfers, search, filterWallet])

  const totalThisMonth = useMemo(() => {
    const now = new Date()
    const m = String(now.getMonth() + 1).padStart(2, '0')
    const prefix = `${now.getFullYear()}-${m}`
    return transfers.filter(t => t.date.startsWith(prefix)).reduce((s, t) => s + Number(t.amount), 0)
  }, [transfers])

  const totalFee = useMemo(() => transfers.reduce((s, t) => s + Number(t.fee || 0), 0), [transfers])

  return (
    <AppShell>
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl sm:text-2xl font-extrabold text-surface-900">Transfer</h1>
          <p className="text-xs text-surface-400">{transfers.length} riwayat · {formatShort(totalThisMonth)} bulan ini</p>
        </div>
        <button onClick={openAdd} className="btn btn-primary py-2.5 px-4 text-sm">+ Transfer</button>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-3 gap-2 mb-5">
        <div className="card p-3 text-center">
          <p className="text-[10px] font-bold text-surface-400 uppercase mb-1">Total Transfer</p>
          <p className="text-base font-extrabold text-brand-600 font-mono">{formatShort(transfers.reduce((s, t) => s + Number(t.amount), 0))}</p>
        </div>
        <div className="card p-3 text-center">
          <p className="text-[10px] font-bold text-surface-400 uppercase mb-1">Bulan Ini</p>
          <p className="text-base font-extrabold text-surface-900 font-mono">{formatShort(totalThisMonth)}</p>
        </div>
        <div className="card p-3 text-center">
          <p className="text-[10px] font-bold text-surface-400 uppercase mb-1">Total Biaya</p>
          <p className="text-base font-extrabold text-amber-600 font-mono">{formatShort(totalFee)}</p>
        </div>
      </div>

      {/* Wallet chips filter */}
      {wallets.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-2 mb-4">
          <button
            onClick={() => setFilterWallet('')}
            className={`flex-shrink-0 px-3 py-1.5 rounded-xl text-xs font-bold border transition-all ${!filterWallet ? 'bg-brand-600 text-white border-brand-600' : 'border-surface-200 text-surface-600 bg-white'}`}
          >
            Semua
          </button>
          {wallets.map(w => (
            <button
              key={w.id}
              onClick={() => setFilterWallet(filterWallet === w.id ? '' : w.id)}
              className={`flex-shrink-0 px-3 py-1.5 rounded-xl text-xs font-bold border transition-all ${filterWallet === w.id ? 'bg-brand-600 text-white border-brand-600' : 'border-surface-200 text-surface-600 bg-white'}`}
            >
              {w.icon || '💳'} {w.name}
            </button>
          ))}
        </div>
      )}

      {/* Search */}
      <div className="mb-4">
        <input
          className="input text-sm"
          placeholder="🔍 Cari transfer..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {/* Transfer list */}
      {loading ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="card p-4 h-20 animate-pulse bg-surface-100" />
          ))}
        </div>
      ) : filtered.length > 0 ? (
        <div className="space-y-3">
          {filtered.map(tr => {
            const from = tr.from_wallet as any
            const to = tr.to_wallet as any
            const hasFee = Number(tr.fee || 0) > 0
            return (
              <div
                key={tr.id}
                className="card p-4 flex items-center gap-3 group cursor-pointer active:bg-surface-50"
                onClick={() => openEdit(tr)}
              >
                {/* Icon */}
                <div className="w-11 h-11 rounded-xl bg-blue-50 flex items-center justify-center text-xl flex-shrink-0">
                  🔀
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  {/* Wallet names */}
                  <div className="flex items-center gap-1.5 text-sm font-semibold text-surface-800 mb-0.5">
                    <span className="truncate max-w-[90px]">
                      {getPocketLabel(from?.pocket)}{from?.name || '—'}
                    </span>
                    <span className="text-brand-400 font-bold flex-shrink-0">→</span>
                    <span className="truncate max-w-[90px]">
                      {getPocketLabel(to?.pocket)}{to?.name || '—'}
                    </span>
                  </div>
                  {/* Date & desc */}
                  <div className="flex items-center gap-2 text-[10px] text-surface-400">
                    <span>{formatDate(tr.date)}</span>
                    {tr.description && (
                      <>
                        <span>·</span>
                        <span className="truncate">{tr.description}</span>
                      </>
                    )}
                    {hasFee && (
                      <>
                        <span>·</span>
                        <span className="text-amber-600 font-semibold">Biaya: {formatShort(Number(tr.fee))}</span>
                      </>
                    )}
                  </div>
                </div>

                {/* Amount + delete */}
                <div className="flex items-center gap-2 flex-shrink-0">
                  <p className="text-sm font-bold font-mono text-brand-600">
                    {formatShort(Number(tr.amount))}
                  </p>
                  <button
                    onClick={e => { e.stopPropagation(); deleteTransfer(tr) }}
                    className="opacity-0 group-hover:opacity-100 w-7 h-7 rounded-lg hover:bg-red-50 text-surface-300 hover:text-red-500 flex items-center justify-center text-xs transition-all"
                  >
                    ✕
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="card text-center py-20 text-surface-300">
          <p className="text-5xl mb-3">🔀</p>
          <p className="font-semibold text-surface-500">
            {search || filterWallet ? 'Tidak ada hasil' : 'Belum ada riwayat transfer'}
          </p>
          {!search && !filterWallet && (
            <p className="text-sm mt-1">Transfer antar dompet kamu di sini</p>
          )}
          {(search || filterWallet) && (
            <button onClick={() => { setSearch(''); setFilterWallet('') }} className="mt-3 text-xs text-brand-600 font-bold">
              Reset filter
            </button>
          )}
        </div>
      )}

      {/* ── Add/Edit Transfer Modal ── */}
      <Modal
        open={showModal}
        onClose={() => { setShowModal(false); setEditingId(null) }}
        title={editingId ? 'Edit Transfer' : 'Transfer Antar Dompet'}
      >
        <div className="space-y-4">
          {/* From → To illustration */}
          {(form.from_wallet_id || form.to_wallet_id) && (
            <div className="flex items-center gap-2 p-3 bg-blue-50 rounded-xl text-sm font-semibold text-surface-700">
              <span className="truncate flex-1 text-center">
                {wallets.find(w => w.id === form.from_wallet_id)
                  ? `${wallets.find(w => w.id === form.from_wallet_id)!.icon || '💳'} ${wallets.find(w => w.id === form.from_wallet_id)!.name}`
                  : <span className="text-surface-400 font-normal">Asal...</span>
                }
              </span>
              <span className="text-brand-500 font-bold text-lg flex-shrink-0">→</span>
              <span className="truncate flex-1 text-center">
                {wallets.find(w => w.id === form.to_wallet_id)
                  ? `${wallets.find(w => w.id === form.to_wallet_id)!.icon || '💳'} ${wallets.find(w => w.id === form.to_wallet_id)!.name}`
                  : <span className="text-surface-400 font-normal">Tujuan...</span>
                }
              </span>
            </div>
          )}

          <div>
            <label className="label">Dompet Asal</label>
            <select
              className="input"
              value={form.from_wallet_id}
              onChange={e => setForm({ ...form, from_wallet_id: e.target.value })}
            >
              <option value="">— Pilih dompet asal —</option>
              {wallets.map(w => (
                <option key={w.id} value={w.id}>
                  {getPocketLabel(w.pocket)} {w.icon || '💳'} {w.name} ({formatShort(Number(w.balance))})
                </option>
              ))}
            </select>
            {form.from_wallet_id && (() => {
              const w = wallets.find(x => x.id === form.from_wallet_id)
              return w ? (
                <p className="text-[10px] text-surface-400 mt-1">
                  Saldo: <span className="font-bold text-surface-700">{formatCurrency(Number(w.balance))}</span>
                </p>
              ) : null
            })()}
          </div>

          <div>
            <label className="label">Dompet Tujuan</label>
            <select
              className="input"
              value={form.to_wallet_id}
              onChange={e => setForm({ ...form, to_wallet_id: e.target.value })}
            >
              <option value="">— Pilih dompet tujuan —</option>
              {wallets
                .filter(w => w.id !== form.from_wallet_id)
                .map(w => (
                  <option key={w.id} value={w.id}>
                    {getPocketLabel(w.pocket)} {w.icon || '💳'} {w.name} ({formatShort(Number(w.balance))})
                  </option>
                ))}
            </select>
          </div>

          <div>
            <label className="label">Jumlah Transfer</label>
            <input
              className="input text-xl font-bold"
              type="number"
              inputMode="numeric"
              placeholder="0"
              value={form.amount}
              onChange={e => setForm({ ...form, amount: e.target.value })}
            />
          </div>

          <div>
            <label className="label">Biaya Transfer <span className="text-surface-400 font-normal">(opsional)</span></label>
            <input
              className="input"
              type="number"
              inputMode="numeric"
              placeholder="0"
              value={form.fee}
              onChange={e => setForm({ ...form, fee: e.target.value })}
            />
            {Number(form.fee) > 0 && (
              <p className="text-[10px] text-amber-600 mt-1 font-semibold">
                ⚠️ Total keluar dari {wallets.find(w => w.id === form.from_wallet_id)?.name || 'dompet asal'}: {formatCurrency(Number(form.amount) + Number(form.fee))}
              </p>
            )}
          </div>

          <div>
            <label className="label">Keterangan <span className="text-surface-400 font-normal">(opsional)</span></label>
            <input
              className="input"
              placeholder="mis. Top up tabungan, pindah dana"
              value={form.description}
              onChange={e => setForm({ ...form, description: e.target.value })}
            />
          </div>

          <div>
            <label className="label">Tanggal</label>
            <input
              className="input"
              type="date"
              value={form.date}
              onChange={e => setForm({ ...form, date: e.target.value })}
            />
          </div>

          {/* Summary preview */}
          {form.from_wallet_id && form.to_wallet_id && Number(form.amount) > 0 && (
            <div className="p-3 bg-brand-50 rounded-xl text-xs space-y-1.5">
              <p className="font-bold text-brand-700 mb-2">📋 Ringkasan Transfer</p>
              <div className="flex justify-between">
                <span className="text-surface-500">Dikirim ke {wallets.find(w => w.id === form.to_wallet_id)?.name}</span>
                <span className="font-bold font-mono text-green-600">+{formatCurrency(Number(form.amount))}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-surface-500">Keluar dari {wallets.find(w => w.id === form.from_wallet_id)?.name}</span>
                <span className="font-bold font-mono text-red-500">-{formatCurrency(Number(form.amount) + Number(form.fee || 0))}</span>
              </div>
              {Number(form.fee) > 0 && (
                <div className="flex justify-between">
                  <span className="text-amber-600">Biaya admin</span>
                  <span className="font-bold font-mono text-amber-600">-{formatCurrency(Number(form.fee))}</span>
                </div>
              )}
            </div>
          )}

          <div className="flex gap-2 pt-1">
            {editingId && (
              <button
                onClick={() => {
                  const tr = transfers.find(t => t.id === editingId)
                  if (tr) { deleteTransfer(tr); setShowModal(false) }
                }}
                className="btn btn-danger flex-1"
              >
                Hapus
              </button>
            )}
            <button onClick={saveTransfer} className="btn btn-primary flex-1">
              {editingId ? 'Simpan' : '🔀 Transfer'}
            </button>
          </div>
        </div>
      </Modal>
    </AppShell>
  )
}
