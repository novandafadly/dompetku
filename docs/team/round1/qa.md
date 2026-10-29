# Round 1 — QA / Test Engineer

Peran: QA / Test Engineer · Dasar: `docs/superpowers/specs/2026-10-29-dompetku-v2-design.md` (selanjutnya **SPEC**), `docs/v2/DESIGN.md` (**DESIGN**), `docs/v2/UX.md` (**UX**), `docs/v2/ROADMAP.md` (**ROADMAP**), `docs/audit/02-integrity.md` (**INT**), `docs/audit/03-security.md` (**SEC**), `docs/audit/repro/scenarios.sql` (**S1–S7**).

## 1. Ringkasan sikap

v1 gagal bukan karena tidak ada fitur, tetapi karena tidak ada satu pun bukti otomatis bahwa uang dihitung benar (INT-01..04 lolos ke produksi; 10 dari 25 dompet melenceng, INT §3). Karena itu, untuk v2 tes adalah **spesifikasi yang dapat dieksekusi**: setiap invarian (INT §1 I1–I10), skenario T1–T18 (INT §4), dan repro S1–S7 harus punya tes bernama yang bisa ditelusuri dari ID-nya, dan CI menolak merge bila ada ID yang tidak tertaut ke tes. Piramida yang saya tuntut berat di bawah: pgTAP + tes integrasi terhadap Postgres 17 nyata memikul kebenaran uang dan isolasi ruang. Playwright hanya membuktikan alur, aksesibilitas, dan tampilan, bukan aritmetika. Dua hal belum bisa diuji dari desain saat ini dan harus diputuskan di M0: (a) jam yang bisa dikendalikan di DB, dan (b) semantik visibilitas baris untuk transfer lintas ruang.

## 2. Rekomendasi

### R1 — Registry ID tes + jejak tes otomatis · **wajib** · M0
- **Isi:** file `packages/db/tests/REGISTRY.md` (atau `.yaml`) memuat semua ID: `I1–I10`, `T1–T18`, `S1–S7`, `B1–B20` (ruang, lihat R4), `C1–C8` (konkurensi, R6), `Z1–Z10` (zona waktu, R7), `K1–K12` (keamanan, R10), `BR1–BR6` (backup/restore, R11). Setiap tes menandai ID-nya: pgTAP `-- @covers T1`, Vitest/Playwright `test('T1 …', { tag: '@T1' })`. Skrip CI `scripts/check-test-registry.ts` gagal bila (a) ada ID di registry yang dijadwalkan untuk milestone ≤ milestone aktif tetapi tidak tertaut ke tes, atau (b) ada tes yang ditandai `skip`/`todo` pada ID wajib.
- **Alasan:** ROADMAP menulis "T1–T5 … lulus" sebagai kriteria selesai, tetapi tanpa jejak, "lulus" hanya klaim. Registry membuat status milestone bisa dicek mesin dan membuat regresi bug v1 permanen.

### R2 — Harness pgTAP + tes katalog (keamanan statis skema) · **wajib** · M0
- **Isi:**
  - `pg_prove` dijalankan terhadap container Postgres 17 + ekstensi `pgtap` (bukan `supabase test db`). Migrasi diterapkan dengan role `dompetku_owner`. Tes berjalan sebagai `dompetku_app` dan memakai helper `test.login('novanda'|'farida'|'luar')` yang memanggil `set_config('app.user_id', …, true)`. Setiap file dibungkus `BEGIN … ROLLBACK`. Helper dan skema `test` hanya dipasang oleh migrasi khusus tes (`migrations-test/`), tidak pernah ke produksi.
  - **Tes katalog** dijalankan pada setiap PR. Tes ini membaca `pg_catalog`, sehingga tabel atau fungsi baru otomatis ikut diperiksa tanpa perlu ditulis manual:
    1. Setiap tabel di skema domain punya `relrowsecurity` **dan** `relforcerowsecurity`.
    2. `dompetku_app` tidak punya hak INSERT/UPDATE/DELETE/TRUNCATE pada `entries`, `entry_lines`, `entry_history`, `loans`, `investment_lots`, `recurring_occurrences` (`table_privs_are`).
    3. Setiap fungsi di `api` adalah `SECURITY DEFINER` dengan `proconfig` berisi `search_path=""`, dan tidak ada `EXECUTE` untuk `PUBLIC`.
    4. Fungsi trigger dan `private.*` tidak bisa dieksekusi `dompetku_app` (menutup SEC-03).
    5. `dompetku_app` berstatus `NOBYPASSRLS` dan bukan pemilik tabel mana pun.
    6. Setiap tabel domain punya `space_id NOT NULL` dan setiap FK ke tabel domain bersifat komposit `(space_id, x_id)`.
    7. Skema `test` tidak ada di DB produksi (dicek juga saat smoke pasca-deploy).
    8. Setiap fungsi `api.*` punya file tes `tests/api/<nama_fungsi>.test.sql` (dicek skrip). Isinya wajib memuat lima kategori: sukses, validasi gagal, rollback, idempotensi `client_id`, dan bukan-anggota ruang.
- **Alasan:** desain menaruh seluruh keamanan uang di hak role + RLS + `SECURITY DEFINER` (SPEC §5.2). Satu `GRANT` yang lupa langsung membuka kembali SEC-01/INT-06. Tes katalog murah, cepat (< 2 detik), dan menangkap kelalaian, bukan hanya bug yang sudah dibayangkan.

### R3 — Suite regresi T1–T18 dan S1–S7 sebagai tes v2 · **wajib** · M1–M5 (peta di Lampiran A)
- **Isi:** setiap repro v1 ditulis ulang sebagai pgTAP terhadap API v2 dengan **ekspektasi yang benar**, bukan sekadar tidak-crash:
  - **S1 (INT-03):** `update_entry` 100k→300k membuat saldo turun 300k. Juga dibuktikan bahwa `UPDATE entry_lines` langsung oleh `dompetku_app` gagal `42501`.
  - **S2 (INT-05):** tidak ada kolom saldo yang bisa ditulis. `adjust_balance(target)` membuat entri `adjustment` sebesar selisih, saldo = target, dan income/expense tidak berubah.
  - **S3 (INT-02):** `update_entry` dengan nominal ≤ 0 ditolak dengan kode DK, sementara baris dan saldo tetap. Varian T3: exception disuntik setelah langkah update (lihat di bawah), lalu dibuktikan rollback penuh.
  - **S4 (INT-01):** utang 1jt + 2 cicilan, lalu edit keterangan. Saldo, jumlah cicilan, sisa, dan `occurred_on` pokok semuanya tidak berubah.
  - **S5 (INT-04):** top up goal aset 500k, edit jadi 600k. Nilai aset = 600k, bank −600k, net worth tidak berubah.
  - **S6 (INT-06):** user B tidak bisa membuat, mengedit, atau membatalkan entri yang menunjuk akun A. Error yang muncul harus sama untuk "tidak ada" dan "milik orang lain" agar tidak ada orakel enumerasi UUID.
  - **S7/T18:** tes rekonsiliasi dijalankan **terakhir** di suite dan pada data hasil tes properti (R5): untuk semua akun, `account_balances.balance` = Σ `entry_lines` dari entri non-void.
