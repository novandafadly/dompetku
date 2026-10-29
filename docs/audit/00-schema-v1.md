# 00 — Rekonstruksi Skema DompetKu v1

Sumber: project Supabase `yvapmbjtuhqvsunkmkxw` ("DompetKu", Postgres 17.6, region ap-southeast-1).
Diekstrak **read-only** pada 2026-10-29 lewat MCP Supabase (`list_tables`, `pg_constraint`, `pg_indexes`,
`pg_trigger`, `pg_get_functiondef`, `pg_policies`, `cron.job`, `get_advisors`). Tidak ada operasi tulis.
Project sempat berstatus `INACTIVE` (paused) dan dipulihkan atas izin pemilik produk sebelum ekstraksi.

Replika DDL yang bisa dijalankan ada di [`repro/v1_schema_replica.sql`](repro/v1_schema_replica.sql)
(tabel, FK, trigger, dan fungsi disalin apa adanya; RLS disalin untuk tabel yang relevan dengan reproduksi).

Repo v1 **tidak** menyimpan migrasi (tidak ada folder `supabase/` atau file `.sql`; `find . -name '*.sql'` → 0 hasil sebelum audit ini).
Riwayat migrasi hanya ada di Supabase: `list_migrations` mengembalikan **46 migrasi** (2026-03-28 s/d 2026-08-25), dibuat lewat
dashboard/MCP, termasuk `debug_prevent_balance_trigger`, `force_schema_cache_reload`, dan beberapa migrasi data
(`auto_assign_subcategories_existing_transactions`, `manual_assign_subcategories_batch`). Sebagian migrasi menyimpan UUID user
dan email pemilik secara literal di `supabase_migrations.schema_migrations.statements`.

Kronologi trial (dari `statements` migrasi, read-only):
- `20260417200427 add_trial_system`: menambah `profiles.role`/`trial_expires_at` dan fungsi `cleanup_expired_trials()` (SECURITY DEFINER) yang menghapus data user trial kedaluwarsa dari 13 tabel (tidak termasuk `trips`, `budget_plan`, `savings_goal_wallets`, `trip_excluded_transactions`, dan `auth.users`).
- `20260627183414 update_role_constraint_and_set_permanent`: semua user diset `permanent`.
- `20260627183713 security_hardening_block_register_fix_policies`: registrasi diblok dengan whitelist email.
- Fungsi `cleanup_expired_trials()` kemudian tidak ada lagi, tetapi cron job-nya tetap aktif (§6).
- `20260719111703 add_farida_to_signup_whitelist` mengganti `handle_new_user` **tanpa** `SET search_path` (versi 2026-06-27 masih punya), sehingga advisor `function_search_path_mutable` muncul lagi.

## 1. Ringkasan

| Item | Jumlah |
|---|---|
| Tabel `public` | 18 |
| Trigger non-internal | 6 (5 di `public`, 1 di `auth.users`) |
| Fungsi `public` | 7 |
| Policy RLS | 46, RLS aktif di 18/18 tabel |
| View / materialized view | 0 / 0 |
| Storage bucket | 0 |
| Edge Function | 0 |
| Cron job | 1 (gagal sejak 2026-06-27, lihat §6) |
| Extension | `pg_cron 1.6.4`, `pg_stat_statements`, `pgcrypto`, `plpgsql`, `supabase_vault`, `uuid-ossp` |
| Zona waktu DB | `UTC` (`pg_settings.TimeZone`) |

## 2. Perkiraan jumlah baris (hanya hitungan)

Hitungan `count(*)` per tabel. Statistik `pg_class` menunjukkan 0 karena project baru dipulihkan, jadi angka di bawah memakai `count(*)`.

| Tabel | Baris | | Tabel | Baris |
|---|---|---|---|---|
| auth.users | 3 | | debts | 46 |
| profiles | 2 | | contacts | 9 |
| wallets | 25 | | recurring_transactions | **0** |
| categories | 124 | | savings_goals | 7 |
| transactions | 892 | | savings_goal_wallets | 4 |
| transfers | 88 | | net_worth_snapshots | 96 |
| budgets | 38 | | trips | 9 |
| budget_plan | 5 | | trip_excluded_transactions | 25 |
| assets | 10 | | credit_cards | **0** |
| investment_lots | 26 | | | |

Rentang tanggal transaksi: 2026-03-24 s/d 2026-09-05 (tidak ada transaksi baru sejak September).
Satu `auth.users` tidak punya baris `profiles`.

