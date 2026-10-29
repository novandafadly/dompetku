# DompetKu v2 — Rancangan Arsitektur

Status: **draf untuk checkpoint Fase 2** (belum ada kode v2). Dasar: audit v1 di [`docs/audit/`](../audit/SUMMARY.md).
Setiap keputusan besar menyajikan alternatif, trade-off, dan rekomendasi. Keputusan yang butuh pemilik produk dikumpulkan di §12.

## 1. Tujuan dan batasan

- Semua aturan bisnis v1 yang bernilai bertahan (01-features §2), dengan perilaku yang bisa diuji.
- Uang benar lebih dulu: setiap invarian I1–I10 (02-integrity §1) dijaga DB dan dites.
- Repo dan project Supabase baru; v1 dan project `yvapmbjtuhqvsunkmkxw` tetap read-only.
- Bahasa produk Indonesia, mata uang IDR, zona waktu kalender `Asia/Jakarta`.
- Skala: personal/rumah tangga (ribuan–puluhan ribu entri per user). Desain tidak boleh bergantung pada skala lebih besar, tetapi juga tidak boleh membayar kompleksitas untuk skala yang tidak ada.

## 2. Prinsip

1. **Logika uang di database.** Setiap mutasi uang = satu fungsi Postgres (RPC) yang atomik, idempoten, memeriksa kepemilikan, dan menulis log audit. Client tidak punya izin INSERT/UPDATE/DELETE langsung ke tabel ledger.
2. **Satu sumber kebenaran untuk saldo.** Saldo = Σ baris ledger. Tidak ada kolom saldo yang bisa ditulis.
3. **Infrastructure as code.** Migrasi, seed, tipe (`supabase gen types`), policy, dan job terjadwal ada di repo dan diterapkan lewat CI.
4. **Per domain.** `src/features/<domain>` berisi query, action, schema, komponen.
5. **Design system.** Token + primitif; halaman tidak menulis warna/spasi mentah.
6. **Gagal dengan jujur.** Setiap daftar punya loading/empty/error; setiap aksi uang punya hasil yang pasti (sukses dengan undo, atau gagal tanpa efek).

## 3. Stack

| Lapisan | Pilihan | Catatan |
|---|---|---|
| Framework | Next.js App Router (versi stabil terbaru saat M0, ≥ 15), React 19, TypeScript `strict` + `noUncheckedIndexedAccess` | RSC untuk baca, Server Actions untuk tulis |
| DB/Auth | Supabase (Postgres 17, Auth, pg_cron) project baru | Supabase CLI untuk lokal & migrasi |
| Validasi | Zod di setiap batas (form, server action, respons AI, harga) | Skema dibagi client/server |
| Tipe DB | `supabase gen types typescript` di CI; build gagal jika usang | |
| Cache client | TanStack Query **hanya** untuk layar interaktif (quick add, filter transaksi) | Default: RSC + `revalidateTag` |
| UI | Tailwind CSS v4 + Radix UI primitives (pola shadcn/ui), lucide-react, Recharts v3 (lazy) | |
| Tes | Vitest (util, schema), pgTAP (fungsi uang, RLS, invarian), Playwright (alur E2E, axe) | |
| Kualitas | ESLint (next + typescript-eslint strict), Prettier, `tsc --noEmit`, `npm audit`, Renovate | |
| CI | GitHub Actions: lint → typecheck → unit → `supabase db reset` + pgTAP → build → Playwright | |
| Observabilitas | Logging terstruktur (pino) di server + Sentry (opsional, keputusan biaya) | |
| Deploy | Vercel (seperti v1) | |

### Keputusan D1 — Pola tulis
| Alternatif | Plus | Minus |
|---|---|---|
| A. Server Action → `supabase.rpc('fn')` dengan JWT user | Logika di DB, RLS tetap berlaku, satu round-trip | Fungsi SQL lebih sulit ditulis/dites daripada TS |
| B. Server Action berisi logika TS + service role | TS lebih ekspresif | Melewati RLS; atomik butuh transaksi manual; logika uang kembali tersebar |
| C. Edge Function per operasi | Terisolasi | Latensi tambahan, deploy terpisah, tetap butuh transaksi DB |
**Rekomendasi: A.** Server Action hanya: autentikasi, validasi Zod, panggil RPC, `revalidateTag`, petakan error ke pesan Indonesia.

