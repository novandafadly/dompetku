'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Asset } from '@/lib/supabase'
import { formatCurrency, formatShort, formatDate, ASSET_ICONS } from '@/lib/utils'
import AppShell from '@/components/AppShell'
import Modal from '@/components/Modal'
import { toast } from '@/components/Toast'

export default function AssetsPage() {
  const [assets, setAssets] = useState<Asset[]>([])
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ name: '', type: 'investment', value: '', description: '', purchase_date: '' })

  useEffect(() => { load() }, [])

  async function load() {
    const { data } = await supabase.from('assets').select('*').order('value', { ascending: false })
    setAssets(data || [])
  }

  async function addAsset() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return
    const { error } = await supabase.from('assets').insert({
      user_id: session.user.id,
      name: form.name,
      type: form.type,
      value: Number(form.value) || 0,
      description: form.description || null,
      purchase_date: form.purchase_date || null,
    })
    if (error) { toast(error.message, '❌'); return }
    toast('Aset ditambahkan!', '🏦')
    setShowAdd(false)
    setForm({ name: '', type: 'investment', value: '', description: '', purchase_date: '' })
    load()
  }

  async function deleteAsset(id: string) {
    if (!confirm('Hapus aset ini?')) return
    await supabase.from('assets').delete().eq('id', id)
    toast('Aset dihapus', '🗑️')
    load()
  }

  const total = assets.reduce((s, a) => s + Number(a.value), 0)
  const byType = (type: string) => assets.filter(a => a.type === type).reduce((s, a) => s + Number(a.value), 0)

  return (
    <AppShell>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-extrabold text-surface-900">Manajemen Aset</h1>
          <p className="text-sm text-surface-400">Total: {formatCurrency(total)}</p>
        </div>
        <button onClick={() => setShowAdd(true)} className="btn btn-primary">+ Tambah Aset</button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {['investment', 'property', 'vehicle', 'other'].map((type) => (
          <div key={type} className="metric-card">
            <p className="text-xs font-bold text-surface-400 uppercase mb-1">{ASSET_ICONS[type]} {type === 'investment' ? 'Investasi' : type === 'property' ? 'Properti' : type === 'vehicle' ? 'Kendaraan' : 'Lainnya'}</p>
            <p className="text-xl font-extrabold text-surface-900">{formatShort(byType(type))}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {assets.map((a) => (
          <div key={a.id} className="card-hover p-5">
            <div className="flex items-start justify-between mb-3">
              <div className="w-11 h-11 rounded-xl bg-amber-50 flex items-center justify-center text-xl">{ASSET_ICONS[a.type]}</div>
              <button onClick={() => deleteAsset(a.id)} className="text-surface-300 hover:text-red-500 text-xs">✕</button>
            </div>
            <p className="font-semibold text-surface-800">{a.name}</p>
            <p className="text-[10px] font-bold text-surface-400 uppercase tracking-wider mb-2">{a.type}</p>
            <p className="text-xl font-extrabold font-mono text-surface-900">{formatCurrency(Number(a.value))}</p>
            {a.description && <p className="text-xs text-surface-400 mt-1">{a.description}</p>}
            {a.purchase_date && <p className="text-[10px] text-surface-300 mt-1">Dibeli: {formatDate(a.purchase_date)}</p>}
          </div>
        ))}
        {assets.length === 0 && (
          <div className="col-span-full card text-center py-16 text-surface-300">
            <p className="text-4xl mb-2">🏦</p>
            <p className="text-sm">Belum ada aset tercatat</p>
          </div>
        )}
      </div>

      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="Tambah Aset">
        <div className="space-y-4">
          <div><label className="label">Nama Aset</label><input className="input" placeholder="mis. Saham BBCA" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div>
            <label className="label">Tipe</label>
            <select className="input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              <option value="investment">📈 Investasi</option>
              <option value="property">🏠 Properti</option>
              <option value="vehicle">🚗 Kendaraan</option>
              <option value="electronics">💻 Elektronik</option>
              <option value="other">📦 Lainnya</option>
            </select>
          </div>
          <div><label className="label">Nilai</label><input className="input" type="number" placeholder="0" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} /></div>
          <div><label className="label">Keterangan</label><input className="input" placeholder="Opsional" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
          <div><label className="label">Tanggal Beli</label><input className="input" type="date" value={form.purchase_date} onChange={(e) => setForm({ ...form, purchase_date: e.target.value })} /></div>
          <button onClick={addAsset} className="btn btn-primary w-full">Simpan</button>
        </div>
      </Modal>
    </AppShell>
  )
}