- **Injeksi kegagalan untuk T3:** tes tidak bisa menyuntik exception ke tengah fungsi tanpa titik kait. Usul: tes memasang trigger `test.fail_after_update` (hanya di DB tes) pada `entry_history` yang melempar exception. Fungsi harus rollback seluruhnya. Pola yang sama dipakai untuk `record_loan_payment` (INT-12) dan `settle_reimbursement` (INT-13).
- **Alasan:** ROADMAP sudah mewajibkan T-ID per milestone, tetapi S1–S6 hanya disebut sebagian (S4 di M3, S5 di M4). Semua bug v1 yang terbukti harus jadi tes yang tidak boleh dihapus.

### R4 — Suite isolasi Pribadi/Bersama dua user dengan data kanari · **wajib** · M0 (kerangka) → M1 (penuh) → tiap milestone
- **Isi:** persona tetap: **Novanda** (pemilik), **Farida** (pasangan), **Luar** (user terautentikasi tanpa household; penguji RLS), dan **Anonim** (tanpa sesi). Ruang Pribadi Farida diisi **kanari**: deskripsi `KANARI-FARIDA-PRIBADI-7f3a`, nama dompet `KANARI-DOMPET-F`, dan nominal unik Rp 7.777.777. Ruang Pribadi Novanda diisi kanari serupa. Skenario wajib:

| ID | Skenario | Diharapkan |
|---|---|---|
| B1 | Loop katalog: sebagai Novanda, `SELECT` setiap tabel/view domain | 0 baris dengan `space_id` = Pribadi Farida |
| B2 | Novanda `create_entry`/`create_transfer` dengan `account_id`/`category_id` milik Pribadi Farida | Ditolak dengan kode yang sama seperti UUID acak |
| B3 | Transfer Pribadi Novanda → dompet Bersama 500k | Novanda −500k, Bersama +500k. Laporan pribadi menampilkan "Setor ke Bersama" (bukan pengeluaran), laporan Bersama "Setoran dari Novanda" (bukan pemasukan). Σ saldo kedua ruang tidak berubah |
| B4 | Farida membuka entri B3 lewat **semua** jalur baca (list, detail, `entry_history`, feed aktivitas, laporan, ekspor, payload RSC/JSON) | Tidak ada `account_id`/nama dompet sumber Novanda di payload mana pun (grep kanari pada respons HTTP mentah) |
| B5 | Farida mengedit/membatalkan transfer B3 | Ditolak (hanya pencatat, SPEC §7a) |
| B6 | Farida mengambil Bersama → Pribadi Farida | Bersama −, Pribadi Farida +. Novanda melihat "Diambil oleh Farida" tanpa nama dompet tujuan |
| B7 | Transfer lintas ruang ke ruang yang bukan keanggotaan pencatat (Novanda → Pribadi Farida) | Ditolak |
| B8 | Novanda dan Farida mengedit entri Bersama yang sama dengan `version` sama | Satu sukses, satu konflik. `entry_history` mencatat `changed_by` yang benar |
| B9 | Kategori/anggaran ruang Pribadi dipakai di entri Bersama (dan sebaliknya) | Ditolak (FK komposit `space_id`) |
| B10 | Utang/piutang, modal trading, pocket kantor, talangan kantor dibuat di Bersama | Ditolak (SPEC §5.4) |
| B11 | `app.user_id` tidak diset / string kosong / UUID user tak dikenal | 0 baris di semua tabel, semua `api.*` gagal (fail-closed), tidak ada error 500 |
| B12 | Kebocoran GUC lewat pool: pool `max=1`, request Novanda lalu request tanpa `withUser` | Request kedua melihat `app.user_id` kosong (`is_local = true`) |
| B13 | Laporan, ekspor CSV/PDF, prompt builder AI (fungsi yang membuat prompt, dengan provider palsu) dijalankan sebagai Novanda | Tidak ada kanari Farida dalam keluaran maupun prompt |
| B14 | Job worker (`recurring_materialize`, `net_worth_snapshot`) untuk aturan Novanda | Entri hanya muncul di ruang aturan itu. Job tidak memakai identitas yang bisa melihat semua ruang tanpa filter |
| B15 | Log server (pino) selama suite E2E penuh | 0 kemunculan kanari, nominal kanari, atau email (redaksi) |
| B16 | Net worth per ruang setelah B3/B6 | Per ruang berubah sesuai transfer, Σ kedua ruang tetap |
| B17 | Novanda membuka URL `/r/<space_id Pribadi Farida>/…` | 404 (bukan 403), tanpa membocorkan keberadaan ruang |
| B18 | Undangan pasangan: tautan dipakai 2×, kedaluwarsa, dipakai email di luar allowlist | Ditolak. Penggunaan pertama tercatat di audit log |
| B19 | Cabut sesi Farida dari perangkat lain | Request berikutnya dengan cookie lama: 401/redirect |
| B20 | Feed aktivitas Bersama | Mencatat setiap create/edit/void oleh kedua anggota, tanpa detail ruang Pribadi |

- **Alasan:** anti-tujuan SPEC §2 menyebut "data pribadi pasangan terlihat lewat jalur apa pun" sebagai kegagalan. RLS saja tidak cukup karena fungsi `SECURITY DEFINER`, view, worker, ekspor, AI, dan log adalah jalur yang melewati atau berada di luar RLS. Kanari mengubah "tidak bocor" menjadi pernyataan yang bisa di-grep.