## 3. Tabel, kolom, constraint

Notasi: `?` = nullable, `=` default. Semua PK `uuid`. Semua `user_id` → `auth.users(id) ON DELETE CASCADE`
kecuali `savings_goal_wallets.user_id` (tanpa `ON DELETE`).

### profiles
`id` PK → auth.users CASCADE · `full_name?` · `avatar_url?` · `currency? ='IDR'` · `created_at?`, `updated_at?` ·
`role ='trial'` CHECK in (`permanent`,`trial`,`admin`) · `trial_expires_at?`

### wallets
`user_id` · `name` · `type` CHECK in (`cash`,`bank`,`ewallet`,`investment`) · `balance? numeric =0` · `icon?` · `color?` ·
`is_active? =true` · `pocket ='operasional'` CHECK in (`operasional`,`tabungan`,`kantor`) · `currency ='IDR'` ·
`exchange_rate =1` CHECK > 0 · timestamps.
Tidak ada CHECK pada `balance` (boleh negatif; 1 wallet saat ini bersaldo negatif).
`currency` dan `exchange_rate` ada di DB tetapi **tidak dipakai kode** (grep `exchange_rate` di `app/` → 0).

### categories
`user_id?` · `name` · `type` CHECK in (`income`,`expense`) · `icon?` · `color?` · `is_default? =false` ·
`parent_id?` → categories ON DELETE SET NULL. Trigger `trg_check_category_depth` membatasi 2 level.
Tidak ada CHECK bahwa `type` anak = `type` induk, dan tidak ada UNIQUE nama.

### transactions
`user_id` · `wallet_id` → wallets **CASCADE** · `category_id?` → categories SET NULL ·
`subcategory_id?` → categories SET NULL · `type` CHECK in (`income`,`expense`) · `amount numeric` CHECK > 0 ·
`description?` · `date date =CURRENT_DATE` (UTC) · `created_at?` · `debt_id?` → debts SET NULL ·
`is_reimbursable =false` · `reimbursed_at? timestamptz` · `trip_id?` → trips SET NULL ·
`savings_goal_id?` → savings_goals SET NULL.
Tidak ada kolom `updated_at`, tidak ada FK reimburse→transaksi asal, tidak ada `recurring_id`.

### transfers
`user_id` · `from_wallet_id?` → wallets **CASCADE** · `to_wallet_id?` → wallets **CASCADE** ·
`from_asset_id?` → assets SET NULL · `to_asset_id?` → assets SET NULL · `amount` CHECK > 0 ·
`fee? =0` CHECK null or ≥ 0 · `note?` · `description?` (duplikat `note`) · `date =CURRENT_DATE` ·
`savings_goal_id?` → savings_goals SET NULL · `savings_type?` CHECK in (`topup`,`withdraw`) ·
`debt_id?` → debts SET NULL.
Tidak ada CHECK "tepat satu sumber" / "tepat satu tujuan" / `from <> to`; eksklusivitas wallet vs aset hanya
dijelaskan di komentar kolom ("enforced at the application layer").

### budgets
`user_id` · `category_id` → categories CASCADE · `amount` CHECK > 0 · `period_month` CHECK 1..12 · `period_year` ·
`rollover_enabled =false` (tidak dipakai kode) · UNIQUE (`user_id`,`category_id`,`period_month`,`period_year`).

### budget_plan
`user_id` · `period_month smallint` CHECK 1..12 · `period_year smallint` · `estimated_income =0` ·
`savings_allocations jsonb ='[]'` · timestamps · UNIQUE (`user_id`,`period_month`,`period_year`).

### assets
`user_id` · `name` · `type` CHECK in (`investment`,`property`,`vehicle`,`electronics`,`other`) · `value numeric =0` ·
`purchase_date?` · `description?` · `ticker?` · `qty? =0` · `avg_price? =0` · `current_price? =0` ·
`last_price_update?` · timestamps. Tidak ada CHECK `value >= 0`.

### investment_lots
`user_id` · `asset_id` → assets CASCADE · `action` CHECK in (`buy`,`sell`) · `qty` · `price` (tanpa CHECK > 0) ·
`total_amount` GENERATED (`qty * price`) · `date =CURRENT_DATE` · `note?`.

### credit_cards
`user_id` · `name` · `bank` · `card_limit =0` · `used_amount =0` · `billing_date?` CHECK 1..31 · `due_date?` CHECK 1..31 · `color?`.

