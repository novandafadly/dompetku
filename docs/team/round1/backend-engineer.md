# Ronde 1 — Backend Engineer (Postgres & domain uang)

Rujukan: spec = `docs/superpowers/specs/2026-10-29-dompetku-v2-design.md`; DESIGN = `docs/v2/DESIGN.md`; audit = `docs/audit/02-integrity.md`.

## 1. Ringkasan sikap

Model jurnal `entries`/`entry_lines` (DESIGN §4 D3-B) tepat dan saya dukung. Saldo sebagai view (D4-A) juga tepat. Masalahnya ada di cara `space_id` ditempelkan.
Keputusan "satu entri transfer dengan dua line di ruang berbeda, header di ruang sumber" (spec §5.4, §7a) bertabrakan dengan tiga hal sekaligus:
FK komposit `(space_id, …)`, aturan RLS "terlihat bila anggota `space_id`", dan larangan bocornya data Pribadi pasangan. Ruang Bersama tidak akan bisa membaca header setorannya sendiri.
Saya mengusulkan **dua entri berpasangan** (`space_transfer` + `link_id`). Setiap entri dan semua line-nya tetap di satu ruang, jadi satu aturan RLS berlaku di mana-mana.
Selain itu ada beberapa jebakan yang membuat desain sekarang gagal diam-diam. `FORCE RLS` memblokir INSERT dari fungsi `SECURITY DEFINER`. Constraint deferrable tidak pernah jalan di pgTAP. Rumus fee transfer di DESIGN §5 salah tanda. Driver `pg` mengubah `date` menjadi `Date` lokal, yaitu kelas bug INT-07. Semuanya bisa diperbaiki di M0–M1 dengan biaya kecil. Skema inti yang sudah dikoreksi ada di Lampiran A.

## 2. Rekomendasi

### R1 — Transfer lintas ruang = dua entri berpasangan, bukan satu entri dua ruang · **wajib** · M1
- **Isi:** `entry_kind` baru `space_transfer`. Satu entri di ruang sumber (line `main` < 0, opsional `fee` < 0) dan satu entri di ruang tujuan (line `main` > 0). Keduanya diikat `link_id uuid` yang sama, punya `unique (link_id, space_id)`, dan dicek oleh constraint trigger pasangan. Isi cek: tepat 2 entri, 2 ruang berbeda dalam satu household, minimal satu ruang `shared`, Σ main = 0, tanggal sama, status void sama, hanya dompet.
  Fungsi `api.*` selalu membuat, mengedit, dan membatalkan kedua kaki bersamaan. Hak edit/batal = **anggota kedua ruang**. Rumus ini otomatis cocok dengan §7a: hanya pemilik ruang Pribadi yang bisa menyentuh kakinya, ke arah mana pun.
- **Alasan:** (a) FK komposit `(space_id, entry_id) → entries(space_id, id)` hanya bisa dipakai kalau line dan header satu ruang. Di model satu entri, FK itu harus dilonggarkan dan "line tidak boleh lintas ruang" berubah jadi aturan trigger dengan pengecualian. (b) Kalau header ada di Pribadi Novanda, RLS menyembunyikannya dari Farida. Ruang Bersama tidak bisa menampilkan "Setoran dari Novanda" tanpa policy khusus "boleh lihat header bila anggota ruang salah satu line-nya". Policy seperti itu membocorkan `description`/`occurred_on` entri Pribadi. (c) Laporan per ruang tinggal `where space_id = $1`, dan kontribusi per orang di Bersama = Σ kaki masuk − Σ kaki keluar per `created_by`, tanpa menyentuh ruang Pribadi.
- **Trade-off:** dua baris per transfer lintas ruang dan satu trigger pasangan. Invarian "Σ entri = −fee" pindah ke level pasangan (`link_id`). Biaya ini jauh lebih kecil daripada pengecualian di RLS.

### R2 — Bentuk lines per `entry_kind` dikunci DB; perbaiki rumus fee · **wajib** · M1 (ADR sebelum UI, sesuai ROADMAP M1 "Risiko")
- **Isi:** matriks bentuk (PK `(entry_id, role)` tetap, jadi tiap role maksimal 1):

| kind | main | counter | fee | catatan |
|---|---|---|---|---|
| income, reimbursement | > 0 | – | – | kategori `type` = kind (income) |
| expense | < 0 | – | – | |
| transfer (satu ruang) | −amount | +amount, akun ≠ main | −fee, akun = main | Σ = −fee |
| space_transfer (kaki keluar / masuk) | −amount / +amount | – | −fee hanya di kaki keluar | Σ pasangan = −fee |
| opening_balance, adjustment | ≠ 0 | – | – | maks 1 opening per akun (lewat `api.create_account`) |
| valuation | ≠ 0, akun `asset` | – | – | |
| debt_principal, debt_payment | tanda sesuai `loans.direction` | – | opsional | `loan_id` wajib |

  DESIGN §5 menulis transfer `|main| = counter + fee` **dan** line `fee` terpisah. Kalau main sudah memuat fee lalu line fee juga negatif, Σ = −2·fee, bukan −fee seperti klaim D3. Fee dihitung dua kali. Pakai main = −amount, fee terpisah.
  Line `fee` masuk laporan sebagai **pengeluaran** dengan kategori sistem "Biaya transfer" per ruang. Kalau tidak, filter `kind in ('income','expense')` membuat fee hilang dari laporan (mirip INT-09).
- **Mekanisme:** `CONSTRAINT TRIGGER … DEFERRABLE INITIALLY DEFERRED` di `entries` dan `entry_lines` memanggil `private.assert_entry_shape(entry_id)`. **Setiap fungsi `api.*` dibuka dengan `set constraints all deferred` dan ditutup dengan `set constraints all immediate`.** Dengan begitu:
  1. error bentuk muncul di dalam fungsi dengan SQLSTATE `DK500`, bukan saat `COMMIT` (Kysely melempar dari `execute()`, dan stack trace hilang konteks);
  2. pgTAP benar-benar menguji cek ini. Tes pgTAP berjalan dalam satu transaksi yang di-rollback, jadi trigger deferred **tidak pernah** jalan tanpa langkah ini. Tes akan hijau palsu;
  3. trigger deferred tidak jalan di konteks user commit (`dompetku_app`) yang tidak punya hak baca yang dibutuhkan.
- **Alasan:** cek ini adalah pertahanan berlapis terhadap bug di fungsi `api.*` sendiri, bukan terhadap user. Itu satu-satunya jalur tulis.

### R3 — Model role & kepemilikan fungsi yang benar-benar jalan dengan `FORCE RLS` · **wajib** · M0
- **Isi:** empat role, bukan tiga (spec §5.2):
  - `dompetku_owner`: LOGIN, **BYPASSRLS**, pemilik skema/tabel. Hanya untuk migrasi. Juga pemilik fungsi cek `private.*` yang perlu melihat dua ruang.
  - `dompetku_api`: **NOLOGIN, NOBYPASSRLS**, pemilik semua fungsi `api.*` (`SECURITY DEFINER`). Punya INSERT/UPDATE/DELETE ledger, dibatasi policy `TO dompetku_api WITH CHECK (space_id = any(app.my_space_ids()))`.
  - `dompetku_app`: LOGIN, NOBYPASSRLS. `SELECT` tabel domain + `EXECUTE api.*`. Tidak punya DML ledger.
  - `dompetku_worker`: seperti app + `EXECUTE jobs.*`.
