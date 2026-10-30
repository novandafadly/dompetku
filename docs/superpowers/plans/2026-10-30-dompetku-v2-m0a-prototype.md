# DompetKu v2 · M0a (Fondasi + Prototipe Klik) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repo `dompetku-v2` baru dengan CI hijau, design system bertoken terukur, dan prototipe klik (Beranda, Catat, Transaksi, Dompet, onboarding, pengalih Pribadi|Bersama) di atas data demo deterministik — cukup untuk dinilai Novanda dan Farida di HP dan desktop.

**Architecture:** Monorepo pnpm. `packages/domain` berisi logika murni (uang, tanggal, tipe) yang nanti dipakai server juga. `packages/demo-data` berisi seed deterministik + selector yang meniru kontrak `api.*` M1, sehingga layar prototipe memakai bentuk data yang sama dengan produksi. `apps/web` adalah Next.js App Router; di M0a semua data datang dari `demo-data` lewat store klien in-memory (tidak ada DB, tidak ada auth sungguhan). Tidak ada `apps/worker` / `packages/db` di M0a (dibuat di M0b).

**Tech Stack:** Node 24 LTS, pnpm 10 workspaces, Next.js 16.x (App Router, Turbopack), React 19.2, TypeScript 5.9+ strict, Tailwind CSS 4.1 (`@theme`), `radix-ui` 1.4+, `cmdk` 1.x, Phosphor Icons (`@phosphor-icons/react`), Zod 4, React Hook Form 7, Vitest + Testing Library + fast-check, Playwright + `@axe-core/playwright`, ESLint (typescript-eslint strict, jsx-a11y, better-tailwindcss, boundaries), Prettier. Versi pasti dikunci di Task 1 dan dicatat di `docs/adr/0001-stack.md`.

**Spec:** `docs/superpowers/specs/2026-10-29-dompetku-v2-design.md` (§9 berlaku), dengan rincian visual di `docs/team/round1/ui-ux.md` (Lampiran A–B) dan frontend di `docs/team/round1/frontend-engineer.md`. Repo kerja: `novandafadly/dompetku-v2` (private). Salin kedua file tim tersebut + spec ke `docs/` repo baru di Task 1.

## Global Constraints

- Bahasa UI Indonesia; mata uang IDR; zona waktu kalender `Asia/Jakarta`. Zona waktu browser tidak pernah dipakai.
- Nominal: bilangan bulat rupiah (`number` dengan `Number.isSafeInteger`); format `Rp 1.250.000` (spasi tak putus U+00A0 setelah "Rp"); negatif `−Rp 35.000` dengan U+2212; nol `Rp 0` tanpa tanda; ringkas `Rp 1,25 jt` / `Rp 12,5 rb` / `Rp 1,2 M` dengan **pemotongan**, bukan pembulatan ke atas; maksimal 2 desimal ringkas.
- Tanggal domain = string `YYYY-MM-DD`; label: "Hari ini", "Kemarin", "Sen, 27 Okt", tahun ditambahkan bila beda tahun.
- Ruang di URL: `/pribadi/...` dan `/bersama/...`; ruang tujuan catat = ruang dompet; dompet yang ditawarkan hanya milik ruang aktif.
- Tab bar mobile: `Beranda · Transaksi · [Catat] · Dompet · Rencana`; "Menu" berlabel di header; Laporan = tampilan `Ringkasan` di tab Transaksi; segmen Transaksi `Semua · Operasional · Kantor · Menunggu reimburse` (bukan "Pribadi").
- Token warna hanya dari `apps/web/src/styles/tokens.css` (nilai Lampiran A ui-ux.md); palet bawaan Tailwind dimatikan (`--color-*: initial`); nilai warna/ukuran arbitrer dilarang lint.
- Tombol primer tema gelap berteks `#121210`, tidak pernah putih.
- Teks minimum 13 px untuk meta, 15 px body, input ≥ 16 px. Target sentuh ≥ 44×44 px.
- Ikon Phosphor regular 20/24 px, fill untuk tab aktif; setiap ikon navigasi berlabel teks; tidak ada emoji sistem sebagai ikon.
- Gerak: sheet 200 ms ease-out, toast 150 ms, ganti ruang 120 ms; `prefers-reduced-motion: reduce` → instan; tidak ada animasi angka.
- Setiap halaman prototipe menampilkan banner "Data demo".
- WCAG 2.2 AA: axe 0 pelanggaran serious/critical di semua rute, tema terang dan gelap.
- Tidak ada secret di repo; `.env.example` tanpa nilai.
- Actions GitHub dipatok SHA; tidak ada self-hosted runner.

## Review Focus

