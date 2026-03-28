'use client'

import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import type { Asset, InvestmentLot } from '@/lib/supabase'
import { formatCurrency, formatShort, formatDate, ASSET_ICONS } from '@/lib/utils'
import AppShell from '@/components/AppShell'
import Modal from '@/components/Modal'
import { toast } from '@/components/Toast'

// Fetch IDX stock price via Yahoo Finance (no API key needed)
// Uses a CORS proxy since browser can't call Yahoo directly
async function fetchStockPrice(ticker: string): Promise<number | null> {
  const symbol = ticker.includes('.') ? ticker : `${ticker}.JK`
  try {
    // Try multiple CORS proxies in sequence
    const proxyUrls = [
      `https://api.allorigins.win/get?url=${encodeURIComponent(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1d`)}`,
      `https://corsproxy.io/?${encodeURIComponent(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1d`)}`,
    ]
    for (const url of proxyUrls) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
        if (!res.ok) continue
        let json: any
        const text = await res.text()
        try {
          const wrapper = JSON.parse(text)
          json = wrapper.contents ? JSON.parse(wrapper.contents) : wrapper
        } catch { continue }
        const price = json?.chart?.result?.[0]?.meta?.regularMarketPrice
        if (price && price > 0) return price
      } catch { continue }
    }
  } catch {}
  return null
}

type AssetForm = {
  name: string
  type: string
  value: string
  description: string
  purchase_date: string
  ticker: string
}

const emptyAssetForm: AssetForm = { name: '', type: 'investment', value: '', description: '', purchase_date: '', ticker: '' }

type LotForm = {
  action: 'buy' | 'sell'
  qty: string
  price: string
  date: string
  note: string
}

const emptyLotForm: LotForm = { action: 'buy', qty: '', price: '', date: new Date().toISOString().split('T')[0], note: '' }