## 4. Model uang

### Keputusan D2 — Representasi nominal
| Alternatif | Plus | Minus |
|---|---|---|
| A. `bigint` rupiah utuh | Tanpa pecahan; aman di JS sampai 9×10¹⁵ (`Number.isSafeInteger`); cepat | Multi-mata-uang nanti butuh kolom skala |
| B. `numeric(18,2)` | Siap sen/valas | Pecahan muncul di UI IDR; JS menerima string/float |
| C. `bigint` satuan terkecil per mata uang (ISO 4217 minor unit) | Siap valas | IDR minor unit = 2 → semua angka ×100, membingungkan saat debug |
**Rekomendasi: A** untuk MVP, dengan kolom `currency char(3) default 'IDR'` di akun dan CHECK `currency = 'IDR'` sampai valas diputuskan.
Harga per lembar saham dan qty disimpan `numeric(20,4)` (harga IDX bulat, tetapi reksa dana punya NAB pecahan); nilai rupiah hasilnya dibulatkan ke rupiah di satu fungsi.

`src/lib/money.ts`: `parseRupiah("1.250.000") → 1250000`, `formatRupiah(n, {compact})` → `Rp 1.250.000` / `Rp 1,25 jt`, tolak non-integer/negatif di input, tes properti (Vitest + fast-check).

### Keputusan D3 — Model ledger
| Alternatif | Plus | Minus |
|---|---|---|
| A. Seperti v1: tabel `transactions` + `transfers` + kolom `balance` dijaga trigger (ditambah UPDATE) | Paling dekat v1; migrasi mudah | Dua tabel uang + aset terpisah = tiga jalur saldo; "edit" tetap rawan; aset dan utang punya logika sendiri |
| B. **Jurnal sederhana**: `entries` (header: jenis, tanggal, deskripsi, kategori, tautan) + `entry_lines` (akun, jumlah bertanda). Saldo = Σ lines per akun | Satu jalur untuk semua perpindahan (transaksi, transfer, fee, modal trading, goal, setor aset); invarian "transfer internal Σ = 0" bisa dicek; laporan = filter `kind` | Konsep baru; query laporan perlu view |
| C. Double-entry penuh dengan akun income/expense | Paling ketat | Berlebihan untuk app pribadi; UI harus menyembunyikannya |
**Rekomendasi: B.** Akun = dompet **dan** aset. Income/expense adalah entri satu sisi (1 line) dengan `kind`; transfer = 2–3 lines (sumber, tujuan, fee) dengan Σ lines = −fee.

### Keputusan D4 — Saldo tersimpan atau turunan
| Alternatif | Plus | Minus |
|---|---|---|
| A. View `account_balances` = Σ lines | Tidak bisa melenceng | Σ di setiap baca (puluhan ribu baris: <5 ms dengan index `(account_id)` + `INCLUDE (amount)`) |
| B. Kolom cache diperbarui trigger + tes rekonsiliasi | Baca O(1) | Bisa melenceng jika ada jalur tulis lupa |
**Rekomendasi: A**, dengan index covering. Jika suatu saat lambat, tambah materialized cache yang dijaga trigger **dan** pgTAP rekonsiliasi (ADR).

### Edit, hapus, audit
- Edit dilakukan di dalam fungsi: kunci baris (`SELECT … FOR UPDATE`), cek `version` (optimistic lock), tulis versi lama ke `entry_history`, ganti lines, `version + 1` — semua dalam satu transaksi. ID stabil.
- Hapus = soft delete (`voided_at`, `voided_reason`); view saldo mengabaikan entri void; undo = un-void dalam 10 detik di UI (dan tetap tersedia dari riwayat).
- Idempotensi: setiap RPC tulis menerima `p_client_id uuid`; UNIQUE `(user_id, client_id)` → panggilan ulang mengembalikan hasil yang sama.

## 5. Skema (ringkas)