- **Alasan:** `FORCE ROW LEVEL SECURITY` juga berlaku untuk pemilik tabel. Fungsi definer milik pemilik tabel tanpa BYPASSRLS akan **gagal INSERT** karena tabel ledger hanya punya policy SELECT (DESIGN §5 RLS). Kalau fungsi dimiliki role BYPASSRLS, kita kehilangan pagar "fungsi pun tidak bisa menulis ke ruang yang bukan milik user". Policy `TO dompetku_api` mempertahankan pagar itu.
  Fungsi di Postgres **default `EXECUTE` ke PUBLIC**. Wajib ada `alter default privileges for role dompetku_owner revoke execute on functions from public`, plus tes katalog.
  DESIGN §5 masih menulis `auth.uid()`, role `authenticated`, `supabase gen types`, dan `pg_cron`. Semua itu tidak ada di Postgres polos (spec §4.1-B) dan perlu ADR pembaruan.

### R4 — Konteks RLS: `app.user_id` lokal-transaksi, fail-closed, transaksi pendek · **wajib** · M0
- **Isi:**
  - `app.current_user_id()` = `nullif(current_setting('app.user_id', true), '')::uuid`. Setelah `set_config(..., true)` pernah dipakai di satu koneksi, GUC kustom kembali ke **string kosong**, bukan NULL. Tanpa `nullif`, cast `''::uuid` melempar error di koneksi pool berikutnya. Kalau error itu ditangani longgar, perilakunya tidak jelas. NULL → semua policy false (fail-closed).
  - Policy memakai `space_id = any ((select app.my_space_ids()))`. Bungkus `select` membuat initplan dievaluasi sekali per query. `my_space_ids()` membaca `space_members` dengan policy `user_id = app.current_user_id()`, jadi tidak rekursif dan tidak perlu definer. Daftar anggota Bersama untuk UI diambil lewat `api.space_roster()`.
  - **Dilarang:** `SET app.user_id` (level sesi), `set_config(..., false)`, `SET ROLE` per request. Semua itu bocor antar request di pool. Tambahkan lint/grep di CI.
  - `withUser` = **satu transaksi pendek per data-loader / per Server Action**, bukan satu transaksi sepanjang render RSC. Satu transaksi = satu koneksi serial, jadi `Promise.all` di dalamnya tidak paralel. Transaksi juga tidak boleh menahan lock saat menunggu I/O luar (Gemini, Telegram). Baca = `read only`.
  - Pasang di role: `statement_timeout=5s`, `lock_timeout=3s`, `idle_in_transaction_session_timeout=15s`.
  - `spaceId` di `withUser(userId, spaceId?)` (spec §5.1) **bukan** dasar otorisasi. Ruang adalah parameter eksplisit fungsi/query. Otorisasi hanya keanggotaan.
- **Pooling:** cukup `pg.Pool` di Node (max ±10 untuk web, 3 untuk worker). Tidak perlu PgBouncer untuk 2 user. Kalau nanti dipakai, mode transaction aman karena semua `set_config` lokal, tetapi prepared statement bernama harus dimatikan.
- **Batas kepercayaan (nyatakan di ADR):** role app bisa mengisi `app.user_id` sembarang. RLS di sini melindungi dari **bug aplikasi** (lupa `WHERE`, salah id), bukan dari SQL injection atau server yang sudah dibobol. Opsi **nanti** untuk pengerasan: `app.current_user_id()` memverifikasi `app.session_token` terhadap tabel sesi Better Auth.

### R5 — Idempotensi lewat tabel kunci dengan hash permintaan · **wajib** · M1
- **Isi:** ganti `unique (user_id, client_id)` di `entries` (DESIGN §4) dengan `core.idempotency_keys(user_id, client_id, op, request_hash, result jsonb)`, PK `(user_id, client_id)`. Urutan di fungsi:
  1. `insert … on conflict do nothing`;
  2. kalau tidak ter-insert: op/hash beda → `DK410 idempotency_key_reused`; sama → kembalikan `result` dengan `replayed: true`.
- **Alasan:** (a) satu operasi bisa menghasilkan >1 entri (R1), jadi unique per entri tidak cukup; (b) tanpa hash, klien yang salah memakai ulang `client_id` dengan isi berbeda akan diam-diam menerima hasil lama; (c) panggilan paralel dengan kunci sama otomatis berurutan. INSERT kedua menunggu lock indeks unik sampai transaksi pertama commit/rollback, tanpa lock tambahan.
  **Hash dihitung dari argumen mentah**, misalnya `p_occurred_on` sebelum default "hari ini". Kalau dihitung setelah default, retry yang melewati tengah malam WIB ditolak sebagai DK410.

### R6 — Edit, version, history: setiap mutasi menaikkan version; history append-only sejak create · **wajib** · M1
- **Isi:**
  - `update_entry`/`void_entry`/`restore_entry` semua menaikkan `version`. Dengan begitu edit setelah pasangan membatalkan entri ditolak `DK409`, tidak menimpa diam-diam (T5).
  - `entry_history(entry_id, version, op create|update|void|restore, snapshot jsonb, changed_by, via web|job|telegram)`, PK `(entry_id, version)`, ditulis **juga saat create**. Feed aktivitas Bersama (spec §7a) cukup berupa query ke tabel ini, tanpa tabel kedua.
  - Urutan lock: entri (`for update`) → akun lama ∪ baru diurutkan id (`for no key update`). Pasangan `space_transfer`: kedua kaki dikunci urut id.
  - Edit mengganti lines (delete + insert dalam satu fungsi, aman karena cek deferred). Ganti `kind` hanya diizinkan antara income ↔ expense. Transfer diedit lewat `update_transfer`.
- **Alasan:** menutup INT-01..04: ID stabil, atomik, dan versi lama tidak pernah hilang.

### R7 — Saldo = view, tanpa cache; kunci akun; putuskan DK001 · **wajib** · M1
- **Isi:** `account_balances` = `accounts LEFT JOIN lines/entries`. Akun tanpa transaksi harus tetap muncul dengan saldo 0; versi DESIGN §5 menghilangkannya. Ambang untuk menambah cache: p95 > 20 ms pada fixture 50k entri per ruang, diukur di CI, bukan diklaim. Klaim "<5 ms" di D4 belum ada buktinya.
  Fungsi tulis mengunci baris akun `for no key update` urut id. Tujuannya mencegah race dengan arsip akun dan, kalau dipilih, cek saldo. `no key` dipakai supaya tidak bentrok dengan `KEY SHARE` dari cek FK.