1. **Keyboard menutupi sheet Catat** di 360×640 dan 390×844 → nominal, label ruang, chip kategori, dompet, dan Simpan tetap terlihat tanpa gulir (Task 9 test `catat fits above keyboard`).
2. **Nominal sangat panjang di 320 px** (`Rp 12.345.678.900`) → tidak terpotong, tidak ada gulir horizontal (Task 5 `MoneyText wraps at 320px`, Task 12 `no horizontal scroll at 320`).
3. **Pergantian hari 23:59 → 00:01 WIB** → label "Hari ini"/"Kemarin" dan default tanggal Catat mengikuti WIB, bukan UTC/zona browser (Task 3 `todayWIB boundary`, Task 9 `default date is today WIB`).
4. **Salah ruang**: membuka Catat di Bersama lalu "Pindah ke Pribadi" → dompet & kategori ter-reset ke milik Pribadi, nominal tetap; toast menyebut ruang tujuan (Task 9 `switch space resets wallet and category`).
5. **Tempel nominal berformat** (`Rp 1.250.000`, `1.250.000`, `-5000`, `1e3`) ke MoneyInput → dua pertama diterima jadi 1250000, dua terakhir ditolak tanpa mengubah nilai (Task 5 `MoneyInput paste`).

---

### Task 0: Prasyarat dari pemilik (bukan kode)

- [ ] **Step 1:** Pemilik membuat repo **private** kosong `novandafadly/dompetku-v2` (tanpa README) dan memberi tahu.
- [ ] **Step 2:** Tambahkan repo ke sesi (`add_repo`, akses push), clone ke `/home/user/dompetku-v2`, `register_repo_root`.
- [ ] **Step 3:** Pemilik mengaktifkan GitHub Actions dan branch protection `main` (wajib PR + CI hijau).

---

### Task 1: Scaffold monorepo + CI dasar

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `.npmrc`, `.nvmrc`, `tsconfig.base.json`, `eslint.config.mjs`, `.prettierrc`, `.editorconfig`, `.gitignore`, `.env.example`, `README.md`, `CONTRIBUTING.md`
- Create: `apps/web/` (via `create-next-app` lalu dirapikan), `apps/web/next.config.ts`, `apps/web/tsconfig.json`, `apps/web/vitest.config.ts`, `apps/web/playwright.config.ts`
- Create: `packages/domain/package.json`, `packages/domain/tsconfig.json`, `packages/domain/src/index.ts`
- Create: `.github/workflows/ci.yml`, `.github/pull_request_template.md`, `renovate.json`
- Create: `docs/adr/0001-stack.md`; copy `docs/spec/design.md`, `docs/spec/ui-ux.md`, `docs/spec/frontend.md`
- Test: `apps/web/tests/e2e/smoke.spec.ts`

**Interfaces:**
- Produces: scripts root `pnpm lint`, `pnpm typecheck`, `pnpm test` (Vitest semua workspace), `pnpm build`, `pnpm e2e`; alias impor `@dompetku/domain` dan `@dompetku/demo-data`; `apps/web` path alias `@/*` → `src/*`.

