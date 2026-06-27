/**
 * CategoryPicker — 2-level category selector
 *
 * Usage:
 *   <CategoryPicker
 *     categories={categories}        // all Category[] from DB
 *     type="expense"                 // filter by type
 *     categoryId={form.category_id}
 *     subcategoryId={form.subcategory_id}
 *     onCategoryChange={(id) => setForm({...form, category_id: id, subcategory_id: ''})}
 *     onSubcategoryChange={(id) => setForm({...form, subcategory_id: id})}
 *   />
 *
 * Subcategory adalah WAJIB — tombol simpan di parent form harus cek subcategory_id tidak kosong.
 */

import type { Category } from '@/lib/supabase'

type Props = {
  categories: Category[]
  type?: 'income' | 'expense' | ''
  categoryId: string
  subcategoryId: string
  onCategoryChange: (id: string) => void
  onSubcategoryChange: (id: string) => void
  required?: boolean
}

export default function CategoryPicker({
  categories,
  type,
  categoryId,
  subcategoryId,
  onCategoryChange,
  onSubcategoryChange,
  required = true,
}: Props) {
  // Parents = categories with no parent_id
  const parents = categories.filter(c =>
    !(c as any).parent_id &&
    (!type || c.type === type)
  )

  // Subcategories of selected parent
  const subs = categories.filter(c =>
    (c as any).parent_id === categoryId
  )

  const selectedParent = parents.find(c => c.id === categoryId)
  const selectedSub = subs.find(c => c.id === subcategoryId)

  function handleParentChange(id: string) {
    onCategoryChange(id)
    onSubcategoryChange('') // reset sub when parent changes
  }

  return (
    <div className="space-y-2">
      {/* Step 1: Pilih kategori utama */}
      <div>
        <label className="label">Kategori</label>
        <select
          className="input"
          value={categoryId}
          onChange={e => handleParentChange(e.target.value)}
        >
          <option value="">— Pilih kategori —</option>
          {parents.map(p => (
            <option key={p.id} value={p.id}>
              {p.icon} {p.name}
            </option>
          ))}
        </select>
      </div>

      {/* Step 2: Pilih subkategori (muncul setelah pilih parent) */}
      {categoryId && subs.length > 0 && (
        <div>
          <label className="label">
            Subkategori
            {required && <span className="text-red-400 ml-1">*</span>}
          </label>
          <div className="grid grid-cols-2 gap-1.5 p-2 bg-surface-50 rounded-xl border border-surface-100">
            {subs.map(sub => (
              <button
                key={sub.id}
                type="button"
                onClick={() => onSubcategoryChange(sub.id)}
                className={`flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium transition-all text-left
                  ${subcategoryId === sub.id
                    ? 'text-white shadow-sm'
                    : 'bg-white text-surface-600 hover:bg-surface-100 border border-surface-100'
                  }`}
                style={subcategoryId === sub.id ? { background: selectedParent?.color || '#3b82f6' } : {}}
              >
                <span className="text-base flex-shrink-0">{sub.icon}</span>
                <span className="truncate leading-tight">{sub.name}</span>
              </button>
            ))}
          </div>
          {required && !subcategoryId && (
            <p className="text-xs text-red-400 mt-1">Pilih subkategori</p>
          )}
        </div>
      )}

      {/* Kalau parent dipilih tapi tidak ada sub (edge case) */}
      {categoryId && subs.length === 0 && (
        <p className="text-xs text-surface-400 italic">Kategori ini tidak memiliki subkategori</p>
      )}
    </div>
  )
}