- **Saya tidak setuju DK001 `saldo_tidak_cukup` sebagai error keras** (DESIGN §5). Entri bertanggal mundur membuat "saldo cukup" ambigu: cukup di tanggal itu atau hari ini? Pencatatan telat juga lazim. Usul: kembalikan `warnings: ['saldo_negatif']` dan biarkan UI meminta konfirmasi. Kalau PM memilih blokir, cek saldo **hari ini** di bawah lock akun.

### R8 — Kontrak fungsi `api.*` dan katalog error · **wajib** · M1
- **Signature:** parameter bernama berawalan `p_`, dipanggil `select api.f(p_x => $1, …)`. `p_client_id uuid` wajib untuk semua tulis, `p_expected_version int` untuk edit/void. Ruang **diturunkan dari akun**, bukan dikirim terpisah, supaya tidak ada ketidakcocokan. Nilai kembali `jsonb` (`{entry_id, version, linked_entry_id?, replayed, warnings[]}`) yang divalidasi Zod di `packages/db/src/api.ts`. Wrapper ditulis tangan karena kysely-codegen tidak menghasilkan tipe fungsi. Tes pgTAP `function_returns` menjaga signature.
- **Atribut wajib:** `security definer`, `set search_path = ''`, semua nama terkualifikasi skema, `revoke all … from public`, `grant execute … to dompetku_app`, owner `dompetku_api`. Larang `current_date`/`localtimestamp` (bergantung `TimeZone` sesi) dan pakai `(now() at time zone 'Asia/Jakarta')::date`. Larangan ini dicek tes katalog terhadap `prosrc`.
- **SQLSTATE kustom kelas `DK`:** `DK400` argumen tidak valid (`DETAIL` = nama field saja), `DK401` tanpa konteks user, `DK404` tidak ditemukan **atau** bukan anggota (sengaja disamakan), `DK409` konflik versi, `DK410` kunci idempotensi dipakai ulang, `DK422` aturan bisnis (`MESSAGE` = kode mesin, misalnya `account_archived`, `cross_space_not_allowed`, `overpayment`), `DK500` bentuk/invarian rusak (bug, alert).
  **Pesan dan detail tidak pernah memuat nominal atau deskripsi.** Kode native: `40001`/`40P01` → retry otomatis maks 3× di Node (aman karena idempoten); `23xxx` dari fungsi = bug → 500 + alert.
- **Log DB:** `log_parameter_max_length=0`, `log_parameter_max_length_on_error=0`, `log_statement='ddl'`, `auto_explain` mati di prod. Tanpa ini, log Postgres bisa memuat nominal/deskripsi, bertentangan dengan spec §5.7 "log tanpa nominal".

### R9 — Driver, Kysely, migrasi: pilih `pg` + kysely-codegen + **dbmate** · **wajib** · M0
- **Driver `pg`** (dialek resmi Kysely). Wajib pasang type parser:
  - **OID 1082 `date` → string apa adanya.** Default `pg` membuat `Date` di tengah malam zona proses Node. Ini persis kelas bug INT-07: tanggal bergeser satu hari.
  - OID 20 `int8` → `number` dengan assert `Number.isSafeInteger`, lempar error kalau tidak aman.
  - OID 1700 `numeric` → string, dan `sum()` atas `bigint` selalu di-`::bigint` di SQL karena hasilnya `numeric`.
- **kysely-codegen** dijalankan di CI setelah migrasi; build gagal kalau `db.d.ts` berbeda. Override int8 → `number`, date → `string`.
- **Tool migrasi: dbmate.** Biner tunggal (ada arm64/x86 untuk spec §3 multi-arch), SQL murni, satu transaksi per file, `schema.sql` di-dump untuk review diff, tidak menambah runtime ke image app.
  Alternatif yang ditimbang: graphile-migrate (alur `current.sql` enak untuk fungsi, tapi lebih kompleks dan Node-sentris); sqitch (rework fungsi rapi, tapi Perl dan kurva belajar); node-pg-migrate/Kysely Migrator (migrasi di TS, padahal logika kita SQL-first).
  Aturan: **maju-saja di produksi**. `down` hanya untuk lokal. Expand/contract sesuai spec §5.7. Perubahan fungsi = `create or replace` utuh di file migrasi baru, ditinjau lewat diff `schema.sql`. Indeks `concurrently` memakai `-- migrate:up transaction:false`. CI memastikan `pg_dump` versi 17.

### R10 — Strategi pgTAP berbasis katalog + uji konkurensi di Node · **wajib** · M0 (harness), M1 (isi)
- **Jalankan sebagai role app**, bukan superuser. Helper `tests.as_user(uid)` = `set local role dompetku_app; select set_config('app.user_id', uid, true)`. Superuser mem-bypass RLS, jadi tes isolasi yang dijalankan sebagai superuser selalu hijau palsu.
- **Tes katalog** (otomatis mencakup tabel/fungsi baru):
  - semua tabel `core.*` punya `relrowsecurity` dan `relforcerowsecurity`;
  - `dompetku_app` tidak punya INSERT/UPDATE/DELETE pada tabel ledger;
  - semua `api.*` adalah `prosecdef` dengan `search_path` di `proconfig`, tidak ada grantee PUBLIC di `aclexplode(proacl)`, dan `prosrc` tanpa `current_date`;
  - setiap FK punya indeks pendukung.
- **Matriks dua user × tabel × operasi** dihasilkan oleh loop dinamis atas katalog, bukan ditulis tangan. B tidak bisa membaca, menulis, atau **menunjuk** baris di ruang Pribadi A (T12). Cakupannya termasuk fungsi laporan/ekspor (spec §5.4).
- **Property test SQL:** `setseed(…)`, 1.000 operasi acak (create/update/void/restore/transfer/space_transfer). Setelah itu: view saldo = Σ ulang dari lines; setiap `transfer` Σ = −fee; setiap pasangan konsisten; `version` = jumlah baris history (T18).
- **Konkurensi tidak bisa diuji di pgTAP** karena hanya satu sesi. Tulis tes integrasi Vitest dengan dua koneksi untuk: kunci idempotensi paralel (hasil 1 entri), edit dengan versi lama (DK409), transfer A→B ∥ B→A (tanpa deadlock), arsip akun ∥ transaksi baru.
- **Golden numbers** laporan pada fixture tetap (M2), termasuk fee sebagai pengeluaran dan `space_transfer` yang tidak masuk income/expense.

### R11 — Soft delete tanpa hapus fisik ledger · **sebaiknya** · M1 (keputusan sebelum M5 `purge_voided`)
- **Isi:** `purge_voided` (spec §5.5, keputusan §12-8) **tidak** menghapus baris. Fungsinya diubah menjadi "keluar dari Sampah, tidak bisa dipulihkan dari UI", lewat flag `purged_at`. Snapshot di `entry_history` tetap ada.
- **Alasan:** hapus fisik memutus `entry_history`, `recurring_occurrences.entry_id`, `trip_exclusions`, dan audit Bersama. Hapus fisik juga bertentangan dengan anti-tujuan "edit yang bisa kehilangan data". Manfaat privasinya pun nol karena backup WAL-G menyimpan data 12 bulan (spec §5.7). Volume 2 user hanya ribuan baris per tahun, jadi biaya simpannya diabaikan. Kalau pemilik tetap mau hapus fisik: purge harus menghapus pasangan dan history secara atomik, dan tercatat di audit log.

