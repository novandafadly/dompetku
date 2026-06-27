'use client'

import { useEffect, useState, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import type { Category } from '@/lib/supabase'
import AppShell from '@/components/AppShell'
import Modal from '@/components/Modal'
import { toast } from '@/components/Toast'

const EMOJI_OPTIONS = [
  '🍔','🍕','🚗','🏠','💊','👕','📱','🎮','✈️','🎬','📚','💡','🛒',
  '☕','🍜','🚌','⚕️','💰','📈','🎁','💳','🏋️','🐶','🌿','🎵','⚽',
  '🏦','💼','🧾','🔧','🏥','💅','🎓','🍱','🛵','🏖️','🎂','🛍️','💸','💹',
  '🍳','🍡','⛽','🚕','🅿️','🏍️','⚡','💧','📡','📶','📱','🤖','🎨',
  '🏃','📷','🎯','💌','💍','🤝','🕌','📖','💼','📊','₿','🥇','⚖️',
  '🎡','🛕','🏄','🌊','🎪','🎠','💑','🌹','🍽️','🎑',
]

const COLOR_OPTIONS = [
  '#ef4444','#f97316','#eab308','#22c55e','#14b8a6','#3b82f6','#8b5cf6','#ec4899',
  '#64748b','#0f172a','#f43f5e','#06b6d4','#a16207','#15803d','#1d4ed8','#7c3aed',
]

type CategoryWithSubs = Category & { subcategories?: Category[] }

type CategoryForm = {
  name: string
  type: 'income' | 'expense'
  icon: string
  color: string
  parent_id: string // '' = parent category
}

const emptyForm: CategoryForm = { name: '', type: 'expense', icon: '📦', color: '#64748b', parent_id: '' }

export default function CategoriesPage() {
  const [categories, setCategories] = useState<Category[]>([])
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<Category | null>(null)
  const [form, setForm] = useState<CategoryForm>(emptyForm)
  const [tab, setTab] = useState<'expense' | 'income'>('expense')
  const [expandedParents, setExpandedParents] = useState<Set<string>>(new Set())

  useEffect(() => { load() }, [])

  async function load() {
    const { data } = await supabase
      .from('categories')
      .select('*')
      .order('is_default', { ascending: false })
      .order('name')
    setCategories(data || [])
  }

  // Build tree: parents with nested subcategories
  const tree = useMemo((): CategoryWithSubs[] => {
    const filtered = categories.filter(c => c.type === tab)
    const parents = filtered.filter(c => !(c as any).parent_id)
    return parents.map(p => ({
      ...p,
      subcategories: filtered.filter(c => (c as any).parent_id === p.id),
    }))
  }, [categories, tab])

  const parentOptions = useMemo(() =>
    categories.filter(c => c.type === form.type && !(c as any).parent_id),
    [categories, form.type]
  )

  function toggleExpand(id: string) {
    setExpandedParents(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function openAdd(parentId?: string) {
    setEditing(null)
    setForm({
      ...emptyForm,
      type: tab,
      parent_id: parentId || '',
    })
    setShowModal(true)
  }

  function openEdit(c: Category) {
    setEditing(c)
    setForm({
      name: c.name,
      type: c.type as 'income' | 'expense',
      icon: c.icon || '📦',
      color: c.color || '#64748b',
      parent_id: (c as any).parent_id || '',
    })
    setShowModal(true)
  }

  async function saveCategory() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return
    if (!form.name.trim()) { toast('Nama kategori wajib diisi!', '⚠️'); return }

    const payload: any = {
      name: form.name,
      icon: form.icon,
      color: form.color,
      parent_id: form.parent_id || null,
    }

    if (editing) {
      const { error } = await supabase.from('categories').update(payload).eq('id', editing.id)
      if (error) { toast(error.message, '❌'); return }
      toast('Kategori diperbarui!', '✅')
    } else {
      const { error } = await supabase.from('categories').insert({
        ...payload,
        user_id: session.user.id,
        type: form.type,
        is_default: false,
      })
      if (error) { toast(error.message, '❌'); return }
      toast('Kategori ditambahkan!', '🏷️')
      // Auto-expand parent
      if (form.parent_id) {
        setExpandedParents(prev => new Set(Array.from(prev).concat(form.parent_id)))
      }
    }
    setShowModal(false)
    setEditing(null)
    setForm(emptyForm)
    load()
  }

  async function deleteCategory(c: Category) {
    const hasSubs = (c as CategoryWithSubs).subcategories?.length ?? 0
    if (hasSubs > 0) {
      toast('Hapus semua subkategori dulu sebelum hapus kategori ini', '⚠️'); return
    }
    if (!confirm('Hapus kategori ini? Transaksi terkait tidak ikut terhapus.')) return
    const { error } = await supabase.from('categories').delete().eq('id', c.id)
    if (error) { toast('Gagal hapus — kategori mungkin masih dipakai transaksi', '❌'); return }
    toast('Kategori dihapus', '🗑️')
    load()
  }

  const totalParents = tree.length
  const totalSubs = tree.reduce((s, p) => s + (p.subcategories?.length || 0), 0)

  return (
    <AppShell>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-extrabold text-surface-900">Kategori</h1>
          <p className="text-sm text-surface-400">{totalParents} kategori · {totalSubs} subkategori</p>
        </div>
        <button onClick={() => openAdd()} className="btn btn-primary">+ Tambah</button>
      </div>

      {/* Tab */}
      <div className="flex gap-2 mb-6">
        <button onClick={() => setTab('expense')} className={`btn ${tab === 'expense' ? 'btn-primary' : 'btn-secondary'}`}>💸 Pengeluaran</button>
        <button onClick={() => setTab('income')} className={`btn ${tab === 'income' ? 'btn-primary' : 'btn-secondary'}`}>💰 Pemasukan</button>
      </div>

      {/* Category Tree */}
      <div className="space-y-2">
        {tree.map((parent) => {
          const isExpanded = expandedParents.has(parent.id)
          const subCount = parent.subcategories?.length || 0
          return (
            <div key={parent.id} className="card overflow-hidden">
              {/* Parent Row */}
              <div className="flex items-center gap-3 p-4 group">
                {/* Expand toggle */}
                <button
                  onClick={() => toggleExpand(parent.id)}
                  className="w-6 h-6 flex items-center justify-center text-surface-400 hover:text-surface-700 flex-shrink-0 transition-colors"
                >
                  {subCount > 0 ? (
                    <span className="text-xs font-bold">{isExpanded ? '▾' : '▸'}</span>
                  ) : (
                    <span className="text-xs text-surface-200">—</span>
                  )}
                </button>

                <div className="w-10 h-10 rounded-xl flex items-center justify-center text-lg flex-shrink-0" style={{ background: (parent.color || '#64748b') + '22' }}>
                  {parent.icon}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-surface-800">{parent.name}</p>
                    {parent.is_default && <span className="text-[10px] font-bold text-brand-500 uppercase tracking-wider bg-brand-50 px-1.5 py-0.5 rounded-full">Default</span>}
                  </div>
                  <p className="text-xs text-surface-400">{subCount} subkategori</p>
                </div>

                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => openAdd(parent.id)}
                    title="Tambah subkategori"
                    className="w-7 h-7 rounded-lg hover:bg-green-50 text-surface-400 hover:text-green-600 flex items-center justify-center text-xs transition-colors"
                  >+sub</button>
                  <button onClick={() => openEdit(parent)} className="w-7 h-7 rounded-lg hover:bg-brand-50 text-surface-400 hover:text-brand-600 flex items-center justify-center text-xs transition-colors">✏️</button>
                  {!parent.is_default && (
                    <button onClick={() => deleteCategory(parent)} className="w-7 h-7 rounded-lg hover:bg-red-50 text-surface-400 hover:text-red-500 flex items-center justify-center text-xs transition-colors">✕</button>
                  )}
                </div>
              </div>

              {/* Subcategories — expandable */}
              {isExpanded && subCount > 0 && (
                <div className="border-t border-surface-100 bg-surface-50">
                  {parent.subcategories!.map((sub, i) => (
                    <div
                      key={sub.id}
                      className={`flex items-center gap-3 px-4 py-3 group/sub ${i < subCount - 1 ? 'border-b border-surface-100' : ''}`}
                    >
                      {/* Tree line indent */}
                      <div className="w-6 flex-shrink-0 flex items-center justify-center">
                        <div className="w-3 h-3 border-l-2 border-b-2 border-surface-200 rounded-bl-sm" />
                      </div>

                      <div className="w-8 h-8 rounded-lg flex items-center justify-center text-base flex-shrink-0" style={{ background: (sub.color || '#64748b') + '22' }}>
                        {sub.icon}
                      </div>

                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-surface-700">{sub.name}</p>
                      </div>

                      <div className="flex items-center gap-1 opacity-0 group-hover/sub:opacity-100 transition-opacity">
                        <button onClick={() => openEdit(sub)} className="w-6 h-6 rounded-lg hover:bg-brand-50 text-surface-400 hover:text-brand-600 flex items-center justify-center text-xs transition-colors">✏️</button>
                        <button onClick={() => deleteCategory(sub)} className="w-6 h-6 rounded-lg hover:bg-red-50 text-surface-400 hover:text-red-500 flex items-center justify-center text-xs transition-colors">✕</button>
                      </div>
                    </div>
                  ))}
                  {/* Add subcategory shortcut */}
                  <button
                    onClick={() => openAdd(parent.id)}
                    className="w-full px-4 py-2.5 flex items-center gap-3 text-sm text-surface-400 hover:text-brand-600 hover:bg-brand-50 transition-colors"
                  >
                    <div className="w-6 flex-shrink-0" />
                    <span className="text-xs">+ Tambah subkategori</span>
                  </button>
                </div>
              )}

              {/* Collapsed hint */}
              {!isExpanded && subCount > 0 && (
                <button
                  onClick={() => toggleExpand(parent.id)}
                  className="w-full px-4 py-2 border-t border-surface-100 bg-surface-50 text-xs text-surface-400 hover:text-brand-600 hover:bg-brand-50 transition-colors text-left"
                >
                  {parent.subcategories!.map(s => s.icon).slice(0, 6).join(' ')} {subCount > 6 ? `+${subCount - 6} lainnya` : ''}
                  <span className="ml-1">· klik untuk lihat</span>
                </button>
              )}
            </div>
          )
        })}

        {tree.length === 0 && (
          <div className="card text-center py-12 text-surface-300">
            <p className="text-4xl mb-2">🏷️</p>
            <p className="text-sm">Belum ada kategori {tab === 'expense' ? 'pengeluaran' : 'pemasukan'}</p>
          </div>
        )}
      </div>

      {/* Add/Edit Modal */}
      <Modal open={showModal} onClose={() => { setShowModal(false); setEditing(null) }} title={editing ? 'Edit Kategori' : 'Tambah Kategori'}>
        <div className="space-y-4">
          {/* Tipe — hanya untuk tambah baru */}
          {!editing && (
            <div>
              <label className="label">Tipe</label>
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => setForm({ ...form, type: 'expense', parent_id: '' })} className={`btn ${form.type === 'expense' ? 'bg-red-50 text-red-700 border-red-200 border' : 'btn-secondary'}`}>💸 Pengeluaran</button>
                <button onClick={() => setForm({ ...form, type: 'income', parent_id: '' })} className={`btn ${form.type === 'income' ? 'bg-green-50 text-green-700 border-green-200 border' : 'btn-secondary'}`}>💰 Pemasukan</button>
              </div>
            </div>
          )}

          {/* Parent selector — hanya untuk tambah baru */}
          {!editing && (
            <div>
              <label className="label">Level</label>
              <div className="grid grid-cols-2 gap-2 mb-2">
                <button
                  onClick={() => setForm({ ...form, parent_id: '' })}
                  className={`btn text-sm ${!form.parent_id ? 'btn-primary' : 'btn-secondary'}`}
                >
                  📁 Kategori Utama
                </button>
                <button
                  onClick={() => setForm({ ...form, parent_id: parentOptions[0]?.id || '' })}
                  className={`btn text-sm ${form.parent_id ? 'btn-primary' : 'btn-secondary'}`}
                >
                  📂 Subkategori
                </button>
              </div>
              {form.parent_id && (
                <select
                  className="input"
                  value={form.parent_id}
                  onChange={e => setForm({ ...form, parent_id: e.target.value })}
                >
                  <option value="">— Pilih kategori induk —</option>
                  {parentOptions.map(p => (
                    <option key={p.id} value={p.id}>{p.icon} {p.name}</option>
                  ))}
                </select>
              )}
            </div>
          )}

          {/* Nama */}
          <div>
            <label className="label">Nama {form.parent_id ? 'Subkategori' : 'Kategori'}</label>
            <input
              className="input"
              placeholder={form.parent_id ? 'mis. Makan Siang, Ngopi...' : 'mis. Makanan, Transport...'}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>

          {/* Icon */}
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

          {/* Warna */}
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
            {editing && !(editing as any).is_default && (
              <button onClick={() => { deleteCategory(editing as CategoryWithSubs); setShowModal(false) }} className="btn btn-danger flex-1">Hapus</button>
            )}
            <button onClick={saveCategory} className="btn btn-primary flex-1">{editing ? 'Simpan Perubahan' : 'Simpan'}</button>
          </div>
        </div>
      </Modal>
    </AppShell>
  )
}