### R5 — Tes properti berbasis model untuk invarian saldo · **wajib** · M1 (diperluas M3/M4)
- **Isi:** fast-check `fc.commands` di Vitest, dijalankan terhadap Postgres nyata lewat lapisan yang sama dengan Server Actions (Kysely → `api.*`). Model TS sederhana (map akun → saldo, entri → lines) menjadi **orakel independen** dari SQL. Perintah acak: income, expense, transfer (± fee), transfer lintas ruang, edit, void, restore, adjust, replay `client_id`, edit dengan `version` basi, dan aksi oleh user lain. Setelah setiap perintah, invarian berikut diperiksa:
  1. `account_balances` = model untuk setiap akun (I1).
  2. Transfer: Σ lines = −fee. Lintas ruang: Σ saldo seluruh household berubah tepat −fee.
  3. Total income/expense laporan tidak berubah oleh transfer, adjust, atau pokok utang (I6).
  4. Void lalu restore = identitas (saldo dan laporan kembali persis).
  5. Replay `client_id` mengembalikan id yang sama, tanpa baris baru.
  6. `version` monoton naik; jumlah `entry_history` = jumlah edit + void + restore.
  7. Visibilitas: setiap baris yang dilihat user X punya `space_id` ∈ ruang X.
  8. Fungsi uang hanya pernah gagal dengan SQLSTATE kelas `DK` atau `23xxx` yang dipetakan, tidak pernah `XX000`/`42xxx`.
- **Anggaran:** PR: seed tetap + 100 run × ≤ 50 perintah (< 60 detik). Nightly: seed acak, 2.000 run. Seed yang gagal dicetak dan otomatis ditambahkan ke `regressions.json` agar tes kegagalan itu diulang selamanya.
- **Fuzz input:** fast-check untuk `parseRupiah`/`formatRupiah` (roundtrip, tolak negatif/desimal/`1e3`, INT-19), semua skema Zod (input acak tidak boleh lolos ke DB dalam bentuk tak valid), parser teks bebas M6 ("35rb", "35k", "35.000", "1,5jt", kalimat tanpa angka). Untuk `api.*` dengan argumen acak (null, 0, negatif, `bigint` maks, string 10 KB, UUID asing), hasilnya harus error berkode, tanpa efek samping.
- **Alasan:** ROADMAP M1 meminta "1.000 operasi acak (property test di SQL)". Saya tidak setuju dengan pelaksanaannya di SQL (lihat §4-2): pengacakan di SQL tidak punya shrinking dan orakelnya ditulis dalam bahasa yang sama dengan implementasinya, sehingga bug logika yang sama bisa muncul di kedua sisi.

### R6 — Konkurensi, double submit, dua tab · **wajib** · M1
- **Isi:** pgTAP berjalan dalam satu sesi, sehingga tidak bisa menguji balapan. Diperlukan harness Vitest dengan **dua koneksi `pg` nyata** dan titik sinkronisasi (`pg_advisory_lock` di DB tes atau barrier Promise):

| ID | Skenario | Diharapkan |
|---|---|---|
| C1 | Dua transaksi paralel `update_entry` pada entri sama, `version` sama | Tepat satu sukses, satu `DK-conflict` (T5 dalam kondisi balapan nyata, bukan berurutan) |
| C2 | Dua `create_entry` paralel dengan `client_id` sama | Satu baris. Kedua pemanggil menerima id yang sama, tanpa error unik mentah ke user |
| C3 | Dua `record_loan_payment` paralel yang bersama-sama melebihi sisa | Satu ditolak (T7). Sisa tidak pernah negatif |
| C4 | `void_entry` paralel dengan `update_entry` | Hasil serial yang konsisten, tidak ada deadlock tak tertangani (retry `40P01`/`40001` teruji) |
| C5 | `recurring_materialize` dijalankan dua worker bersamaan | Satu entri per occurrence (T15 dalam balapan) |
| C6 | E2E: klik ganda "Simpan" di quick add + transfer + bayar cicilan | Satu entri (INT-18) |
| C7 | E2E: request Server Action diputar ulang (Playwright `route` menahan respons pertama, klien mengulang) | Satu entri, UI menampilkan sukses sekali |
| C8 | E2E: dua tab user sama mengedit entri sama | Tab kedua menampilkan pesan konflik berbahasa Indonesia dengan opsi muat ulang, tanpa menimpa diam-diam |

- **Alasan:** INT-18 dan INT-12 adalah bug balapan. Tes berurutan tidak akan pernah menemukannya.

### R7 — Kendali waktu dan matriks zona waktu · **wajib** · M0
- **Isi:**
  - **DB:** semua fungsi memakai `app.now()` dan `app.today_wib()`, tidak memanggil `now()`/`current_date` langsung. Di produksi, `app.now()` = `now()`. Migrasi tes menggantinya agar membaca `current_setting('test.fake_now', true)`. Tes katalog (R2-7) memastikan definisi produksi adalah `now()`. Konsekuensinya, `now()` di dalam transaksi pgTAP tidak lagi "beku".
  - **Node:** `todayWIB()`/`date.ts` menerima jam yang disuntik. Vitest dijalankan dengan `TZ=UTC`, `TZ=Asia/Jakarta`, dan `TZ=America/New_York` (zona dengan DST untuk menangkap ketergantungan pada zona host). Playwright memakai `timezoneId` `Asia/Jakarta` dan `Asia/Makassar`, serta `page.clock.setFixedTime`.
  - **Postgres tes** dijalankan dengan `timezone = 'UTC'` (sama seperti VM) agar bug "kebetulan benar karena server WIB" tertangkap.

| ID | Skenario | Diharapkan |
|---|---|---|
| Z1 | Entri 31 Okt 23:30 WIB (T13) | Masuk laporan dan realisasi anggaran Oktober |
| Z2 | Quick add pukul 00:30 WIB (17:30 UTC hari sebelumnya) | Tanggal default = hari ini WIB (INT-07) |
| Z3 | Laporan bulan Feb 2028 (kabisat) dan Feb 2027 | Rentang 1–29 / 1–28 |
| Z4 | Tagihan tgl 31 mulai 31 Jan (T14) | 31 Jan, 28/29 Feb, 31 Mar, 30 Apr |
| Z5 | Cron pg-boss `recurring_materialize` 00:05 WIB | Terjadwal 17:05 UTC; occurrence bertanggal hari WIB yang benar |
| Z6 | `net_worth_snapshot` 23:55 WIB | Snapshot bertanggal hari WIB itu, bukan kemarin/besok (INT-20) |
| Z7 | Filter "Bulan lalu" dijalankan 1 Nov 00:10 WIB | 1–31 Okt |
| Z8 | Label "Hari ini/Kemarin" lintas tengah malam WIB | Benar dengan device di `Asia/Makassar` |
| Z9 | Pergantian tahun 31 Des 23:59 → 1 Jan 00:01 WIB | Laporan tahunan dan anggaran Januari benar |
| Z10 | Anggaran "aman dipakai sampai 31 Okt" pada 31 Okt 23:59 | Sisa hari = 1, tidak ada pembagian dengan nol |