### R12 — Kinerja & indeks · **sebaiknya** · M1–M2
- `entries (space_id, occurred_on desc, created_at desc, id desc) where voided_at is null` untuk paginasi kursor (DESIGN §10).
- `entry_lines (account_id) include (amount, entry_id)` untuk saldo.
- `entry_lines (space_id, entry_id)` untuk RLS + join.
- Indeks per FK komposit.
- Postgres container: `shared_buffers` ±25% dari limit memori container, `work_mem` 8–16 MB, `random_page_cost=1.1` (SSD). Dataset kecil, jadi konfigurasi tidak perlu dioptimalkan lebih jauh.
- **Nanti:** `pg_trgm` GIN untuk cari deskripsi; cache saldo hanya kalau ambang R7 terlewati, dan wajib dengan tes rekonsiliasi.

Catatan kecil yang ikut M0/M1:
- **Better Auth memakai id `text` secara default.** Konfigurasikan agar menghasilkan UUID, atau samakan tipe `created_by`/`user_id` ke `text` di semua tabel. Putuskan sebelum migrasi pertama.
- Hapus `on delete cascade` dari user ke tabel domain (DESIGN §5 `accounts`). Menghapus akun auth tidak boleh menghapus ledger; pakai `restrict`.
- Batas nominal per line `|amount| ≤ 10^13` (10 triliun). Dengan batas ini Σ tetap jauh di bawah `Number.MAX_SAFE_INTEGER` (9×10^15).
- Tabel khusus Pribadi (`loans`, `contacts`, pocket `kantor`) dikunci deklaratif dengan kolom `space_kind` + FK `(space_id, space_kind) → spaces(id, kind)`, tanpa trigger (Lampiran A).
- Job worker berjalan **atas nama** anggota ruang (`set_config('app.user_id', rule.created_by, true)` per job-tx, `via='job'` di history), bukan role BYPASSRLS. Satu model RLS untuk semua jalur.

## 3. Risiko utama & mitigasi

| Risiko | Dampak | Mitigasi |
|---|---|---|
| Cek bentuk/pasangan deferred tidak pernah jalan di tes (rollback) | Bug ledger lolos CI | `set constraints all immediate` di akhir tiap fungsi (R2); tes yang sengaja merusak bentuk lewat role owner, harus `throws_ok 'DK500'` |
| `FORCE RLS` + fungsi definer tanpa policy tulis | Semua tulis gagal di prod, atau "diperbaiki" dengan BYPASSRLS sehingga pagar hilang | Role `dompetku_api` + policy `TO dompetku_api` (R3); tes katalog role |
| GUC `app.user_id` bocor/kosong di koneksi pool | Data lintas user atau error acak | Lokal-transaksi saja, `nullif`, lint larang `SET` sesi, tes Node "query di luar `withUser` mengembalikan 0 baris" (R4) |
| Parser `date` di `pg` menggeser tanggal | Pengulangan INT-07 | Type parser 1082 → string + tes Vitest `TZ=UTC` dan `TZ=Asia/Jakarta` (R9) |
| Deadlock transfer silang / edit paralel di Bersama | Error 500 sporadis | Lock urut id, retry `40P01` di Node, tes konkurensi (R6, R10) |
| Fungsi `api.*` diam-diam executable PUBLIC | Permukaan serangan | Default privileges + tes `aclexplode` (R3) |
| Nominal/deskripsi masuk log Postgres atau pesan error | Melanggar spec §5.7 | Setelan log (R8); tes yang memeriksa `MESSAGE`/`DETAIL` semua `raise` di `prosrc` tidak memuat `%` dengan nilai uang |
| Fungsi SQL membengkak, sulit dirawat | Lambat iterasi | Satu fungsi per operasi, helper `private.*` (idempotensi, snapshot, lock), pgTAP test-first |

## 4. Ketidaksetujuan dengan desain saat ini

1. **spec §5.4 + §7a "satu entri transfer dengan dua line di ruang berbeda, header di ruang sumber".** Saya tidak setuju; alternatif dan trade-off ada di R1. Perilaku produk §7a (pencatat yang mengedit, "Setoran dari <nama>", "Diambil oleh <nama>", kontribusi per orang) tetap utuh dengan dua kaki.
2. **DESIGN §5 rumus transfer** `|main| = counter + fee` bersama line fee terpisah memberi Σ = −2·fee. Perbaikan ada di R2.
3. **DESIGN §4 idempotensi `unique (user_id, client_id)` di `entries`** tidak memadai untuk operasi multi-entri dan tidak mendeteksi pemakaian ulang dengan isi berbeda (R5).
4. **DESIGN §4 DK001 sebagai error keras** bermasalah untuk entri bertanggal mundur (R7). Ini keputusan PM.
5. **DESIGN §12-8 hapus permanen 90 hari** (sudah disetujui pemilik): saya minta ditinjau ulang menjadi "tidak bisa dipulihkan" tanpa hapus fisik (R11).
6. **DESIGN §5 view `account_balances`** menghilangkan akun tanpa transaksi; gunakan `LEFT JOIN` dari `accounts`.
7. **DESIGN §3, §5 (RLS, fungsi RPC) masih memakai Supabase** (`auth.uid()`, `authenticated`, `supabase gen types`, `pg_cron`, `supabase test db` di ROADMAP). Perlu ADR yang menyatakan bagian mana yang diganti spec rev 2, supaya builder tidak menyalin pola Supabase.
8. **spec §5.2 tiga role** tidak cukup untuk `FORCE RLS` + definer yang tetap dipagari (R3).

## 5. Kriteria penerimaan (bisa dites)