Semua tabel: `id uuid pk`, `user_id uuid not null`, `created_at`, `updated_at`. Semua FK ke data user berbentuk **komposit**
`(user_id, x_id) references x(user_id, id)` dengan UNIQUE `(user_id, id)` di tabel target, sehingga baris tidak bisa menunjuk milik user lain (menutup SEC-01).

```sql
-- akun = dompet atau aset
create type account_kind as enum ('wallet','asset');
create type pocket as enum ('operasional','tabungan','kantor');
create type asset_class as enum ('cash_equivalent','stock','mutual_fund','property','vehicle','electronics','other');
create table accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  kind account_kind not null,
  name text not null check (length(name) between 1 and 60),
  pocket pocket,                         -- wajib untuk wallet
  wallet_type text check (wallet_type in ('cash','bank','ewallet','investment')),
  asset_class asset_class,               -- wajib untuk asset
  ticker text,                           -- saham IDX/reksa dana
  currency char(3) not null default 'IDR' check (currency = 'IDR'),
  archived_at timestamptz,
  sort_order int not null default 0,
  unique (user_id, id),
  check ((kind = 'wallet') = (pocket is not null)),
  check ((kind = 'asset') = (asset_class is not null))
);

create type entry_kind as enum (
  'income','expense',               -- operasional, masuk laporan
  'transfer',                       -- antar akun milik sendiri (termasuk setor/tarik aset, top up goal)
  'opening_balance','adjustment',   -- saldo awal & koreksi rekonsiliasi
  'debt_principal','debt_payment',  -- utang/piutang/modal trading
  'reimbursement',                  -- pelunasan talangan kantor
  'valuation'                       -- perubahan nilai aset non-kas (harga/penilaian), bukan arus kas
);
create table entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  kind entry_kind not null,
  occurred_on date not null,                       -- tanggal kalender WIB
  description text check (length(description) <= 200),
  category_id uuid,                                -- hanya income/expense
  trip_id uuid, loan_id uuid, goal_id uuid, recurring_occurrence_id uuid,
  reimbursable boolean not null default false,     -- expense ditalangi untuk kantor
  reimburses_entry_id uuid,                        -- untuk kind = reimbursement
  client_id uuid not null,                         -- idempotensi
  version int not null default 1,
  voided_at timestamptz, voided_reason text,
  unique (user_id, id), unique (user_id, client_id),
  foreign key (user_id, category_id) references categories (user_id, id),
  foreign key (user_id, trip_id) references trips (user_id, id),
  foreign key (user_id, loan_id) references loans (user_id, id),
  foreign key (user_id, goal_id) references goals (user_id, id),
  check ((kind in ('income','expense')) or category_id is null),
  check (kind = 'expense' or not reimbursable),
  check ((kind = 'reimbursement') = (reimburses_entry_id is not null))
);
create table entry_lines (
  entry_id uuid not null, user_id uuid not null,
  account_id uuid not null,
  amount bigint not null check (amount <> 0),       -- + masuk, − keluar
  role text not null check (role in ('main','counter','fee')),
  foreign key (user_id, entry_id) references entries (user_id, id) on delete cascade,
  foreign key (user_id, account_id) references accounts (user_id, id),
  primary key (entry_id, role)
);
create index on entry_lines (account_id) include (amount);
-- trigger constraint (deferrable) memastikan bentuk lines sesuai kind:
--   income: 1 line > 0; expense: 1 line < 0; transfer: main < 0, counter > 0, |main| = counter + fee;
--   debt_*: sesuai arah pinjaman; valuation: hanya akun asset.

create view account_balances with (security_invoker = true) as
  select l.user_id, l.account_id, sum(l.amount)::bigint as balance
  from entry_lines l join entries e on e.id = l.entry_id
  where e.voided_at is null group by 1, 2;
```

Tabel domain lain (ringkas):