- **Alasan:** INT-07 menghilangkan 46 transaksi dari laporan produksi. Tanpa jam yang bisa dikendalikan, Z2, Z5, dan Z6 tidak bisa dites deterministik.

### R8 — Tes integrasi Server Actions terhadap Postgres nyata · **wajib** · M0 (harness) → M1
- **Isi:**
  - Vitest project `integration`, satu **template database** per worker (`CREATE DATABASE t_<worker> TEMPLATE dompetku_tmpl`; ±100 ms) dari migrasi + seed fixture. Tidak memakai mock DB.
  - Action dipanggil langsung sebagai fungsi, dengan `getSession` diganti fake yang mengembalikan persona. Yang diuji: validasi Zod (pesan Indonesia per field), pemetaan kode DK → pesan (UX §7: apa yang terjadi + apa yang bisa dilakukan), `client_id` diteruskan, `revalidateTag` terpanggil dengan tag ruang yang benar, dan tidak ada data ruang lain dalam nilai kembalian.
  - **Enumerasi otorisasi:** semua action wajib dibuat lewat `authedAction(schema, fn)`. Ini dijaga lint (aturan kustom ESLint atau grep CI: file `'use server'` hanya boleh mengekspor hasil `authedAction`). Ada pula tes yang membaca `app-paths-manifest.json` setelah build dan memanggil setiap route `/api/*` tanpa cookie, dengan harapan 401 (pengecualian eksplisit: `/api/health`, endpoint auth).
- **Alasan:** lapisan action adalah tempat pemetaan error dan otorisasi. SEC-02 (route terbuka) dan SEC-06 (matcher mengecualikan `api/`) adalah bug di lapisan ini, bukan di DB.

### R9 — Playwright E2E mobile + desktop, axe, visual regression · E2E + axe **wajib** M0; visual **sebaiknya** M0, **wajib** sebelum screenshot portofolio (M2)
- **Isi:**
  - Project Playwright: `mobile-chromium` (Pixel 7, 412px) dan `mobile-webkit` (iPhone 14, 390px) di nightly, `mobile-chromium` di PR; `desktop-chromium` 1280px di PR; `desktop-firefox` di nightly. Stack E2E adalah `next build && next start` + worker + Postgres efemeral, bukan `next dev`.
  - Alur kritis per milestone ada di Lampiran A. Termasuk **ukur ≤ 3 ketukan** (ROADMAP M1): helper menghitung `click`/`tap` dari tombol (+) sampai toast "Tersimpan", dan tes gagal bila > 3.
  - **axe** (`@axe-core/playwright`, tag `wcag2a, wcag2aa, wcag21aa, wcag22aa`) di setiap layar dan setiap state (kosong, terisi, error, sheet terbuka, dark mode): 0 pelanggaran serious/critical. Tambahan: tes keyboard-only untuk quick add (fokus awal di nominal, Escape menutup, fokus kembali ke pemicu), `prefers-reduced-motion`, target sentuh ≥ 44px (cek bounding box elemen interaktif di mobile).
  - **Visual regression:** `toHaveScreenshot` di image Docker Playwright yang dipin (font deterministik), data seed demo tetap, `page.clock` tetap, animasi dimatikan, `maxDiffPixelRatio: 0.001`. Cakupan: Beranda, Transaksi, Quick add, Dompet, Anggaran, Laporan, Bersama × {390, 1280} × {light, dark}. Baseline hanya diperbarui lewat workflow berlabel `update-snapshots`, dan diff harus disetujui reviewer manusia.
- **Alasan:** UX menargetkan WCAG 2.2 AA dan screenshot portofolio (SPEC §1). Visual regression mencegah regresi gaya diam-diam. Saya menandainya "sebaiknya" di M0 karena layar masih berubah cepat.

### R10 — Tes keamanan otomatis di CI · **wajib** · M0

| ID | Pemeriksaan | Kapan | Gagal bila |
|---|---|---|---|
| K1 | `gitleaks` (riwayat penuh + diff PR); juga pre-commit | PR | Ada temuan tanpa allowlist beralasan |
| K2 | `npm audit --omit=dev --audit-level=high` + `osv-scanner` lockfile | PR + nightly | high/critical tanpa pengecualian berkedaluwarsa (`.osv-ignore` dengan tanggal, maks 30 hari) |
| K3 | Trivy scan image multi-arch (web, worker, postgres+WAL-G) | PR yang menyentuh Dockerfile + nightly + rilis | critical/high yang punya perbaikan |
| K4 | Header check: tes Playwright/fetch ke `next start` | PR | CSP tanpa nonce atau dengan `'unsafe-inline'` di `script-src`; HSTS < 1 tahun; tidak ada `frame-ancestors 'none'`/XFO DENY, `nosniff`, `Referrer-Policy`, `Permissions-Policy` |
| K5 | Cookie sesi | PR | Tanpa `HttpOnly; Secure; SameSite=Lax`, atau ada `Domain` terlalu luas |
| K6 | Otorisasi route/action (R8) | PR | Ada route/action yang bisa dipanggil anonim |
| K7 | Rate limit login/reset (SPEC §5.3) | PR | Percobaan ke-N+1 tidak 429/lockout; lockout bocor ke akun lain |
| K8 | Tes katalog DB (R2) | PR | Lihat R2 |
| K9 | CSV formula escape + PDF escape (SEC-09): fixture `=HYPERLINK(...)`, `+1`, `-1`, `@SUM`, `<img src=x onerror=alert(1)>` | PR (M5+) | Sel tidak di-prefix `'`; HTML tidak ter-escape |
| K10 | Semgrep OSS (ruleset TypeScript/React/Next + aturan kustom: dilarang `dangerouslySetInnerHTML`, `sql.raw`/`sql.lit` Kysely dengan input, `console.log`) | PR | Ada temuan |
| K11 | OWASP ZAP baseline ke stack efemeral (login otomatis) | Nightly + rilis | high; medium ditriase |
| K12 | Smoke pasca-deploy dari runner GitHub-hosted (eksternal): `nc -z <ip> 5437` harus **gagal**, header di domain publik sesuai K4, TLS (`testssl.sh --severity HIGH`), `/api/health` 200 | Setiap deploy | Port DB terbuka dari internet (anti-tujuan SPEC §2) |