1. pgTAP katalog: 100% tabel `core.*` RLS enabled+forced; 0 fungsi `api.*` executable PUBLIC; semua `api.*` `prosecdef` + `search_path=''`; 0 `current_date` di `prosrc`; setiap FK punya indeks.
2. `has_table_privilege('dompetku_app', t, 'INSERT|UPDATE|DELETE')` false untuk semua tabel ledger.
3. Sebagai `dompetku_app` dengan `app.user_id` = Farida: `select count(*)` dari setiap tabel `core.*` untuk ruang Pribadi Novanda = 0, dan setiap `api.*` yang diberi id milik Novanda → `DK404`.
4. `create_transfer` Pribadi→Bersama menghasilkan tepat 2 entri satu `link_id`; Farida melihat kaki Bersama dan tidak melihat akun sumber; Farida memanggil `void_entry` pada kaki itu → `DK404`.
5. Entri dengan bentuk salah (dibuat lewat role owner di tes) → `DK500` di dalam fungsi/statement, bukan saat commit.
6. Panggilan ulang dengan `client_id` sama + isi sama → hasil identik `replayed=true`, jumlah entri tetap. Isi beda → `DK410`. Dua panggilan paralel (Vitest) → 1 entri.
7. Edit dengan `p_expected_version` lama → `DK409`, data tidak berubah. Setiap mutasi menambah tepat 1 baris `entry_history`.
8. Property test 1.000 operasi acak: Σ lines = view saldo untuk semua akun; Σ per `transfer` = −fee; Σ main per pasangan = 0; status void pasangan seragam.
9. Vitest: `date` dari DB adalah string `YYYY-MM-DD` identik di `TZ=UTC` dan `TZ=Asia/Jakarta`; int8 > 2^53 melempar error.
10. Query di luar `withUser` (koneksi pool yang sebelumnya dipakai `withUser`) mengembalikan 0 baris domain, tanpa error cast.
11. Saldo semua akun pada fixture 50k entri/ruang: p95 ≤ 20 ms (job CI non-blocking, tercatat).
12. `grep` di repo: 0 `insert into core.`/`update core.`/`delete from core.` di `apps/**`; 0 `set_config(…, false)` / `SET app.`.

## 6. Pertanyaan/permintaan untuk peran lain

- **Product Manager:**
  - Saldo negatif: blokir atau peringatan (R7)?
  - Tanggal masa depan: diizinkan? Usul: tolak > hari ini WIB.
  - Catatan transfer lintas ruang: apakah deskripsi disalin ke kaki Bersama (terlihat pasangan), atau ada kolom catatan terpisah?
  - Apakah pocket `kantor` boleh menyetor ke Bersama?
  - Setujui tinjauan ulang purge (R11).
- **Security Engineer:**
  - Setuju dengan batas kepercayaan R4 (RLS = pagar bug, bukan pagar injeksi)?
  - Perlukah pengikatan `app.user_id` ke token sesi di M0, atau cukup nanti?
  - Tinjau hak R/W `dompetku_app` ke skema `auth` Better Auth.
- **DevOps/SRE:**
  - Runbook pembuatan 4 role + `grant dompetku_api to dompetku_owner` (perlu untuk `alter function … owner`).
  - Setelan log R8 di `postgresql.conf`.
  - Image CI Postgres 17 + pgTAP + `pg_prove`.
  - Biner dbmate multi-arch.
  - Timeout per role.
- **Frontend Engineer:**
  - `client_id` dibuat saat form dibuka, dipakai ulang saat retry, dan diganti setelah sukses.
  - UX konflik `DK409` (muat ulang + tampilkan versi baru).
  - Peta kode DK → pesan Indonesia dari satu file bersama.
  - Ambil data per loader, bukan satu transaksi per halaman.
- **QA:** harness konkurensi Vitest dua koneksi (R10) dan fixture 50k entri; golden numbers M2 harus memuat fee dan `space_transfer`.
- **UX Designer:** label kaki pasangan ("Setor ke Bersama", "Setoran dari <nama>", "Diambil oleh <nama>") dan tampilan fee sebagai pengeluaran "Biaya transfer".

---

## Lampiran A — Skema inti yang dikoreksi (Postgres 17)

Catatan: tabel di skema `core` (bukan `public`). `auth."user"` = tabel Better Auth, diasumsikan id `uuid` (lihat catatan R12). Tabel lain (categories detail, loans, goals, dst.) mengikuti pola yang sama.

