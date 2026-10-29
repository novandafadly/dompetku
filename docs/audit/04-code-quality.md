# 04 — Kualitas Kode dan Arsitektur

Ukuran diambil dari repo pada commit `17f1c2b` (main) dengan `wc -l`, `grep`, `next build`, dan `tsc --noEmit`.

## 1. Angka

| Metrik | Nilai | Cara ukur |
|---|---|---|
| Baris TS/TSX (`app`, `components`, `lib`) | 9.318 | `wc -l` |
| File terbesar | `debts/page.tsx` 1.210, `transactions/page.tsx` 1.103, `savings-goals/page.tsx` 1.098, `assets/page.tsx` 698, `trips/page.tsx` 645 | `wc -l` |
| Halaman `'use client'` | 19/19 (+1 API route) | grep |
| Pemanggilan `supabase.from(...)` di halaman | 146 | grep |
| Penulisan yang hasil/error-nya diabaikan (`await supabase.from(..).insert/update/delete` tanpa menangkap `error`) | 39 | grep |
| `any` (`as any`, `: any`, `any[]`) | 139 (transactions 58, trips 18) | grep |
| `try/catch` | 9 / 8 | grep |
| `confirm()` bawaan browser | 16 | grep |
| Tombol `router.push` sebagai link | 6 | grep |
| `toISOString().split('T')[0]` untuk tanggal lokal | 41 | grep |
| Atribut `aria-*` | 2 | grep |
| `htmlFor` (label terhubung ke input) | 0 dari 124 `<label>` | grep |
| Kelas `dark:` | 0 | grep |
| Aksi hanya muncul saat hover (`opacity-0 group-hover`) | 12 | grep |
| Tes | 0 file | `find -name '*.test.*'` |
| Lint/format | tidak ada ESLint, Prettier, `.editorconfig` | ls |
| CI | tidak ada `.github/` | ls |
| `tsc --noEmit` | lulus (karena `any` dan tipe longgar) | eksekusi |
| `npm audit` | 1 critical, 2 high | 03-security SEC-10 |
| First Load JS | 155–269 kB per halaman; `/dashboard` 269 kB, `/reports` 264 kB (Recharts) | `next build` |
| Middleware bundle | 84,8 kB | `next build` |

## 2. Temuan

### CQ-01 — Tidak ada lapisan data atau domain · high
Setiap halaman memuat, menggabungkan, menghitung, dan menulis data sendiri (contoh: `debts/page.tsx` berisi query, aturan cicilan, aturan modal trading, 5 modal, dan 4 sub-komponen dalam satu file). Aturan uang tersebar di 19 file (01-features §3). Akibatnya aturan "kantor dikecualikan" hanya diterapkan di 6 dari 9 tempat yang relevan (02-integrity INT-08), dan progres goal punya dua rumus.
**Saran:** `src/features/<domain>/{queries,actions,schema,components}`; aturan uang di fungsi Postgres; satu modul `money`/`date`.

### CQ-02 — Tipe tidak sinkron dengan DB · high
`lib/supabase.ts` ditulis tangan dan tertinggal dari skema (00-schema §9), sehingga 139 `any`. Contoh: `(tx as any).subcategory_id`, `(t as any).fee`, `(c as any).parent_id` di belasan tempat; `Transfer.from_wallet_id: string` padahal nullable.
**Saran:** `supabase gen types` di CI + Zod di batas input.

### CQ-03 — Error diabaikan, tidak ada state error · high
39 penulisan tidak memeriksa error; 0 halaman menampilkan state error saat load gagal (mis. `load()` di semua halaman hanya `setX(r.data || [])`, sehingga kegagalan jaringan tampil sebagai "Belum ada data"). Toast sukses tetap muncul meskipun langkah kedua gagal (mis. `debts/page.tsx:394` setelah insert yang tidak dicek).