- **Alasan:** SEC-10 menunjukkan v1 tidak menjalankan audit apa pun. Catatan: **CodeQL untuk repo private butuh GitHub Advanced Security (berbayar)**, jadi Semgrep OSS adalah penggantinya. Ini perlu dikonfirmasi peran Security/DevOps.

### R11 — Tes backup-restore dan migrasi · **wajib** · M0
- **Isi:**

| ID | Tes | Kapan |
|---|---|---|
| BR1 | Di CI: Postgres + WAL-G → **MinIO** (container, pengganti OCI Object Storage) untuk base backup, tulis baris penanda, `wal-g backup-fetch` + PITR ke container baru, lalu jalankan pgTAP rekonsiliasi (T18) + hitung baris per tabel = sumber | PR yang menyentuh `infra/backup/**` + nightly |
| BR2 | PITR: penanda ditulis pada t0, t0+1m, t0+2m; restore ke t0+1m30s, lalu hanya penanda 1–2 yang ada (bukti RPO) | nightly |
| BR3 | Restore dengan kunci enkripsi salah harus gagal dengan jelas (bukti backup benar-benar terenkripsi) | nightly |
| BR4 | Job produksi `backup_verify` mingguan (SPEC §5.5): restore ke container sementara di VM DB → pgTAP rekonsiliasi → hasil ke `job_runs` + alert bila gagal | mingguan, status jadi gate rilis |
| BR5 | Drill manual per kuartal + sebelum go-live: pemilik/DevOps memulihkan dari nol ke VM kosong mengikuti runbook, dicatat dengan durasi | RTO ≤ 1 jam dibuktikan dengan stopwatch, bukan asumsi |
| BR6 | Migrasi: (a) dari kosong ke HEAD; (b) **upgrade**: DB berisi fixture rilis sebelumnya (dump tag N-1) → migrasi HEAD → seluruh pgTAP + rekonsiliasi; (c) **kompatibilitas N-1**: tes integrasi versi app N-1 dijalankan terhadap skema HEAD (menjamin rollback image aman, SPEC §5.7 expand/contract) | (a) PR; (b)(c) PR yang menyentuh `migrations/**` mulai M1 |

- **Alasan:** "tidak pernah kehilangan data" (SPEC §1) hanya benar bila restore pernah berhasil. Backup yang tidak pernah direstore bukan backup. BR6(c) adalah satu-satunya bukti bahwa rollback otomatis CD tidak merusak data.

### R12 — Quality gate CI, kebijakan flaky, dan bukti "selesai" di PR · **wajib** · M0
- **Isi:** detail di Lampiran B (gate) dan Lampiran C (template PR).
  - Tes uang (pgTAP, integrasi, properti) **tanpa retry**: satu kegagalan = merah. Playwright boleh `retries: 1` di CI, tetapi tes yang lulus setelah retry dilaporkan sebagai flaky (reporter JSON) dan dibuatkan issue otomatis. Karantina maksimal 7 hari, dan **tidak boleh** untuk tes ber-ID T/S/B/C/K.
  - Coverage bukan gate global. Gate yang berlaku: `lib/money.ts`, `lib/date.ts`, parser teks bebas 100% branch; setiap `api.*` punya file tes lima kategori (R2-8).
  - Mutation testing (Stryker) untuk `money.ts`/`date.ts`/parser: **nanti** (M6), skor ≥ 80%.
- **Alasan:** gate yang bisa dilewati dengan "retry sampai hijau" sama dengan tidak ada gate.

## 3. Risiko utama di area QA + mitigasi

| Risiko | Dampak | Mitigasi |
|---|---|---|
| Tes ditulis setelah implementasi sehingga hanya mengonfirmasi kode | Bug logika lolos (pola v1) | Commit tes terpisah dan lebih dulu di PR. CI menjalankan suite pada commit tes saja (job `test-first-proof`, opsional per PR berlabel `money`), dan **harus merah**. Log merahnya ditempel di PR (Lampiran C) |
| Orakel tes sama dengan implementasi (SQL menguji SQL) | Bug identik di kedua sisi | Model TS independen (R5) + golden numbers yang dihitung tangan dan disetujui pemilik (Lampiran D) |
| Self-hosted runner di VM produksi menjalankan kode PR | Kode branch (termasuk yang ditulis agen) berjalan di mesin yang memegang DB produksi | **Wajib:** runner self-hosted hanya untuk job `deploy` pada `main`/tag dengan GitHub Environment protection. Semua tes PR di runner GitHub-hosted. `pull_request` tidak pernah `runs-on: self-hosted` (dicek lint workflow `actionlint` + skrip) |
| CI terlalu lambat sehingga orang melewatinya | Gate dimatikan | Anggaran PR ≤ 15 menit wall-clock: job paralel, cache image Postgres/Playwright, template DB, matriks browser penuh hanya nightly |
| Visual regression flaky karena font/rendering | Baseline diabaikan | Docker image Playwright dipin, font self-host, clock tetap, animasi off. Visual dijalankan hanya di satu OS |
| Tidak ada staging permanen (SPEC §7a) | Tes upgrade/restore/ZAP tidak punya tempat | Stack compose efemeral di runner GitHub-hosted untuk BR1–3, BR6, K11. Restore produksi (BR4) di VM DB oleh job worker, bukan oleh CI |
| Data nyata masuk fixture/screenshot | Kebocoran privasi pasangan | Fixture dan demo hanya data fiktif (Lampiran D). `gitleaks` + aturan kustom menolak email asli pemilik/pasangan di `tests/**`, `seed/**`, dan PNG baseline (nama file); review manusia untuk baseline |
| Jam/zona tidak bisa dikendalikan | Tes tanggal flaky atau tidak ada | `app.now()` (R7), keputusan di M0 sebelum fungsi pertama ditulis |
| Semantik lintas ruang kabur | Tes B3–B6 tidak bisa ditulis dengan ekspektasi pasti | Minta definisi tertulis + view sebelum M1 (§4-4, §6) |
| Bigint vs `Number` JS | Nominal > 2^53 salah di UI | CHECK batas atas nominal di DB (usul ≤ 10^13) + tes properti roundtrip DB↔TS pada batas |