```sql
-- ===== 0. Skema & role (role dibuat runbook; di sini hanya hak) =====
-- dompetku_owner  LOGIN BYPASSRLS   : pemilik skema/tabel, migrasi, pemilik private.assert_*
-- dompetku_api    NOLOGIN NOBYPASSRLS: pemilik fungsi api.* (security definer), DML ledger
-- dompetku_app    LOGIN NOBYPASSRLS  : SELECT domain + EXECUTE api.*
create schema core;  create schema app;  create schema private;  create schema api;
revoke all on schema public from public;
alter default privileges for role dompetku_owner revoke execute on functions from public;
alter default privileges for role dompetku_api   revoke execute on functions from public;
grant usage on schema core, app to dompetku_app, dompetku_api;
grant usage on schema api to dompetku_app;
grant usage on schema private to dompetku_api;

-- ===== 1. Konteks user =====
create function app.current_user_id() returns uuid
language sql stable parallel safe set search_path = '' as $$
  select nullif(current_setting('app.user_id', true), '')::uuid
$$;

-- ===== 2. Household, ruang, anggota =====
create table core.households (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 60),
  created_at timestamptz not null default now()
);

create type core.space_kind as enum ('personal', 'shared');
create table core.spaces (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references core.households on delete restrict,
  kind          core.space_kind not null,
  owner_user_id uuid references auth."user" (id) on delete restrict,
  name          text not null check (length(btrim(name)) between 1 and 40),
  created_at    timestamptz not null default now(),
  unique (id, kind),                                   -- target FK (space_id, space_kind)
  check ((kind = 'personal') = (owner_user_id is not null))
);
create unique index spaces_one_shared   on core.spaces (household_id)  where kind = 'shared';
create unique index spaces_one_personal on core.spaces (owner_user_id) where kind = 'personal';

create table core.space_members (
  space_id uuid not null references core.spaces on delete restrict,
  user_id  uuid not null references auth."user" (id) on delete restrict,
  role     text not null default 'member' check (role in ('owner', 'member')),
  primary key (space_id, user_id)
);
create index on core.space_members (user_id);
-- constraint trigger (tidak ditampilkan): ruang personal hanya beranggota owner_user_id.

create function app.my_space_ids() returns uuid[]
language sql stable parallel safe set search_path = '' as $$
  select coalesce(array_agg(m.space_id), '{}')
  from core.space_members m
  where m.user_id = app.current_user_id()       -- terfilter juga oleh RLS space_members
$$;

-- ===== 3. Akun & kategori =====
create type core.account_kind as enum ('wallet', 'asset');
create type core.pocket       as enum ('operasional', 'tabungan', 'kantor');
create table core.accounts (
  id          uuid primary key default gen_random_uuid(),
  space_id    uuid not null references core.spaces on delete restrict,
  kind        core.account_kind not null,
  name        text not null check (length(btrim(name)) between 1 and 60),
  pocket      core.pocket,
  wallet_type text check (wallet_type in ('cash', 'bank', 'ewallet', 'investment')),
  asset_class text,                                  -- enum di DESIGN §5
  currency    char(3) not null default 'IDR' check (currency = 'IDR'),
  archived_at timestamptz,
  sort_order  int not null default 0,
  created_by  uuid not null references auth."user" (id) on delete restrict,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (space_id, id),
  check ((kind = 'wallet') = (pocket is not null)),
  check ((kind = 'asset')  = (asset_class is not null))
);

create type core.category_type as enum ('income', 'expense');
create table core.categories (
  id          uuid primary key default gen_random_uuid(),
  space_id    uuid not null references core.spaces on delete restrict,
  type        core.category_type not null,
  parent_id   uuid,
  name        text not null check (length(btrim(name)) between 1 and 40),
  is_system   boolean not null default false,       -- mis. "Biaya transfer"
  archived_at timestamptz,
  unique (space_id, id),
  foreign key (space_id, parent_id) references core.categories (space_id, id)
);

-- Contoh tabel khusus Pribadi (pola deklaratif, tanpa trigger):
create table core.loans (
  id         uuid primary key default gen_random_uuid(),
  space_id   uuid not null,
  space_kind core.space_kind not null default 'personal' check (space_kind = 'personal'),
  direction  text not null check (direction in ('borrowed', 'lent')),
  principal  bigint not null check (principal > 0 and principal <= 10000000000000),
  -- … kolom lain DESIGN §5
  unique (space_id, id),
  foreign key (space_id, space_kind) references core.spaces (id, kind)
);

-- ===== 4. Jurnal =====
create type core.entry_kind as enum (
  'income', 'expense', 'transfer', 'space_transfer',
  'opening_balance', 'adjustment', 'debt_principal', 'debt_payment',
  'reimbursement', 'valuation'
);
create type core.line_role as enum ('main', 'counter', 'fee');

create table core.entries (
  id                  uuid primary key default gen_random_uuid(),
  space_id            uuid not null references core.spaces on delete restrict,
  kind                core.entry_kind not null,
  occurred_on         date not null,
  description         text check (length(description) <= 200),
  category_id         uuid,
  loan_id             uuid,
  reimbursable        boolean not null default false,
  reimburses_entry_id uuid,
  link_id             uuid,                           -- pasangan space_transfer
  version             int not null default 1 check (version >= 1),
  voided_at           timestamptz,
  voided_by           uuid references auth."user" (id) on delete restrict,
  voided_reason       text check (length(voided_reason) <= 200),
  created_by          uuid not null references auth."user" (id) on delete restrict,
  created_at          timestamptz not null default now(),
  updated_by          uuid not null references auth."user" (id) on delete restrict,
  updated_at          timestamptz not null default now(),
  unique (space_id, id),
  foreign key (space_id, category_id)         references core.categories (space_id, id),
  foreign key (space_id, loan_id)             references core.loans      (space_id, id),
  foreign key (space_id, reimburses_entry_id) references core.entries    (space_id, id),
  check (kind in ('income', 'expense') or category_id is null),
  check (kind = 'expense' or not reimbursable),
  check ((kind = 'reimbursement')  = (reimburses_entry_id is not null)),
  check ((kind = 'space_transfer') = (link_id is not null)),
  check ((kind in ('debt_principal', 'debt_payment')) = (loan_id is not null)),
  check ((voided_at is null) = (voided_by is null))
);
create unique index entries_link_space on core.entries (link_id, space_id) where link_id is not null;
create index entries_list on core.entries (space_id, occurred_on desc, created_at desc, id desc)
  where voided_at is null;
create index on core.entries (space_id, category_id);
create index on core.entries (space_id, loan_id);
create index on core.entries (space_id, reimburses_entry_id);

create table core.entry_lines (
  entry_id   uuid not null,
  space_id   uuid not null,
  role       core.line_role not null,
  account_id uuid not null,
  amount     bigint not null
             check (amount <> 0 and amount between -10000000000000 and 10000000000000),
  primary key (entry_id, role),
  foreign key (space_id, entry_id)   references core.entries  (space_id, id) on delete cascade,
  foreign key (space_id, account_id) references core.accounts (space_id, id)
);
create index entry_lines_balance on core.entry_lines (account_id) include (amount, entry_id);
create index entry_lines_space   on core.entry_lines (space_id, entry_id);

create table core.entry_history (
  entry_id   uuid not null,
  space_id   uuid not null,
  version    int  not null,
  op         text not null check (op in ('create', 'update', 'void', 'restore')),
  snapshot   jsonb not null,                       -- entry + lines SESUDAH op
  changed_by uuid not null references auth."user" (id) on delete restrict,
  via        text not null default 'web' check (via in ('web', 'job', 'telegram')),
  changed_at timestamptz not null default now(),
  primary key (entry_id, version),
  foreign key (space_id, entry_id) references core.entries (space_id, id)
);

create table core.idempotency_keys (
  user_id      uuid not null,
  client_id    uuid not null,
  op           text not null,
  request_hash bytea not null,
  result       jsonb,
  created_at   timestamptz not null default now(),
  primary key (user_id, client_id)
);

create view core.account_balances with (security_invoker = true) as
select a.space_id, a.id as account_id,
       coalesce(sum(l.amount) filter (where e.voided_at is null), 0)::bigint as balance
from core.accounts a
left join core.entry_lines l on l.account_id = a.id
left join core.entries     e on e.id = l.entry_id
group by a.space_id, a.id;

-- ===== 5. RLS =====
alter table core.spaces        enable row level security; alter table core.spaces        force row level security;
alter table core.space_members enable row level security; alter table core.space_members force row level security;
alter table core.accounts      enable row level security; alter table core.accounts      force row level security;
alter table core.categories    enable row level security; alter table core.categories    force row level security;
alter table core.loans         enable row level security; alter table core.loans         force row level security;
alter table core.entries       enable row level security; alter table core.entries       force row level security;
alter table core.entry_lines   enable row level security; alter table core.entry_lines   force row level security;
alter table core.entry_history enable row level security; alter table core.entry_history force row level security;
alter table core.idempotency_keys enable row level security; alter table core.idempotency_keys force row level security;

create policy own on core.space_members for select to dompetku_app, dompetku_api
  using (user_id = (select app.current_user_id()));
create policy member on core.spaces for select to dompetku_app, dompetku_api
  using (id = any ((select app.my_space_ids())));

-- pola untuk setiap tabel ber-space_id (accounts, categories, loans, entries, entry_lines, entry_history, …):
create policy read  on core.entries for select to dompetku_app
  using (space_id = any ((select app.my_space_ids())));
create policy write on core.entries for all    to dompetku_api
  using      (space_id = any ((select app.my_space_ids())))
  with check (space_id = any ((select app.my_space_ids())));
create policy read  on core.entry_lines for select to dompetku_app
  using (space_id = any ((select app.my_space_ids())));
create policy write on core.entry_lines for all    to dompetku_api
  using      (space_id = any ((select app.my_space_ids())))
  with check (space_id = any ((select app.my_space_ids())));
-- (sama untuk accounts, categories, loans, entry_history)

create policy own on core.idempotency_keys for all to dompetku_api
  using (user_id = (select app.current_user_id()))
  with check (user_id = (select app.current_user_id()));

grant select on all tables in schema core to dompetku_app, dompetku_api;
grant insert, update, delete on core.entries, core.entry_lines, core.entry_history, core.idempotency_keys
  to dompetku_api;
-- referensi (accounts, categories) juga ditulis lewat api.* agar satu jalur + history.

-- ===== 6. Cek bentuk (deferred) =====
create function private.assert_space_transfer_pair(p_link_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  select count(*)                                  as n,
         count(distinct e.space_id)                as n_space,
         count(distinct s.household_id)            as n_household,
         count(*) filter (where s.kind = 'shared') as n_shared,
         count(distinct e.occurred_on)             as n_date,
         count(distinct (e.voided_at is null))     as n_void_state,
         count(*) filter (where l.amount < 0)      as n_out,
         count(*) filter (where l.amount > 0)      as n_in,
         coalesce(sum(l.amount), 0)                as net,
         bool_and(a.kind = 'wallet')               as wallets_only
    into r
    from core.entries e
    join core.spaces s       on s.id = e.space_id
    join core.entry_lines l  on l.entry_id = e.id and l.role = 'main'
    join core.accounts a     on a.id = l.account_id
   where e.link_id = p_link_id;

  if not (r.n = 2 and r.n_space = 2 and r.n_household = 1 and r.n_shared >= 1
          and r.n_date = 1 and r.n_void_state = 1 and r.n_out = 1 and r.n_in = 1
          and r.net = 0 and r.wallets_only) then
    raise exception using errcode = 'DK500', message = 'space_transfer_pair_invalid',
                          detail = p_link_id::text;
  end if;
end $$;

create function private.assert_entry_shape(p_entry_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  e  core.entries%rowtype;
  m  core.entry_lines%rowtype;
  c  core.entry_lines%rowtype;
  f  core.entry_lines%rowtype;
  ok boolean;
begin
  select * into e from core.entries where id = p_entry_id;
  if not found then return; end if;                -- entri sudah dihapus (cascade)
  select * into m from core.entry_lines where entry_id = p_entry_id and role = 'main';
  select * into c from core.entry_lines where entry_id = p_entry_id and role = 'counter';
  select * into f from core.entry_lines where entry_id = p_entry_id and role = 'fee';

  ok := m.entry_id is not null
        and (f.entry_id is null or (f.amount < 0 and f.account_id = m.account_id));

  ok := ok and case
    when e.kind in ('income', 'expense') then
         c.entry_id is null and f.entry_id is null
         and (case e.kind when 'income' then m.amount > 0 else m.amount < 0 end)
         and (e.category_id is null or exists (
               select 1 from core.categories k
                where k.id = e.category_id and k.type::text = e.kind::text))
    when e.kind = 'reimbursement' then
         c.entry_id is null and f.entry_id is null and m.amount > 0
    when e.kind = 'transfer' then
         c.entry_id is not null and m.amount < 0 and c.amount = -m.amount
         and c.account_id <> m.account_id
    when e.kind = 'space_transfer' then
         c.entry_id is null and (f.entry_id is null or m.amount < 0)
    when e.kind in ('opening_balance', 'adjustment') then
         c.entry_id is null and f.entry_id is null
    when e.kind = 'valuation' then
         c.entry_id is null and f.entry_id is null
         and exists (select 1 from core.accounts a where a.id = m.account_id and a.kind = 'asset')
    when e.kind in ('debt_principal', 'debt_payment') then
         c.entry_id is null
         and exists (select 1 from core.loans ln where ln.id = e.loan_id and
               (ln.direction = 'borrowed') = ((e.kind = 'debt_principal') = (m.amount > 0)))
    else false
  end;

  if not ok then
    raise exception using errcode = 'DK500', message = 'entry_shape_invalid',
                          detail = p_entry_id::text;
  end if;
  if e.kind = 'space_transfer' then
    perform private.assert_space_transfer_pair(e.link_id);
  end if;
end $$;

create function private.trg_entry_shape() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'entry_lines' then
    perform private.assert_entry_shape(case when tg_op = 'DELETE' then old.entry_id else new.entry_id end);
  else
    perform private.assert_entry_shape(new.id);
  end if;
  return null;
end $$;

create constraint trigger entry_lines_shape after insert or update or delete on core.entry_lines
  deferrable initially deferred for each row execute function private.trg_entry_shape();
create constraint trigger entries_shape after insert or update on core.entries
  deferrable initially deferred for each row execute function private.trg_entry_shape();
-- pemilik ketiga fungsi di atas: dompetku_owner (BYPASSRLS) → melihat kedua kaki pasangan.

create function private.entry_snapshot(p_entry_id uuid) returns jsonb
language sql stable set search_path = '' as $$
  select to_jsonb(e) || jsonb_build_object('lines', coalesce(
           (select jsonb_agg(to_jsonb(l) order by l.role)
              from core.entry_lines l where l.entry_id = e.id), '[]'::jsonb))
    from core.entries e where e.id = p_entry_id
$$;
alter function private.entry_snapshot(uuid) owner to dompetku_api;
```

