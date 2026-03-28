'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Category } from '@/lib/supabase'
import AppShell from '@/components/AppShell'
import Modal from '@/components/Modal'
import { toast } from '@/components/Toast'

const EMOJI_OPTIONS = [
  '🍔','🍕','🚗','🏠','💊','👕','📱','🎮','✈️','🎬','📚','💡','🛒',
  '☕','🍜','🚌','⚕️','💰','📈','🎁','💳','🏋️','🐶','🌿','🎵','⚽',
  '🏦','💼','🧾','🔧','🏥','💅','🎓','🍱','🛵','🏖️','🎂','🛍️','💸','💹',
]

const COLOR_OPTIONS = [
  '#ef4444','#f97316','#eab308','#22c55e','#14b8a6','#3b82f6','#8b5cf6','#ec4899',
  '#64748b','#0f172a','#f43f5e','#06b6d4','#a16207','#15803d','#1d4ed8','#7c3aed',
]

type CategoryForm = {
  name: string
  type: 'income' | 'expense'
  icon: string
  color: string
}

const emptyForm: CategoryForm = { name: '', type: 'expense', icon: '📦', color: '#64748b' }

export default function CategoriesPage() {
  const [categories, setCategories] = useState<Category[]>([])
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<Category | null>(null)
  const [form, setForm] = useState<CategoryForm>(emptyForm)
  const [tab, setTab] = useState<'expense' | 'income'>('expense')

  useEffect(() => { load() }, [])

  async function load() {
    const { data } = await supabase.from('categories').select('*').order('is_default', { ascending: false }).order('name')
    setCategories(data || [])
  }

  function openAdd() {
    setEditing(null)
    setForm({ ...emptyForm, type: tab })
    setShowModal(true)
  }

  function openEdit(c: Category) {
    setEditing(c)
    setForm({ name: c.name, type: c.type as 'income' | 'expense', icon: c.icon || '📦', color: c.color || '#64748b' })
    setShowModal(true)
  }

  async function saveCategory() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return
    if (!form.name.trim()) { toast('Nama kategori wajib diisi!', '⚠️'); return }

    if (editing) {
      const { error } = await supabase.from('categories').update({ name: form.name, icon: form.icon, color: form.color }).eq('id', editing.id)
      if (error) { toast(error.message, '❌'); return }
      toast('Kategori diperbarui!', '✅')
    } else {
      const { error } = await supabase.from('categories').insert({
        user_id: session.user.id,
        name: form.name,
        type: form.type,
        icon: form.icon,
        color: form.color,
        is_default: false,
      })
      if (error) { toast(error.message, '❌'); return }
      toast('Kategori ditambahkan!', '🏷️')
    }
    setShowModal(false)
    setEditing(null)
    setForm(emptyForm)
    load()
  }

  async function deleteCategory(id: string) {
    if (!confirm('Hapus kategori ini? Transaksi terkait tidak ikut terhapus.')) return
    const { error } = await supabase.from('categories').delete().eq('id', id)
    if (error) { toast('Gagal hapus — kategori mungkin masih dipakai transaksi', '❌'); return }
    toast('Kategori dihapus', '🗑️')
    load()
  }

  const filtered = categories.filter(c => c.type === tab)

  return (
    <AppShell>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-extrabold text-surface-900">Kategori</h1>
          <p className="text-sm text-surface-400">{categories.length} kategori</p>
        </div>
        <button onClick={openAdd} className="btn btn-primary">+ Tambah</button>
      </div>

      {/* Tab */}
      <div className="flex gap-2 mb-6">
        <button onClick={() => setTab('expense')} className={`btn ${tab === 'expense' ? 'btn-primary' : 'btn-secondary'}`}>💸 Pengeluaran</button>
        <button onClick={() => setTab('income')} className={`btn ${tab === 'income' ? 'btn-primary' : 'btn-secondary'}`}>💰 Pemasukan</button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {filtered.map((c) => (
          <div key={c.id} className="card p-4 flex items-center gap-3 group">
            <div className="w-11 h-11 rounded-xl flex items-center justify-center text-xl flex-shrink-0" style={{ background: (c.color || '#64748b') + '22' }}>
              {c.icon}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-surface-800 truncate">{c.name}</p>
              {c.is_default && <span className="text-[10px] font-bold text-brand-500 uppercase tracking-wider">Default</span>}
            </div>
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button onClick={() => openEdit(c)} className="w-7 h-7 rounded-lg hover:bg-brand-50 text-surface-400 hover:text-brand-600 flex items-center justify-center text-xs transition-colors">✏️</button>
              {!c.is_default && (
                <button onClick={() => deleteCategory(c.id)} className="w-7 h-7 rounded-lg hover:bg-red-50 text-surface-400 hover:text-red-500 flex items-center justify-center text-xs transition-colors">✕</button>
              )}
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="col-span-full card text-center py-12 text-surface-300">
            <p className="text-4xl mb-2">🏷️</p>
            <p className="text-sm">Belum ada kategori {tab === 'expense' ? 'pengeluaran' : 'pemasukan'}</p>
          </div>
        )}
      </div>

      <Modal open={showModal} onClose={() => { setShowModal(false); setEditing(null) }} title={editing ? 'Edit Kategori' : 'Tambah Kategori'}>
        <div className="space-y-4">
          {!editing && (
            <div>
              <label className="label">Tipe</label>
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => setForm({ ...form, type: 'expense' })} className={`btn ${form.type === 'expense' ? 'bg-red-50 text-red-700 border-red-200 border' : 'btn-secondary'}`}>💸 Pengeluaran</button>
                <button onClick={() => setForm({ ...form, type: 'income' })} className={`btn ${form.type === 'income' ? 'bg-green-50 text-green-700 border-green-200 border' : 'btn-secondary'}`}>💰 Pemasukan</button>
              </div>
            </div>
          )}
          <div>
            <label className="label">Nama Kategori</label>
            <input className="input" placeholder="mis. Makan, Transport" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <label className="label">Icon</label>
            <div className="grid grid-cols-10 gap-1.5 p-3 bg-surface-50 rounded-xl max-h-36 overflow-y-auto">
              {EMOJI_OPTIONS.map(e => (
                <button
                  key={e}
                  onClick={() => setForm({ ...form, icon: e })}
                  className={`w-8 h-8 rounded-lg flex items-center justify-center text-lg transition-all ${form.icon === e ? 'bg-brand-100 ring-2 ring-brand-400' : 'hover:bg-surface-200'}`}
                >
                  {e}
                </button>
              ))}
            </div>
            <p className="text-xs text-surface-400 mt-1">Dipilih: {form.icon}</p>
          </div>
          <div>
            <label className="label">Warna</label>
            <div className="flex flex-wrap gap-2">
              {COLOR_OPTIONS.map(c => (
                <button
                  key={c}
                  onClick={() => setForm({ ...form, color: c })}
                  className="w-8 h-8 rounded-lg border-2 transition-all"
                  style={{ background: c, borderColor: form.color === c ? '#fff' : 'transparent', boxShadow: form.color === c ? `0 0 0 2px ${c}` : 'none' }}
                />
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            {editing && !editing.is_default && (
              <button onClick={() => { deleteCategory(editing.id); setShowModal(false) }} className="btn btn-danger flex-1">Hapus</button>
            )}
            <button onClick={saveCategory} className="btn btn-primary flex-1">{editing ? 'Simpan Perubahan' : 'Simpan'}</button>
          </div>
        </div>
      </Modal>
    </AppShell>
  )
}