## 4. Ketidaksetujuan dengan desain saat ini

1. **ROADMAP sudah usang terhadap SPEC revisi 2.** Masih ada `supabase test db`, pg_cron, `auth.uid()`, M7 migrasi data + ETL hash, dan tidak ada M8. Usul: ROADMAP diperbarui. Tes M7 diganti "cutover: ekspor arsip v1 terbaca + v2 kosong siap pakai". pg_cron diganti pg-boss. Kriteria "Lighthouse a11y ≥ 95" (ROADMAP M0) dijadikan informatif saja karena axe 0 serious/critical lebih ketat dan deterministik.
2. **"Property test di SQL, 1.000 operasi acak" (ROADMAP M1).** Alternatif: model-based fast-check di TS terhadap DB nyata (R5). Trade-off: lebih banyak round-trip (±10 detik per 1.000 operasi lokal, dapat diterima), tetapi ada shrinking, seed yang bisa direproduksi, dan orakel independen. SQL acak boleh dipertahankan sebagai smoke murah, tetapi bukan bukti utama.
3. **Jam tidak bisa dikendalikan.** DESIGN §5 "Zona waktu" memakai `now() at time zone 'Asia/Jakarta'` langsung, sehingga Z2/Z5/Z6 tidak bisa dites deterministik. Usul `app.now()`/`app.today_wib()` (R7). Trade-off: satu indireksi dan disiplin lint ("dilarang `now()` di `api.*`", dicek tes katalog dengan `prosrc` regex).
4. **Visibilitas transfer lintas ruang belum terdefinisi di level baris.** SPEC §7a: header entri milik ruang sumber, dan ruang tujuan melihat "Setoran dari <nama>" tanpa nama dompet sumber. Tetapi bila RLS `entries` berbasis `space_id` header, anggota ruang tujuan tidak bisa membaca header (deskripsi, tanggal). Bila dibuka, `entry_lines` sumber berisiko terbaca. Usul: RLS `entry_lines` berbasis ruang **akun** line, dan view `space_ledger` (security_invoker) yang memproyeksikan entri lintas ruang ke ruang tujuan dengan kolom tersaring (tanggal, nominal line tujuan, nama pencatat, label). Tes B4 memeriksa view ini dan semua jalur lain. Tanpa definisi ini, saya tidak bisa menulis ekspektasi B3–B6.
5. **Self-hosted runner untuk deploy di VM yang menjalankan app** (SPEC §7a) berisiko bila juga dipakai untuk tes PR. Lihat risiko §3. Ini syarat, bukan penolakan.
6. **Kriteria "dua user × semua tabel × semua operasi"** (SPEC §5.4) sebaiknya dijalankan **dari katalog** (R2/B1), bukan ditulis tangan per tabel. Tes manual per tabel akan tertinggal saat tabel baru ditambah.

## 5. Kriteria penerimaan yang saya tuntut (bisa dicek)

1. `scripts/check-test-registry.ts` hijau: setiap ID wajib untuk milestone aktif (Lampiran A) tertaut ≥ 1 tes non-skip.
2. Tes katalog R2 (1–8) lulus pada setiap PR. Smoke pasca-deploy memastikan skema `test` tidak ada di produksi dan `app.now()` produksi = `now()`.
3. T1–T18 dan S1–S7 (versi v2) lulus pada milestone yang ditetapkan, dan tetap lulus di semua milestone sesudahnya (tidak ada penghapusan tanpa ADR).
4. B1–B20 lulus mulai M1 (B1, B11, B12, B17–B19 sudah di M0). Grep kanari pada log E2E, ekspor, dan payload HTTP = 0.
5. Tes properti R5: PR 100 run hijau. Nightly 2.000 run hijau 7 malam berturut-turut sebelum milestone ditutup. `regressions.json` selalu dijalankan.
6. C1–C8 lulus. Tidak ada `retry` pada project tes uang (dicek konfigurasi).
7. Z1–Z10 lulus pada matriks `TZ` ∈ {UTC, Asia/Jakarta, America/New_York}.
8. Playwright: alur milestone lulus di 390px dan 1280px; axe 0 serious/critical pada semua layar dan state baru; quick add ≤ 3 ketukan terukur.
9. K1–K10 hijau per PR; K11 tanpa high per rilis; K12 hijau setelah setiap deploy (port 5437 tertutup dari internet).
10. BR1–BR3 hijau nightly; BR4 sukses ≤ 7 hari sebelum rilis; BR5 drill sebelum go-live dengan RTO tercatat ≤ 1 jam; BR6(b)(c) hijau pada setiap PR migrasi.
11. Waktu gate PR ≤ 15 menit (p90 dari 20 run terakhir); tingkat flaky Playwright < 2% per minggu.
12. Setiap PR mengisi template bukti (Lampiran C). PR tanpa bukti tidak di-merge, termasuk PR dari agen.

## 6. Pertanyaan/permintaan untuk peran lain

- **Arsitek DB / Backend:**
  - (a) Setuju `app.now()`/`app.today_wib()` dan titik injeksi kegagalan via trigger tes (R3/R7)?
  - (b) Definisi baris + view untuk transfer lintas ruang (§4-4) sebelum M1.
  - (c) Daftar kode error `DKxxx` lengkap + SQLSTATE agar R5-8 dan pemetaan pesan bisa dites.
  - (d) Batas atas nominal (CHECK) dan perilaku `sum()` → `bigint`.
  - (e) Identitas worker pg-boss: apakah job memakai `withUser` per ruang atau role khusus? (B14)
- **Frontend:**
  - (a) Semua action lewat `authedAction()` + aturan lint (R8).
  - (b) Atribut `data-testid` hanya untuk elemen tanpa peran/label aksesibel; selector utama `getByRole`.
  - (c) `todayWIB()` menerima jam yang disuntik.
  - (d) Halaman `/dev/ui` (UX §6) dipakai sebagai target axe + visual per komponen.
- **UX/Design:** daftar layar + state untuk baseline visual (R9) dan teks pesan konflik/versi basi (C8), saldo kurang, dan 404 ruang (B17).
- **DevOps/SRE:**
  - (a) Runner self-hosted hanya untuk deploy (§3).
  - (b) MinIO di CI untuk BR1–BR3.
  - (c) Job `backup_verify` menulis ke `job_runs` yang bisa dibaca gate rilis.
  - (d) Konfirmasi arsitektur VM untuk matriks build/Trivy multi-arch.
  - (e) Smoke K12 dari runner eksternal setelah deploy, dengan rollback otomatis bila gagal.