export default function AssetsPage() {
  const [assets, setAssets] = useState<Asset[]>([])
  const [lots, setLots] = useState<Record<string, InvestmentLot[]>>({})
  const [priceLoading, setPriceLoading] = useState<Record<string, boolean>>({})

  const [showAdd, setShowAdd] = useState(false)
  const [showLot, setShowLot] = useState(false)
  const [showLotHistory, setShowLotHistory] = useState(false)
  const [editingAsset, setEditingAsset] = useState<Asset | null>(null)
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null)

  const [form, setForm] = useState<AssetForm>(emptyAssetForm)
  const [lotForm, setLotForm] = useState<LotForm>(emptyLotForm)
  const [tab, setTab] = useState<'all' | 'stock' | 'other'>('all')

  useEffect(() => { load() }, [])

  async function load() {
    const { data } = await supabase.from('assets').select('*').order('value', { ascending: false })
    setAssets(data || [])
    // load lots for stock assets
    const stockAssets = (data || []).filter(a => a.type === 'investment' && a.ticker)
    if (stockAssets.length > 0) {
      const { data: lotData } = await supabase
        .from('investment_lots')
        .select('*')
        .in('asset_id', stockAssets.map(a => a.id))
        .order('date', { ascending: false })
      const grouped: Record<string, InvestmentLot[]> = {}
      for (const lot of lotData || []) {
        if (!grouped[lot.asset_id]) grouped[lot.asset_id] = []
        grouped[lot.asset_id].push(lot)
      }
      setLots(grouped)
    }
  }

  async function refreshPrice(asset: Asset) {
    if (!asset.ticker) return
    setPriceLoading(p => ({ ...p, [asset.id]: true }))
    const price = await fetchStockPrice(asset.ticker)
    if (price) {
      const newValue = Number(asset.qty || 0) * price
      await supabase.from('assets').update({
        current_price: price,
        value: newValue,
        last_price_update: new Date().toISOString(),
      }).eq('id', asset.id)
      toast(`Harga ${asset.ticker} diperbarui: ${formatCurrency(price)}`, '📈')
      load()
    } else {
      toast(`Gagal fetch harga ${asset.ticker}. Coba update manual.`, '⚠️')
    }
    setPriceLoading(p => ({ ...p, [asset.id]: false }))
  }

  async function refreshAllPrices() {
    const stockAssets = assets.filter(a => a.type === 'investment' && a.ticker)
    if (stockAssets.length === 0) { toast('Tidak ada aset saham', '⚠️'); return }
    toast('Mengambil harga terbaru...', '⏳')
    for (const asset of stockAssets) {
      await refreshPrice(asset)
    }
  }

  function openAdd() {
    setEditingAsset(null)
    setForm(emptyAssetForm)
    setShowAdd(true)
  }

  function openEdit(a: Asset) {
    setEditingAsset(a)
    setForm({
      name: a.name,
      type: a.type,
      value: String(a.value),
      description: a.description || '',
      purchase_date: a.purchase_date || '',
      ticker: a.ticker || '',
    })
    setShowAdd(true)
  }

  function openAddLot(a: Asset) {
    setSelectedAsset(a)
    setLotForm(emptyLotForm)
    setShowLot(true)
  }

  function openLotHistory(a: Asset) {
    setSelectedAsset(a)
    setShowLotHistory(true)
  }

  async function saveAsset() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return
    if (!form.name) { toast('Nama aset wajib diisi!', '⚠️'); return }

    const isStock = form.type === 'investment' && form.ticker

    if (editingAsset) {
      const { error } = await supabase.from('assets').update({
        name: form.name,
        type: form.type,
        value: isStock ? editingAsset.value : (Number(form.value) || 0),
        description: form.description || null,
        purchase_date: form.purchase_date || null,
        ticker: form.ticker ? form.ticker.toUpperCase() : null,
      }).eq('id', editingAsset.id)
      if (error) { toast(error.message, '❌'); return }
      toast('Aset diperbarui!', '✅')
    } else {
      const { error } = await supabase.from('assets').insert({
        user_id: session.user.id,
        name: form.name,
        type: form.type,
        value: isStock ? 0 : (Number(form.value) || 0),
        description: form.description || null,
        purchase_date: form.purchase_date || null,
        ticker: form.ticker ? form.ticker.toUpperCase() : null,
        qty: 0,
        avg_price: 0,
        current_price: 0,
      })
      if (error) { toast(error.message, '❌'); return }
      toast('Aset ditambahkan!', '🏦')
    }
    setShowAdd(false)
    setEditingAsset(null)
    setForm(emptyAssetForm)
    load()
  }

  async function deleteAsset(id: string) {
    if (!confirm('Hapus aset ini?')) return
    await supabase.from('assets').delete().eq('id', id)
    toast('Aset dihapus', '🗑️')
    load()
  }

  async function addLot() {
    if (!selectedAsset) return
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return
    const qty = Number(lotForm.qty)
    const price = Number(lotForm.price)
    if (!qty || !price) { toast('Qty dan harga wajib diisi!', '⚠️'); return }

    // Check sell qty
    if (lotForm.action === 'sell') {
      const currentQty = Number(selectedAsset.qty || 0)
      if (qty > currentQty) { toast(`Tidak bisa jual ${qty} lot — kamu hanya punya ${currentQty}`, '⚠️'); return }
    }

    const { error } = await supabase.from('investment_lots').insert({
      user_id: session.user.id,
      asset_id: selectedAsset.id,
      action: lotForm.action,
      qty,
      price,
      date: lotForm.date,
      note: lotForm.note || null,
    })
    if (error) { toast(error.message, '❌'); return }
    toast(`${lotForm.action === 'buy' ? 'Pembelian' : 'Penjualan'} dicatat!`, lotForm.action === 'buy' ? '📈' : '💰')
    setShowLot(false)
    setLotForm(emptyLotForm)
    load()
  }

  async function deleteLot(lotId: string) {
    if (!confirm('Hapus transaksi lot ini?')) return
    await supabase.from('investment_lots').delete().eq('id', lotId)
    toast('Lot dihapus', '🗑️')
    load()
  }

  const total = assets.reduce((s, a) => s + Number(a.value), 0)
  const stockAssets = assets.filter(a => a.type === 'investment' && a.ticker)
  const otherAssets = assets.filter(a => !(a.type === 'investment' && a.ticker))

  const displayed = tab === 'stock' ? stockAssets : tab === 'other' ? otherAssets : assets

  const totalPL = stockAssets.reduce((s, a) => {
    const cp = Number(a.current_price || 0)
    const ap = Number(a.avg_price || 0)
    const qty = Number(a.qty || 0)
    if (!cp || !ap || !qty) return s
    return s + (cp - ap) * qty
  }, 0)

  return (
    <AppShell>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-extrabold text-surface-900">Manajemen Aset</h1>
          <p className="text-sm text-surface-400">Total: {formatShort(total)}</p>
        </div>
        <div className="flex gap-2">
          {stockAssets.length > 0 && (
            <button onClick={refreshAllPrices} className="btn btn-secondary text-xs">🔄 Update Harga</button>
          )}
          <button onClick={openAdd} className="btn btn-primary">+ Tambah Aset</button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="metric-card">
          <div className="absolute inset-0 bg-gradient-to-br from-amber-50 to-transparent" />
          <div className="relative">
            <p className="text-xs font-bold text-amber-600 uppercase mb-1">📈 Investasi</p>
            <p className="text-xl font-extrabold text-surface-900">{formatShort(assets.filter(a => a.type === 'investment').reduce((s, a) => s + Number(a.value), 0))}</p>
          </div>
        </div>
        <div className="metric-card">
          <div className="absolute inset-0 bg-gradient-to-br from-blue-50 to-transparent" />
          <div className="relative">
            <p className="text-xs font-bold text-blue-600 uppercase mb-1">🏠 Properti</p>
            <p className="text-xl font-extrabold text-surface-900">{formatShort(assets.filter(a => a.type === 'property').reduce((s, a) => s + Number(a.value), 0))}</p>
          </div>
        </div>
        <div className="metric-card">
          <div className="absolute inset-0 bg-gradient-to-br from-purple-50 to-transparent" />
          <div className="relative">
            <p className="text-xs font-bold text-purple-600 uppercase mb-1">🚗 Kendaraan</p>
            <p className="text-xl font-extrabold text-surface-900">{formatShort(assets.filter(a => a.type === 'vehicle').reduce((s, a) => s + Number(a.value), 0))}</p>
          </div>
        </div>
        <div className="metric-card">
          <div className="absolute inset-0 bg-gradient-to-br from-green-50 to-transparent" />
          <div className="relative">
            <p className="text-xs font-bold text-green-600 uppercase mb-1">P/L Saham</p>
            <p className={`text-xl font-extrabold ${totalPL >= 0 ? 'text-green-600' : 'text-red-500'}`}>{totalPL >= 0 ? '+' : ''}{formatShort(totalPL)}</p>
          </div>
        </div>
      </div>

      {/* Tab */}
      <div className="flex gap-2 mb-4">
        <button onClick={() => setTab('all')} className={`btn text-xs ${tab === 'all' ? 'btn-primary' : 'btn-secondary'}`}>Semua ({assets.length})</button>
        <button onClick={() => setTab('stock')} className={`btn text-xs ${tab === 'stock' ? 'btn-primary' : 'btn-secondary'}`}>📈 Saham ({stockAssets.length})</button>
        <button onClick={() => setTab('other')} className={`btn text-xs ${tab === 'other' ? 'btn-primary' : 'btn-secondary'}`}>Lainnya ({otherAssets.length})</button>
      </div>

      {/* Asset Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {displayed.map((a) => {
          const isStock = a.type === 'investment' && a.ticker
          const currentPrice = Number(a.current_price || 0)
          const avgPrice = Number(a.avg_price || 0)
          const qty = Number(a.qty || 0)
          const pl = isStock && currentPrice && avgPrice && qty ? (currentPrice - avgPrice) * qty : 0
          const plPct = isStock && avgPrice > 0 ? ((currentPrice - avgPrice) / avgPrice) * 100 : 0
          const isLoading = priceLoading[a.id]

          return (
            <div key={a.id} className="card-hover p-5 group">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-11 h-11 rounded-xl bg-amber-50 flex items-center justify-center text-xl">
                    {isStock ? '📈' : ASSET_ICONS[a.type] || '📦'}
                  </div>
                  {isStock && a.ticker && (
                    <div>
                      <p className="font-bold text-surface-900">{a.ticker}</p>
                      <p className="text-[10px] font-bold text-surface-400 uppercase">{a.name}</p>
                    </div>
                  )}
                  {!isStock && <p className="font-semibold text-surface-800">{a.name}</p>}
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => openEdit(a)} className="w-6 h-6 rounded-lg hover:bg-brand-50 text-surface-400 hover:text-brand-600 flex items-center justify-center text-xs">✏️</button>
                  <button onClick={() => deleteAsset(a.id)} className="w-6 h-6 rounded-lg hover:bg-red-50 text-surface-400 hover:text-red-500 flex items-center justify-center text-xs">✕</button>
                </div>
              </div>

              {isStock ? (
                /* Stock card */
                <>
                  <div className="space-y-1.5 mb-3">
                    <div className="flex justify-between text-xs">
                      <span className="text-surface-500">Qty</span>
                      <span className="font-bold font-mono text-surface-800">{qty.toLocaleString('id-ID')} lembar</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-surface-500">Avg Price</span>
                      <span className="font-bold font-mono text-surface-800">{formatCurrency(avgPrice)}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-surface-500">Current Price</span>
                      <span className="font-bold font-mono text-surface-800">
                        {currentPrice > 0 ? formatCurrency(currentPrice) : <span className="text-surface-300">—</span>}
                      </span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-surface-500">Market Value</span>
                      <span className="font-bold font-mono text-surface-900">{formatShort(Number(a.value))}</span>
                    </div>
                  </div>

                  {currentPrice > 0 && avgPrice > 0 && (
                    <div className={`flex items-center justify-between p-2 rounded-xl text-xs font-bold mb-3 ${pl >= 0 ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
                      <span>P/L</span>
                      <span className="font-mono">{pl >= 0 ? '+' : ''}{formatShort(pl)} ({plPct >= 0 ? '+' : ''}{plPct.toFixed(2)}%)</span>
                    </div>
                  )}

                  {a.last_price_update && (
                    <p className="text-[10px] text-surface-300 mb-2">Update: {new Date(a.last_price_update).toLocaleString('id-ID')}</p>
                  )}

                  <div className="flex gap-2 mt-2">
                    <button
                      onClick={() => refreshPrice(a)}
                      disabled={isLoading}
                      className="btn btn-secondary text-xs flex-1 py-1.5"
                    >
                      {isLoading ? '⏳' : '🔄'} Harga
                    </button>
                    <button onClick={() => openAddLot(a)} className="btn btn-primary text-xs flex-1 py-1.5">+ Lot</button>
                    <button onClick={() => openLotHistory(a)} className="btn btn-secondary text-xs px-2 py-1.5">📋</button>
                  </div>
                </>
              ) : (
                /* Non-stock card */
                <>
                  <p className="text-[10px] font-bold text-surface-400 uppercase tracking-wider mb-2">{a.type}</p>
                  <p className="text-xl font-extrabold font-mono text-surface-900">{formatCurrency(Number(a.value))}</p>
                  {a.description && <p className="text-xs text-surface-400 mt-1">{a.description}</p>}
                  {a.purchase_date && <p className="text-[10px] text-surface-300 mt-1">Dibeli: {formatDate(a.purchase_date)}</p>}
                </>
              )}
            </div>
          )
        })}
        {displayed.length === 0 && (
          <div className="col-span-full card text-center py-16 text-surface-300">
            <p className="text-4xl mb-2">🏦</p>
            <p className="text-sm">Belum ada aset</p>
          </div>
        )}
      </div>

      {/* Add/Edit Asset Modal */}
      <Modal open={showAdd} onClose={() => { setShowAdd(false); setEditingAsset(null) }} title={editingAsset ? 'Edit Aset' : 'Tambah Aset'}>
        <div className="space-y-4">
          <div>
            <label className="label">Tipe Aset</label>
            <select className="input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value, ticker: '' })}>
              <option value="investment">📈 Investasi / Saham</option>
              <option value="property">🏠 Properti</option>
              <option value="vehicle">🚗 Kendaraan</option>
              <option value="electronics">💻 Elektronik</option>
              <option value="other">📦 Lainnya</option>
            </select>
          </div>
          <div>
            <label className="label">Nama Aset</label>
            <input className="input" placeholder={form.type === 'investment' ? 'mis. Bank Central Asia' : 'mis. Rumah BSD'} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          {form.type === 'investment' && (
            <div>
              <label className="label">Kode Saham IDX (opsional)</label>
              <div className="flex gap-2 items-center">
                <input
                  className="input uppercase"
                  placeholder="mis. BBCA, GOTO, BBRI"
                  value={form.ticker}
                  onChange={(e) => setForm({ ...form, ticker: e.target.value.toUpperCase() })}
                />
              </div>
              <p className="text-[10px] text-surface-400 mt-1">Isi ticker untuk fitur tracking harga real-time & sistem lot. Kosongkan untuk investasi manual.</p>
            </div>
          )}
          {(!form.ticker || form.type !== 'investment') && (
            <div>
              <label className="label">Nilai {form.ticker ? '(otomatis dari lot)' : ''}</label>
              <input className="input" type="number" placeholder="0" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} disabled={!!form.ticker && form.type === 'investment'} />
            </div>
          )}
          <div>
            <label className="label">Keterangan</label>
            <input className="input" placeholder="Opsional" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          {form.type !== 'investment' && (
            <div>
              <label className="label">Tanggal Beli</label>
              <input className="input" type="date" value={form.purchase_date} onChange={(e) => setForm({ ...form, purchase_date: e.target.value })} />
            </div>
          )}
          <div className="flex gap-2">
            {editingAsset && (
              <button onClick={() => { deleteAsset(editingAsset.id); setShowAdd(false) }} className="btn btn-danger flex-1">Hapus</button>
            )}
            <button onClick={saveAsset} className="btn btn-primary flex-1">{editingAsset ? 'Simpan Perubahan' : 'Simpan'}</button>
          </div>
        </div>
      </Modal>

      {/* Add Lot Modal */}
      <Modal open={showLot} onClose={() => setShowLot(false)} title={`Tambah Lot — ${selectedAsset?.ticker || ''}`}>
        <div className="space-y-4">
          {selectedAsset && (
            <div className="p-3 bg-surface-50 rounded-xl text-xs space-y-1">
              <div className="flex justify-between"><span className="text-surface-500">Qty saat ini</span><span className="font-bold">{Number(selectedAsset.qty || 0).toLocaleString('id-ID')} lembar</span></div>
              <div className="flex justify-between"><span className="text-surface-500">Avg Price</span><span className="font-bold font-mono">{formatCurrency(Number(selectedAsset.avg_price || 0))}</span></div>
              <div className="flex justify-between"><span className="text-surface-500">Harga Pasar</span><span className="font-bold font-mono">{Number(selectedAsset.current_price) > 0 ? formatCurrency(Number(selectedAsset.current_price)) : '—'}</span></div>
            </div>
          )}
          <div>
            <label className="label">Aksi</label>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setLotForm({ ...lotForm, action: 'buy' })} className={`btn ${lotForm.action === 'buy' ? 'bg-green-50 text-green-700 border-green-200 border' : 'btn-secondary'}`}>📈 Beli</button>
              <button onClick={() => setLotForm({ ...lotForm, action: 'sell' })} className={`btn ${lotForm.action === 'sell' ? 'bg-red-50 text-red-700 border-red-200 border' : 'btn-secondary'}`}>💰 Jual</button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Jumlah (lembar)</label>
              <input className="input" type="number" placeholder="100" value={lotForm.qty} onChange={(e) => setLotForm({ ...lotForm, qty: e.target.value })} />
            </div>
            <div>
              <label className="label">Harga per Lembar</label>
              <input className="input" type="number" placeholder="0" value={lotForm.price} onChange={(e) => setLotForm({ ...lotForm, price: e.target.value })} />
            </div>
          </div>
          {lotForm.qty && lotForm.price && (
            <div className="p-3 bg-brand-50 rounded-xl text-xs">
              <div className="flex justify-between">
                <span className="text-brand-600 font-semibold">Total {lotForm.action === 'buy' ? 'Pembelian' : 'Penjualan'}</span>
                <span className="font-bold font-mono text-brand-700">{formatCurrency(Number(lotForm.qty) * Number(lotForm.price))}</span>
              </div>
              {lotForm.action === 'buy' && selectedAsset && Number(selectedAsset.avg_price) > 0 && (
                <div className="flex justify-between mt-1">
                  <span className="text-brand-500">Avg Price baru (est.)</span>
                  <span className="font-bold font-mono text-brand-700">
                    {formatCurrency(
                      (Number(selectedAsset.avg_price) * Number(selectedAsset.qty || 0) + Number(lotForm.price) * Number(lotForm.qty)) /
                      (Number(selectedAsset.qty || 0) + Number(lotForm.qty))
                    )}
                  </span>
                </div>
              )}
            </div>
          )}
          <div>
            <label className="label">Tanggal</label>
            <input className="input" type="date" value={lotForm.date} onChange={(e) => setLotForm({ ...lotForm, date: e.target.value })} />
          </div>
          <div>
            <label className="label">Catatan (opsional)</label>
            <input className="input" placeholder="mis. Average down" value={lotForm.note} onChange={(e) => setLotForm({ ...lotForm, note: e.target.value })} />
          </div>
          <button onClick={addLot} className="btn btn-primary w-full">Simpan</button>
        </div>
      </Modal>

      {/* Lot History Modal */}
      <Modal open={showLotHistory} onClose={() => setShowLotHistory(false)} title={`Riwayat Lot — ${selectedAsset?.ticker || ''}`}>
        <div className="space-y-2">
          {selectedAsset && (lots[selectedAsset.id] || []).length > 0 ? (
            (lots[selectedAsset.id] || []).map(lot => (
              <div key={lot.id} className="flex items-center gap-3 p-3 rounded-xl bg-surface-50 group">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold ${lot.action === 'buy' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
                  {lot.action === 'buy' ? '↑' : '↓'}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="font-bold text-surface-800">{lot.qty.toLocaleString('id-ID')} lembar</span>
                    <span className="text-surface-400">@</span>
                    <span className="font-mono font-semibold text-surface-700">{formatCurrency(lot.price)}</span>
                  </div>
                  <div className="text-[10px] text-surface-400 mt-0.5">
                    {formatDate(lot.date)} · Total: {formatCurrency(lot.total_amount)}
                    {lot.note && ` · ${lot.note}`}
                  </div>
                </div>
                <button onClick={() => deleteLot(lot.id)} className="opacity-0 group-hover:opacity-100 text-surface-300 hover:text-red-500 text-xs w-6 h-6 flex items-center justify-center transition-all">✕</button>
              </div>
            ))
          ) : (
            <div className="text-center py-8 text-surface-300 text-sm">Belum ada riwayat lot</div>
          )}
        </div>
      </Modal>
    </AppShell>
  )
}