| Tabel | Kolom kunci | Catatan |
|---|---|---|
| `categories` | `type income/expense`, `parent_id` (komposit), `archived_at` | CHECK 2 level & `type` anak = induk (trigger); `entries.category_id` = kategori paling spesifik; anggaran induk menjumlah anak (fungsi) |
| `contacts` | nama, telepon, catatan | |
| `loans` | `direction borrowed/lent`, `contact_id?`, `is_internal` (modal trading), `principal bigint`, `due_on?`, `source_account_id?`, `holding_account_id?`, `closed_at?` | Sisa = principal − Σ `debt_payment` (view `loan_balances`); `is_completed` turunan |
| `goals` | nama, target, `target_on?`, ikon (lucide), warna token | |
| `goal_accounts` | `goal_id`, `account_id` | UNIQUE `account_id` di antara goal aktif (keputusan §12-6) |
| `holdings` / `investment_lots` | lot buy/sell (qty, price, fee, `entry_id`) | Beli saham = transfer dompet RDN → akun saham (biaya) + lot; jual = sebaliknya + P/L terealisasi (FIFO atau rata-rata, ADR) |
| `price_quotes` | `ticker`, `price`, `as_of`, `source` | Cache harga; nilai pasar = qty × harga terakhir |
| `budgets` | `category_id`, `month date` (tgl 1), `amount` | UNIQUE (user, category, month) |
| `budget_plans` | `month`, `estimated_income` | `budget_plan_allocations` (label, account, amount) menggantikan JSON |
| `recurring_rules` | jenis, akun, kategori, jumlah, `rrule` sederhana (freq, interval, by_month_day, by_weekday), `auto_post`, `starts_on`, `ends_on?` | |
| `recurring_occurrences` | `rule_id`, `due_on`, `status due/posted/skipped`, `entry_id?` | UNIQUE (rule_id, due_on) → idempoten |
| `trips`, `trip_exclusions` | seperti v1 | `entry_id` stabil (edit tidak mengganti id) |
| `net_worth_snapshots` | `on date`, total per komponen | Diisi job harian |
| `entry_history` | salinan entry+lines sebelum edit/void, `changed_by`, `changed_at` | Audit |
| `profiles`, `access` | nama, preferensi; `access.plan/role/expires_at` hanya ditulis service role | §7 |
| `ai_usage` | `user_id`, `day`, `count` | rate limit |

### Fungsi RPC (skema `api`, `security definer`, `search_path = ''`)

`create_entry`, `update_entry`, `void_entry`, `restore_entry`, `create_transfer` (dompet↔dompet, dompet↔aset, fee), `adjust_balance` (rekonsiliasi),
`create_loan`, `record_loan_payment` (tolak/batasi kelebihan — §12-7), `void_loan_payment`, `update_loan_meta`, `close_loan`,
`goal_contribute` / `goal_withdraw` (transfer bertanda goal), `record_lot`, `void_lot`, `settle_reimbursement`, `post_recurring_occurrence`,
`budget_actuals(month)`, `period_summary(from, to)`, `net_worth(on)`, `dashboard_summary(today)`.
Semua fungsi: `auth.uid()` wajib; validasi argumen; `p_client_id`; `p_expected_version` untuk edit; error dengan kode (`DK001 saldo_tidak_cukup` dsb.) yang dipetakan ke pesan Indonesia.

### RLS
- `alter table … enable row level security` untuk semua tabel; `force row level security`.
- Tabel ledger (`entries`, `entry_lines`, `investment_lots`, `loans`, `recurring_occurrences`): **hanya policy SELECT** `user_id = (select auth.uid())`. Tulis hanya via fungsi.
- Tabel referensi (`accounts` metadata, `categories`, `contacts`, `trips`, `goals`, `budgets`, `budget_plans`): SELECT/INSERT/UPDATE/DELETE own, `WITH CHECK` sama; FK komposit mencegah referensi lintas user.
- `REVOKE` semua dari `anon`; `EXECUTE` fungsi `api.*` hanya untuk `authenticated`; fungsi trigger di skema `private` tanpa EXECUTE untuk siapa pun.
- pgTAP: setiap tabel × setiap operasi × dua user (A tidak bisa membaca/menulis/menunjuk milik B) + tes "semua tabel publik punya RLS".