- **Security:** konfirmasi CodeQL tidak tersedia (repo private tanpa GHAS) → Semgrep OSS + aturan kustom. Daftar aksi yang wajib masuk audit log (login, ekspor, undang, cabut sesi) agar bisa dites.
- **Pemilik/PM:**
  - (a) Perangkat Farida dan Novanda: iOS Safari? Ini menentukan apakah `mobile-webkit` naik dari nightly ke gate PR.
  - (b) Setujui golden numbers dataset fixture M2 (rumus "aman dipakai", UX §2) sebelum implementasi.
  - (c) Bersedia menjalankan drill restore BR5 sebelum go-live (±1 jam).

---

## Lampiran A — Matriks tes per milestone

Kolom: **pgTAP** (fungsi uang, RLS, katalog), **Int** (Vitest integrasi Server Actions/konkurensi/properti terhadap Postgres), **Unit** (Vitest util/schema), **E2E** (Playwright + axe; visual bila ditandai), **Ops/Sec**. ID yang ditulis pada milestone wajib tetap hijau di semua milestone berikutnya.

| Milestone | pgTAP | Int | Unit | E2E (+axe) | Ops/Sec |
|---|---|---|---|---|---|
| **M0** Fondasi | Harness, katalog R2-1..8, `withUser` + B11, B12; auth schema: allowlist, undangan sekali pakai (B18) | Harness template DB; `authedAction` + enumerasi route anonim (K6); rate limit login (K7) | `money.ts` (properti roundtrip, INT-19), `date.ts` Z2/Z7/Z8 × matriks TZ, skema env Zod | Login, logout, reset, passkey (virtual authenticator), TOTP; 2FA wajib setelah onboarding; cabut sesi (B19); 404 ruang orang lain (B17); navigasi 5 tab; axe shell; prototipe klik (visual **sebaiknya**) | K1–K5, K8, K10; BR1–BR3 di MinIO; BR6(a); K12 setelah deploy pertama; BR5 drill pra-go-live |
| **M1** Dompet, kategori, transaksi, transfer | T1–T5, T12, T13, T16, T18; S1, S2, S3, S6, S7; B1–B10, B13 (laporan dasar), B16, B20; `suggest_categories` hanya dari ruang aktif | R5 properti (perintah entri/transfer/lintas ruang/adjust/void/restore); C1, C2, C4; pemetaan DK → pesan | Zod entri/transfer; parser alias nominal dasar | Quick add ≤ 3 ketukan; edit + konflik (C8); undo 10 detik; transfer + biaya; transfer lintas ruang dua persona (B3–B6) dalam dua `browserContext`; klik ganda (C6), replay (C7); talangan + `settle_reimbursement` | BR6(b)(c) aktif; B15 grep log |
| **M2** Anggaran, laporan, Beranda | T17; Z1, Z3, Z9, Z10; golden numbers `period_summary`/`budget_actuals`/`dashboard_summary` (Lampiran D); "tidak termasuk" (kantor, transfer, pokok utang) | Revalidasi tag anggaran setelah catat; B13 laporan Bersama tanpa kanari | Formatter ringkas `Rp 1,25 jt` (UX §7) | Buat anggaran → catat → progres berubah; Beranda "aman dipakai" + rumus terlihat; **visual wajib** untuk layar portofolio; First Load JS ≤ 150 kB (`size-limit`/build manifest) | — |
| **M3** Utang/piutang, modal trading | T6–T10; S4; INT-12 (bayar > sisa, atomik); `void_loan_payment` | R5 diperluas (utang, cicilan, modal trading); C3 | — | Catat utang → cicilan 25/50/Lunas → batal dengan dialog akibat (UX §3.3) | — |
| **M4** Tujuan tabungan, aset/saham | T11; S5; lot buy/sell (qty, biaya rata-rata, P/L); 1 dompet = 1 goal aktif; `valuation` tidak mengubah income/expense | R5 diperluas (goal, lot); validator harga (> 0, perubahan < 35%) dengan `PriceSource` palsu | Validator harga, proyeksi goal | Setor ke goal; harga gagal → nilai terakhir + label "Diperbarui …" | K3 untuk route harga (tanpa proxy CORS publik, SEC-07) |
| **M5** Tagihan rutin, trip, ekspor | T14, T15; Z4, Z5; `recurring_occurrences` UNIQUE; trip exclusions stabil setelah edit | C5 (dua worker); job dijalankan 2× = 1 entri; `job_runs` + alert saat gagal; B14 | Escape CSV (K9), escape PDF | Ekspor CSV/PDF cocok dengan laporan (angka sama); B13 ekspor tanpa kanari | K9 |
| **M6** AI, net worth, PWA, teks bebas | `net_worth(on)` per ruang (B16); Z6; `ai_usage` batas 20/hari | AI 401 tanpa sesi, 429 setelah batas; prompt builder tanpa kanari/nama kontak/deskripsi mentah (B13); respons AI tidak valid → pesan anggun | Skema respons AI (fixture valid/invalid); parser teks bebas: fuzz + tabel contoh ("makan siang 35rb bca", "35k", "1,5jt gopay", tanpa angka) | Teks bebas → pratinjau → konfirmasi (tidak pernah simpan tanpa konfirmasi); offline baca-saja + banner; installable | Mutation testing (**nanti**) |
| **M7** Cutover | Rekonsiliasi T18 pada DB produksi setelah 2 minggu pemakaian nyata (dijalankan `dompetku_readonly`) | — | — | Smoke penuh di domain publik (read-only, akun demo) | BR5 drill final; K11 ZAP; K12 |
| **M8** Bot Telegram | Penautan kode sekali pakai (dipakai 2× / kedaluwarsa → ditolak); bot hanya menulis ke ruang user yang tertaut | Webhook: verifikasi secret token Telegram; payload palsu ditolak; idempotensi `update_id` (dikirim ulang = 1 entri); parser sama dengan M6 | Parser (reuse) | — | K2/K3 dependensi bot; rate limit per chat |

## Lampiran B — Quality gate