### debts
`user_id` · `type` CHECK in (`debt`,`receivable`) · `person_name` · `total_amount` CHECK > 0 · `paid_amount =0`
(tanpa CHECK ≤ total) · `description?` · `due_date?` · `is_completed? =false` · `contact_id?` → contacts SET NULL ·
`wallet_id?` → wallets SET NULL · `is_capital_loan =false` · `trading_wallet_id?` → wallets SET NULL ·
`asset_id?` → assets SET NULL.

### contacts
`user_id` · `name` · `phone?` · `note?` · `avatar_color? ='#3b82f6'`.

### recurring_transactions
`user_id` · `wallet_id?` → wallets SET NULL · `category_id?` → categories SET NULL · `type` · `amount` (tanpa CHECK) ·
`description?` · `frequency` CHECK in (`daily`,`weekly`,`monthly`,`yearly`) · `day_of_month?` CHECK 1..31 ·
`day_of_week?` CHECK 0..6 · `next_due date` · `last_executed?` · `is_active =true` · `auto_execute =false`.

### savings_goals
`user_id` · `wallet_id?` → wallets **CASCADE** (kolom lama) · `asset_id?` → assets SET NULL · `name` ·
`target_amount` CHECK > 0 · `target_date?` · `icon? ='🎯'` · `color? ='#22c55e'` · `is_completed =false` ·
`current_amount? =0` (kolom lama; 4 baris masih bernilai ≠ 0, tidak dibaca kode) · `notes?`.
Menghapus wallet lama di `wallet_id` ikut menghapus goal (CASCADE).

### savings_goal_wallets
`savings_goal_id` → savings_goals CASCADE · `wallet_id` → wallets CASCADE · `user_id` · UNIQUE (`savings_goal_id`,`wallet_id`).
Tidak ada aturan bahwa satu wallet hanya milik satu goal (saat ini 0 wallet dipakai bersama).

### net_worth_snapshots
`user_id` · `snapshot_date` · `total_balance` · `total_assets` · `total_debt` ·
`net_worth` GENERATED (`total_balance + total_assets - total_debt`) · UNIQUE (`user_id`,`snapshot_date`).

### trips / trip_excluded_transactions
trips: `user_id` · `name` · `emoji? ='✈️'` · `start_date?` · `end_date?` (tanpa CHECK start ≤ end) · `notes?` · `destination?` · `budget?`.
trip_excluded_transactions: PK (`trip_id`,`transaction_id`); `trip_id` → trips CASCADE; `transaction_id` → transactions CASCADE.

## 4. Index

Ada: `idx_transactions_user_date (user_id, date DESC)`, `idx_transactions_date`, `_user`, `_user_type`, `_wallet`,
`_trip_id`, `_subcategory_id`, `_savings_goal_id`, partial `idx_transactions_reimbursable`; `idx_transfers_user`, `_date`,
`_savings_goal_id`; `idx_budgets_user_period`; `idx_wallets_user`; `idx_assets_user`; `idx_categories_user`, `_parent_id`;
`idx_debts_user`, `_contact_id`; `idx_trips_user_id`, `_user_date`; `idx_savings_goal_wallets_goal`, `_wallet`;
`idx_savings_goals_asset_id`; `idx_trip_excluded_trip_id`; `idx_credit_cards_user`.

Advisor performa: **22 FK tanpa index** (antara lain `transfers.from_wallet_id`, `transfers.to_wallet_id`,
`transfers.debt_id`, `transactions.debt_id`, `transactions.category_id`, `investment_lots.asset_id`) dan
**21 index tidak pernah dipakai** (statistik baru, sebagian karena project baru aktif kembali).

## 5. Trigger dan fungsi