### CQ-04 — Tidak ada tes, lint, format, CI · high
Logika uang yang sudah terbukti salah (02-integrity) tidak punya tes yang akan menangkapnya. Tidak ada pipeline yang menjalankan `tsc`, lint, audit, atau build sebelum merge (commit langsung via PR tanpa cek).

### CQ-05 — Duplikasi · medium
Form transfer di 3 halaman, insert transfer di 6 titik, insert transaksi di 9 titik, normalisasi tagihan rutin 3×, `daysUntil` 3×, akhir bulan 4×, join manual di 5 halaman, dua implementasi pemilih kategori (dan `components/CategoryPicker.tsx` tidak dipakai sama sekali). Rincian: 01-features §3.

### CQ-06 — Pola data fetching boros · medium
- Semua halaman static shell + fetch di `useEffect` (`useEffect(() => { load() }, [])` di 13 halaman): HTML → JS → `getSession` (AppShell) → render → `getSession` lagi → N query paralel → join di JS. Dashboard: 9 request ke Supabase per kunjungan (Playwright, 05-ux).
- Mengambil seluruh tabel lalu memfilter di client (kategori, dompet, aset dimuat ulang di hampir setiap halaman); agregat dihitung di browser dari baris mentah dan dipotong oleh `limit` (02-integrity INT-17).
- Setiap aksi memanggil `load()` ulang seluruh halaman; tidak ada cache lintas halaman.
- Komentar "hindari PostgREST embedded join yang tidak reliable setelah schema migration" (`transactions/page.tsx:75-76`, `transfers/page.tsx:85`, `trips/page.tsx:69`) menunjukkan masalah schema cache yang ditambal dengan join manual, bukan diperbaiki (`force_schema_cache_reload` migrasi 2026-06-15).

### CQ-07 — Komponen dan state · medium
- Sub-komponen didefinisikan di dalam komponen halaman (`DebtRow`, `ContactCard` di `debts/page.tsx:485-613`; `GoalCard` di `savings-goals/page.tsx:583`; `ItemCard`, `DueBadge` di `recurring/page.tsx`) → dibuat ulang setiap render, state internal hilang, tidak bisa dites.
- `transactions/page.tsx` punya 25+ `useState`; form memakai `(form as any).is_reimbursable` padahal field ada di tipe.
- Toast global lewat variabel modul yang dimutasi (`components/Toast.tsx:5-9`), id `Date.now()` bisa bentrok; tidak ada `aria-live`.
- `Modal` tanpa focus trap, tanpa `role="dialog"`, tanpa tutup dengan Escape (`components/Modal.tsx`).

### CQ-08 — Konvensi dan kebersihan · low
- Penamaan campur ("Hutang"/"Utang", "Tabunganku"), komentar campur bahasa, emoji sebagai ikon dan data (kolom `icon` berisi emoji).
- Kolom ganda `transfers.note`/`description` ditulis keduanya di semua insert.
- Tailwind config tanpa token semantik; warna hex di inline style (`PIE_COLORS`, `AVATAR_COLORS`, `GOAL_COLORS`).
- `next.config.js` minimal (tanpa header keamanan, tanpa `images`), `tsconfig` target `es5`.
- `formatShort` membulatkan ke 1 desimal sehingga Rp1.250.000 tampil "Rp 1.3jt" di kartu yang sama dengan "-Rp 1.250.000" (screenshot `desktop-debts.png`); prompt AI menghasilkan "RpRp 1.2jt" (`ai-analysis/page.tsx:67,73`).

## 3. Yang sudah baik dan layak dipertahankan
- RLS aktif di semua tabel; saldo dijaga trigger DB (bukan client) untuk INSERT/DELETE; trigger transfer memeriksa kepemilikan.
- `numeric` di DB (bukan float) dan nominal bulat.
- Middleware memakai `getUser()`.
- Komentar niat bisnis di kode cukup jelas (mis. alasan modal trading lewat Transfer, `debts/page.tsx:245-247`), sangat membantu audit.
- `tsconfig` `strict: true` (walau dilemahkan oleh `any`).