### Per PR (required status checks; target ≤ 15 menit)
1. `lint` (ESLint strict, Prettier, `actionlint`, aturan `authedAction`, larangan `now()` di SQL `api.*`).
2. `typecheck` (`tsc --noEmit`) + `kysely-codegen` tidak menghasilkan diff terhadap migrasi.
3. `unit` (Vitest; matriks `TZ` 3 nilai; coverage 100% branch untuk `money/date/parser`).
4. `db` (migrasi dari kosong, pgTAP penuh termasuk katalog; tanpa retry).
5. `integration` (Server Actions, konkurensi C1–C5, properti R5 seed tetap 100 run; tanpa retry).
6. `registry` (R1).
7. `build` (Next standalone + worker; budget First Load JS mulai M2).
8. `e2e` (Playwright `mobile-chromium` + `desktop-chromium`, axe, header K4/K5; visual mulai M2).
9. `security` (K1, K2, K10; K3 bila Dockerfile berubah).
10. Kondisional: `migration-compat` BR6(b)(c) bila `migrations/**` berubah; `backup` BR1 bila `infra/backup/**` berubah.
11. Review: minimal 1 review manusia (pemilik) untuk PR berlabel `money`, `rls`, `auth`, `migrations`. PR agen tidak boleh di-approve oleh agen.

### Nightly (cron, `main`)
R5 seed acak 2.000 run; matriks browser penuh (+ `mobile-webkit`, `desktop-firefox`); visual penuh light/dark; K2, K3 penuh; K11 ZAP; BR1–BR3; laporan flaky. Gagal → issue otomatis + email pemilik.

### Per rilis (tag `vX.Y.Z`, sebelum job deploy)
1. Semua gate PR hijau pada commit tag.
2. Nightly terakhir (< 24 jam) hijau.
3. BR4 `backup_verify` produksi sukses ≤ 7 hari (dibaca dari `job_runs` lewat endpoint internal/`dompetku_readonly`).
4. BR6(b) upgrade dari dump fixture rilis sebelumnya + BR6(c) kompatibilitas N-1.
5. Tidak ada pengecualian `osv`/Trivy yang kedaluwarsa.
6. Changelog + ADR untuk setiap penyimpangan.
7. Setelah deploy: K12 smoke (health, header, TLS, port 5437 tertutup, skema `test` tidak ada). Gagal → rollback otomatis ke image sebelumnya.
8. Rilis pertama ke produksi dan setiap rilis dengan langkah *contract*: **latihan rollback** di stack efemeral (deploy N, migrasi N+1, rollback image ke N, tes integrasi N lulus).

## Lampiran C — Bukti "selesai" di PR (template `.github/pull_request_template.md`)

```
## Lingkup
Milestone: Mx · ID yang dicakup: T1, T2, B3 … (harus cocok dengan registry)

## Bukti test-first (wajib untuk label money/rls)
- Commit tes: <sha> → CI merah: <link run> (kutip 3–5 baris kegagalan)
- Commit implementasi: <sha> → CI hijau: <link run>

## Hasil
- [ ] Semua required checks hijau (tautan run)
- [ ] pgTAP: N tes, 0 gagal · Integrasi: N · Properti: seed=…, 100 run
- [ ] Screenshot 390px & 1280px, light & dark untuk layar yang berubah (lampirkan)
- [ ] axe: 0 serious/critical (artefak laporan)
- [ ] Diff baseline visual ditinjau (bila ada)
- [ ] Tidak ada data nyata di fixture/screenshot
- [ ] Migrasi expand/contract: langkah ini = expand | contract | none; kompatibel N-1: ya/tidak (alasan)
- [ ] ADR untuk penyimpangan dari DESIGN/UX: <link> | tidak ada

## Yang belum / risiko tersisa
(ditulis apa adanya; "tidak ada" hanya bila memang tidak ada)
```

Milestone dinyatakan selesai bila: (1) semua ID milestone di Lampiran A tertaut dan hijau; (2) nightly hijau 7 malam berturut-turut; (3) pemilik memakai fitur itu pada data demo di build `main` dan menandai checklist penerimaan di issue milestone.

## Lampiran D — Data uji dan fixture

| Set | Lokasi | Isi | Dipakai oleh |
|---|---|---|---|
| **Persona** | `packages/db/seed/test/00_personas.sql` | Household 1; Novanda, Farida (anggota), Luar (tanpa household); ruang Pribadi ×2 + Bersama; UUID tetap (`…000a`, `…000b`, `…000c`, sesuai repro v1) | Semua |
| **Minimal** | `seed/test/10_minimal.sql` | Per ruang: 2 dompet operasional, 1 tabungan, 1 kantor (Pribadi saja), 1 aset kas; kategori default + 2 subkategori; saldo awal via `opening_balance` | pgTAP, Int |
| **Kanari** | `seed/test/20_canary.sql` | Entri, dompet, kontak, kategori dengan kanari di setiap ruang Pribadi (R4) | B1, B4, B13, B15 |
| **Golden** | `seed/test/30_golden_2026_10.sql` + `expected/golden_2026_10.json` | Satu bulan lengkap: income, expense, transfer + fee, lintas ruang, kantor, reimburse, utang + cicilan, entri 31 Okt 23:30, void, edit. Angka diharapkan **dihitung tangan** dan disetujui pemilik | M2 laporan, Beranda, anggaran, ekspor (M5) |
| **Tepi** | `seed/test/40_edge.sql` / fast-check arbitraries | Nominal 1, batas atas CHECK, deskripsi 200 karakter, emoji, RTL, `=HYPERLINK(…)`, `<img onerror>`, tanggal 29 Feb 2028, 31 Des, 1 Jan | K9, R5, Z* |
| **Volume** | generator `scripts/gen-volume.ts` (seed tetap) | 50.000 entri per ruang (10× pemakaian v1) | Nightly: `EXPLAIN ANALYZE` saldo < 5 ms (DESIGN D4), daftar paginasi kursor, laporan < 200 ms |
| **Demo** | `seed/demo/` | Data fiktif yang "terlihat hidup" untuk prototipe M0 dan screenshot portofolio; nama fiktif, bukan Novanda/Farida | Visual regression, screenshot PR |
| **Regresi properti** | `tests/property/regressions.json` | Seed + urutan perintah dari setiap kegagalan R5 | Integration (selalu) |

Aturan fixture: SQL idempoten, hanya lewat `api.*` (bukan INSERT langsung ke ledger, kecuali `opening_balance` via fungsi) agar fixture juga menguji jalur tulis; tidak ada data produksi/v1 dalam bentuk apa pun; pabrik TS (`makeEntry`, `makeTransfer`) memanggil Server Action/`api.*`, bukan tabel.
