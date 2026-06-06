'use client'

import { useEffect, useState, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import type { Transaction, Wallet, Category } from '@/lib/supabase'
import { formatCurrency, formatDate, MONTHS } from '@/lib/utils'
import AppShell from '@/components/AppShell'
import { toast } from '@/components/Toast'

type ExportType = 'transactions' | 'transfers' | 'debts' | 'assets'

const now = new Date()

export default function ExportPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [wallets, setWallets] = useState<Wallet[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)

  // Filters
  const [exportType, setExportType] = useState<ExportType>('transactions')
  const [dateFrom, setDateFrom] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`)
  const [dateTo, setDateTo] = useState(now.toISOString().split('T')[0])
  const [filterWallet, setFilterWallet] = useState('')
  const [filterType, setFilterType] = useState('')
  const [filterCat, setFilterCat] = useState('')
  const [format, setFormat] = useState<'csv' | 'pdf'>('csv')

  useEffect(() => { load() }, [])

  async function load() {
    const [t, w, c] = await Promise.all([
      supabase.from('transactions').select('*, categories(*), wallets(*)').order('date', { ascending: false }).limit(1000),
      supabase.from('wallets').select('*').eq('is_active', true).order('name'),
      supabase.from('categories').select('*').order('name'),
    ])
    setTransactions((t.data as any) || [])
    setWallets(w.data || [])
    setCategories(c.data || [])
    setLoading(false)
  }

  const filtered = useMemo(() => {
    return transactions.filter(tx => {
      if (dateFrom && tx.date < dateFrom) return false
      if (dateTo && tx.date > dateTo) return false
      if (filterWallet && tx.wallet_id !== filterWallet) return false
      if (filterType && tx.type !== filterType) return false
      if (filterCat && tx.category_id !== filterCat) return false
      return true
    })
  }, [transactions, dateFrom, dateTo, filterWallet, filterType, filterCat])

  const totalIncome = useMemo(() => filtered.filter(t => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0), [filtered])
  const totalExpense = useMemo(() => filtered.filter(t => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0), [filtered])

  // ── Export CSV ────────────────────────────────────────────
  function exportCSV() {
    setExporting(true)
    try {
      const headers = ['Tanggal', 'Tipe', 'Kategori', 'Dompet', 'Jumlah', 'Keterangan', 'Trip']
      const rows = filtered.map(tx => [
        tx.date,
        tx.type === 'income' ? 'Pemasukan' : 'Pengeluaran',
        (tx as any).categories?.name || '',
        (tx as any).wallets?.name || '',
        Number(tx.amount),
        tx.description || '',
        (tx as any).trip_id || '',
      ])

      const csvContent = [
        headers.join(','),
        ...rows.map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      ].join('\n')

      const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `dompetku_transaksi_${dateFrom}_${dateTo}.csv`
      a.click()
      URL.revokeObjectURL(url)
      toast(`${filtered.length} transaksi diekspor!`, '✅')
    } catch (e) {
      toast('Gagal export', '❌')
    } finally {
      setExporting(false)
    }
  }

  // ── Export PDF (print-friendly HTML) ─────────────────────
  function exportPDF() {
    setExporting(true)
    try {
      const periodLabel = dateFrom === dateTo ? formatDate(dateFrom) : `${formatDate(dateFrom)} – ${formatDate(dateTo)}`
      const walletLabel = filterWallet ? wallets.find(w => w.id === filterWallet)?.name : 'Semua Dompet'
      const typeLabel = filterType === 'income' ? 'Pemasukan' : filterType === 'expense' ? 'Pengeluaran' : 'Semua'

      const rows = filtered.map(tx => `
        <tr>
          <td>${formatDate(tx.date)}</td>
          <td><span class="${tx.type === 'income' ? 'badge-income' : 'badge-expense'}">${tx.type === 'income' ? 'Masuk' : 'Keluar'}</span></td>
          <td>${(tx as any).categories?.icon || ''} ${(tx as any).categories?.name || '—'}</td>
          <td>${(tx as any).wallets?.name || '—'}</td>
          <td class="amount ${tx.type === 'income' ? 'green' : 'red'}">${tx.type === 'income' ? '+' : '-'}${formatCurrency(Number(tx.amount))}</td>
          <td>${tx.description || '—'}</td>
        </tr>
      `).join('')

      const html = `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8">
<title>DompetKu — Laporan Transaksi</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Segoe UI', sans-serif; font-size: 12px; color: #1e293b; padding: 32px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; padding-bottom: 16px; border-bottom: 2px solid #e2e8f0; }
  .logo { font-size: 20px; font-weight: 800; color: #0c8ce9; }
  .meta { text-align: right; color: #64748b; font-size: 11px; }
  .meta strong { display: block; font-size: 13px; color: #1e293b; }
  .summary { display: flex; gap: 16px; margin-bottom: 20px; }
  .summary-card { flex: 1; padding: 12px 16px; border-radius: 10px; border: 1px solid #e2e8f0; }
  .summary-card .label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #94a3b8; margin-bottom: 4px; }
  .summary-card .value { font-size: 18px; font-weight: 800; font-family: monospace; }
  .green { color: #16a34a; }
  .red { color: #dc2626; }
  .blue { color: #0c8ce9; }
  table { width: 100%; border-collapse: collapse; }
  thead tr { background: #f8fafc; }
  th { padding: 8px 10px; text-align: left; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #94a3b8; border-bottom: 1px solid #e2e8f0; }
  td { padding: 8px 10px; border-bottom: 1px solid #f1f5f9; vertical-align: middle; }
  tr:hover { background: #f8fafc; }
  .amount { font-family: monospace; font-weight: 700; text-align: right; }
  .badge-income { background: #dcfce7; color: #16a34a; padding: 2px 8px; border-radius: 20px; font-size: 10px; font-weight: 700; }
  .badge-expense { background: #fee2e2; color: #dc2626; padding: 2px 8px; border-radius: 20px; font-size: 10px; font-weight: 700; }
  .footer { margin-top: 20px; padding-top: 12px; border-top: 1px solid #e2e8f0; color: #94a3b8; font-size: 10px; display: flex; justify-content: space-between; }
  @media print { body { padding: 16px; } }
</style>
</head>
<body>
  <div class="header">
    <div>
      <div class="logo">💰 DompetKu</div>
      <div style="color:#64748b;font-size:11px;margin-top:4px;">Laporan Transaksi Keuangan</div>
    </div>
    <div class="meta">
      <strong>${periodLabel}</strong>
      ${walletLabel} · ${typeLabel} · ${filtered.length} transaksi
    </div>
  </div>

  <div class="summary">
    <div class="summary-card">
      <div class="label">Total Pemasukan</div>
      <div class="value green">+${formatCurrency(totalIncome)}</div>
    </div>
    <div class="summary-card">
      <div class="label">Total Pengeluaran</div>
      <div class="value red">-${formatCurrency(totalExpense)}</div>
    </div>
    <div class="summary-card">
      <div class="label">Cashflow</div>
      <div class="value ${totalIncome - totalExpense >= 0 ? 'green' : 'red'}">${totalIncome - totalExpense >= 0 ? '+' : ''}${formatCurrency(totalIncome - totalExpense)}</div>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Tanggal</th><th>Tipe</th><th>Kategori</th><th>Dompet</th><th style="text-align:right">Jumlah</th><th>Keterangan</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>

  <div class="footer">
    <span>DompetKu — diekspor ${new Date().toLocaleString('id-ID')}</span>
    <span>Total: ${filtered.length} transaksi</span>
  </div>
</body>
</html>`

      const w2 = window.open('', '_blank')
      if (w2) {
        w2.document.write(html)
        w2.document.close()
        setTimeout(() => { w2.print() }, 500)
      }
      toast('PDF siap di-print/save!', '🖨️')
    } catch (e) {
      toast('Gagal generate PDF', '❌')
    } finally {
      setExporting(false)
    }
  }

  function doExport() {
    if (filtered.length === 0) { toast('Tidak ada data untuk diekspor', '⚠️'); return }
    if (format === 'csv') exportCSV()
    else exportPDF()
  }

  // Quick period shortcuts
  function setPeriod(type: 'thisMonth' | 'lastMonth' | 'thisYear' | 'last3') {
    const d = new Date()
    if (type === 'thisMonth') {
      setDateFrom(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`)
      setDateTo(d.toISOString().split('T')[0])
    } else if (type === 'lastMonth') {
      const lm = new Date(d.getFullYear(), d.getMonth() - 1, 1)
      setDateFrom(`${lm.getFullYear()}-${String(lm.getMonth() + 1).padStart(2, '0')}-01`)
      const lastDay = new Date(d.getFullYear(), d.getMonth(), 0)
      setDateTo(lastDay.toISOString().split('T')[0])
    } else if (type === 'thisYear') {
      setDateFrom(`${d.getFullYear()}-01-01`)
      setDateTo(d.toISOString().split('T')[0])
    } else if (type === 'last3') {
      const from = new Date(d.getFullYear(), d.getMonth() - 2, 1)
      setDateFrom(`${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, '0')}-01`)
      setDateTo(d.toISOString().split('T')[0])
    }
  }

  return (
    <AppShell>
      <div className="mb-5">
        <h1 className="text-xl sm:text-2xl font-extrabold text-surface-900">Export Data</h1>
        <p className="text-xs text-surface-400">Export transaksi ke CSV atau PDF</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Left: Filters */}
        <div className="lg:col-span-2 space-y-4">
          {/* Format */}
          <div className="card p-4">
            <p className="text-xs font-bold text-surface-500 uppercase tracking-wider mb-3">Format Export</p>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setFormat('csv')}
                className={`btn flex-col gap-1 py-4 ${format === 'csv' ? 'btn-primary' : 'btn-secondary'}`}>
                <span className="text-2xl">📊</span>
                <span className="text-sm font-bold">CSV</span>
                <span className="text-[10px] opacity-70">Buka di Excel / Google Sheets</span>
              </button>
              <button onClick={() => setFormat('pdf')}
                className={`btn flex-col gap-1 py-4 ${format === 'pdf' ? 'btn-primary' : 'btn-secondary'}`}>
                <span className="text-2xl">🖨️</span>
                <span className="text-sm font-bold">PDF</span>
                <span className="text-[10px] opacity-70">Print atau save sebagai PDF</span>
              </button>
            </div>
          </div>

          {/* Period */}
          <div className="card p-4">
            <p className="text-xs font-bold text-surface-500 uppercase tracking-wider mb-3">Periode</p>
            <div className="flex gap-2 flex-wrap mb-3">
              {[
                { key: 'thisMonth', label: 'Bulan ini' },
                { key: 'lastMonth', label: 'Bulan lalu' },
                { key: 'last3', label: '3 bulan' },
                { key: 'thisYear', label: 'Tahun ini' },
              ].map(s => (
                <button key={s.key} onClick={() => setPeriod(s.key as any)}
                  className="btn btn-secondary text-xs py-1.5 px-3">
                  {s.label}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Dari</label>
                <input className="input" type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
              </div>
              <div>
                <label className="label">Sampai</label>
                <input className="input" type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} />
              </div>
            </div>
          </div>

          {/* Filters */}
          <div className="card p-4">
            <p className="text-xs font-bold text-surface-500 uppercase tracking-wider mb-3">Filter (opsional)</p>
            <div className="space-y-3">
              <div>
                <label className="label">Tipe</label>
                <select className="input" value={filterType} onChange={e => setFilterType(e.target.value)}>
                  <option value="">Semua tipe</option>
                  <option value="income">💰 Pemasukan saja</option>
                  <option value="expense">💸 Pengeluaran saja</option>
                </select>
              </div>
              <div>
                <label className="label">Dompet</label>
                <select className="input" value={filterWallet} onChange={e => setFilterWallet(e.target.value)}>
                  <option value="">Semua dompet</option>
                  {wallets.map(w => <option key={w.id} value={w.id}>{w.icon || '💳'} {w.name}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Kategori</label>
                <select className="input" value={filterCat} onChange={e => setFilterCat(e.target.value)}>
                  <option value="">Semua kategori</option>
                  {categories.map(c => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* Right: Preview & Export */}
        <div className="space-y-4">
          <div className="card p-4">
            <p className="text-xs font-bold text-surface-500 uppercase tracking-wider mb-3">Preview</p>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-surface-500">Total data</span>
                <span className="font-bold">{filtered.length} transaksi</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-surface-500">Pemasukan</span>
                <span className="font-bold text-green-600">+{filtered.filter(t => t.type === 'income').length} tx</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-surface-500">Pengeluaran</span>
                <span className="font-bold text-red-500">-{filtered.filter(t => t.type === 'expense').length} tx</span>
              </div>
              <div className="border-t border-surface-100 my-2" />
              <div className="flex justify-between text-sm">
                <span className="text-surface-500">Total masuk</span>
                <span className="font-bold font-mono text-green-600">+{new Intl.NumberFormat('id-ID').format(totalIncome)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-surface-500">Total keluar</span>
                <span className="font-bold font-mono text-red-500">-{new Intl.NumberFormat('id-ID').format(totalExpense)}</span>
              </div>
              <div className="flex justify-between text-sm font-bold border-t border-surface-100 pt-2 mt-2">
                <span>Cashflow</span>
                <span className={`font-mono ${totalIncome - totalExpense >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                  {totalIncome - totalExpense >= 0 ? '+' : ''}{new Intl.NumberFormat('id-ID').format(totalIncome - totalExpense)}
                </span>
              </div>
            </div>
          </div>

          <button
            onClick={doExport}
            disabled={exporting || filtered.length === 0}
            className="btn btn-primary w-full py-4 text-base"
          >
            {exporting ? (
              <span className="flex items-center gap-2">
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Memproses...
              </span>
            ) : (
              `${format === 'csv' ? '📊 Download CSV' : '🖨️ Generate PDF'} (${filtered.length})`
            )}
          </button>

          {filtered.length === 0 && (
            <p className="text-center text-xs text-surface-400">Tidak ada data dengan filter ini</p>
          )}

          <div className="card p-3 bg-surface-50">
            <p className="text-[10px] text-surface-400 font-semibold mb-1">💡 Tips</p>
            <p className="text-[10px] text-surface-400">
              {format === 'csv'
                ? 'CSV bisa dibuka di Excel, Google Sheets, atau Numbers. UTF-8 encoding, sudah include BOM untuk karakter Indonesia.'
                : 'PDF akan terbuka di tab baru. Gunakan Ctrl+P / Cmd+P untuk print atau save as PDF.'}
            </p>
          </div>
        </div>
      </div>
    </AppShell>
  )
}
