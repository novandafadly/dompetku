'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Wallet, Transfer } from '@/lib/supabase'
import { formatCurrency, formatDate, WALLET_ICONS, WALLET_COLORS } from '@/lib/utils'
import AppShell from '@/components/AppShell'
import Modal from '@/components/Modal'
import { toast } from '@/components/Toast'

export default function WalletsPage() {
  const [wallets, setWallets] = useState<Wallet[]>([])
  const [transfers, setTransfers] = useState<Transfer[]>([])
  const [showAdd, setShowAdd] = useState(false)
  const [showTransfer, setShowTransfer] = useState(false)
  const [form, setForm] = useState({ name: '', type: 'cash', balance: '' })
  const [tForm, setTForm] = useState({ from_wallet_id: '', to_wallet_id: '', amount: '', note: '' })

  useEffect(() => { load() }, [])

  async function load() {
    const [w, t] = await Promise.all([
      supabase.from('wallets').select('*').eq('is_active', true).order('created_at'),
      supabase.from('transfers').select('*').order('date', { ascending: false }).limit(20),
    ])
    setWallets(w.data || [])
    setTransfers(t.data || [])
  }

  async function addWallet() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return
    const { error } = await supabase.from('wallets').insert({
      user_id: session.user.id,
      name: form.name,
      type: form.type,
      balance: Number(form.balance) || 0,
      icon: WALLET_ICONS[form.type],
      color: WALLET_COLORS[form.type],
    })
    if (error) { toast(error.message, '❌'); return }
    toast('Dompet berhasil ditambahkan!', '💳')
    setShowAdd(false)
    setForm({ name: '', type: 'cash', balance: '' })
    load()
  }

  async function deleteWallet(id: string) {
    if (!confirm('Hapus dompet ini? Semua transaksi terkait akan ikut terhapus.')) return
    await supabase.from('wallets').delete().eq('id', id)
    toast('Dompet dihapus', '🗑️')
    load()
  }

  async function doTransfer() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return
    if (tForm.from_wallet_id === tForm.to_wallet_id) { toast('Pilih dompet yang berbeda!', '⚠️'); return }
    const amount = Number(tForm.amount)
    if (!amount || amount <= 0) { toast('Jumlah tidak valid!', '⚠️'); return }

    const from = wallets.find(w => w.id === tForm.from_wallet_id)
    if (from && Number(from.balance) < amount) { toast('Saldo tidak mencukupi!', '⚠️'); return }

    const { error } = await supabase.from('transfers').insert({
      user_id: session.user.id,
      from_wallet_id: tForm.from_wallet_id,
      to_wallet_id: tForm.to_wallet_id,
      amount,
      note: tForm.note || null,
    })
    if (error) { toast(error.message, '❌'); return }
    toast('Transfer berhasil!', '⇄')
    setShowTransfer(false)
    setTForm({ from_wallet_id: '', to_wallet_id: '', amount: '', note: '' })
    load()
  }

  const totalBalance = wallets.reduce((s, w) => s + Number(w.balance), 0)

  return (
    <AppShell>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-extrabold text-surface-900">Dompet & Saldo</h1>
          <p className="text-sm text-surface-400">Total: {formatCurrency(totalBalance)}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowTransfer(true)} className="btn btn-secondary">⇄ Transfer</button>
          <button onClick={() => setShowAdd(true)} className="btn btn-primary">+ Tambah</button>
        </div>
      </div>

      {/* Wallet Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        {wallets.map((w) => (
          <div key={w.id} className="card-hover p-5 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-24 h-24 rounded-full opacity-10" style={{ background: w.color || '#3b82f6', transform: 'translate(30%, -30%)' }} />
            <div className="flex items-start justify-between mb-4">
              <div className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl" style={{ background: (w.color || '#3b82f6') + '18' }}>
                {w.icon || '💳'}
              </div>
              <button onClick={() => deleteWallet(w.id)} className="text-surface-300 hover:text-red-500 text-xs transition-colors">✕</button>
            </div>
            <p className="text-sm font-semibold text-surface-800">{w.name}</p>
            <p className="text-[10px] font-bold text-surface-400 uppercase tracking-wider mb-2">{w.type}</p>
            <p className="text-xl font-extrabold font-mono text-surface-900">{formatCurrency(Number(w.balance))}</p>
          </div>
        ))}
        {wallets.length === 0 && (
          <div className="col-span-full text-center py-16 text-surface-300">
            <p className="text-4xl mb-2">💳</p>
            <p className="text-sm">Belum ada dompet. Tambah dompet pertamamu!</p>
          </div>
        )}
      </div>

      {/* Transfer History */}
      {transfers.length > 0 && (
        <div className="card p-6">
          <h3 className="text-sm font-bold text-surface-900 mb-4">Riwayat Transfer</h3>
          <div className="space-y-2">
            {transfers.map((t) => {
              const from = wallets.find(w => w.id === t.from_wallet_id)
              const to = wallets.find(w => w.id === t.to_wallet_id)
              return (
                <div key={t.id} className="flex items-center gap-3 p-3 rounded-xl hover:bg-surface-50 transition-colors">
                  <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center text-lg">⇄</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-surface-800">{from?.name || '?'} → {to?.name || '?'}</p>
                    <p className="text-[10px] text-surface-400">{formatDate(t.date)}{t.note ? ` · ${t.note}` : ''}</p>
                  </div>
                  <p className="text-sm font-bold font-mono text-blue-600">{formatCurrency(Number(t.amount))}</p>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Add Wallet Modal */}
      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="Tambah Dompet">
        <div className="space-y-4">
          <div>
            <label className="label">Nama Dompet</label>
            <input className="input" placeholder="mis. BCA, GoPay, Cash" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <label className="label">Tipe</label>
            <select className="input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              <option value="cash">💵 Cash</option>
              <option value="bank">🏦 Bank</option>
              <option value="ewallet">📱 E-Wallet</option>
              <option value="investment">📈 Investasi</option>
            </select>
          </div>
          <div>
            <label className="label">Saldo Awal</label>
            <input className="input" type="number" placeholder="0" value={form.balance} onChange={(e) => setForm({ ...form, balance: e.target.value })} />
          </div>
          <button onClick={addWallet} className="btn btn-primary w-full">Simpan</button>
        </div>
      </Modal>

      {/* Transfer Modal */}
      <Modal open={showTransfer} onClose={() => setShowTransfer(false)} title="Transfer Antar Dompet">
        <div className="space-y-4">
          <div>
            <label className="label">Dari</label>
            <select className="input" value={tForm.from_wallet_id} onChange={(e) => setTForm({ ...tForm, from_wallet_id: e.target.value })}>
              <option value="">Pilih dompet asal</option>
              {wallets.map(w => <option key={w.id} value={w.id}>{w.icon} {w.name} ({formatCurrency(Number(w.balance))})</option>)}
            </select>
          </div>
          <div>
            <label className="label">Ke</label>
            <select className="input" value={tForm.to_wallet_id} onChange={(e) => setTForm({ ...tForm, to_wallet_id: e.target.value })}>
              <option value="">Pilih dompet tujuan</option>
              {wallets.map(w => <option key={w.id} value={w.id}>{w.icon} {w.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Jumlah</label>
            <input className="input" type="number" placeholder="0" value={tForm.amount} onChange={(e) => setTForm({ ...tForm, amount: e.target.value })} />
          </div>
          <div>
            <label className="label">Catatan (opsional)</label>
            <input className="input" placeholder="mis. Top up GoPay" value={tForm.note} onChange={(e) => setTForm({ ...tForm, note: e.target.value })} />
          </div>
          <button onClick={doTransfer} className="btn btn-primary w-full">Transfer</button>
        </div>
      </Modal>
    </AppShell>
  )
}