- [ ] **Step 1: Tulis smoke test** `smoke.spec.ts`: `page.goto('/')` → diarahkan ke `/pribadi/beranda`; `expect(page.getByText('Data demo')).toBeVisible()`.
- [ ] **Step 2: Jalankan** `pnpm e2e smoke` → FAIL (app belum ada).
- [ ] **Step 3: Scaffold.** Next 16 dengan `output: 'standalone'`, `outputFileTracingRoot` = root, `poweredByHeader: false`, `images.unoptimized: true`, `reactStrictMode: true`; `typedRoutes: true`. TS: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`. ESLint: typescript-eslint strict-type-checked, `jsx-a11y`, `eslint-plugin-better-tailwindcss` (`no-unregistered-classes`, larang nilai arbitrer), `eslint-plugin-boundaries` (`features/*` tidak impor internal fitur lain; hanya `src/components/ui` boleh impor `radix-ui`), larang impor `date-fns`/`moment` dan `Intl.DateTimeFormat` di luar `packages/domain/src/date.ts`. `/` → redirect `/pribadi/beranda` (halaman sementara berisi banner). `.npmrc`: `engine-strict=true`, pnpm `minimumReleaseAge` 4320 menit.
- [ ] **Step 4: CI** `.github/workflows/ci.yml` pada `pull_request` & push `main`: job `check` (pnpm install --frozen-lockfile, lint, typecheck, test, build), job `e2e` (Playwright di container `mcr.microsoft.com/playwright:<versi sama dengan paket>-noble`, upload laporan sebagai artifact), job `security` (gitleaks, osv-scanner, actionlint). Semua `uses:` dipatok SHA penuh dengan komentar versi. Renovate: `minimumReleaseAge: "3 days"`, grup patch.
- [ ] **Step 5: Jalankan** `pnpm lint && pnpm typecheck && pnpm build && pnpm e2e smoke` → semua PASS.
- [ ] **Step 6: ADR** `0001-stack.md`: versi pasti tiap paket yang terpasang + alasan singkat (salin dari tabel frontend.md R0) + keputusan "M0a tanpa DB/auth".
- [ ] **Step 7: Commit & PR** `chore: scaffold monorepo dan CI dasar`; CI hijau di PR.

---

### Task 2: `packages/domain` — uang

**Files:**
- Create: `packages/domain/src/money.ts`
- Test: `packages/domain/src/money.test.ts`

**Interfaces:**
- Produces:
  - `type Rupiah = number` (bilangan bulat aman)
  - `formatRupiah(n: Rupiah, opts?: { sign?: 'auto' | 'always' }): string` — `sign: 'always'` memberi `+Rp …` untuk positif
  - `formatRupiahCompact(n: Rupiah): string`
  - `parseRupiah(input: string): Rupiah | null` — `null` bila tidak sah
  - `spokenRupiah(n: Rupiah, kind: 'income' | 'expense' | 'neutral'): string` — teks pembaca layar, mis. "pengeluaran Rp 35.000"

- [ ] **Step 1: Tulis tes** (tabel + properti):
  - `formatRupiah(1250000)` → `"Rp 1.250.000"`; `formatRupiah(-35000)` → `"−Rp 35.000"`; `formatRupiah(0)` → `"Rp 0"`; `formatRupiah(9500000, {sign:'always'})` → `"+Rp 9.500.000"`.
  - `formatRupiahCompact`: 999 → `"Rp 999"`; 12500 → `"Rp 12,5 rb"`; 1250000 → `"Rp 1,25 jt"`; 1259999 → `"Rp 1,25 jt"` (dipotong); 1200000000 → `"Rp 1,2 M"`; -1250000 → `"−Rp 1,25 jt"`.
  - `parseRupiah`: `"35.000"`→35000, `"35000"`→35000, `"Rp 1.250.000"`→1250000, `" 1.250.000 "`→1250000; `"-5000"`, `"1e3"`, `"12,5"`, `""`, `"abc"`, `"9007199254740993"` → `null`.
  - fast-check: untuk semua bilangan bulat 0..10^13, `parseRupiah(formatRupiah(n)) === n`.
  - `spokenRupiah(35000,'expense')` → `"pengeluaran Rp 35.000"` (spasi biasa).
- [ ] **Step 2: Jalankan** `pnpm --filter @dompetku/domain test money` → FAIL.
- [ ] **Step 3: Implementasi** tanpa `Intl.NumberFormat` (pengelompokan ribuan manual agar identik di server/klien).
- [ ] **Step 4: Jalankan** → PASS.
- [ ] **Step 5: Commit** `feat(domain): format dan parse rupiah`.

---

### Task 3: `packages/domain` — tanggal WIB

**Files:**
- Create: `packages/domain/src/date.ts`
- Test: `packages/domain/src/date.test.ts`

**Interfaces:**
- Produces:
  - `type IsoDate = string` (`YYYY-MM-DD`)
  - `todayWIB(now?: Date): IsoDate`
  - `nowTimeWIB(now?: Date): string` → `"10.32"`
  - `dayLabel(d: IsoDate, today: IsoDate): string` → "Hari ini" | "Kemarin" | "Sen, 27 Okt" | "Sen, 27 Okt 2025"
  - `endOfMonth(d: IsoDate): IsoDate`; `daysInclusive(from: IsoDate, to: IsoDate): number`; `addDays(d: IsoDate, n: number): IsoDate`

- [ ] **Step 1: Tulis tes:**
  - `todayWIB boundary`: `todayWIB(new Date('2026-10-30T16:59:00Z'))` → `"2026-10-30"`; `todayWIB(new Date('2026-10-30T17:01:00Z'))` → `"2026-10-31"`.
  - `dayLabel('2026-10-31','2026-10-31')`→"Hari ini"; `('2026-10-30','2026-10-31')`→"Kemarin"; `('2026-10-26','2026-10-31')`→"Sen, 26 Okt"; `('2025-12-31','2026-01-02')`→"Rab, 31 Des 2025".
  - `endOfMonth('2026-02-10')`→`"2026-02-28"`; `endOfMonth('2028-02-10')`→`"2028-02-29"`; `endOfMonth('2026-10-31')`→`"2026-10-31"`.
  - `daysInclusive('2026-10-17','2026-10-31')` → 15.
  - Jalankan tes dengan `TZ=America/Los_Angeles` dan `TZ=Asia/Tokyo` di script `test:tz` → hasil sama.
- [ ] **Step 2: Jalankan** → FAIL.
- [ ] **Step 3: Implementasi:** satu-satunya pemakaian `Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' })` ada di `todayWIB`/`nowTimeWIB`; aritmetika tanggal pada string via `Date.UTC`; nama hari/bulan dari tabel lokal (`Min Sen Sel Rab Kam Jum Sab`, `Jan Feb Mar Apr Mei Jun Jul Agu Sep Okt Nov Des`).
- [ ] **Step 4: Jalankan** `test` dan `test:tz` → PASS.
- [ ] **Step 5: Commit** `feat(domain): tanggal kalender WIB`.

---

### Task 4: Token desain, tema, font, uji kontras

**Files:**
- Create: `apps/web/src/styles/tokens.css` (CSS variables light + dark), `apps/web/src/styles/globals.css` (Tailwind `@theme`, reset palet), `apps/web/src/styles/token-pairs.ts` (daftar pasangan yang wajib lulus)
- Create: `apps/web/src/app/fonts.ts`
- Test: `apps/web/src/styles/contrast.test.ts`, `apps/web/tests/e2e/tnum.spec.ts`

**Interfaces:**
- Produces: kelas Tailwind semantik saja: `bg`, `surface`, `surface-2`, `text`, `text-muted`, `border`, `hairline`, `pribadi`, `pribadi-tint`, `bersama`, `bersama-tint`, `income`, `danger`, `warning`, plus `accent` / `accent-tint` / `on-accent` yang dipetakan ke ruang aktif lewat atribut `data-ruang="pribadi|bersama"` pada `<html>`. Tema: `data-theme="light|dark"` atau mengikuti `prefers-color-scheme`. Font CSS variables `--font-sans` (Plus Jakarta Sans 400/600), `--font-hero` (Source Serif 4 600).
- Nilai: persis tabel Lampiran A.1 `docs/spec/ui-ux.md` (light & dark).

- [ ] **Step 1: Tulis `contrast.test.ts`:** parse `tokens.css`, untuk setiap pasangan di `token-pairs.ts` hitung rasio WCAG (fungsi lokal di file tes) dan assert ≥ ambang: teks 4.5, non-teks (`border` di `bg`/`surface`) 3.0. Pasangan minimum: `text`/`text-muted` di `bg`,`surface`,`surface-2`, tint ruang; `border` di `bg`,`surface`; `on-accent` di `accent` (kedua ruang, kedua tema); `income`,`danger`,`warning` di `surface`.
- [ ] **Step 2: Jalankan** → FAIL.
- [ ] **Step 3: Implementasi** token + `@theme` (`--color-*: initial;` lalu hanya token semantik), skala spasi 4px, radius `field 8`, `sheet 16`, `pill`; `font-variant-numeric: tabular-nums lining-nums` pada kelas `.num`.
- [ ] **Step 4: Tulis `tnum.spec.ts`:** render `/dev/ui#angka`, ukur lebar `1111111` vs `0000000` di `.num` → selisih ≤ 0,5 px. Bila gagal, ganti digit daftar ke IBM Plex Sans dan catat di ADR (sesuai ui-ux R5).
- [ ] **Step 5: Jalankan** unit + e2e → PASS.
- [ ] **Step 6: Commit** `feat(web): token desain buku kas dan uji kontras`.

---

### Task 5: Primitif UI + halaman `/dev/ui`

**Files:**
- Create di `apps/web/src/components/ui/`: `button.tsx`, `icon-button.tsx`, `chip.tsx`, `segmented-control.tsx`, `money-text.tsx`, `money-input.tsx`, `sheet.tsx`, `toast.tsx`, `state.tsx` (EmptyState, ErrorState, Skeleton), `demo-banner.tsx`, `ledger-column.tsx`
- Create: `apps/web/src/app/dev/ui/page.tsx` (hanya bila `NODE_ENV !== 'production'` atau `NEXT_PUBLIC_PROTOTYPE=1`)
- Test: `apps/web/src/components/ui/*.test.tsx`

**Interfaces:**
- Consumes: `formatRupiah`, `formatRupiahCompact`, `parseRupiah`, `spokenRupiah` (Task 2).
- Produces:
  - `<Button variant="primary|secondary|ghost|danger" loading? />`; `<IconButton label: string icon />` (label wajib → `aria-label`)
  - `<Chip selected onSelect />` (role `radio` di dalam `<ChipGroup label>` role `radiogroup`)
  - `<SegmentedControl items: {value,label}[] value onChange label />`
  - `<MoneyText value: Rupiah kind?: 'income'|'expense'|'neutral' size?: 'list'|'hero' compact?: boolean />` — "Rp" `text-muted`, sr-only teks dari `spokenRupiah`
  - `<MoneyInput value: Rupiah|null onChange(v: Rupiah|null) label />` — `inputMode="numeric"`, tampilan berpemisah ribuan saat mengetik
  - `<Sheet open onOpenChange title tint?: 'pribadi'|'bersama'>` (Radix Dialog, gaya bottom sheet < 600 px, dialog tengah ≥ 600 px, tinggi dari `visualViewport`)
  - `toast({ message, action?: { label, onAction } })` + `<Toaster />` (Radix Toast, posisi di atas tab bar)
  - `<LedgerColumn rows: {label, value: Rupiah, op?: 'minus'}[] total: Rupiah />` (garis ganda di atas total)
  - `<DemoBanner />` teks "Data demo"

- [ ] **Step 1: Tulis tes komponen:**
  - `MoneyInput typing`: ketik "35000" → nilai tampil "35.000", `onChange` terakhir 35000.
  - `MoneyInput paste`: tempel "Rp 1.250.000" → 1250000; "1.250.000" → 1250000; "-5000" dan "1e3" → nilai tidak berubah dan `aria-invalid` tidak true (ditolak diam, input tetap).
  - `MoneyText` render `-35000` → teks `−Rp 35.000` dan sr-only "pengeluaran Rp 35.000" bila `kind='expense'`.
  - `MoneyText wraps at 320px` (Playwright di `/dev/ui#angka`, viewport 320): `Rp 12.345.678.900` terlihat utuh, `document.documentElement.scrollWidth <= 320`.
  - `IconButton` tanpa `label` → error tipe (tes `// @ts-expect-error`).
  - `Sheet` Escape menutup dan fokus kembali ke pemicu.
  - `ChipGroup` panah kiri/kanan memindah pilihan.
- [ ] **Step 2: Jalankan** → FAIL.
- [ ] **Step 3: Implementasi** dengan Radix + token; target sentuh ≥ 44 px; tidak ada `opacity-0 group-hover`.
- [ ] **Step 4: `/dev/ui`**: semua komponen dalam keadaan normal, fokus, nonaktif, memuat, kosong, gagal; anchor `#angka` berisi contoh nominal (0, negatif, 12.345.678.900, ringkas).
- [ ] **Step 5: Jalankan** → PASS.
- [ ] **Step 6: Commit** `feat(web): primitif design system dan /dev/ui`.

---

### Task 6: `packages/demo-data` — seed deterministik + selector

**Files:**
- Create: `packages/demo-data/src/types.ts`, `seed.ts`, `selectors.ts`, `store.ts`, `index.ts`
- Test: `packages/demo-data/src/selectors.test.ts`

**Interfaces:**
- Consumes: `Rupiah`, `IsoDate`, `addDays`, `endOfMonth`, `daysInclusive` (Task 2–3).
- Produces (bentuk sama dengan kontrak M1 nanti):
  - `type Ruang = 'pribadi' | 'bersama'`; `type Pocket = 'operasional'|'tabungan'|'kantor'`
  - `type Member = { id: string; name: 'Novanda'|'Farida'; initial: string }`
  - `type Account = { id; ruang: Ruang; ownerId: string|null; name; pocket: Pocket; walletType: 'cash'|'bank'|'ewallet'; openedOn: IsoDate }`
  - `type Category = { id; ruang: Ruang; parentId: string|null; name; type: 'income'|'expense'; icon: string /* nama ikon Phosphor */ }`
  - `type Entry = { id; ruang: Ruang; kind: 'income'|'expense'|'transfer'|'opening_balance'|'space_transfer'; occurredOn: IsoDate; createdAt: string; createdBy: string; accountId: string; counterAccountId?: string; amount: Rupiah /* selalu positif */; categoryId?: string; description?: string; reimbursable?: boolean; voidedAt?: string }`
  - `type Bill = { id; ruang; name; amount: Rupiah; dueOn: IsoDate; posted: boolean }`; `type Budget = { ruang; categoryId; month: IsoDate; amount: Rupiah; wajib: boolean }`
  - `type Activity = { id; at: string; actor: Member; text: string; amount?: Rupiah; before?: Rupiah }`
  - `createSeed(opts: { today: IsoDate; variant: 'empty'|'full' }): DemoState` — deterministik (PRNG `mulberry32(20261030)`), 6 bulan transaksi, nama fiktif (Novanda, Farida tetap; merchant generik), dompet Pribadi: BCA (operasional), Tunai (operasional), Dana Darurat (tabungan), Kas Kantor (kantor); Bersama: Kas Rumah (operasional), Tabungan Liburan (tabungan)
  - `balances(state, ruang): Map<accountId, Rupiah>` — termasuk akun tanpa entri (0)
  - `safeToSpend(state, ruang, today): { operasional: Rupiah; billsUntilEom: Rupiah; budgetWajibRemaining: Rupiah; total: Rupiah; perDay: Rupiah; daysLeft: number; until: IsoDate }`
  - `groupByDay(entries: Entry[], today: IsoDate): { date: IsoDate; label: string; net: Rupiah; items: Entry[] }[]`
  - `suggestCategories(state, ruang, opts: { amount?: Rupiah; hourWIB: number }): Category[]` (6 teratas: frekuensi 30 hari × kecocokan jam; data demo saja)
  - `activityFeed(state, limit): Activity[]` (hanya ruang Bersama)
  - `createDemoStore(seed): DemoStore` dengan `addEntry(e: Omit<Entry,'id'|'createdAt'>): Entry`, `voidEntry(id)`, `restoreEntry(id)`, `addAccount(a, openingBalance: Rupiah)`, `subscribe(fn)`, `getState()`

- [ ] **Step 1: Tulis tes** (dengan `today='2026-10-17'`, `variant:'full'`):
  - `createSeed` dua kali → `JSON.stringify` identik.
  - `balances` = saldo awal + Σ income − Σ expense ± transfer, entri void diabaikan; akun baru tanpa entri → 0.
  - `safeToSpend`: `total = operasional − billsUntilEom − budgetWajibRemaining`; `daysLeft = daysInclusive(today, endOfMonth(today))` = 15; `perDay = Math.floor(total / daysLeft)`; total negatif tetap dikembalikan negatif (tidak di-clamp). Kantor tidak masuk `operasional`.
  - `groupByDay` urut tanggal turun; `net` = income − expense hari itu; label dari `dayLabel`.
  - `space_transfer` Pribadi→Bersama: muncul di kedua ruang; di ruang tujuan `description` undefined.
  - `activityFeed` tidak pernah memuat entri `ruang='pribadi'`.
  - `voidEntry` lalu `restoreEntry` → saldo kembali.
- [ ] **Step 2: Jalankan** → FAIL.
- [ ] **Step 3: Implementasi.**
- [ ] **Step 4: Jalankan** → PASS.
- [ ] **Step 5: Commit** `feat(demo-data): seed deterministik dan selector`.

---

### Task 7: Shell aplikasi — ruang, tab bar, sidebar, menu

**Files:**
- Create: `apps/web/src/app/[ruang]/layout.tsx`, `apps/web/src/app/[ruang]/{beranda,transaksi,dompet,rencana}/page.tsx` (isi sementara), `apps/web/src/features/shell/{space-switcher,tab-bar,sidebar,app-header,menu-sheet}.tsx`, `apps/web/src/features/shell/demo-provider.tsx`
- Test: `apps/web/tests/e2e/shell.spec.ts`

**Interfaces:**
- Consumes: `createSeed`, `createDemoStore` (Task 6); primitif (Task 5).
- Produces: `useDemo(): { state; store; ruang: Ruang; today: IsoDate }` (context klien; `today` = `todayWIB()` kecuali query `?today=YYYY-MM-DD` untuk tes); `ruang` dari segmen URL (selain `pribadi|bersama` → `notFound()`); `<html data-ruang>` ikut ruang. Query `?seed=empty|full` memilih varian (default `full`), `?hero=serif|sans` memilih font hero.

- [ ] **Step 1: Tulis tes e2e:**
  - Mobile 390: tab bar berisi 5 item berlabel urut `Beranda, Transaksi, Catat, Dompet, Rencana`; Catat adalah `button`, lainnya `link` dengan `aria-current="page"` pada yang aktif.
  - Klik `Bersama` di pengalih → URL `/bersama/beranda`, `html[data-ruang=bersama]`, header menampilkan label "Bersama" (bukan hanya warna).
  - Desktop 1280: sidebar 248 px berisi pengalih, tombol Catat, 5 grup; tab bar tidak tampil.
  - Tombol "Menu" membuka sheet berisi Trip, Kategori, Kontak, Export, Analisis, Pengaturan (item non-M0a berlabel "Segera").
  - `/lainnya/beranda` → 404.
  - `?seed=empty`: tab Rencana tidak tampil (belum ada isi); `?seed=full`: tampil.
- [ ] **Step 2: Jalankan** → FAIL.
- [ ] **Step 3: Implementasi** (semua navigasi `<Link>`; pintasan `c` membuka Catat hanya bila fokus tidak di field teks).
- [ ] **Step 4: Jalankan** → PASS.
- [ ] **Step 5: Commit** `feat(web): shell aplikasi dengan ruang di URL`.

---

### Task 8: Beranda (Pribadi kosong/terisi, Bersama)

**Files:**
- Create: `apps/web/src/features/beranda/{safe-to-spend,bills-soon,budgets-near-limit,recent-entries,onboarding-checklist,activity-feed}.tsx`; Modify: `apps/web/src/app/[ruang]/beranda/page.tsx`
- Test: `apps/web/tests/e2e/beranda.spec.ts`

**Interfaces:**
- Consumes: `useDemo`, `safeToSpend`, `groupByDay`, `activityFeed`, `LedgerColumn`, `MoneyText`.

- [ ] **Step 1: Tulis tes e2e** (`?today=2026-10-17`):
  - `?seed=empty`: checklist "Mulai dari sini" (Akun aman ✓, Tambah dompet sehari-hari, Catat satu pengeluaran, Undang Farida); kalimat "Tambahkan dompet operasional untuk melihat berapa yang aman dipakai bulan ini."; **tidak ada** teks "Rp 0" di halaman.
  - `?seed=full` Pribadi: judul "Aman dipakai sampai 31 Okt"; hero = `formatRupiah(safeToSpend(...).total)`; kolom rumus 3 baris + total dengan garis ganda; "≈ Rp … per hari untuk 15 hari"; bagian Tagihan 7 hari, Anggaran hampir habis (ikon + teks persen), Terakhir.
  - Bersama: aksen bata, judul "Aman dipakai bersama sampai 31 Okt", feed Aktivitas dengan inisial pelaku.
  - Net worth **tidak** tampil di Beranda.
  - Tombol "Tidak ada pengeluaran hari ini" tampil bila belum ada pengeluaran hari ini; diklik → berubah jadi teks "Hari ini tercatat tanpa pengeluaran" (disimpan di store demo).
- [ ] **Step 2: Jalankan** → FAIL.
- [ ] **Step 3: Implementasi** (tanpa tumpukan kartu berbayang; pemisah `hairline`; hero memakai `--font-hero` sesuai `?hero`).
- [ ] **Step 4: Jalankan** → PASS.
- [ ] **Step 5: Commit** `feat(web): prototipe Beranda`.

---

### Task 9: Sheet Catat (≤ 3 ketukan, varian keypad A/B)

**Files:**
- Create: `apps/web/src/features/catat/{catat-sheet,category-chips,wallet-picker,app-keypad,use-catat}.tsx`
- Test: `apps/web/tests/e2e/catat.spec.ts`, `apps/web/src/features/catat/use-catat.test.ts`

**Interfaces:**
- Consumes: `Sheet`, `MoneyInput`, `ChipGroup`, `SegmentedControl`, `toast`, `suggestCategories`, `store.addEntry`, `store.voidEntry`, `todayWIB`.
- Produces: `openCatat(opts?: { ruang?: Ruang })` dipanggil tab bar/sidebar/pintasan; `useCatat()` mengelola `{ type: 'expense'|'income'|'transfer'; amount: Rupiah|null; categoryId?; accountId; date: IsoDate; description?; ruang: Ruang; clientId: string }` — `clientId` dibuat sekali saat sheet dibuka.

- [ ] **Step 1: Tulis tes:**
  - `use-catat.test.ts`: dompet default = dompet operasional terakhir dipakai di ruang itu; `switchRuang('pribadi')` → `accountId` dan `categoryId` ter-reset ke milik Pribadi, `amount` tetap; `clientId` tidak berubah saat simpan gagal lalu diulang.
  - e2e `three taps from beranda`: dari `/pribadi/beranda`, hitung klik/tap: Catat (1) → ketik nominal (keyboard, bukan ketukan) → chip kategori pertama (2) → Simpan (3) → toast "Tersimpan di Pribadi · Rp 35.000 dari BCA" + tombol "Urungkan"; daftar Terakhir memuat entri baru.
  - e2e `undo`: klik Urungkan → entri hilang dari daftar, saldo kembali.
  - e2e `switch space resets wallet and category`: buka di Bersama (judul "Pengeluaran · Bersama", dompet hanya Kas Rumah/Tabungan Liburan), ketik 35000, "Pindah ke Pribadi" → judul "Pengeluaran · Pribadi", dompet = BCA, kategori kosong, nominal tetap 35.000.
  - e2e `catat fits above keyboard` (viewport 360×640 dan 390×844, set `visualViewport` tinggi − 300 px via emulasi CSS `env(keyboard-inset-height)`/script): nominal, label ruang, minimal 4 chip, dompet, Simpan berada dalam viewport tanpa gulir.
  - e2e `default date is today WIB`: dengan jam browser di-mock ke `2026-10-30T17:30:00Z` → tanggal di sheet "Hari ini" mewakili 2026-10-31.
  - e2e varian B (`?keypad=app`): keypad aplikasi `1–9, 000, 0, ⌫`, input tidak memunculkan keyboard OS (`inputmode="none"`).
- [ ] **Step 2: Jalankan** → FAIL.
- [ ] **Step 3: Implementasi** (Simpan nonaktif sampai nominal > 0 dan kategori terpilih; kategori tidak pernah dipilih otomatis; chip "Kategori lain…" membuka Combobox `cmdk`).
- [ ] **Step 4: Jalankan** → PASS.
- [ ] **Step 5: Commit** `feat(web): prototipe sheet Catat`.

---

### Task 10: Transaksi (daftar, ringkasan, detail, batalkan)

**Files:**
- Create: `apps/web/src/features/transaksi/{entry-list,entry-row,entry-detail,void-dialog,summary-view,filters}.tsx`; Modify: `apps/web/src/app/[ruang]/transaksi/page.tsx`; Create: `apps/web/src/app/[ruang]/transaksi/[id]/page.tsx`
- Test: `apps/web/tests/e2e/transaksi.spec.ts`

**Interfaces:**
- Consumes: `groupByDay`, `MoneyText`, `SegmentedControl`, `store.voidEntry`, `store.restoreEntry`.

- [ ] **Step 1: Tulis tes e2e:**
  - Segmen `Daftar | Ringkasan`; filter chip `Semua · Operasional · Kantor · Menunggu reimburse`; grup per hari dengan total harian; baris 60 px: deskripsi, "kategori · dompet", nominal rata kanan.
  - Pencarian "parkir" menyaring; filter tanpa hasil → "Tidak ada transaksi Kantor di Oktober." + tombol "Hapus filter".
  - "Muat lagi" menambah 50 entri berikutnya.
  - Detail: "dicatat oleh kamu"/"dicatat oleh Farida" (Bersama); tombol Ubah, Pindahkan ke ruang lain, Batalkan; dialog Batalkan memuat kalimat "Transaksi Rp 35.000 dibatalkan. Saldo BCA bertambah Rp 35.000. Bisa dipulihkan 90 hari dari Sampah." → konfirmasi → kembali ke daftar, entri hilang, toast dengan Urungkan.
  - Ringkasan: pemasukan, pengeluaran, selisih bulan berjalan + baris "Tidak termasuk: Kas kantor Rp …, Transfer internal Rp …".
- [ ] **Step 2: Jalankan** → FAIL.
- [ ] **Step 3: Implementasi** (Ubah & Pindahkan di M0a membuka sheet Catat terisi / toast "Segera di M1").
- [ ] **Step 4: Jalankan** → PASS.
- [ ] **Step 5: Commit** `feat(web): prototipe Transaksi`.

---

### Task 11: Dompet, tambah dompet, onboarding & layar auth tiruan

**Files:**
- Create: `apps/web/src/features/dompet/{account-list,add-account-sheet}.tsx`; Modify: `apps/web/src/app/[ruang]/dompet/page.tsx`
- Create: `apps/web/src/app/(auth)/{masuk,amankan,undang,terima-undangan}/page.tsx` (tiruan, tanpa logika auth; label "Prototipe — belum aktif")
- Test: `apps/web/tests/e2e/dompet-onboarding.spec.ts`

**Interfaces:**
- Consumes: `balances`, `store.addAccount`, `MoneyInput`, `ChipGroup`.

- [ ] **Step 1: Tulis tes e2e:**
  - Dompet dikelompokkan per pocket dengan subtotal; Kas Kantor diberi label "Tidak masuk hitungan pribadi"; kekayaan bersih tampil di sini (bukan di Beranda).
  - Tambah dompet (`?seed=empty`): Nama "BCA", Jenis Operasional, Saldo hari ini 4.100.000 → "Simpan dompet" → riwayat dompet berisi entri "Saldo awal Rp 4.100.000"; checklist Beranda mencentang "Tambah dompet" dan kalimat aman-dipakai muncul.
  - Layar `masuk`, `amankan` (2 langkah: passkey, kode TOTP), `undang` (email, "Tautan berlaku 72 jam, sekali pakai."), `terima-undangan` dapat dibuka dan lulus axe.
- [ ] **Step 2: Jalankan** → FAIL.
- [ ] **Step 3: Implementasi.**
- [ ] **Step 4: Jalankan** → PASS.
- [ ] **Step 5: Commit** `feat(web): prototipe Dompet dan onboarding`.

---

### Task 12: Aksesibilitas, screenshot, budget performa

**Files:**
- Create: `apps/web/tests/e2e/a11y.spec.ts`, `apps/web/tests/e2e/screenshots.spec.ts`, `apps/web/tests/e2e/budget.spec.ts`, `apps/web/tests/e2e/routes.ts` (daftar rute M0a)
- Create: `docs/screenshots/m0a/` (keluaran)

**Interfaces:**
- Consumes: semua rute Task 7–11.

- [ ] **Step 1: Tulis tes:**
  - `a11y.spec.ts`: untuk setiap rute di `routes.ts` × tema light/dark × viewport 390/1280 → `AxeBuilder.withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa'])` 0 pelanggaran `serious|critical`; sheet Catat terbuka juga diperiksa.
  - `no horizontal scroll at 320`: semua rute di 320 px → `scrollWidth <= 320`.
  - `reduced motion`: dengan `reducedMotion: 'reduce'`, `getComputedStyle(sheet).transitionDuration` = `0s`.
  - `keyboard only`: catat pengeluaran memakai Tab/Enter/panah saja; Escape menutup sheet dan fokus kembali ke tombol Catat.
  - `budget.spec.ts`: Σ `encodedBodySize` JS pada cold load `/pribadi/beranda` dan `/pribadi/transaksi` ≤ 120 kB.
  - `screenshots.spec.ts` (tag `@screens`, tidak dijalankan di PR biasa): rute utama × 390/1280 × light/dark × `hero=serif|sans` → `docs/screenshots/m0a/<rute>-<lebar>-<tema>-<hero>.png`, `today=2026-10-17`, animasi dimatikan.