| Trigger | Tabel | Event | Fungsi | Catatan |
|---|---|---|---|---|
| `on_auth_user_created` | auth.users | AFTER INSERT | `handle_new_user()` SECURITY DEFINER, **tanpa** `search_path` | Whitelist 2 email di-hardcode; profil dibuat `role='permanent'`, `trial_expires_at=NULL`; buat 1 wallet "Dompet Cash" dan 13 kategori default (8 expense, 5 income). Email lain → `RAISE EXCEPTION 'Registrasi tidak diizinkan.'` |
| `trg_prevent_direct_balance_update` | wallets | BEFORE UPDATE | `prevent_direct_balance_update()` | Jika `balance` berubah dan GUC `app.allow_balance_update` ≠ `'true'`, **diam-diam** mengembalikan `NEW.balance := OLD.balance` (tanpa error). INSERT tidak dijaga → saldo awal bebas. |
| `on_transaction_change` | transactions | AFTER **INSERT OR DELETE** | `update_wallet_balance_on_transaction()` SECURITY DEFINER | income `+amount`, expense `-amount`. **UPDATE tidak ditangani** → mengubah `amount`/`type`/`wallet_id` lewat UPDATE membuat saldo melenceng. Tidak memeriksa kepemilikan wallet (mengandalkan policy INSERT). |
| `on_transfer_change` | transfers | AFTER **INSERT OR DELETE** | `update_wallet_balance_on_transfer()` SECURITY DEFINER | INSERT: sumber `-(amount+fee)` (wallet atau aset), tujuan `+amount` (wallet atau aset), dengan cek kepemilikan. DELETE: membalik **tanpa** cek kepemilikan. UPDATE tidak ditangani. |
| `trg_recalc_investment` | investment_lots | AFTER INSERT/UPDATE/DELETE | `recalculate_asset_investment()` | `qty = Σbuy − Σsell` (dipotong ke ≥ 0), `avg_price = Σ(buy qty×price) / Σ buy qty` (mengabaikan penjualan), `value = qty × (current_price atau avg_price)`. Menimpa `assets.value` sehingga transfer `to_asset_id` ke aset bertiker ikut hilang saat lot berubah. |
| `trg_check_category_depth` | categories | BEFORE INSERT/UPDATE | `check_category_depth()` | Maks 2 level; tidak mencegah `parent_id = id` sendiri, dan tidak mencegah kategori yang punya anak dijadikan anak. |

Fungsi lain: `next_due_date(text, date, int)` (`search_path=public`) — **tidak dipanggil** dari kode maupun cron.
Rumus `date_trunc('month') + 1 month + (dom−1) days` meluap untuk `day_of_month` 29–31 (31 → tanggal 3 bulan berikutnya pada Februari).

## 6. pg_cron

| jobid | nama | jadwal | perintah | status |
|---|---|---|---|---|
| 1 | `cleanup-expired-trials-dompetku` | `0 * * * *` | `SELECT public.cleanup_expired_trials();` | **2.090 kali gagal** (`function public.cleanup_expired_trials() does not exist`), sukses terakhir 2026-06-27 18:00 UTC; 1.651 sukses sebelumnya |

Artinya: logika penghapusan data trial pernah ada, lalu fungsinya dihapus tanpa mematikan job. Saat ini **tidak ada**
yang menegakkan trial (lihat audit 1.1).

## 7. RLS

RLS aktif di semua 18 tabel. Semua policy `PERMISSIVE`, role `public`, berbasis `auth.uid() = user_id`.

| Tabel | SELECT | INSERT | UPDATE | DELETE | Celah |
|---|---|---|---|---|---|
| wallets | own | own | own | own | — |
| transactions | own | own **+ wallet milik user** | own **+ wallet milik user** | own | `category_id`, `subcategory_id`, `debt_id`, `trip_id`, `savings_goal_id` tidak dicek kepemilikannya |
| transfers | own | own + from/to wallet + to_asset milik user | **hanya `user_id`** | own | UPDATE boleh menunjuk wallet/aset milik user lain; DELETE berikutnya memicu trigger yang mengubah saldo korban (terbukti, lihat 02-integrity S6). `from_asset_id` tidak dicek di policy (dicek di trigger INSERT saja) |
| debts | own | own + wallet milik user | **hanya `user_id`** | own | `trading_wallet_id`, `asset_id`, `contact_id` tidak dicek |
| categories | own **atau `user_id IS NULL`** | own | own | own **dan `is_default=false`** | Kategori default tidak bisa dihapus lewat RLS, tetapi UI tidak membedakannya (error generik) |
| savings_goal_wallets | own | own | — (tidak ada policy UPDATE) | own | `wallet_id` dan `savings_goal_id` tidak dicek kepemilikannya |
| profiles | own | own **+ email == 'novandafadly@gmail.com'** | own | — | Policy UPDATE mengizinkan user mengubah `role` dan `trial_expires_at` miliknya sendiri |
| assets, budgets, credit_cards | own ×4 | | | | — |
| budget_plan, contacts, investment_lots, net_worth_snapshots, recurring_transactions, savings_goals, trips, trip_excluded_transactions | `ALL` own | | | | FK lintas-tabel tidak dicek (mis. `investment_lots.asset_id`, `trip_excluded_transactions.transaction_id`) |