### Zona waktu
`entries.occurred_on date` adalah tanggal kalender pilihan user. Default tanggal di server: `(now() at time zone 'Asia/Jakarta')::date`.
Periode laporan dihitung di SQL (`date_trunc('month', d)` dan `+ interval '1 month' - 1 day`). Satu util TS `todayWIB()` untuk UI. Tes T13.

## 6. Struktur repo

```
dompetku-v2/
  supabase/
    migrations/        # SQL berurutan; tidak ada perubahan dashboard
    tests/             # pgTAP: *.test.sql
    seed.sql           # kategori default, data demo lokal
    config.toml
  src/
    app/(auth)/…  app/(app)/{beranda,transaksi,dompet,rencana,lainnya}/…  app/api/…
    features/
      accounts/ entries/ transfers/ budgets/ loans/ goals/ assets/ recurring/ trips/ reports/ ai/
        queries.ts  actions.ts  schema.ts  components/
    components/ui/     # Button, Dialog, Sheet, Select, Combobox, Toast, Tabs, Tooltip, MoneyInput, …
    lib/               # money.ts, date.ts, supabase/{server,client}.ts, errors.ts, env.ts (Zod)
    types/database.ts  # hasil supabase gen types
  tests/e2e/           # Playwright + axe
  scripts/migrate-v1/  # ETL
  docs/
```

## 7. Auth, akses, trial

### Keputusan D5 — Model akses
| Alternatif | Plus | Minus |
|---|---|---|
| A. Pribadi: allowlist email di tabel `access` (bukan hardcode); daftar ditolak di hook `before-user-created` | Sesuai pemakaian nyata v1 (2 user) | Tidak bisa dibuka publik tanpa perubahan |
| B. Publik + trial **batasi akses**: setelah `expires_at`, read-only + export; data dipertahankan N hari lalu dihapus job | Ramah user, sesuai praktik | Butuh billing/upgrade path |
| C. Publik + trial **hapus data** otomatis (seperti v1 dulu) | Sederhana | Kehilangan data mengejutkan; risiko hukum/kepercayaan |
**Rekomendasi: A untuk MVP**, dengan tabel `access(user_id, role, plan, expires_at)` yang ditulis service role saja, sehingga B bisa diaktifkan tanpa migrasi besar.
Penegakan di **satu** tempat: fungsi `private.has_access()` dipakai RLS (SELECT) dan setiap RPC tulis; middleware hanya menyegarkan sesi dan redirect UX.