## Lampiran B — `api.create_transfer` lengkap

```sql
create function api.create_transfer(
  p_client_id    uuid,
  p_from_account uuid,
  p_to_account   uuid,
  p_amount       bigint,
  p_fee          bigint default 0,
  p_occurred_on  date   default null,   -- null = hari ini WIB
  p_description  text   default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid      uuid := app.current_user_id();
  v_today    date := (now() at time zone 'Asia/Jakarta')::date;
  v_on       date := coalesce(p_occurred_on, (now() at time zone 'Asia/Jakarta')::date);
  v_desc     text := nullif(btrim(p_description), '');
  v_my       uuid[];
  v_from     core.accounts%rowtype;
  v_to       core.accounts%rowtype;
  v_from_sp  core.spaces%rowtype;
  v_to_sp    core.spaces%rowtype;
  v_hash     bytea;
  v_idem     core.idempotency_keys%rowtype;
  v_entry    uuid;
  v_entry_in uuid;
  v_link     uuid;
  v_result   jsonb;
begin
  set constraints all deferred;

  -- 1. Konteks
  if v_uid is null then
    raise exception using errcode = 'DK401', message = 'unauthenticated';
  end if;

  -- 2. Validasi argumen (DETAIL = nama field, tanpa nilai)
  if p_client_id is null then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'client_id';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount > 10000000000000 then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'amount';
  end if;
  if p_fee is null or p_fee < 0 or p_fee > 10000000000000 then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'fee';
  end if;
  if p_from_account is null or p_to_account is null or p_from_account = p_to_account then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'to_account';
  end if;
  if v_on < date '2000-01-01' or v_on > v_today then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'occurred_on';
  end if;
  if length(v_desc) > 200 then
    raise exception using errcode = 'DK400', message = 'invalid_argument', detail = 'description';
  end if;

  -- 3. Idempotensi (hash dari argumen MENTAH, bukan v_on, agar retry lewat tengah malam aman)
  v_hash := sha256(convert_to(jsonb_build_object(
              'from', p_from_account, 'to', p_to_account, 'amount', p_amount,
              'fee', p_fee, 'on', p_occurred_on, 'desc', v_desc)::text, 'UTF8'));

  insert into core.idempotency_keys (user_id, client_id, op, request_hash)
  values (v_uid, p_client_id, 'create_transfer', v_hash)
  on conflict (user_id, client_id) do nothing;

  if not found then
    -- transaksi pertama sudah commit (INSERT di atas menunggu bila masih berjalan)
    select * into v_idem from core.idempotency_keys
     where user_id = v_uid and client_id = p_client_id;
    if v_idem.op <> 'create_transfer' or v_idem.request_hash <> v_hash then
      raise exception using errcode = 'DK410', message = 'idempotency_key_reused';
    end if;
    return v_idem.result || jsonb_build_object('replayed', true);
  end if;

  -- 4. Kunci kedua akun urut id (A→B ∥ B→A tidak deadlock; arsip paralel tertahan).
  --    NO KEY UPDATE tidak bentrok dengan KEY SHARE dari cek FK entry_lines.
  perform 1 from core.accounts a
   where a.id in (p_from_account, p_to_account)
   order by a.id
   for no key update;

  -- 5. Keanggotaan: eksplisit, tidak hanya mengandalkan RLS
  v_my := app.my_space_ids();
  select * into v_from from core.accounts where id = p_from_account;
  select * into v_to   from core.accounts where id = p_to_account;
  if v_from.id is null or not (v_from.space_id = any (v_my)) then
    raise exception using errcode = 'DK404', message = 'account_not_found', detail = 'from_account';
  end if;
  if v_to.id is null or not (v_to.space_id = any (v_my)) then
    raise exception using errcode = 'DK404', message = 'account_not_found', detail = 'to_account';
  end if;
  if v_from.archived_at is not null or v_to.archived_at is not null then
    raise exception using errcode = 'DK422', message = 'account_archived';
  end if;

  if v_from.space_id = v_to.space_id then
    -- 6a. Transfer satu ruang: satu entri, 2–3 line, Σ = −fee
    insert into core.entries (space_id, kind, occurred_on, description, created_by, updated_by)
    values (v_from.space_id, 'transfer', v_on, v_desc, v_uid, v_uid)
    returning id into v_entry;

    insert into core.entry_lines (entry_id, space_id, role, account_id, amount)
    select v_entry, v_from.space_id, r.role, r.account_id, r.amount
      from (values ('main'::core.line_role,    p_from_account, -p_amount),
                   ('counter'::core.line_role, p_to_account,    p_amount),
                   ('fee'::core.line_role,     p_from_account, -p_fee)) as r (role, account_id, amount)
     where r.amount <> 0;
  else
    -- 6b. Lintas ruang: dua entri berpasangan. Pemanggil sudah terbukti anggota KEDUA ruang (langkah 5).
    select * into v_from_sp from core.spaces where id = v_from.space_id;
    select * into v_to_sp   from core.spaces where id = v_to.space_id;
    if v_from_sp.household_id <> v_to_sp.household_id
       or 'shared' <> all (array[v_from_sp.kind, v_to_sp.kind]) then
      raise exception using errcode = 'DK422', message = 'cross_space_not_allowed';
    end if;
    if v_from.kind <> 'wallet' or v_to.kind <> 'wallet' then
      raise exception using errcode = 'DK422', message = 'cross_space_wallet_only';
    end if;

    v_link := gen_random_uuid();

    insert into core.entries (space_id, kind, occurred_on, description, link_id, created_by, updated_by)
    values (v_from.space_id, 'space_transfer', v_on, v_desc, v_link, v_uid, v_uid)
    returning id into v_entry;
    insert into core.entry_lines (entry_id, space_id, role, account_id, amount)
    select v_entry, v_from.space_id, r.role, p_from_account, r.amount
      from (values ('main'::core.line_role, -p_amount),
                   ('fee'::core.line_role,  -p_fee)) as r (role, amount)
     where r.amount <> 0;

    insert into core.entries (space_id, kind, occurred_on, description, link_id, created_by, updated_by)
    values (v_to.space_id, 'space_transfer', v_on, v_desc, v_link, v_uid, v_uid)
    returning id into v_entry_in;
    insert into core.entry_lines (entry_id, space_id, role, account_id, amount)
    values (v_entry_in, v_to.space_id, 'main', p_to_account, p_amount);
  end if;

  -- 7. Riwayat (create = version 1)
  insert into core.entry_history (entry_id, space_id, version, op, snapshot, changed_by)
  select e.id, e.space_id, e.version, 'create', private.entry_snapshot(e.id), v_uid
    from core.entries e
   where e.id in (v_entry, v_entry_in);

  -- 8. Jalankan cek bentuk & pasangan SEKARANG: error keluar sebagai DK500 dari fungsi ini,
  --    bukan saat COMMIT, dan pgTAP (yang selalu rollback) ikut menguji.
  set constraints all immediate;

  v_result := jsonb_build_object('entry_id', v_entry, 'linked_entry_id', v_entry_in,
                                 'version', 1, 'warnings', '[]'::jsonb);
  update core.idempotency_keys set result = v_result
   where user_id = v_uid and client_id = p_client_id;

  return v_result || jsonb_build_object('replayed', false);
end
$$;

alter function api.create_transfer(uuid, uuid, uuid, bigint, bigint, date, text) owner to dompetku_api;
revoke all on function api.create_transfer(uuid, uuid, uuid, bigint, bigint, date, text) from public;
grant execute on function api.create_transfer(uuid, uuid, uuid, bigint, bigint, date, text) to dompetku_app;
```