- [ ] **Step 2: Jalankan** → perbaiki pelanggaran sampai PASS.
- [ ] **Step 3: Jalankan** `pnpm e2e --grep @screens` → file screenshot terbentuk; commit ke `docs/screenshots/m0a/`.
- [ ] **Step 4: Commit** `test(web): a11y, screenshot, dan budget M0a`.

---

### Task 13: Pratinjau untuk penilaian pemilik

**Files:**
- Create: `docs/review/m0a-penilaian.md` (formulir penilaian), `.github/workflows/preview.yml`

**Interfaces:**
- Consumes: build `apps/web` dengan `NEXT_PUBLIC_PROTOTYPE=1`.

- [ ] **Step 1:** Keputusan tempat pratinjau (ADR `0002-preview.md`): **Vercel Preview dengan Deployment Protection (password)** — aman karena hanya data demo fiktif, tanpa secret, tanpa DB. Produksi tetap self-hosted di M0b. Workflow `preview.yml` deploy pada PR berlabel `preview`.
- [ ] **Step 2:** Verifikasi pratinjau di HP (390) dan desktop (1280), kedua tema; tempel link + password ke PR.
- [ ] **Step 3:** `m0a-penilaian.md` berisi tugas untuk Novanda dan Farida masing-masing: catat 3 pengeluaran (ukur rasa ≤ 3 ketukan), pindah Pribadi↔Bersama, cari transaksi, batalkan lalu urungkan, tambah dompet; pilih varian keypad A/B; pilih angka hero serif/sans; skala 1–5 "mau pakai tiap hari?"; komentar bebas.
- [ ] **Step 4: Gerbang keluar M0a:** kedua penilaian terisi; keputusan keypad dan font hero dicatat di ADR `0003-hasil-penilaian-m0a.md`; temuan diubah jadi issue berlabel `m0a-feedback`.
- [ ] **Step 5: Commit** `docs: pratinjau dan formulir penilaian M0a`.
