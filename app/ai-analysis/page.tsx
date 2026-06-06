'use client'

import { useEffect, useState, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import type { Transaction, Budget } from '@/lib/supabase'
import { formatCurrency, formatShort, MONTHS } from '@/lib/utils'
import AppShell from '@/components/AppShell'
import { toast } from '@/components/Toast'

type AnalysisResult = {
  summary: string
  insights: { type: 'warning' | 'good' | 'tip' | 'action'; title: string; detail: string }[]
  recommendations: string[]
  score: number
  scoreLabel: string
}

const now = new Date()

function buildFinancialContext(
  transactions: Transaction[],
  budgets: Budget[],
  month: number,
  year: number
) {
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`
  const endDate = new Date(year, month, 0).toISOString().split('T')[0]

  const monthTx = transactions.filter(t => t.date >= startDate && t.date <= endDate)
  const prevMonth = month === 1 ? 12 : month - 1
  const prevYear = month === 1 ? year - 1 : year
  const prevStart = `${prevYear}-${String(prevMonth).padStart(2, '0')}-01`
  const prevEnd = new Date(prevYear, prevMonth, 0).toISOString().split('T')[0]
  const prevTx = transactions.filter(t => t.date >= prevStart && t.date <= prevEnd)

  const income = monthTx.filter(t => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0)
  const expense = monthTx.filter(t => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0)
  const prevIncome = prevTx.filter(t => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0)
  const prevExpense = prevTx.filter(t => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0)

  const expByCat: Record<string, number> = {}
  monthTx.filter(t => t.type === 'expense').forEach(t => {
    const cat = (t as any).categories?.name || 'Lainnya'
    expByCat[cat] = (expByCat[cat] || 0) + Number(t.amount)
  })

  const prevExpByCat: Record<string, number> = {}
  prevTx.filter(t => t.type === 'expense').forEach(t => {
    const cat = (t as any).categories?.name || 'Lainnya'
    prevExpByCat[cat] = (prevExpByCat[cat] || 0) + Number(t.amount)
  })

  const budgetStatus = budgets.map(b => {
    const spent = monthTx.filter(t => t.type === 'expense' && t.category_id === b.category_id)
      .reduce((s, t) => s + Number(t.amount), 0)
    return {
      category: (b as any).categories?.name || 'Unknown',
      budget: Number(b.amount),
      spent,
      pct: Number(b.amount) > 0 ? (spent / Number(b.amount)) * 100 : 0,
    }
  })

  const topExpenses = Object.entries(expByCat)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([cat, amt]) => `${cat}: Rp${formatShort(amt)}`)

  return `
DATA KEUANGAN BULAN ${MONTHS[month - 1].toUpperCase()} ${year}:

RINGKASAN:
- Total Pemasukan: Rp${formatShort(income)}
- Total Pengeluaran: Rp${formatShort(expense)}
- Cashflow: Rp${formatShort(income - expense)} (${income - expense >= 0 ? 'SURPLUS' : 'DEFISIT'})
- Savings rate: ${income > 0 ? (((income - expense) / income) * 100).toFixed(1) : 0}%

BULAN SEBELUMNYA (${MONTHS[prevMonth - 1]} ${prevYear}):
- Pemasukan: Rp${formatShort(prevIncome)}
- Pengeluaran: Rp${formatShort(prevExpense)}
- Cashflow: Rp${formatShort(prevIncome - prevExpense)}

PENGELUARAN PER KATEGORI:
${topExpenses.join('\n')}

PERBANDINGAN KATEGORI VS BULAN LALU:
${Object.entries(expByCat).map(([cat, amt]) => {
    const prev = prevExpByCat[cat] || 0
    const diff = amt - prev
    const pct = prev > 0 ? ((diff / prev) * 100).toFixed(0) : 'N/A'
    return `${cat}: Rp${formatShort(amt)} (${diff >= 0 ? '+' : ''}${pct}% vs bulan lalu)`
  }).join('\n')}

STATUS BUDGET:
${budgetStatus.length > 0 ? budgetStatus.map(b =>
    `${b.category}: spent Rp${formatShort(b.spent)} dari budget Rp${formatShort(b.budget)} (${b.pct.toFixed(0)}%) ${b.pct > 100 ? '⚠️ OVER' : b.pct > 80 ? '⚡ hampir habis' : '✓ OK'}`
  ).join('\n') : 'Tidak ada budget yang diset'}

JUMLAH TRANSAKSI: ${monthTx.length} (${monthTx.filter(t => t.type === 'income').length} pemasukan, ${monthTx.filter(t => t.type === 'expense').length} pengeluaran)
  `.trim()
}

export default function AIAnalysisPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [budgets, setBudgets] = useState<Budget[]>([])
  const [loading, setLoading] = useState(true)
  const [analyzing, setAnalyzing] = useState(false)
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [rawText, setRawText] = useState('')
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1)
  const [selectedYear, setSelectedYear] = useState(now.getFullYear())
  const [mode, setMode] = useState<'monthly' | 'custom'>('monthly')
  const [customPrompt, setCustomPrompt] = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    const threeMonthsAgo = new Date(); threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3)
    const [t, b] = await Promise.all([
      supabase.from('transactions').select('*, categories(*), wallets(*)')
        .gte('date', threeMonthsAgo.toISOString().split('T')[0])
        .order('date', { ascending: false })
        .limit(500),
      supabase.from('budgets').select('*, categories(*)')
        .eq('period_month', now.getMonth() + 1)
        .eq('period_year', now.getFullYear()),
    ])
    setTransactions((t.data as any) || [])
    setBudgets((b.data as any) || [])
    setLoading(false)
  }

  async function analyze() {
    if (transactions.length === 0) { toast('Belum ada transaksi untuk dianalisis', '⚠️'); return }
    setAnalyzing(true)
    setResult(null)
    setRawText('')

    try {
      const context = buildFinancialContext(transactions, budgets, selectedMonth, selectedYear)
      const prompt = mode === 'monthly'
        ? `Kamu adalah financial advisor pribadi yang berbicara dalam Bahasa Indonesia. Analisis data keuangan berikut dan berikan insight yang actionable, jujur, dan personal.

${context}

Berikan analisis dalam format JSON berikut (tidak ada teks lain, hanya JSON):
{
  "summary": "1-2 kalimat ringkasan kondisi keuangan bulan ini",
  "score": <angka 1-100 menggambarkan kesehatan keuangan>,
  "scoreLabel": "<Buruk|Perlu Perhatian|Cukup|Baik|Excellent>",
  "insights": [
    {
      "type": "<warning|good|tip|action>",
      "title": "judul singkat",
      "detail": "penjelasan 1-2 kalimat yang spesifik dengan angka"
    }
  ],
  "recommendations": [
    "rekomendasi actionable 1 (spesifik, dengan angka jika relevan)",
    "rekomendasi actionable 2",
    "rekomendasi actionable 3"
  ]
}

Berikan 4-6 insights. Gunakan data aktual. Jangan generik — sebut kategori dan angka spesifik.`
        : `Kamu adalah financial advisor pribadi berbahasa Indonesia. Berikut data keuangan user:

${context}

Pertanyaan user: ${customPrompt}

Jawab dengan natural, personal, dan berdasarkan data aktual di atas. Sebut angka spesifik. Maksimal 300 kata.`

      const response = await fetch('/api/ai-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, mode }),
      })

      if (!response.ok) throw new Error('API error')
      const data = await response.json()
      const text = data.content?.[0]?.text || ''

      if (mode === 'monthly') {
        try {
          const clean = text.replace(/```json|```/g, '').trim()
          const parsed = JSON.parse(clean) as AnalysisResult
          setResult(parsed)
        } catch {
          setRawText(text)
        }
      } else {
        setRawText(text)
      }
    } catch (e) {
      toast('Gagal analisis. Coba lagi.', '❌')
    } finally {
      setAnalyzing(false)
    }
  }

  const monthOptions = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    return { year: d.getFullYear(), month: d.getMonth() + 1, label: `${MONTHS[d.getMonth()]} ${d.getFullYear()}` }
  })

  const insightConfig = {
    warning: { bg: 'bg-red-50 border-red-200', icon: '⚠️', titleColor: 'text-red-700', detailColor: 'text-red-600' },
    good: { bg: 'bg-green-50 border-green-200', icon: '✅', titleColor: 'text-green-700', detailColor: 'text-green-600' },
    tip: { bg: 'bg-blue-50 border-blue-200', icon: '💡', titleColor: 'text-blue-700', detailColor: 'text-blue-600' },
    action: { bg: 'bg-amber-50 border-amber-200', icon: '🎯', titleColor: 'text-amber-700', detailColor: 'text-amber-600' },
  }

  function ScoreRing({ score }: { score: number }) {
    const color = score >= 80 ? '#22c55e' : score >= 60 ? '#3b82f6' : score >= 40 ? '#f59e0b' : '#ef4444'
    const circumference = 2 * Math.PI * 40
    const offset = circumference - (score / 100) * circumference
    return (
      <div className="relative w-28 h-28 flex-shrink-0">
        <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="40" fill="none" stroke="#f1f5f9" strokeWidth="10" />
          <circle cx="50" cy="50" r="40" fill="none" stroke={color} strokeWidth="10"
            strokeDasharray={circumference} strokeDashoffset={offset}
            strokeLinecap="round" style={{ transition: 'stroke-dashoffset 1s ease' }} />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-extrabold" style={{ color }}>{score}</span>
          <span className="text-[10px] text-surface-400 font-semibold">/100</span>
        </div>
      </div>
    )
  }

  const QUICK_PROMPTS = [
    'Di kategori mana aku bisa hemat paling banyak?',
    'Bagaimana tren pengeluaranku 3 bulan terakhir?',
    'Apakah saving rate-ku sudah sehat?',
    'Kategori apa yang paling boros bulan ini?',
    'Berikan saran untuk mencapai saving rate 20%',
  ]

  return (
    <AppShell>
      <div className="mb-5">
        <div className="flex items-center gap-2 mb-1">
          <h1 className="text-xl sm:text-2xl font-extrabold text-surface-900">Analisis AI</h1>
          <span className="badge bg-brand-100 text-brand-700">Beta</span>
        </div>
        <p className="text-xs text-surface-400">Insight keuangan personal berbasis data transaksimu</p>
      </div>

      {/* Mode tabs */}
      <div className="flex gap-1.5 mb-4 bg-surface-100 p-1 rounded-xl">
        <button onClick={() => setMode('monthly')}
          className={`flex-1 text-xs font-bold py-2 rounded-lg transition-all ${mode === 'monthly' ? 'bg-white text-surface-900 shadow-sm' : 'text-surface-500'}`}>
          📊 Analisis Bulanan
        </button>
        <button onClick={() => setMode('custom')}
          className={`flex-1 text-xs font-bold py-2 rounded-lg transition-all ${mode === 'custom' ? 'bg-white text-surface-900 shadow-sm' : 'text-surface-500'}`}>
          💬 Tanya AI
        </button>
      </div>

      {mode === 'monthly' ? (
        <div className="space-y-4">
          <div className="card p-4">
            <label className="label">Pilih Bulan</label>
            <select className="input" value={`${selectedYear}-${selectedMonth}`}
              onChange={e => {
                const [y, m] = e.target.value.split('-')
                setSelectedYear(Number(y)); setSelectedMonth(Number(m))
                setResult(null); setRawText('')
              }}>
              {monthOptions.map(o => (
                <option key={`${o.year}-${o.month}`} value={`${o.year}-${o.month}`}>{o.label}</option>
              ))}
            </select>
          </div>

          <button onClick={analyze} disabled={analyzing || loading}
            className="btn btn-primary w-full py-4 text-base">
            {analyzing ? (
              <span className="flex items-center gap-2">
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                AI sedang menganalisis...
              </span>
            ) : '🤖 Analisis Keuangan Bulanku'}
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="card p-4">
            <label className="label">Tanya apa saja tentang keuanganmu</label>
            <textarea
              className="input min-h-[100px] resize-none"
              placeholder="mis. Kenapa pengeluaran bulan ini tinggi? Atau, kategori apa yang harus aku kurangi?"
              value={customPrompt}
              onChange={e => setCustomPrompt(e.target.value)}
            />
            <div className="flex flex-wrap gap-2 mt-2">
              {QUICK_PROMPTS.map(p => (
                <button key={p} onClick={() => setCustomPrompt(p)}
                  className="text-xs px-2.5 py-1.5 rounded-lg bg-surface-100 text-surface-600 hover:bg-brand-50 hover:text-brand-700 transition-colors">
                  {p}
                </button>
              ))}
            </div>
          </div>
          <button onClick={analyze} disabled={analyzing || !customPrompt.trim() || loading}
            className="btn btn-primary w-full py-4 text-base">
            {analyzing ? (
              <span className="flex items-center gap-2">
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                AI sedang berpikir...
              </span>
            ) : '💬 Tanya AI'}
          </button>
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="mt-6 space-y-4 animate-slide-up">
          {/* Score + Summary */}
          <div className="card p-5">
            <div className="flex items-center gap-4 mb-4">
              <ScoreRing score={result.score} />
              <div>
                <p className="text-xs font-bold text-surface-400 uppercase tracking-wider mb-1">
                  Skor Kesehatan Keuangan
                </p>
                <p className="text-xl font-extrabold text-surface-900">{result.scoreLabel}</p>
                <p className="text-sm text-surface-600 mt-1 leading-relaxed">{result.summary}</p>
              </div>
            </div>
          </div>

          {/* Insights */}
          <div>
            <p className="text-xs font-bold text-surface-500 uppercase tracking-wider mb-3">Insight</p>
            <div className="space-y-2">
              {result.insights.map((ins, i) => {
                const cfg = insightConfig[ins.type]
                return (
                  <div key={i} className={`p-3 rounded-xl border ${cfg.bg}`}>
                    <div className="flex items-start gap-2">
                      <span className="text-base flex-shrink-0 mt-0.5">{cfg.icon}</span>
                      <div>
                        <p className={`text-sm font-bold ${cfg.titleColor}`}>{ins.title}</p>
                        <p className={`text-xs mt-0.5 ${cfg.detailColor}`}>{ins.detail}</p>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Recommendations */}
          <div className="card p-4">
            <p className="text-xs font-bold text-surface-500 uppercase tracking-wider mb-3">🎯 Rekomendasi Aksi</p>
            <div className="space-y-2">
              {result.recommendations.map((rec, i) => (
                <div key={i} className="flex items-start gap-3 p-2.5 rounded-xl bg-surface-50">
                  <span className="w-5 h-5 rounded-full bg-brand-100 text-brand-700 text-[10px] font-extrabold flex items-center justify-center flex-shrink-0 mt-0.5">
                    {i + 1}
                  </span>
                  <p className="text-sm text-surface-700">{rec}</p>
                </div>
              ))}
            </div>
          </div>

          <button onClick={() => { setResult(null); setRawText('') }}
            className="btn btn-secondary w-full text-sm">
            🔄 Analisis Ulang
          </button>
        </div>
      )}

      {/* Raw text mode (custom prompt or JSON parse fail) */}
      {rawText && (
        <div className="mt-6 animate-slide-up">
          <div className="card p-5">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-xl">🤖</span>
              <p className="text-sm font-bold text-surface-900">Jawaban AI</p>
            </div>
            <p className="text-sm text-surface-700 leading-relaxed whitespace-pre-line">{rawText}</p>
          </div>
          <button onClick={() => { setResult(null); setRawText('') }}
            className="btn btn-secondary w-full text-sm mt-3">
            🔄 Tanya Lagi
          </button>
        </div>
      )}

      {!result && !rawText && !analyzing && (
        <div className="mt-8 text-center text-surface-300">
          <p className="text-4xl mb-2">🤖</p>
          <p className="text-sm font-semibold text-surface-400">AI siap menganalisis keuanganmu</p>
          <p className="text-xs text-surface-300 mt-1">Berbasis data transaksi nyata, bukan asumsi</p>
        </div>
      )}
    </AppShell>
  )
}