Catatan desain fungsi:
- Arah Bersama → Pribadi ("Diambil oleh <nama>") memakai fungsi yang sama. Syarat "anggota kedua ruang" otomatis membatasi tujuan ke ruang Pribadi milik pemanggil.
- Fee hanya di kaki keluar. Laporan menghitung line `fee` sebagai pengeluaran "Biaya transfer" di ruang sumber.
- `update_transfer`/`void_entry` untuk `space_transfer` mengunci kedua kaki (`select … where link_id = $1 order by id for update`), mencocokkan `p_expected_version` dengan kaki yang dipegang pemanggil, dan menaikkan version kedua kaki bersamaan.

## Lampiran C — `withUser` dan parser driver (TypeScript)

```ts
import pg from 'pg';
import { Kysely, PostgresDialect, sql, type Transaction } from 'kysely';

pg.types.setTypeParser(1082, (v) => v);                       // date → 'YYYY-MM-DD' (anti INT-07)
pg.types.setTypeParser(20, (v) => {                           // int8 → number aman
  const n = Number(v);
  if (!Number.isSafeInteger(n)) throw new Error('int8 di luar batas aman');
  return n;
});

export async function withUser<T>(
  userId: string,
  fn: (tx: Transaction<DB>) => Promise<T>,
  opts: { readOnly?: boolean } = {},
): Promise<T> {
  return db.transaction().execute(async (tx) => {
    if (opts.readOnly) await sql`set transaction read only`.execute(tx);
    await sql`select set_config('app.user_id', ${userId}, true)`.execute(tx);  // true = lokal-transaksi
    return fn(tx);
  });
  // Pemanggil: petakan err.code 'DKxxx' → pesan Indonesia; retry 40001/40P01 maks 3×.
}
```
