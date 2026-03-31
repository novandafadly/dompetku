'use client'

import { useEffect, useState, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import type { Debt, Contact, Wallet } from '@/lib/supabase'
import { formatCurrency, formatShort, formatDate } from '@/lib/utils'
import AppShell from '@/components/AppShell'
import Modal from '@/components/Modal'
import { toast } from '@/components/Toast'

// ─── Avatar helpers ───────────────────────────────────────
const AVATAR_COLORS = [
  '#3b82f6','#22c55e','#f59e0b','#ef4444','#8b5cf6',
  '#ec4899','#06b6d4','#f97316','#14b8a6','#6366f1',
]

function initials(name: string) {
  return name.trim().split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 2)
}

function Avatar({ name, color, size = 'md' }: { name: string; color: string; size?: 'sm' | 'md' | 'lg' }) {
  const cls = size === 'lg' ? 'w-14 h-14 text-xl' : size === 'sm' ? 'w-8 h-8 text-xs' : 'w-10 h-10 text-sm'
  return (
    <div className={`${cls} rounded-full flex items-center justify-center font-bold text-white flex-shrink-0`} style={{ background: color }}>
      {initials(name)}
    </div>
  )
}

// ─── Types ────────────────────────────────────────────────
type DebtForm = {
  contact_id: string
  new_contact_name: string
  type: 'debt' | 'receivable'
  total_amount: string
  paid_amount: string
  description: string
  due_date: string
  wallet_id: string
}

type ContactForm = {
  name: string
  phone: string
  note: string
  avatar_color: string
}

const emptyDebtForm: DebtForm = {
  contact_id: '', new_contact_name: '', type: 'debt',
  total_amount: '', paid_amount: '0', description: '', due_date: '',
  wallet_id: '',
}

const emptyContactForm: ContactForm = {
  name: '', phone: '', note: '', avatar_color: AVATAR_COLORS[0],
}

// ─── Per-contact net position ─────────────────────────────
type ContactSummary = {
  contact: Contact
  debts: Debt[]
  receivables: Debt[]
  totalDebt: number
  totalReceivable: number
  net: number
}