- Server: `getUser()` (bukan `getSession`) di helper `requireUser()`; middleware matcher **termasuk** `/api/*`.
- Header: CSP (nonce), HSTS, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`.
- Supabase Auth: leaked password protection on, rate limit default, email OTP/magic link (opsional), reset password.

## 8. Fitur server lain

### AI (D6)
| Alternatif | Plus | Minus |
|---|---|---|
| A. Server action: hitung `period_summary` di DB → prompt template di server → Gemini → Zod → simpan hasil | Aman, murah, bisa di-cache per bulan | Tanya-bebas tetap butuh batas |
| B. Pertahankan route v1 + auth | Cepat | Prompt tetap dari client |
| C. Tunda AI | Fokus ke inti | Kehilangan fitur yang ada |
**Rekomendasi: A** di milestone 6. Provider: Gemini (kunci sudah ada) di balik interface `AiProvider`; model & kunci dari env server. Rate limit `ai_usage` (mis. 20/hari/user). Tidak mengirim nama kontak/deskripsi mentah; hanya agregat kategori.

### Harga saham (D7)
| Alternatif | Plus | Minus |
|---|---|---|
| A. Route server → Yahoo chart API (tidak resmi) + cache `price_quotes` 15 menit + fallback input manual | Gratis, cakupan IDX & reksa dana terbatas | Tidak resmi, bisa berubah/diblok |
| B. Penyedia berbayar (mis. EODHD/Twelve Data) | Stabil, ada ToS | Biaya bulanan |
| C. Manual saja | Nol dependensi | Repot |
**Rekomendasi: A dengan antarmuka `PriceSource`** sehingga bisa diganti B tanpa ubah domain; tampilkan "Diperbarui 10.32 WIB · sumber Yahoo"; validasi harga > 0 dan perubahan harian < 35% (auto-reject IDX). Reksa dana/RDPU: NAB manual atau `valuation` entry.

### Job terjadwal (pg_cron, semua idempoten, waktu WIB)
| Job | Jadwal | Isi |
|---|---|---|
| `recurring_materialize` | 00:05 WIB | Buat `recurring_occurrences` jatuh tempo ≤ hari ini; `auto_post` → `post_recurring_occurrence` |
| `net_worth_snapshot` | 23:55 WIB | Upsert snapshot hari ini |
| `price_refresh` | 16:30 WIB hari bursa | via Edge Function/route terjadwal |
| `purge_voided` | mingguan | Hapus permanen entri void > 90 hari (keputusan §12-8) |
Kalender bulan: `by_month_day = 31` → hari terakhir bulan bila bulan lebih pendek (tes T14). Status job dicatat di `job_runs`; job gagal → alert (bukan diam 2.000× seperti v1).

## 9. Migrasi data v1 → v2

Asumsi default: data v1 nyata dan dibawa (keputusan §12-2).

**Sumber:** project v1 read-only. Cara baca (pilih saat eksekusi): (a) pemilik menjalankan `pg_dump --data-only` dan menyerahkan file ke lingkungan migrasi, atau (b) role Postgres read-only khusus migrasi. Tidak ada tulis ke v1.

**ETL** (`scripts/migrate-v1/`, TypeScript, bisa diulang, deterministik):
1. Muat dump ke skema `v1` di DB staging v2 (bukan produksi).
2. Transformasi SQL `v1 → public` dengan pemetaan id (UUID v1 dipertahankan bila tidak bentrok, sehingga tautan tetap).
3. Validasi + laporan rekonsiliasi; jika lulus, ulangi ke produksi v2 dalam satu transaksi.

| v1 | v2 | Aturan |
|---|---|---|
| `wallets` | `accounts(kind=wallet)` | `pocket`, `type` disalin; `is_active=false` → `archived_at` |
| `assets` | `accounts(kind=asset)` | `type` → `asset_class` (investment+ticker → stock; investment tanpa ticker → mutual_fund/cash_equivalent per pemilik) |
| `transactions` | `entries` + 1 line | `debt_id` → `debt_principal`/`debt_payment` (dari awalan deskripsi `[Hutang]`/`[Piutang]`/`[Bayar Hutang]`/`[Terima Piutang]`); `Reimburse:` → `reimbursement` ditaut ke expense reimbursable (cocokkan jumlah+deskripsi; sisa → daftar tinjau); `savings_goal_id` income → `transfer` aset→dompet; kategori: pakai `subcategory_id` bila valid dan induknya cocok, jika tidak `category_id` (63 baris tak konsisten → laporan) |
| `transfers` | `entries(kind=transfer)` + 2–3 lines | `from/to_asset_id` → akun aset; `fee` → line `fee`; `debt_id` → `loan_id` (modal trading); `savings_goal_id` → `goal_id` |
| `debts` + `contacts` | `loans` + `contacts` | `is_capital_loan` → `is_internal`; `paid_amount` dibandingkan Σ pembayaran; selisih (1 baris) → `debt_payment` "Penyesuaian migrasi" bertanda |
| `investment_lots` | `investment_lots` | qty/price disalin; tanpa entri kas (v1 tidak mencatat uangnya) — ditandai `legacy` |
| `savings_goals` + `savings_goal_wallets` | `goals` + `goal_accounts` | `asset_id` → akun aset; `wallet_id` lama dipakai bila tak ada baris junction |
| `budgets`, `budget_plan` | `budgets`, `budget_plans` + allocations | JSON → baris; anggaran subkategori dipertahankan (sekarang benar dihitung) |
| `trips`, `trip_excluded_transactions` | sama | |
| `net_worth_snapshots` | sama | historis apa adanya, ditandai `source='v1'` |
| `categories` | sama | `icon` emoji → ikon lucide (tabel pemetaan) dengan emoji disimpan di `legacy_emoji` |
| `credit_cards`, `recurring_transactions` | — | 0 baris |

**Saldo:** untuk setiap akun, `opening_balance` = saldo v1 tersimpan − Σ ledger v1 yang dimigrasi, bertanggal sehari sebelum entri pertama,
sehingga **saldo v2 = saldo v1 yang dilihat user**. Selisih negatif (3 dompet) diberi deskripsi "Penyesuaian migrasi — selisih v1" dan masuk laporan tinjauan.
Nilai aset: `valuation` entry agar nilai v2 = `assets.value` v1.

**Laporan rekonsiliasi** (`migration-report.md`, dibuat otomatis, tanpa data pribadi selain agregat):
jumlah baris per tabel sumber vs tujuan; saldo per akun v1 vs v2 (harus 0 selisih); total utang & piutang terbuka; nilai aset per akun; net worth hari H;
income/expense per bulan v1 vs v2 (berbeda secara sengaja — dijelaskan per sebab: tanggal akhir bulan, kantor, pokok utang, reimburse); daftar baris yang butuh tinjauan.

**Cutover:** bekukan v1 (pemilik berhenti input) → migrasi final → verifikasi bersama pemilik → v2 aktif → v1 tetap read-only 30 hari → arsip.

## 10. Kinerja

- Baca via RSC dengan query terarah (fungsi ringkasan di DB), tanpa waterfall `getSession`.
- Index: `entries (user_id, occurred_on desc) where voided_at is null`, `entry_lines (account_id) include (amount)`, FK komposit ter-index (menutup advisor 22 FK).
- RLS memakai `(select auth.uid())` (menutup advisor 46 initplan).
- Recharts di-load dinamis hanya di Laporan; target First Load JS ≤ 150 kB untuk Beranda dan Transaksi.
- Daftar transaksi: paginasi kursor 50 baris + total dari fungsi DB.
- `next/font` self-host 2 bobot.

## 11. Risiko

| Risiko | Mitigasi |
|---|---|
| Model jurnal terasa asing bagi user | UI tetap bicara "pemasukan/pengeluaran/transfer"; jurnal tidak terlihat |
| Fungsi SQL sulit dirawat | pgTAP test-first; satu fungsi per operasi; konvensi error |
| Migrasi menemukan kasus tak terduga | Staging berulang; daftar tinjau; tidak ada tulis ke v1 |
| Harga Yahoo berhenti | Interface `PriceSource`, fallback manual |
| Biaya (project Supabase kedua, Sentry, Gemini) | Keputusan pemilik §12-9 |

## 12. Keputusan yang dibutuhkan dari pemilik produk

| # | Pertanyaan | Rekomendasi |
|---|---|---|
| 1 | Model akses v2 | Pribadi/allowlist (D5-A), siap diubah ke trial-batasi-akses |
| 2 | Migrasi data v1 | Bawa data dengan entri penyesuaian saldo eksplisit |
| 3 | Piutang (termasuk modal trading) dihitung sebagai aset di net worth | Ya — uang yang dipinjamkan masih milik user; tampil terpisah "Piutang" |
| 4 | Pembayaran cicilan utang di laporan pengeluaran | Tidak (itu pelunasan pokok); laporan menampilkan "Pembayaran utang" terpisah. Pinjaman masuk juga bukan pemasukan |
| 5 | Pengeluaran talangan kantor (reimbursable) | Tidak dihitung pengeluaran pribadi; tampil sebagai "Menunggu reimburse"; penggantian bukan pemasukan |
| 6 | Satu dompet hanya untuk satu tujuan tabungan aktif | Ya (mencegah hitung ganda); jika perlu berbagi, pakai alokasi nominal (ditunda) |
| 7 | Bayar cicilan melebihi sisa | Tolak dengan pesan dan tombol "Bayar sisa Rp…" |
| 8 | Hapus data keuangan | Soft delete + undo; permanen setelah 90 hari |
| 9 | Infrastruktur | Project Supabase baru region Singapore; free tier di awal (perhatikan batas 2 project aktif — v1 sedang aktif); Sentry opsional |
| 10 | Kartu kredit | Tunda; nanti sebagai akun dompet bertipe `credit` (saldo negatif = tagihan) |
| 11 | Biaya AI | Gemini dengan rate limit 20/hari/user |