Grant: `anon` dan `authenticated` punya `SELECT/INSERT/UPDATE/DELETE/TRUNCATE` di tabel `public` (default Supabase); hanya RLS yang melindungi.

## 8. Advisor Supabase

Keamanan (semua `WARN`):
- `function_search_path_mutable` ×3: `check_category_depth`, `prevent_direct_balance_update`, `handle_new_user`.
- `anon_security_definer_function_executable` ×3 dan `authenticated_security_definer_function_executable` ×3:
  `handle_new_user`, `update_wallet_balance_on_transaction`, `update_wallet_balance_on_transfer` dapat dipanggil via `/rest/v1/rpc/*`
  (fungsi trigger; memanggil langsung akan gagal karena tidak dalam konteks trigger, tetapi EXECUTE seharusnya dicabut).
- `auth_leaked_password_protection`: proteksi password bocor (HaveIBeenPwned) mati.

Performa: `auth_rls_initplan` ×46 (semua policy memakai `auth.uid()` tanpa `(select auth.uid())`), `unindexed_foreign_keys` ×22, `unused_index` ×21.

## 9. Selisih antara kode dan DB

| Arah | Item | Bukti |
|---|---|---|
| Kode → DB tidak ada | Tidak ada tabel yang dipakai kode tetapi hilang di DB. Semua 18 tabel yang di-`from()` ada. | `grep -rhoE "from\('[a-z_]+'\)" app` vs daftar tabel |
| Kode → DB tidak ada | `public.cleanup_expired_trials()` dipanggil cron tetapi tidak ada | §6 |
| DB → tidak dipakai kode | `wallets.currency`, `wallets.exchange_rate`, `budgets.rollover_enabled`, `profiles.avatar_url`, `profiles.currency`, `savings_goals.current_amount`, fungsi `next_due_date` | grep di `app/`, `lib/` |
| DB → tidak dipakai kode | `profiles.role`, `profiles.trial_expires_at` hanya muncul sebagai tipe di `lib/supabase.ts:11-12` | grep |
| Tipe TS tidak sinkron | `lib/supabase.ts` tidak punya `subcategory_id`, `trip_id`, `savings_goal_id`, `fee`, `description`, `to_asset_id`, `from_asset_id`, `debt_id` (transfers), `parent_id`, sehingga kode memakai `(x as any)` (139 kemunculan `any`) | `lib/supabase.ts:40-80` |
| Asumsi kode keliru | `wallets/page.tsx:61` berkomentar "balance diset manual, tidak lewat trigger" dan UI memperingatkan "akan menimpa saldo" (`:331`), padahal trigger `prevent_direct_balance_update` membatalkan perubahan secara diam-diam | §5 |

## 10. Rekonsiliasi cepat (agregat, read-only)

Saldo tersimpan dibandingkan ledger (`Σ income − Σ expense + Σ transfer masuk − Σ (transfer keluar + fee)`) per wallet.
Karena saldo awal tidak dicatat sebagai entri, selisih positif bisa berarti saldo awal; selisih **negatif** tidak bisa dijelaskan oleh saldo awal yang wajar.

| Hasil | Jumlah wallet |
|---|---|
| Saldo = ledger | 15 |
| Selisih positif (kemungkinan saldo awal) | 6 (296; 3.629; 200.000; 342.324; 1.230.150; 1.384.874) |
| Selisih negatif (drift) | 3 (−15.000; −174.921; −2.000.000) |
| Saldo negatif | 1 (−30.218, pocket tabungan) |

Utang/piutang: 46 baris; 1 baris `paid_amount` ≠ jumlah cicilan tercatat; 8 baris `is_completed=true` padahal `paid_amount < total_amount`.

Kategori: 4 anggaran memakai subkategori (realisasinya selalu 0, lihat audit 1.2); 53 transaksi punya `subcategory_id` yang
induknya ≠ `category_id` (30 di antaranya `category_id = subcategory_id`); 10 transaksi punya `subcategory_id` tanpa `category_id`.

Tanggal: 46 transaksi jatuh di tanggal terakhir bulan, dan semuanya hilang dari laporan bulanan dan realisasi anggaran
karena bug zona waktu (audit 1.2, temuan INT-07).