export default function DebtsPage() {
  const [debts, setDebts] = useState<Debt[]>([])
  const [contacts, setContacts] = useState<Contact[]>([])
  const [wallets, setWallets] = useState<Wallet[]>([])

  const [showDebtModal, setShowDebtModal] = useState(false)
  const [showContactModal, setShowContactModal] = useState(false)
  const [showContactDetail, setShowContactDetail] = useState(false)
  const [showPayModal, setShowPayModal] = useState(false)

  const [editingDebt, setEditingDebt] = useState<Debt | null>(null)
  const [editingContact, setEditingContact] = useState<Contact | null>(null)
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null)
  const [payingDebt, setPayingDebt] = useState<Debt | null>(null)
  const [payAmount, setPayAmount] = useState('')
  const [payWalletId, setPayWalletId] = useState('')

  const [debtForm, setDebtForm] = useState<DebtForm>(emptyDebtForm)
  const [contactForm, setContactForm] = useState<ContactForm>(emptyContactForm)
  const [tab, setTab] = useState<'contacts' | 'all'>('contacts')
  const [searchContact, setSearchContact] = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    const [d, c, w] = await Promise.all([
      supabase.from('debts').select('*, contacts(*), wallets(*)').order('is_completed').order('due_date', { nullsFirst: false }),
      supabase.from('contacts').select('*').order('name'),
      supabase.from('wallets').select('*').eq('is_active', true).order('name'),
    ])
    setDebts(d.data || [])
    setContacts(c.data || [])
    setWallets(w.data || [])
  }

  // ── Contact CRUD ────────────────────────────────────────
  function openAddContact() {
    setEditingContact(null)
    setContactForm(emptyContactForm)
    setShowContactModal(true)
  }

  function openEditContact(c: Contact, e?: React.MouseEvent) {
    e?.stopPropagation()
    setEditingContact(c)
    setContactForm({ name: c.name, phone: c.phone || '', note: c.note || '', avatar_color: c.avatar_color })
    setShowContactModal(true)
  }

  async function saveContact() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return
    if (!contactForm.name.trim()) { toast('Nama wajib diisi!', '⚠️'); return }

    if (editingContact) {
      const { error } = await supabase.from('contacts').update({
        name: contactForm.name.trim(), phone: contactForm.phone || null,
        note: contactForm.note || null, avatar_color: contactForm.avatar_color,
      }).eq('id', editingContact.id)
      if (error) { toast(error.message, '❌'); return }
      toast('Kontak diperbarui!', '✅')
    } else {
      const { error } = await supabase.from('contacts').insert({
        user_id: session.user.id, name: contactForm.name.trim(),
        phone: contactForm.phone || null, note: contactForm.note || null,
        avatar_color: contactForm.avatar_color,
      })
      if (error) { toast(error.message, '❌'); return }
      toast('Kontak ditambahkan!', '👤')
    }
    setShowContactModal(false); setEditingContact(null); load()
  }

  async function deleteContact(id: string, e?: React.MouseEvent) {
    e?.stopPropagation()
    if (!confirm('Hapus kontak ini? Catatan utang/piutang terkait tidak akan terhapus.')) return
    await supabase.from('contacts').delete().eq('id', id)
    toast('Kontak dihapus', '🗑️'); load()
  }

  // ── Debt CRUD ───────────────────────────────────────────
  function openAddDebt(contactId?: string, type?: 'debt' | 'receivable') {
    setEditingDebt(null)
    setDebtForm({ ...emptyDebtForm, contact_id: contactId || '', type: type || 'debt' })
    setShowDebtModal(true)
  }

  function openEditDebt(d: Debt, e?: React.MouseEvent) {
    e?.stopPropagation()
    setEditingDebt(d)
    setDebtForm({
      contact_id: d.contact_id || '',
      new_contact_name: '',
      type: d.type,
      total_amount: String(d.total_amount),
      paid_amount: String(d.paid_amount),
      description: d.description || '',
      due_date: d.due_date || '',
      wallet_id: d.wallet_id || '',
    })
    setShowDebtModal(true)
  }

  async function saveDebt() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return
    const total = Number(debtForm.total_amount)
    if (!total) { toast('Jumlah wajib diisi!', '⚠️'); return }

    // Create new contact on the fly if name typed
    let contactId = debtForm.contact_id
    let personName = contacts.find(c => c.id === contactId)?.name || debtForm.new_contact_name

    if (!contactId && debtForm.new_contact_name.trim()) {
      const color = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)]
      const { data, error } = await supabase.from('contacts').insert({
        user_id: session.user.id, name: debtForm.new_contact_name.trim(),
        avatar_color: color,
      }).select().single()
      if (error) { toast(error.message, '❌'); return }
      contactId = data.id
      personName = data.name
    }

    if (!contactId && !debtForm.new_contact_name.trim()) { toast('Pilih atau isi nama orang!', '⚠️'); return }

    const payload = {
      contact_id: contactId || null,
      person_name: personName,
      type: debtForm.type,
      total_amount: total,
      paid_amount: Number(debtForm.paid_amount) || 0,
      description: debtForm.description || null,
      due_date: debtForm.due_date || null,
      wallet_id: debtForm.wallet_id || null,
    }

    if (editingDebt) {
      const { error } = await supabase.from('debts').update(payload).eq('id', editingDebt.id)
      if (error) { toast(error.message, '❌'); return }
      toast('Diperbarui!', '✅')
    } else {
      const { error } = await supabase.from('debts').insert({ ...payload, user_id: session.user.id, is_completed: false })
      if (error) { toast(error.message, '❌'); return }

      // Adjust wallet balance saat catat baru
      if (debtForm.wallet_id) {
        const wallet = wallets.find(w => w.id === debtForm.wallet_id)
        if (wallet) {
          // Piutang = kamu bayarin dulu → saldo berkurang
          // Hutang = kamu terima uang → saldo bertambah
          const delta = debtForm.type === 'receivable' ? -total : total
          await supabase.from('wallets')
            .update({ balance: wallet.balance + delta })
            .eq('id', wallet.id)

          // Catat otomatis di riwayat transaksi
          await supabase.from('transactions').insert({
            user_id: session.user.id,
            wallet_id: debtForm.wallet_id,
            type: debtForm.type === 'receivable' ? 'expense' : 'income',
            amount: total,
            description: debtForm.type === 'receivable'
              ? `[Piutang] ${personName}${debtForm.description ? ' - ' + debtForm.description : ''}`
              : `[Hutang] ${personName}${debtForm.description ? ' - ' + debtForm.description : ''}`,
            date: new Date().toISOString().split('T')[0],
            category_id: null,
          })
        }
      }

      toast(debtForm.type === 'debt' ? 'Utang dicatat!' : 'Piutang dicatat!', debtForm.type === 'debt' ? '💸' : '💰')
    }
    setShowDebtModal(false); setEditingDebt(null); load()
  }

  async function deleteDebt(id: string, e?: React.MouseEvent) {
    e?.stopPropagation()
    if (!confirm('Hapus catatan ini?')) return
    await supabase.from('debts').delete().eq('id', id)
    toast('Dihapus', '🗑️'); load()
  }

  async function toggleComplete(d: Debt, e?: React.MouseEvent) {
    e?.stopPropagation()
    await supabase.from('debts').update({ is_completed: !d.is_completed }).eq('id', d.id)
    toast(!d.is_completed ? '✅ Selesai!' : 'Dibuka kembali', !d.is_completed ? '✅' : '🔄')
    load()
  }

  // ── Quick pay ───────────────────────────────────────────
  function openPay(d: Debt, e?: React.MouseEvent) {
    e?.stopPropagation()
    setPayingDebt(d)
    setPayAmount('')
    setPayWalletId(d.wallet_id || '')
    setShowPayModal(true)
  }

  async function submitPay() {
    if (!payingDebt) return
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return

    const amount = Number(payAmount)
    if (!amount || amount <= 0) { toast('Jumlah tidak valid!', '⚠️'); return }

    const newPaid = Math.min(Number(payingDebt.paid_amount) + amount, Number(payingDebt.total_amount))
    const isCompleted = newPaid >= Number(payingDebt.total_amount)
    await supabase.from('debts').update({ paid_amount: newPaid, is_completed: isCompleted }).eq('id', payingDebt.id)

    // Adjust wallet balance saat catat bayar
    if (payWalletId) {
      const wallet = wallets.find(w => w.id === payWalletId)
      if (wallet) {
        // Bayar hutang = uang keluar dari wallet
        // Terima piutang = uang masuk ke wallet
        const delta = payingDebt.type === 'debt' ? -amount : amount
        await supabase.from('wallets')
          .update({ balance: wallet.balance + delta })
          .eq('id', wallet.id)

        // Catat otomatis di riwayat transaksi
        await supabase.from('transactions').insert({
          user_id: session.user.id,
          wallet_id: payWalletId,
          type: payingDebt.type === 'debt' ? 'expense' : 'income',
          amount,
          description: payingDebt.type === 'debt'
            ? `[Bayar Hutang] ${payingDebt.person_name}`
            : `[Terima Piutang] ${payingDebt.person_name}`,
          date: new Date().toISOString().split('T')[0],
          category_id: null,
        })
      }
    }

    toast(isCompleted ? '🎉 Lunas!' : `Pembayaran ${formatCurrency(amount)} dicatat!`, isCompleted ? '🎉' : '✅')
    setShowPayModal(false); setPayingDebt(null); load()
  }

  // ── Computed ─────────────────────────────────────────────
  const contactSummaries = useMemo((): ContactSummary[] => {
    return contacts.map(contact => {
      const contactDebts = debts.filter(d => d.contact_id === contact.id)
      const myDebts = contactDebts.filter(d => d.type === 'debt' && !d.is_completed)
      const myReceivables = contactDebts.filter(d => d.type === 'receivable' && !d.is_completed)
      const totalDebt = myDebts.reduce((s, d) => s + Number(d.total_amount) - Number(d.paid_amount), 0)
      const totalReceivable = myReceivables.reduce((s, d) => s + Number(d.total_amount) - Number(d.paid_amount), 0)
      return {
        contact,
        debts: myDebts,
        receivables: myReceivables,
        totalDebt,
        totalReceivable,
        net: totalReceivable - totalDebt,
      }
    }).filter(s => s.debts.length + s.receivables.length > 0 || contacts.find(c => c.id === s.contact.id))
  }, [contacts, debts])

  const ungroupedDebts = debts.filter(d => !d.contact_id && !d.is_completed)

  const totalMyDebt = debts.filter(d => d.type === 'debt' && !d.is_completed)
    .reduce((s, d) => s + Number(d.total_amount) - Number(d.paid_amount), 0)
  const totalMyReceivable = debts.filter(d => d.type === 'receivable' && !d.is_completed)
    .reduce((s, d) => s + Number(d.total_amount) - Number(d.paid_amount), 0)
  const netPosition = totalMyReceivable - totalMyDebt

  const filteredContacts = contacts.filter(c =>
    c.name.toLowerCase().includes(searchContact.toLowerCase())
  )

  const selectedSummary = selectedContact
    ? contactSummaries.find(s => s.contact.id === selectedContact.id)
    : null

  // ── Sub-components ────────────────────────────────────────
  function DebtRow({ d }: { d: Debt }) {
    const remaining = Number(d.total_amount) - Number(d.paid_amount)
    const pct = Math.min((Number(d.paid_amount) / Number(d.total_amount)) * 100, 100)
    const isOverdue = d.due_date && new Date(d.due_date) < new Date() && !d.is_completed

    return (
      <div className={`card p-4 ${d.is_completed ? 'opacity-50' : ''}`}>
        <div className="flex items-start gap-3 mb-3">
          <button
            onClick={(e) => toggleComplete(d, e)}
            className={`w-6 h-6 rounded-md border-2 flex items-center justify-center text-xs mt-0.5 flex-shrink-0 transition-all ${d.is_completed ? 'bg-green-500 border-green-500 text-white' : 'border-surface-300 hover:border-brand-500'}`}
          >
            {d.is_completed && '✓'}
          </button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center flex-wrap gap-1.5 mb-0.5">
              <span className={`text-xs font-bold px-2 py-0.5 rounded-lg ${d.type === 'debt' ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                {d.type === 'debt' ? '↑ Hutang' : '↓ Piutang'}
              </span>
              {isOverdue && <span className="badge bg-orange-100 text-orange-700 text-[10px]">Jatuh Tempo</span>}
              {d.wallets && (
                <span className="text-[10px] bg-surface-100 text-surface-500 px-2 py-0.5 rounded-lg">
                  {d.wallets.icon || '💳'} {d.wallets.name}
                </span>
              )}
            </div>
            {d.description && <p className="text-sm font-semibold text-surface-800">{d.description}</p>}
            {d.due_date && <p className="text-[10px] text-surface-400">{formatDate(d.due_date)}</p>}
          </div>
          <div className="text-right flex-shrink-0">
            <p className={`text-sm font-bold font-mono ${d.type === 'debt' ? 'text-red-500' : 'text-green-600'}`}>
              {formatShort(remaining)}
            </p>
            <p className="text-[10px] text-surface-400">dari {formatShort(Number(d.total_amount))}</p>
          </div>
        </div>

        {/* Progress */}
        {Number(d.paid_amount) > 0 && (
          <div className="mb-3">
            <div className="progress-bar mb-1">
              <div className="progress-fill" style={{ width: `${pct}%`, background: d.type === 'debt' ? '#ef4444' : '#22c55e' }} />
            </div>
            <p className="text-[10px] text-surface-400">Dibayar {formatShort(Number(d.paid_amount))}</p>
          </div>
        )}

        {/* Actions */}
        {!d.is_completed && (
          <div className="flex gap-2">
            <button onClick={(e) => openPay(d, e)} className="btn btn-secondary text-xs flex-1 py-2">
              💸 Catat Bayar
            </button>
            <button onClick={(e) => openEditDebt(d, e)} className="btn btn-secondary text-xs w-11 p-0">✏️</button>
            <button onClick={(e) => deleteDebt(d.id, e)} className="btn btn-secondary text-xs w-11 p-0 hover:bg-red-50 hover:text-red-600">✕</button>
          </div>
        )}
        {d.is_completed && (
          <button onClick={(e) => deleteDebt(d.id, e)} className="btn btn-secondary text-xs w-full py-2 text-surface-400">Hapus catatan</button>
        )}
      </div>
    )
  }

  function ContactCard({ summary }: { summary: ContactSummary }) {
    const { contact, net, totalDebt, totalReceivable } = summary
    const hasDebt = totalDebt > 0 || totalReceivable > 0
    const netColor = net > 0 ? 'text-green-600' : net < 0 ? 'text-red-500' : 'text-surface-500'
    const netBg = net > 0 ? 'bg-green-50 border-green-200' : net < 0 ? 'bg-red-50 border-red-200' : 'bg-surface-50 border-surface-200'

    return (
      <div
        className="card p-4 active:scale-[0.98] transition-transform cursor-pointer"
        onClick={() => { setSelectedContact(contact); setShowContactDetail(true) }}
      >
        <div className="flex items-center gap-3">
          <Avatar name={contact.name} color={contact.avatar_color} />
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-surface-800 truncate">{contact.name}</p>
            {contact.phone && <p className="text-[10px] text-surface-400">{contact.phone}</p>}
            {!hasDebt && <p className="text-[10px] text-surface-300">Belum ada catatan</p>}
          </div>
          {hasDebt && (
            <div className={`text-right border rounded-xl px-3 py-2 ${netBg}`}>
              <p className="text-[10px] font-bold text-surface-400 mb-0.5">Net</p>
              <p className={`text-sm font-bold font-mono ${netColor}`}>
                {net > 0 ? '+' : ''}{formatShort(net)}
              </p>
            </div>
          )}
          <button
            onClick={(e) => openEditContact(contact, e)}
            className="w-8 h-8 rounded-lg hover:bg-surface-100 flex items-center justify-center text-surface-400 flex-shrink-0"
          >
            ✏️
          </button>
        </div>

        {hasDebt && (
          <div className="flex gap-3 mt-3 pt-3 border-t border-surface-100">
            {totalDebt > 0 && (
              <div className="flex-1">
                <p className="text-[10px] text-surface-400 mb-0.5">Hutang saya</p>
                <p className="text-xs font-bold font-mono text-red-500">-{formatShort(totalDebt)}</p>
              </div>
            )}
            {totalReceivable > 0 && (
              <div className="flex-1">
                <p className="text-[10px] text-surface-400 mb-0.5">Piutang saya</p>
                <p className="text-xs font-bold font-mono text-green-600">+{formatShort(totalReceivable)}</p>
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <AppShell>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-extrabold text-surface-900">Utang & Piutang</h1>
          <p className={`text-sm font-semibold ${netPosition >= 0 ? 'text-green-600' : 'text-red-500'}`}>
            Net: {netPosition >= 0 ? '+' : ''}{formatCurrency(netPosition)}
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={openAddContact} className="btn btn-secondary py-2.5 px-3 text-sm">👤 Kontak</button>
          <button onClick={() => openAddDebt()} className="btn btn-primary py-2.5 px-3 text-sm">+ Catat</button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-2 sm:gap-4 mb-4">
        <div className="card p-3 sm:p-4">
          <p className="text-[10px] font-bold text-red-500 uppercase mb-1">Hutang Saya</p>
          <p className="text-base sm:text-xl font-extrabold text-red-500 font-mono">{formatShort(totalMyDebt)}</p>
        </div>
        <div className="card p-3 sm:p-4">
          <p className="text-[10px] font-bold text-green-600 uppercase mb-1">Piutang Saya</p>
          <p className="text-base sm:text-xl font-extrabold text-green-600 font-mono">{formatShort(totalMyReceivable)}</p>
        </div>
        <div className={`card p-3 sm:p-4 ${netPosition >= 0 ? 'bg-green-50/50' : 'bg-red-50/50'}`}>
          <p className="text-[10px] font-bold text-surface-400 uppercase mb-1">Posisi Bersih</p>
          <p className={`text-base sm:text-xl font-extrabold font-mono ${netPosition >= 0 ? 'text-green-600' : 'text-red-500'}`}>
            {netPosition >= 0 ? '+' : ''}{formatShort(netPosition)}
          </p>
        </div>
      </div>

      {/* Tab */}
      <div className="flex gap-2 mb-4">
        <button onClick={() => setTab('contacts')} className={`btn flex-1 text-sm ${tab === 'contacts' ? 'btn-primary' : 'btn-secondary'}`}>
          👥 Per Orang
        </button>
        <button onClick={() => setTab('all')} className={`btn flex-1 text-sm ${tab === 'all' ? 'btn-primary' : 'btn-secondary'}`}>
          📋 Semua
        </button>
      </div>

      {/* ── Tab: Per Contact ── */}
      {tab === 'contacts' && (
        <>
          {contacts.length > 4 && (
            <div className="mb-3">
              <input className="input text-sm" placeholder="🔍 Cari kontak..." value={searchContact} onChange={e => setSearchContact(e.target.value)} />
            </div>
          )}

          {filteredContacts.length === 0 && (
            <div className="card text-center py-16 text-surface-300">
              <p className="text-4xl mb-2">👥</p>
              <p className="text-sm font-semibold text-surface-500">Belum ada kontak</p>
              <p className="text-xs mt-1 mb-4">Tambah kontak dulu, lalu catat utang/piutang ke orang tersebut.</p>
              <button onClick={openAddContact} className="btn btn-primary text-sm">+ Tambah Kontak</button>
            </div>
          )}

          <div className="space-y-3">
            {filteredContacts.map(contact => {
              const summary = contactSummaries.find(s => s.contact.id === contact.id)
              if (!summary) {
                return (
                  <div key={contact.id} className="card p-4 flex items-center gap-3 active:scale-[0.98] transition-transform cursor-pointer"
                    onClick={() => { setSelectedContact(contact); setShowContactDetail(true) }}>
                    <Avatar name={contact.name} color={contact.avatar_color} />
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-surface-800">{contact.name}</p>
                      {contact.phone && <p className="text-[10px] text-surface-400">{contact.phone}</p>}
                      <p className="text-[10px] text-surface-300">Belum ada catatan</p>
                    </div>
                    <button onClick={e => openEditContact(contact, e)} className="w-8 h-8 rounded-lg hover:bg-surface-100 flex items-center justify-center text-surface-400">✏️</button>
                  </div>
                )
              }
              return <ContactCard key={contact.id} summary={summary} />
            })}
          </div>

          {ungroupedDebts.length > 0 && (
            <div className="mt-6">
              <p className="text-xs font-bold text-surface-400 uppercase tracking-wider mb-3">📝 Tanpa Kontak</p>
              <div className="space-y-3">
                {ungroupedDebts.map(d => (
                  <div key={d.id} className="card p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-8 h-8 rounded-full bg-surface-100 flex items-center justify-center text-sm">?</div>
                      <p className="font-semibold text-surface-700">{d.person_name}</p>
                    </div>
                    <DebtRow d={d} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Tab: All Debts ── */}
      {tab === 'all' && (
        <div>
          {(() => {
            const active = debts.filter(d => !d.is_completed)
            const completed = debts.filter(d => d.is_completed)
            return (
              <>
                {active.length === 0 && completed.length === 0 && (
                  <div className="card text-center py-16 text-surface-300">
                    <p className="text-4xl mb-2">🤝</p>
                    <p className="text-sm">Belum ada catatan utang/piutang</p>
                  </div>
                )}
                {active.length > 0 && (
                  <div className="space-y-3 mb-4">
                    {active.map(d => (
                      <div key={d.id}>
                        {d.contacts && (
                          <div className="flex items-center gap-2 mb-1.5 px-1">
                            <Avatar name={d.contacts.name} color={d.contacts.avatar_color} size="sm" />
                            <span className="text-xs font-semibold text-surface-500">{d.contacts.name}</span>
                          </div>
                        )}
                        {!d.contacts && d.person_name && (
                          <p className="text-xs text-surface-400 mb-1.5 px-1">👤 {d.person_name}</p>
                        )}
                        <DebtRow d={d} />
                      </div>
                    ))}
                  </div>
                )}
                {completed.length > 0 && (
                  <div>
                    <p className="text-xs font-bold text-surface-400 uppercase tracking-wider mb-3">✅ Selesai ({completed.length})</p>
                    <div className="space-y-3">
                      {completed.map(d => <DebtRow key={d.id} d={d} />)}
                    </div>
                  </div>
                )}
              </>
            )
          })()}
        </div>
      )}

      {/* ── Contact Detail Modal ── */}
      <Modal open={showContactDetail} onClose={() => { setShowContactDetail(false); setSelectedContact(null) }}
        title={selectedContact?.name || ''}>
        {selectedContact && selectedSummary && (
          <div>
            <div className="flex items-center gap-4 mb-5 p-4 bg-surface-50 rounded-2xl">
              <Avatar name={selectedContact.name} color={selectedContact.avatar_color} size="lg" />
              <div className="flex-1 min-w-0">
                <p className="font-bold text-surface-900 text-lg">{selectedContact.name}</p>
                {selectedContact.phone && <p className="text-sm text-surface-500">📞 {selectedContact.phone}</p>}
                {selectedContact.note && <p className="text-xs text-surface-400 mt-0.5">{selectedContact.note}</p>}
              </div>
            </div>

            <div className={`p-4 rounded-2xl border mb-5 ${selectedSummary.net > 0 ? 'bg-green-50 border-green-200' : selectedSummary.net < 0 ? 'bg-red-50 border-red-200' : 'bg-surface-50 border-surface-200'}`}>
              <p className="text-xs font-bold text-surface-500 uppercase mb-1">Posisi Net dengan {selectedContact.name}</p>
              <p className={`text-3xl font-extrabold font-mono ${selectedSummary.net > 0 ? 'text-green-600' : selectedSummary.net < 0 ? 'text-red-500' : 'text-surface-500'}`}>
                {selectedSummary.net > 0 ? '+' : ''}{formatCurrency(selectedSummary.net)}
              </p>
              <p className="text-xs text-surface-500 mt-1">
                {selectedSummary.net > 0
                  ? `${selectedContact.name} masih hutang ke kamu`
                  : selectedSummary.net < 0
                  ? `Kamu masih hutang ke ${selectedContact.name}`
                  : 'Tidak ada saldo tersisa'}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-5">
              <div className="card p-3">
                <p className="text-[10px] font-bold text-red-500 uppercase mb-1">Hutang Saya</p>
                <p className="text-lg font-bold text-red-500 font-mono">{formatShort(selectedSummary.totalDebt)}</p>
                <p className="text-[10px] text-surface-400">{selectedSummary.debts.length} catatan</p>
              </div>
              <div className="card p-3">
                <p className="text-[10px] font-bold text-green-600 uppercase mb-1">Piutang Saya</p>
                <p className="text-lg font-bold text-green-600 font-mono">{formatShort(selectedSummary.totalReceivable)}</p>
                <p className="text-[10px] text-surface-400">{selectedSummary.receivables.length} catatan</p>
              </div>
            </div>

            <div className="flex gap-2 mb-5">
              <button onClick={() => { setShowContactDetail(false); openAddDebt(selectedContact.id, 'debt') }}
                className="btn flex-1 bg-red-50 text-red-700 border border-red-200 text-sm">
                + Catat Hutang
              </button>
              <button onClick={() => { setShowContactDetail(false); openAddDebt(selectedContact.id, 'receivable') }}
                className="btn flex-1 bg-green-50 text-green-700 border border-green-200 text-sm">
                + Catat Piutang
              </button>
            </div>

            {(() => {
              const allContactDebts = debts.filter(d => d.contact_id === selectedContact.id)
              const active = allContactDebts.filter(d => !d.is_completed)
              const done = allContactDebts.filter(d => d.is_completed)
              return (
                <div className="space-y-3">
                  {active.length === 0 && done.length === 0 && (
                    <p className="text-center py-6 text-surface-300 text-sm">Belum ada catatan</p>
                  )}
                  {active.map(d => <DebtRow key={d.id} d={d} />)}
                  {done.length > 0 && (
                    <div>
                      <p className="text-xs font-bold text-surface-400 uppercase mb-2">Selesai</p>
                      {done.map(d => <DebtRow key={d.id} d={d} />)}
                    </div>
                  )}
                </div>
              )
            })()}

            <button onClick={() => { deleteContact(selectedContact.id); setShowContactDetail(false) }}
              className="btn btn-ghost w-full text-red-400 text-xs mt-4">
              Hapus kontak ini
            </button>
          </div>
        )}
        {selectedContact && !selectedSummary && (
          <div className="text-center py-8">
            <Avatar name={selectedContact.name} color={selectedContact.avatar_color} size="lg" />
            <p className="font-bold text-surface-900 mt-3">{selectedContact.name}</p>
            <p className="text-sm text-surface-400 mt-1 mb-5">Belum ada catatan utang/piutang</p>
            <div className="flex gap-2">
              <button onClick={() => { setShowContactDetail(false); openAddDebt(selectedContact.id, 'debt') }}
                className="btn flex-1 bg-red-50 text-red-700 border border-red-200 text-sm">+ Catat Hutang</button>
              <button onClick={() => { setShowContactDetail(false); openAddDebt(selectedContact.id, 'receivable') }}
                className="btn flex-1 bg-green-50 text-green-700 border border-green-200 text-sm">+ Catat Piutang</button>
            </div>
            <button onClick={() => { deleteContact(selectedContact.id); setShowContactDetail(false) }}
              className="btn btn-ghost w-full text-red-400 text-xs mt-3">Hapus kontak ini</button>
          </div>
        )}
      </Modal>

      {/* ── Add/Edit Debt Modal ── */}
      <Modal open={showDebtModal} onClose={() => { setShowDebtModal(false); setEditingDebt(null) }}
        title={editingDebt ? 'Edit Catatan' : 'Catat Utang/Piutang'}>
        <div className="space-y-4">
          <div>
            <label className="label">Tipe</label>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setDebtForm({ ...debtForm, type: 'debt' })}
                className={`btn ${debtForm.type === 'debt' ? 'bg-red-50 text-red-700 border border-red-200' : 'btn-secondary'}`}>
                💸 Hutang Saya
              </button>
              <button onClick={() => setDebtForm({ ...debtForm, type: 'receivable' })}
                className={`btn ${debtForm.type === 'receivable' ? 'bg-green-50 text-green-700 border border-green-200' : 'btn-secondary'}`}>
                💰 Piutang Saya
              </button>
            </div>
          </div>

          {/* Contact selector */}
          <div>
            <label className="label">Orang</label>
            {contacts.length > 0 ? (
              <>
                <select className="input mb-2" value={debtForm.contact_id}
                  onChange={e => setDebtForm({ ...debtForm, contact_id: e.target.value, new_contact_name: '' })}>
                  <option value="">-- Pilih kontak --</option>
                  {contacts.map(c => <option key={c.id} value={c.id}>{initials(c.name)} {c.name}</option>)}
                </select>
                {!debtForm.contact_id && (
                  <div>
                    <p className="text-xs text-surface-400 mb-1.5">atau ketik nama baru:</p>
                    <input className="input text-sm" placeholder="Nama orang baru..." value={debtForm.new_contact_name}
                      onChange={e => setDebtForm({ ...debtForm, new_contact_name: e.target.value })} />
                    {debtForm.new_contact_name.trim() && (
                      <p className="text-[10px] text-brand-600 mt-1">✓ Kontak baru akan otomatis dibuat</p>
                    )}
                  </div>
                )}
              </>
            ) : (
              <div>
                <input className="input" placeholder="Nama orang..." value={debtForm.new_contact_name}
                  onChange={e => setDebtForm({ ...debtForm, new_contact_name: e.target.value })} />
                <p className="text-[10px] text-brand-600 mt-1">Kontak baru akan otomatis dibuat</p>
              </div>
            )}
          </div>

          <div>
            <label className="label">Jumlah Total</label>
            <input className="input text-xl font-bold" type="number" inputMode="numeric" placeholder="0"
              value={debtForm.total_amount} onChange={e => setDebtForm({ ...debtForm, total_amount: e.target.value })} />
          </div>

          {/* Wallet selector */}
          <div>
            <label className="label">Dari/Ke Wallet <span className="text-surface-400 font-normal">(opsional)</span></label>
            <select className="input" value={debtForm.wallet_id}
              onChange={e => setDebtForm({ ...debtForm, wallet_id: e.target.value })}>
              <option value="">-- Tidak terhubung wallet --</option>
              {wallets.map(w => (
                <option key={w.id} value={w.id}>{w.icon || '💳'} {w.name}</option>
              ))}
            </select>
            {debtForm.wallet_id && !editingDebt && (
              <p className={`text-[10px] mt-1.5 font-semibold ${debtForm.type === 'receivable' ? 'text-red-500' : 'text-green-600'}`}>
                {debtForm.type === 'receivable'
                  ? '⚠️ Saldo wallet akan berkurang (kamu bayarin dulu)'
                  : '✅ Saldo wallet akan bertambah (kamu terima uang)'}
              </p>
            )}
          </div>

          <div>
            <label className="label">Sudah Dibayar</label>
            <input className="input" type="number" inputMode="numeric" placeholder="0"
              value={debtForm.paid_amount} onChange={e => setDebtForm({ ...debtForm, paid_amount: e.target.value })} />
          </div>
          <div>
            <label className="label">Keterangan</label>
            <input className="input" placeholder="mis. Patungan makan, Pinjam uang cash" value={debtForm.description}
              onChange={e => setDebtForm({ ...debtForm, description: e.target.value })} />
          </div>
          <div>
            <label className="label">Jatuh Tempo (opsional)</label>
            <input className="input" type="date" value={debtForm.due_date}
              onChange={e => setDebtForm({ ...debtForm, due_date: e.target.value })} />
          </div>
          <div className="flex gap-2 pt-1">
            {editingDebt && (
              <button onClick={() => { deleteDebt(editingDebt.id); setShowDebtModal(false) }} className="btn btn-danger flex-1">Hapus</button>
            )}
            <button onClick={saveDebt} className="btn btn-primary flex-1">{editingDebt ? 'Simpan' : 'Catat'}</button>
          </div>
        </div>
      </Modal>

      {/* ── Add/Edit Contact Modal ── */}
      <Modal open={showContactModal} onClose={() => { setShowContactModal(false); setEditingContact(null) }}
        title={editingContact ? 'Edit Kontak' : 'Tambah Kontak'}>
        <div className="space-y-4">
          <div className="flex justify-center">
            <Avatar name={contactForm.name || '?'} color={contactForm.avatar_color} size="lg" />
          </div>
          <div>
            <label className="label">Nama</label>
            <input className="input" placeholder="mis. Budi Santoso" value={contactForm.name}
              onChange={e => setContactForm({ ...contactForm, name: e.target.value })} />
          </div>
          <div>
            <label className="label">No. HP (opsional)</label>
            <input className="input" type="tel" placeholder="08xxxxxxxxxx" value={contactForm.phone}
              onChange={e => setContactForm({ ...contactForm, phone: e.target.value })} />
          </div>
          <div>
            <label className="label">Catatan (opsional)</label>
            <input className="input" placeholder="mis. Teman kantor, Saudara" value={contactForm.note}
              onChange={e => setContactForm({ ...contactForm, note: e.target.value })} />
          </div>
          <div>
            <label className="label">Warna Avatar</label>
            <div className="flex flex-wrap gap-2">
              {AVATAR_COLORS.map(c => (
                <button key={c} onClick={() => setContactForm({ ...contactForm, avatar_color: c })}
                  className="w-9 h-9 rounded-full border-4 transition-all"
                  style={{ background: c, borderColor: contactForm.avatar_color === c ? '#fff' : 'transparent', boxShadow: contactForm.avatar_color === c ? `0 0 0 2px ${c}` : 'none' }} />
              ))}
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            {editingContact && (
              <button onClick={() => { deleteContact(editingContact.id); setShowContactModal(false) }} className="btn btn-danger flex-1">Hapus</button>
            )}
            <button onClick={saveContact} className="btn btn-primary flex-1">{editingContact ? 'Simpan' : 'Tambah'}</button>
          </div>
        </div>
      </Modal>

      {/* ── Quick Pay Modal ── */}
      <Modal open={showPayModal} onClose={() => { setShowPayModal(false); setPayingDebt(null) }} title="Catat Pembayaran">
        {payingDebt && (
          <div className="space-y-4">
            <div className={`p-4 rounded-2xl ${payingDebt.type === 'debt' ? 'bg-red-50' : 'bg-green-50'}`}>
              <p className="text-xs text-surface-500 mb-1">{payingDebt.type === 'debt' ? 'Hutang saya' : 'Piutang saya'}</p>
              <p className="text-sm font-semibold text-surface-800">{payingDebt.description || payingDebt.person_name}</p>
              <div className="flex justify-between text-xs mt-2">
                <span className="text-surface-500">Sisa: <span className="font-bold font-mono">{formatCurrency(Number(payingDebt.total_amount) - Number(payingDebt.paid_amount))}</span></span>
                <span className="text-surface-500">Total: <span className="font-mono">{formatCurrency(Number(payingDebt.total_amount))}</span></span>
              </div>
            </div>

            <div>
              <label className="label">Jumlah Bayar</label>
              <input className="input text-xl font-bold" type="number" inputMode="numeric" placeholder="0"
                value={payAmount} onChange={e => setPayAmount(e.target.value)} autoFocus />
            </div>

            {/* Quick fill buttons */}
            <div className="flex gap-2">
              {[25, 50, 100].map(pct => {
                const rem = Number(payingDebt.total_amount) - Number(payingDebt.paid_amount)
                const amt = Math.round(rem * pct / 100)
                return (
                  <button key={pct} onClick={() => setPayAmount(String(amt))} className="btn btn-secondary text-xs flex-1 py-2">
                    {pct === 100 ? 'Lunas' : `${pct}%`}
                    <span className="text-[10px] block text-surface-400">{formatShort(amt)}</span>
                  </button>
                )
              })}
            </div>

            {/* Wallet selector untuk pembayaran */}
            <div>
              <label className="label">Dari Wallet <span className="text-surface-400 font-normal">(opsional)</span></label>
              <select className="input" value={payWalletId} onChange={e => setPayWalletId(e.target.value)}>
                <option value="">-- Tidak adjust wallet --</option>
                {wallets.map(w => (
                  <option key={w.id} value={w.id}>{w.icon || '💳'} {w.name}</option>
                ))}
              </select>
              {payWalletId && (
                <p className={`text-[10px] mt-1.5 font-semibold ${payingDebt.type === 'debt' ? 'text-red-500' : 'text-green-600'}`}>
                  {payingDebt.type === 'debt'
                    ? '⚠️ Saldo wallet akan berkurang (kamu bayar hutang)'
                    : '✅ Saldo wallet akan bertambah (kamu terima piutang)'}
                </p>
              )}
            </div>

            <button onClick={submitPay} className="btn btn-primary w-full">Simpan Pembayaran</button>
          </div>
        )}
      </Modal>
    </AppShell>
  )
}
