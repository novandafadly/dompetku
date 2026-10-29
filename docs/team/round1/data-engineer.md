# Data Engineer — Round 1 (DompetKu v2)

Penulis: peran Data Engineer · 2026-10-29 · Dasar: `docs/superpowers/specs/2026-10-29-dompetku-v2-design.md` (selanjutnya **spec**), `docs/v2/DESIGN.md` (**DESIGN**), `docs/v2/UX.md`, `docs/v2/ROADMAP.md`, `docs/audit/02-integrity.md`.

## 1. Ringkasan sikap

Semua angka laporan, anggaran, ekspor, AI, dan net worth harus lewat **satu** lapisan klasifikasi, yaitu view `app.report_lines` dengan kolom `report_class`. Lapisan ini menutup INT-07/08/09 dari akar: v1 salah karena tiap layar punya filter sendiri.
Pada skala ini (2 orang, ±5.000 entri/tahun/ruang), agregat dihitung langsung dari jurnal dengan view biasa dan fungsi `STABLE`. **Materialized view tidak dipakai untuk data user** karena MV tidak tunduk pada RLS dan akan membocorkan ruang Pribadi pasangan.
Satu-satunya tabel agregat adalah `net_worth_snapshots`. Isinya riwayat (harga pasar per hari), jadi tidak bisa diturunkan ulang tanpa menyimpan harga harian.
Saya tidak setuju dengan bentuk transfer lintas ruang di spec §5.4/§7a: satu entri dengan line di dua ruang. Bentuk itu bertabrakan dengan FK komposit dan RLS. Usulan saya: dua entri yang ditautkan `transfer_group_id` (§4).
Kualitas data dijaga berlapis: constraint DB, tes golden numbers, lalu job rekonsiliasi harian yang memberi alert tanpa pernah memuat nominal atau deskripsi di log.

## 2. Rekomendasi

### R1 — Transfer lintas ruang = dua entri ber-`transfer_group_id` · **wajib** · M1
- **Isi:** setiap entri dan semua line-nya berada di **satu** ruang. FK komposit `entry_lines(space_id, entry_id) → entries(space_id, id)` dan `entry_lines(space_id, account_id) → accounts(space_id, id)` menjamin hal itu.
  - Setor Pribadi ke Bersama terdiri dari dua entri `kind='transfer'`. Entri A ada di ruang Pribadi (line −X, plus line fee bila ada). Entri B ada di ruang Bersama (line +X).
  - Keduanya memakai `transfer_group_id` yang sama. Constraint trigger (deferrable) memeriksa Σ line per grup = −fee.
  - Edit dan void selalu dikerjakan per grup oleh `api.*`.
  - Deskripsi sisi Bersama dibuat sistem ("Setoran dari Novanda"). Deskripsi sisi Pribadi milik pencatat.
- **Alasan:** dengan desain spec, header entri ada di ruang sumber. Akibatnya Farida tidak bisa membaca header untuk line yang muncul di Bersama, atau header (deskripsi, kategori) bocor kalau RLS dilonggarkan. FK komposit `(space_id, entry_id)` juga tidak bisa dipasang. Dengan grup, laporan Bersama tidak pernah menyentuh baris ruang Pribadi. Anti-tujuan "data pasangan bocor lewat laporan" (spec §2) jadi dijamin oleh struktur data, bukan hanya oleh policy.

### R2 — Satu sumber klasifikasi: `app.report_class()` + view `app.report_lines` · **wajib** · M1 (view), M2 (dipakai laporan)
- **Isi:** fungsi `IMMUTABLE` memetakan `(entry_kind, line role, pocket akun, space kind, tanda amount, reimbursable, transfer_group_id)` ke `report_class`.
  - `report_lines` (security_invoker) = semua line non-void dengan kelasnya.
  - Pemakai wajib: `period_summary`, `budget_actuals`, `dashboard_summary`, ekspor, input AI, trip. Mereka tidak boleh menulis filter `kind`/`pocket` sendiri. Aturan lint: grep `pocket = 'kantor'` di luar fungsi ini harus gagal di CI.
  - Tabel aturan ada di §2a.
- **Alasan:** INT-08 terjadi karena aturan kantor diterapkan di 5 tempat dan terlupa di 3 tempat (01-features §2). Satu fungsi juga bisa dites exhaustively (AC1).

### R3 — Strategi view vs MV vs tabel agregat · **wajib** · M1–M2
| Objek | Bentuk | Refresh | Alasan |
|---|---|---|---|
| `account_balances` | view biasa (security_invoker) | — (selalu segar) | DESIGN D4-A; Σ ±5k baris < 5 ms dengan index covering |
| `report_lines` | view biasa (security_invoker, security_barrier) | — | Sumber tunggal R2 |
| `loan_balances`, `reimburse_pending` | view biasa | — | Turunan murah |
| `period_summary`, `budget_actuals`, `contributions`, `net_worth(on)` | fungsi SQL/plpgsql `STABLE`, **SECURITY INVOKER** | per request (RSC) + `revalidateTag` setelah tulis | RLS tetap berlaku sebagai lapisan kedua |
| `net_worth_snapshots` | **tabel** | job harian 00:10 WIB untuk H−1 + hitung ulang "hari kotor" (R7) | Harga historis tidak bisa diturunkan ulang tanpa disimpan |
| `price_daily` | tabel (ticker, tanggal, close) | job harga | Dasar hitung ulang snapshot |
| Materialized view | **tidak dipakai** untuk data ruang | — | MV tidak mendukung RLS, jadi langsung bocor bila `dompetku_app` punya SELECT |
- **Ambang naik kelas:** buat tabel agregat bulanan `(space_id, month, category_id, report_class)` yang dijaga fungsi tulis hanya jika `period_summary` p95 > 50 ms pada dataset demo ×10. Langkah itu wajib disertai cek rekonsiliasi R6 dan ADR. Perkiraan saya: tidak akan pernah diperlukan.

### R4 — Zona waktu & tanggal kalender · **wajib** · M0
- `entries.occurred_on date` = tanggal kalender WIB pilihan user. Stempel waktu memakai `timestamptz` (`created_at`, `voided_at`). Server Postgres `timezone='UTC'`.
- Satu fungsi `app.today() = (now() at time zone 'Asia/Jakarta')::date`. **Dilarang** memakai `current_date`, `now()::date`, `localtimestamp` di SQL, atau `toISOString().split('T')` di TS. Semua dicek oleh lint di CI.
- Fungsi laporan menerima tanggal eksplisit (`p_month date`, `p_from/p_to date`) dan **tidak** membaca jam. Default `p_today date default app.today()` hanya di lapisan api. Dengan begitu tes cukup mengirim tanggal, tanpa memalsukan jam.
- Periode laporan: `[p_from, p_to]` inklusif bertipe `date`. Bulan = `p_month` tanggal 1 (CHECK `extract(day from p_month)=1`), akhir = `(p_month + interval '1 month')::date` eksklusif. Minggu dimulai Senin (ISO).
- Cron pg-boss dijadwalkan dengan `tz: 'Asia/Jakarta'`. Hari kerja bursa memakai kalender libur IDX di tabel (bukan hardcode).
- **Nanti:** awal bulan custom (siklus gajian tgl 25), sebagai `profiles.month_start_day`. Fungsi sudah menerima `from/to` bebas, jadi perubahan cukup di UI dan kontrak.

### R5 — Constraint kualitas data di skema · **wajib** · M1
- Nominal `bigint`, `amount <> 0`. CHECK tanda per role lewat constraint trigger deferrable per entri (bentuk line per `kind`, DESIGN §5). Bentuk fee didefinisikan ulang di §4.3.
- FK komposit `(space_id, …)` di **semua** referensi, termasuk `category_id`, `trip_id`, `loan_id`, `goal_id`, dan `reimburses_entry_id`.
- Trigger: `categories.type` cocok dengan `entries.kind` (expense ↔ expense), maksimal 2 level, `parent_id <> id`, `type` anak = induk (INT-11).
- `loan_id` hanya boleh di ruang Pribadi. `pocket='kantor'` dan `reimbursable` hanya di ruang Pribadi (spec §5.4).
- `entry_lines` tanpa UPDATE. Fungsi edit menghapus dan menyisipkan ulang line di transaksi yang sama, header tetap. Trigger `BEFORE UPDATE` → `raise`.
- Validasi di fungsi (tidak bisa jadi CHECK karena bergantung waktu): `occurred_on` antara `2020-01-01` dan `app.today() + 7`. Deskripsi ≤ 200 karakter, tanpa karakter kontrol.
- Idempotensi: UNIQUE `(space_id, client_id)`, bukan `(user_id, client_id)` seperti DESIGN §4, karena kolom `user_id` diganti `space_id` (spec §5.4).
- Index: `entries (space_id, occurred_on) include (kind, category_id) where voided_at is null`, `entry_lines (space_id, account_id) include (amount)`, `entries (transfer_group_id) where transfer_group_id is not null`.

### R6 — Job rekonsiliasi harian `dq_reconcile` · **wajib** · M1 (fungsi + pgTAP), M5 (dijadwalkan bersama `job_runs`)
- **Jadwal:** 01:00 WIB, plus setelah setiap restore uji mingguan (spec §5.7).
- **Role khusus `dompetku_auditor`:** `SELECT` + `BYPASSRLS`, dipakai hanya oleh fungsi `private.dq_run()` milik worker. Hasilnya ditulis ke `dq_findings(run_id, check_id, severity, space_id, ref_id, detail_code)`, **tanpa nominal dan deskripsi**.
- **Cek** (ID stabil, masing-masing punya pgTAP yang menyuntikkan kerusakan):

| ID | Cek | Severity |
|---|---|---|
| DQ01 | `account_balances.balance` = Σ `entry_lines.amount` dihitung ulang dengan query independen (tanpa view) per akun | error |
| DQ02 | Saldo checkpoint kemarin + Σ delta dari `entry_history`/entri baru sejak checkpoint = saldo hari ini. Mendeteksi mutasi ledger di luar fungsi (tabel `balance_checkpoints(account_id, on_date, balance)` ditulis job ini) | error |
| DQ03 | Bentuk line per `kind` valid untuk semua entri non-void (pengaman bila trigger pernah dimatikan) | error |
| DQ04 | Σ per `transfer_group_id` = −fee; grup tidak setengah-void | error |
| DQ05 | Sisa utang ≥ 0 dan = principal − Σ `debt_payment`; `closed_at` ⇔ sisa 0 | error |
| DQ06 | `entries.version − 1` = jumlah baris `entry_history` untuk entri itu | warn |
| DQ07 | Dompet pocket `tabungan` bersaldo negatif; dompet mana pun negatif > 3 hari | warn |
| DQ08 | `net_worth_snapshots` H−1 = `net_worth(H−1)` dihitung ulang | warn |
| DQ09 | Line menunjuk akun berbeda ruang / akun diarsipkan setelah `occurred_on` | error |
| DQ10 | Entri void > 97 hari masih ada (purge gagal diam-diam) | warn |
- **Hasil:** `job_runs.status = ok|warn|error`. Status error mengirim alert email ke pemilik berisi ID cek + jumlah baris saja. Metrik `dompetku_dq_findings{check,severity}` diekspos ke Prometheus.
- **Alasan:** spec anti-tujuan #1. Di v1, 10 dari 25 dompet melenceng tanpa ada yang tahu (02-integrity §3). Jika DQ01 dihitung dengan view yang sama, hasilnya tautologis. Karena itu DQ01 memakai query terpisah dan DQ02 memakai checkpoint.

### R7 — Net worth harian · **wajib** · M6 (tabel & fungsi bisa M4)
- `api.net_worth(p_space_id, p_on date)` = Σ saldo dompet non-kantor s/d `p_on` + aset kas (Σ line) + aset pasar (qty lot s/d `p_on` × close terakhir ≤ `p_on` dari `price_daily`) + aset non-kas (Σ line incl. `valuation`) + piutang tersisa + **talangan menunggu reimburse** − utang tersisa.
- Komponen disimpan per kolom di `net_worth_snapshots(space_id, on_date, wallets, assets_cash, assets_market, assets_other, receivables, reimburse_pending, debts, total, price_as_of, computed_at)`, PK `(space_id, on_date)`.
- **Jadwal:** job 00:10 WIB menulis H−1, karena hari itu sudah tutup. Beranda menampilkan nilai hari ini secara live.
- Setiap fungsi tulis dengan `occurred_on < app.today()` meng-upsert `nw_dirty(space_id, from_date = least(...))`. Job menghitung ulang `from_date..H−1` (maksimal 400 hari per run), lalu mengosongkan `nw_dirty`.
- Talangan masuk net worth sebagai piutang ke kantor. Kalau tidak, net worth turun setiap kali menalangi lalu naik lagi saat reimburse: grafik bergerigi palsu.
- Bersama: hanya dompet/aset Bersama. "Total keluarga" ditunda (spec §5.4).

### R8 — Kontribusi per orang di Bersama · **wajib** · M2
- Kontribusi bersih per anggota = Σ setoran (entri grup di Bersama, line > 0, `created_by = u`) − Σ pengambilan (line < 0, `created_by = u`) dalam periode. Kolom tambahan bersifat informasi: jumlah dan nominal pengeluaran Bersama per `created_by`, berlabel **"dicatat oleh"**, bukan "dibayar oleh".
- Saldo awal dompet Bersama ditampilkan terpisah, "tidak diatribusikan". Onboarding menyarankan mengisi Bersama lewat setoran, bukan saldo awal.
- Tidak ada logika pelunasan/split (spec §7a). Persentase hanya ditampilkan bila kedua kontribusi ≥ 0.

### R9 — Data saran kategori · **wajib** (M1, versi dasar) / **sebaiknya** (bobot terkalibrasi, M6)
- **Fitur per kandidat kategori `c`** dari riwayat ruang aktif, 180 hari, entri non-void `income/expense`:
  - `tok`: kecocokan token deskripsi. Normalisasi: lowercase, `unaccent`, buang angka/nominal, stopword ID ("di", "ke", "beli", "bayar"), plus `pg_trgm` similarity ≥ 0,4 untuk salah ketik. Skor = max over token dari P(c | token), dihaluskan Laplace.
  - `freq`: hitungan dengan peluruhan eksponensial, half-life 30 hari.
  - `hour`: proporsi pemakaian `c` di jendela ±90 menit dari jam sekarang. Jam diambil dari `created_at` WIB, hanya untuk entri yang `occurred_on` = tanggal pembuatannya (entri susulan tidak mencerminkan kebiasaan jam).
  - `amt`: kedekatan log-nominal ke median nominal `c` (`exp(−|ln a − ln m_c|)`).
  - `acct`: proporsi `c` pada dompet terpilih.
  - `last`: bonus bila `c` = kategori terakhir dipakai.
- **Skor:** `s(c) = 0,40·tok + 0,20·freq + 0,15·hour + 0,10·amt + 0,10·acct + 0,05·last`. Tanpa teks, `tok` = 0 dan bobot sisanya dinormalisasi ulang. Tie-break: `sort_order`, lalu `id`, supaya deterministik.
- **Cold start (riwayat nol):** blend `s = α·prior + (1−α)·hist`, dengan `α = k/(k+n)`, `k = 20`, `n` = jumlah entri di ruang.
  - `prior` berasal dari tabel seed `category_keywords(default_category_key, keyword)` untuk kategori default. Contoh: kopi, nasi, gojek, grab, bensin, pertamina, pln, token, pulsa, indomaret, alfamart, apotek, parkir.
  - Ditambah prior jam: 05–10 Sarapan, 11–14 Makan siang, 17–21 Makan malam, 06–09 & 16–19 Transport.
  - Ruang Bersama di-seed kata kunci rumah tangga (spec §5.4).
  - Tanpa teks dan tanpa riwayat: 6 chip default per jam.
- **Implementasi:** dihitung on-the-fly di `api.suggest_categories` (SECURITY INVOKER) atas ≤ ±3.000 baris, tanpa tabel statistik yang bisa basi. Target p95 < 30 ms.
- **Pengukuran:** tabel `suggestion_events(space_id, at, shown uuid[], chosen_rank smallint null)` tanpa deskripsi atau nominal. Retensi 180 hari. Metrik `hit@6`.
- **Privasi:** riwayat hanya dari ruang aktif. Saran di Bersama tidak pernah membaca ruang Pribadi.

### R10 — Ekspor CSV/JSON + arsip v1 · **wajib** · M5 (ekspor v2), M0–M1 (arsip v1)
- **Ekspor v2 (per ruang, streaming kursor, tanpa batas baris, INT-17):**
  - **CSV transaksi**, UTF-8 + BOM, pemisah `,`, plus opsi `;` untuk Excel lokal Indonesia. Kolom: `tanggal (YYYY-MM-DD)`, `jenis` (label ID), `kategori_induk`, `subkategori`, `dompet`, `jumlah` (bilangan bulat bertanda, tanpa pemisah ribuan), `keterangan`, `klasifikasi_laporan` (`report_class` + label "Termasuk/Tidak termasuk: Kas kantor"), `trip`, `dicatat_oleh` (Bersama), `id_entri`.
  - Escape injeksi formula (`= + - @ \t \r` di awal → awalan `'`) **hanya** untuk kolom teks. Kolom `jumlah` tetap numerik.
  - **JSON lengkap** per ruang: `{schema_version, exported_at, space, accounts, categories, entries[{lines}], budgets, loans, goals, recurring, trips}` + `sha256` di manifest. Skema JSON divalidasi Zod di tes.
  - Sisi lawan transfer lintas ruang hanya tampil sebagai "Setoran dari <nama>", tanpa id/nama dompet sumber.
  - File dibuat on-the-fly dan tidak disimpan di server. Setiap ekspor tercatat di audit log (spec §5.7).
- **Arsip v1 (sekali, per akun, untuk referensi):**
  - Dijalankan pemilik dengan koneksi read-only ke project v1. Isinya `SELECT … where user_id = $1` per tabel (00-schema §3), keluar sebagai `json/<tabel>.json` + `transaksi.csv` yang sudah dimanusiakan (nama dompet/kategori) + `README.txt` + `manifest.json` (jumlah baris per tabel, sha256).
  - Arsip juga memuat `selisih_saldo.csv`: saldo tersimpan v1 vs Σ ledger v1, supaya selisih INT-03 terdokumentasi dan tidak membingungkan saat dibaca kelak.
  - Dienkripsi (`age`/zip AES dengan passphrase) dan diserahkan ke masing-masing pemilik akun: arsip Farida hanya untuk Farida.
  - Verifikasi: jumlah baris manifest = hitungan di 00-schema §2.
  - **Lebih awal dari M7:** v1 sudah read-only dan project v1 memakan kuota (ADR-002). Arsip bisa dibuat kapan saja, lalu project di-pause atau dihapus.

### R11 — Retensi & purge · **wajib** · M1 (fungsi + tes), M5 (dijadwalkan)
| Data | Retensi | Mekanisme |
|---|---|---|
| Entri void (+ line, `entry_history`, `trip_exclusions` terkait) | 90 hari sejak `voided_at` (DESIGN §12-8) | `private.purge_voided(p_before)` mingguan, batch 500, urutan FK, idempoten |
| `entry_history` entri aktif | selamanya (kecil, audit) | — |
| Kategori/akun | tidak dihapus; `archived_at` | Hapus hanya bila tanpa referensi |
| `suggestion_events` | 180 hari | job purge |
| `job_runs`, `dq_findings`, arsip pg-boss | 90 hari | job purge |
| `ai_usage` | 90 hari | job purge |
| Audit log keamanan | 2 tahun | job purge |
| Sesi auth kedaluwarsa | 30 hari setelah kedaluwarsa | job purge |
| `net_worth_snapshots`, `price_daily`, `balance_checkpoints` | selamanya / 400 hari (checkpoint) | — |
- **Aturan referensi:**
  - Talangan yang di-void tetapi direferensikan `reimbursement` non-void tidak boleh dipurge. `void_entry` menolak void talangan yang sudah dilunasi kecuali reimburse-nya di-void dulu.
  - `recurring_occurrences.entry_id` yang dipurge: status kembali `due`, atau `skipped` bila jatuh tempo > 90 hari lalu.
- **Hak akses:** fungsi purge hanya bisa dipanggil role worker (`dompetku_worker`), bukan web.
- **Transparansi:** UI menampilkan "Akan dihapus permanen pada <tanggal>" dan "Salinan cadangan terhapus otomatis paling lambat 12 bulan" (retensi backup spec §5.7).

### R12 — Dataset seed deterministik · **wajib** · M0 (kerangka), M1–M2 (isi)
- **Dua set data:**
  1. **`fixture-small`**: ±40 entri tulisan tangan yang mencakup **setiap** `report_class`, tanggal 31, 23:30 WIB, kantor, talangan parsial, utang dengan cicilan + batal cicilan, setoran/pengambilan Bersama, entri void, koreksi saldo, valuation, lot saham, dan anggaran induk + anak. Angka harapan (golden) dihitung **manual** di `golden.json`, tidak dihasilkan kode, supaya tes tidak tautologis.
  2. **`demo-full`**: 6 bulan, ±1.000 entri, untuk screenshot portofolio dan uji kinerja.
- **Generator** TS `packages/db/seed/demo.ts`:
  - PRNG seed tetap (mulberry32, seed `20261029`) dan parameter `--anchor 2026-10-31`. Screenshot memakai anchor = hari ini, tes memakai anchor tetap.
  - `client_id` = UUIDv5 dari `demo:<n>`.
  - Ditulis **lewat `api.*`** dengan `withUser`, sehingga data valid secara konstruksi dan sekaligus menguji jalur tulis.
- **Persona fiktif** (bukan Novanda/Farida), merchant generik, nominal realistis. Skenario wajib tampil di screenshot: satu anggaran > 100%, satu 85%, tagihan jatuh tempo besok, tujuan 60%, setoran Bersama dari kedua orang.
- **Pengaman:** generator menolak jalan kecuali `DOMPETKU_ENV ∈ {dev,test,demo}` **dan** DB punya penanda `app.settings` `env` yang sama **dan** belum ada household non-demo.
- **Determinisme:** hash `pg_dump --data-only` (kolom `created_at/updated_at` dikecualikan) identik pada dua kali jalan.

### 2a. Aturan klasifikasi `report_class` (R2)

Urutan aturan: yang pertama cocok menang. Kolom "Ruang" menunjukkan di ruang mana kelas itu bisa muncul.

| # | Kondisi (line) | `report_class` | Label di laporan | Masuk Pemasukan/Pengeluaran? | Ruang |
|---|---|---|---|---|---|
| 1 | akun `pocket='kantor'` (apa pun kind-nya) | `x_kantor` | Tidak termasuk · Kas kantor | Tidak | Pribadi |
| 2 | `kind='transfer'`, `role='fee'` | `expense_fee` | Pengeluaran · Biaya admin transfer | Ya (pengeluaran, tanpa kategori/anggaran) | keduanya |
| 3 | `kind='income'` | `income` | Pemasukan per kategori | Ya | keduanya |
| 4 | `kind='expense'` ∧ `reimbursable` | `x_talangan` | Tidak termasuk · Talangan kantor (menunggu reimburse) | Tidak | Pribadi |
| 5 | `kind='expense'` | `expense` | Pengeluaran per kategori | Ya | keduanya |
| 6 | `kind='transfer'` ∧ grup lintas ruang ∧ ruang Pribadi ∧ amount < 0 | `x_setor_bersama` | Tidak termasuk · Setor ke Bersama | Tidak (lihat §4.5) | Pribadi |
| 7 | idem, ruang Pribadi ∧ amount > 0 | `x_ambil_bersama` | Tidak termasuk · Ambil dari Bersama | Tidak | Pribadi |
| 8 | idem, ruang Bersama ∧ amount > 0 | `x_setoran_anggota` | Setoran dari <nama> | Tidak (tampil di Kontribusi) | Bersama |
| 9 | idem, ruang Bersama ∧ amount < 0 | `x_diambil_anggota` | Diambil oleh <nama> | Tidak | Bersama |
| 10 | `kind='transfer'` (dalam ruang, termasuk goal & beli/jual aset) | `x_transfer` | Tidak termasuk · Transfer internal | Tidak | keduanya |
| 11 | `kind='debt_principal'` | `x_pokok_utang` | Tidak termasuk · Pinjaman diterima/diberikan | Tidak (DESIGN §12-4) | Pribadi |
| 12 | `kind='debt_payment'` | `x_pelunasan_utang` | Tidak termasuk · Pelunasan utang / penerimaan piutang | Tidak (DESIGN §12-4) | Pribadi |
| 13 | `kind='reimbursement'` | `x_reimburse` | Tidak termasuk · Penggantian kantor | Tidak (DESIGN §12-5) | Pribadi |
| 14 | `kind in ('opening_balance','adjustment')` | `x_koreksi` | Tidak termasuk · Saldo awal & koreksi saldo | Tidak | keduanya |
| 15 | `kind='valuation'` | `x_valuasi` | (hanya net worth) Perubahan nilai aset | Tidak | keduanya |

Turunan:
- Pemasukan = Σ `income`.
- Pengeluaran = Σ |`expense`| + Σ |`expense_fee`|.
- Selisih = Pemasukan − Pengeluaran.
- Tingkat menabung = Selisih / Pemasukan (null bila Pemasukan = 0).
- Bagian "Tidak termasuk" (UX §3.6) menampilkan setiap kelas `x_*` dengan masuk dan keluar terpisah. Untuk `x_transfer`, yang ditampilkan Σ line positif (jumlah yang dipindah), supaya tidak dobel.

## 3. Contoh SQL kunci

Konvensi mengikuti spec §5.1–5.4: skema `app` (internal, view/fungsi bantu), `api` (dipanggil server), `space_id` sebagai batas kepemilikan, `app.current_user_id()`.

### 3.1 Klasifikasi + view sumber tunggal

```sql
create function app.report_class(
  p_kind entry_kind, p_role text, p_pocket pocket, p_space_kind space_kind,
  p_amount bigint, p_reimbursable boolean, p_cross_space boolean
) returns text
language sql immutable parallel safe set search_path = '' as $$
  select case
    when p_pocket = 'kantor'                          then 'x_kantor'
    when p_kind = 'transfer' and p_role = 'fee'       then 'expense_fee'
    when p_kind = 'income'                            then 'income'
    when p_kind = 'expense' and p_reimbursable        then 'x_talangan'
    when p_kind = 'expense'                           then 'expense'
    when p_kind = 'transfer' and p_cross_space then
      case when p_space_kind = 'personal'
           then case when p_amount < 0 then 'x_setor_bersama'   else 'x_ambil_bersama'   end
           else case when p_amount > 0 then 'x_setoran_anggota' else 'x_diambil_anggota' end
      end
    when p_kind = 'transfer'                          then 'x_transfer'
    when p_kind = 'debt_principal'                    then 'x_pokok_utang'
    when p_kind = 'debt_payment'                      then 'x_pelunasan_utang'
    when p_kind = 'reimbursement'                     then 'x_reimburse'
    when p_kind in ('opening_balance','adjustment')   then 'x_koreksi'
    when p_kind = 'valuation'                         then 'x_valuasi'
  end  -- NULL = aturan belum lengkap; pgTAP AC1 gagal bila ada kombinasi NULL
$$;

create view app.report_lines with (security_invoker = true, security_barrier = true) as
select l.space_id, s.kind as space_kind, l.entry_id, l.role, e.kind as entry_kind,
       e.occurred_on, l.account_id, a.pocket, l.amount,
       e.category_id, e.trip_id, e.created_by, e.transfer_group_id,
       app.report_class(e.kind, l.role, a.pocket, s.kind, l.amount,
                        e.reimbursable, e.transfer_group_id is not null) as report_class
from public.entry_lines l
join public.entries  e on e.space_id = l.space_id and e.id = l.entry_id
join public.accounts a on a.space_id = l.space_id and a.id = l.account_id
join public.spaces   s on s.id = l.space_id
where e.voided_at is null;
```

### 3.2 `api.period_summary` — angka kartu Laporan + "Tidak termasuk"

```sql
create function api.period_summary(p_space_id uuid, p_from date, p_to date)
returns table (report_class text, inflow bigint, outflow bigint, entry_count int)
language plpgsql stable security invoker set search_path = '' as $$
begin
  perform app.assert_member(p_space_id);              -- raise 'DK403' bila bukan anggota
  if p_from > p_to or p_to - p_from > 3660 then
    raise exception using errcode = 'DK010', message = 'periode_tidak_valid';
  end if;
  return query
  select r.report_class,
         coalesce(sum(r.amount) filter (where r.amount > 0), 0)::bigint,
         coalesce(-sum(r.amount) filter (where r.amount < 0), 0)::bigint,
         count(distinct r.entry_id)::int
  from app.report_lines r
  where r.space_id = p_space_id
    and r.occurred_on between p_from and p_to          -- date vs date: T13 aman
  group by r.report_class
  order by r.report_class;
end $$;

-- Contoh: Oktober 2026
-- select * from api.period_summary($1, date '2026-10-01', date '2026-10-31');
```

UI menurunkan Pemasukan, Pengeluaran, Selisih, dan Tingkat menabung dari baris ini (aturan di §2a). Fungsi `api.category_breakdown(space, from, to)` memakai filter `report_class in ('income','expense','expense_fee')` yang sama untuk drill-down.

### 3.3 `api.budget_actuals` — anggaran induk menjumlah anak (T17, INT-10)

```sql
create function api.budget_actuals(p_space_id uuid, p_month date)
returns table (category_id uuid, parent_id uuid, budget bigint, actual bigint, remaining bigint)
language plpgsql stable security invoker set search_path = '' as $$
declare v_end date := (p_month + interval '1 month')::date;
begin
  perform app.assert_member(p_space_id);
  if extract(day from p_month) <> 1 then
    raise exception using errcode = 'DK011', message = 'bulan_harus_tanggal_1';
  end if;
  return query
  with spent as (                                   -- realisasi per kategori paling spesifik
    select r.category_id, -sum(r.amount)::bigint as amt
    from app.report_lines r
    where r.space_id = p_space_id and r.report_class = 'expense'
      and r.occurred_on >= p_month and r.occurred_on < v_end
    group by r.category_id
  ),
  rolled as (                                       -- induk = dirinya + semua anak
    select c.id, c.parent_id,
           coalesce(s.amt, 0)
           + case when c.parent_id is null then coalesce((
               select sum(s2.amt) from public.categories ch
               join spent s2 on s2.category_id = ch.id
               where ch.space_id = p_space_id and ch.parent_id = c.id), 0)
             else 0 end as actual
    from public.categories c
    left join spent s on s.category_id = c.id
    where c.space_id = p_space_id and c.type = 'expense'
  )
  select r.id, r.parent_id, b.amount, r.actual::bigint, (b.amount - r.actual)::bigint
  from rolled r
  join public.budgets b on b.space_id = p_space_id and b.category_id = r.id and b.month = p_month
  union all                                         -- baris penyeimbang: Σ actual = period_summary
  select null, null, null,
         coalesce(sum(s.amt), 0)::bigint, null
  from spent s
  where not exists (                                -- belum tercakup anggaran mana pun
    select 1 from public.categories c
    join public.budgets b on b.space_id = p_space_id and b.month = p_month
     and b.category_id in (c.id, c.parent_id)
    where c.space_id = p_space_id and c.id = s.category_id);
end $$;
```

Catatan: bila induk **dan** anak sama-sama dianggarkan, total anggaran di UI = Σ anggaran induk + Σ anggaran anak yang induknya tidak beranggaran. Tanpa aturan ini terjadi hitung ganda. `expense_fee` tidak masuk anggaran (tanpa kategori); ini dijelaskan di UI.

### 3.4 Kontribusi Bersama (R8)

```sql
select e.created_by as user_id,
       coalesce(sum(l.amount) filter (where l.amount > 0), 0)  as setoran,
       coalesce(-sum(l.amount) filter (where l.amount < 0), 0) as diambil,
       coalesce(sum(l.amount), 0)                              as bersih
from public.entries e
join public.entry_lines l on l.space_id = e.space_id and l.entry_id = e.id and l.role <> 'fee'
where e.space_id = $1                                  -- ruang Bersama
  and e.transfer_group_id is not null and e.voided_at is null
  and e.occurred_on between $2 and $3
group by e.created_by;
```

## 4. Ketidaksetujuan dengan desain saat ini

1. **Transfer lintas ruang sebagai satu entri** (spec §5.4, §7a). Desain ini mematahkan FK komposit dan memaksa salah satu dari dua pilihan buruk: header tak terbaca oleh anggota ruang tujuan, atau RLS dilonggarkan sehingga deskripsi pribadi bocor.
   - **Usulan:** R1, dua entri satu grup.
   - **Trade-off:** invarian Σ = −fee pindah dari "per entri" ke "per grup" (constraint trigger + DQ04). Edit/void harus mengunci kedua entri. Riwayat "satu entri" di UI disusun dari grup.
   - **Alternatif kedua** bila tim menolak: denormalisasi `space_id, kind, occurred_on, voided_at, created_by` ke `entry_lines` dan RLS per line. Lebih banyak duplikasi, dan header tetap harus disembunyikan.
2. **Snapshot net worth 23:55 WIB** (spec §5.5). Entri yang dicatat 23:55–23:59 tidak masuk snapshot, dan entri susulan tidak pernah memperbaiki snapshot lama. **Usulan:** 00:10 WIB untuk H−1 + hitung ulang hari kotor (R7).
3. **Bentuk line fee transfer** (DESIGN §5 komentar trigger). Rumus "`|main| = counter + fee`" ditambah line `fee` terpisah membuat fee terhitung dua kali (Σ = −2·fee). **Usulan:** `main = −nominal`, `counter = +nominal`, `fee = −biaya` di akun sumber. Hasilnya Σ = −fee, dan fee diklasifikasikan `expense_fee`.
4. **Semua `api.*` SECURITY DEFINER** (spec §5.2). Untuk fungsi **baca/laporan** saya minta `SECURITY INVOKER`, supaya RLS tetap menjadi lapisan kedua bila `assert_member` keliru. DEFINER cukup untuk fungsi tulis.
5. **"Setor ke Bersama" bukan pengeluaran pribadi** (spec §5.4). Saya setuju secara akuntansi. Namun tingkat menabung pribadi jadi terlihat tinggi, padahal uangnya habis di Bersama.
   - **Usulan (sebaiknya, M2):** tampilkan baris "Setor ke Bersama" menonjol di kartu ringkasan Pribadi, plus metrik opsional "Tingkat menabung setelah setoran Bersama".
6. **Idempotensi `UNIQUE (user_id, client_id)`** (DESIGN §4). Kolom ini harus menjadi `(space_id, client_id)` mengikuti model ruang.

## 5. Risiko utama + mitigasi

| Risiko | Dampak | Mitigasi |
|---|---|---|
| Satu layar/ekspor menulis filter sendiri, angka berbeda antar layar (ulangan INT-08) | Kepercayaan hilang | R2 + lint grep + AC3 (anggaran = laporan) + AC7 (ekspor = laporan) |
| MV/tabel agregat tanpa RLS membocorkan ruang Pribadi pasangan | Anti-tujuan spec §2 | Larangan MV (R3); pgTAP "setiap relasi di skema `public`/`app` yang bisa dibaca `dompetku_app` punya RLS atau security_invoker" |
| Bug tanggal/zona waktu (ulangan INT-07) | Entri akhir bulan hilang | R4: `date` murni, `app.today()`, lint, tes T13 dengan tanggal eksplisit |
| Snapshot net worth basi setelah entri susulan | Grafik salah diam-diam | `nw_dirty` + DQ08 |
| Job rekonsiliasi berisik dan alert diabaikan | Kerusakan nyata lolos | Hanya `error` yang memicu email; `warn` muncul di dashboard Grafana; setiap cek punya tes positif/negatif |
| Role auditor `BYPASSRLS` disalahgunakan | Kebocoran lintas ruang | Role NOLOGIN, dipakai lewat `SECURITY DEFINER` milik worker saja, output tanpa nominal/deskripsi, ditinjau Security |
| Purge salah sasaran | Data hilang permanen | Filter `voided_at < now() - 90 days` + batch + `job_runs` mencatat jumlah; dry-run di restore mingguan; tes 89/91 hari |
| Seed demo tertimpa ke produksi | Data palsu di buku asli | Tiga pengaman R12 |
| Arsip v1 berisi data Farida tersimpan di tempat pemilik | Privasi pasangan | Arsip per akun, terenkripsi, diserahkan ke pemilik akunnya |
| Saran kategori lambat saat riwayat tumbuh | Catat cepat > 3 ketukan terasa lambat | Jendela 180 hari + index `(space_id, occurred_on)`; target p95 < 30 ms di AC10 |

## 6. Kriteria penerimaan (bisa dites)

- **AC1** — pgTAP: untuk setiap kombinasi `enum_range(entry_kind)` × role × pocket × space_kind × tanda × reimbursable × cross_space yang lolos validasi bentuk, `app.report_class(...)` tidak NULL. Menambah nilai enum tanpa aturan membuat tes gagal.
- **AC2** — pgTAP golden: pada `fixture-small`, `period_summary`, `budget_actuals`, `net_worth`, dan kontribusi Bersama sama persis dengan `golden.json` (dihitung manual).
- **AC3** — Σ `budget_actuals.actual` (baris induk tanpa dobel anak + baris penyeimbang) = outflow `expense` dari `period_summary` untuk bulan yang sama, di semua bulan `demo-full`.
- **AC4** — T13: entri `occurred_on = 2026-10-31` masuk `period_summary(…, '2026-10-01', '2026-10-31')`. Vitest `todayWIB()` pada `2026-10-31T16:30:00Z` = `2026-10-31`, dan pada `2026-10-31T17:00:00Z` = `2026-11-01`.
- **AC5** — isolasi: sebagai user B, `report_lines`, `period_summary`, `budget_actuals`, `net_worth`, dan ekspor untuk ruang Pribadi A menghasilkan error `DK403` atau 0 baris. Ekspor Bersama tidak memuat id/nama akun Pribadi mana pun (dicek dengan grep pada file hasil).
- **AC6** — rekonsiliasi: DB bersih menghasilkan 0 temuan `error`. Setiap kerusakan sintetis (ubah amount sebagai owner dengan trigger dimatikan, grup tidak seimbang, utang negatif) terdeteksi oleh cek yang tepat dalam satu run. `job_runs` = `error` dan alert terkirim (mock).
- **AC7** — ekspor: CSV dari 10.000 entri lengkap (tanpa potong). Σ kolom `jumlah` per `klasifikasi_laporan` = `period_summary`. Sel `=HYPERLINK(...)` keluar sebagai teks. JSON lolos skema Zod dan sha256 manifest cocok.
- **AC8** — purge: entri void 91 hari hilang beserta line + history. Entri void 89 hari tetap ada. Run kedua menghapus 0 baris. Entri non-void tidak tersentuh. Web role tidak bisa `EXECUTE` purge.
- **AC9** — seed: dua kali `seed demo --anchor 2026-10-31` menghasilkan hash data identik. Generator menolak jalan pada DB tanpa penanda env.
- **AC10** — saran: ruang kosong mengembalikan tepat 6 kategori. Di `fixture-small`, teks "kopi" menaruh kategori Kopi di rank 1. p95 < 30 ms di `demo-full`.
- **AC11** — net worth: entri susulan tanggal H−10 membuat `nw_dirty`. Job berikutnya memperbarui snapshot H−10..H−1, dan `net_worth(d)` = snapshot `d` untuk semua `d`.
- **AC12** — lint CI: 0 kemunculan `current_date`, `now()::date`, `localtimestamp` di migrasi SQL, dan 0 kemunculan `toISOString().split` di TS. `pocket = 'kantor'` hanya ada di `app.report_class`, `net_worth`, dan `dashboard_summary`.
- **AC13** — kinerja: `period_summary` 1 tahun pada `demo-full` ×10 p95 < 50 ms (`EXPLAIN ANALYZE` di CI, dicatat, gagal di atas 150 ms).

## 7. Pertanyaan/permintaan untuk peran lain

- **Backend/DB Engineer:**
  - (a) Setuju R1 (grup transfer) atau pilih alternatif denormalisasi? Keputusan perlu dikunci di ADR sebelum M1.
  - (b) Konfirmasi bentuk line fee (§4.3).
  - (c) Bagaimana mencatat **refund** pengeluaran? Usul: `kind='expense'` dengan line positif berkategori sama (`report_class='expense'` menjadi netto) dan CHECK bentuk diizinkan dengan flag `is_refund`.
  - (d) Bagaimana mencatat **P/L terealisasi** penjualan saham? Usul: line selisih `kind='valuation'` di akun saham, `report_class='x_valuasi'`, ditampilkan sebagai "Hasil investasi" di luar pemasukan operasional.
  - (e) Bagaimana `settle_reimbursement` menangani penggantian kurang/lebih? Usul: selisih kurang menjadi entri `expense` kategori "Talangan tidak diganti", lebih menjadi `income` "Kelebihan reimburse", keduanya dibuat oleh fungsi.
  - (f) Fungsi tulis meng-upsert `nw_dirty`.
- **Security Engineer:** tinjau role `dompetku_auditor` (BYPASSRLS, NOLOGIN) dan `dompetku_worker`. Tentukan isi audit log ekspor. Tentukan enkripsi arsip v1 (`age` vs zip AES) dan cara serah ke Farida.
- **Product Manager / pemilik:**
  - (a) Metrik "tingkat menabung setelah setoran Bersama" (§4.5): ya/tidak?
  - (b) Perlu periode gajian (awal bulan custom)?
  - (c) Pengeluaran Bersama yang dibayar dari dompet pribadi: cukup "setor lalu catat di Bersama", atau perlu jalur khusus (nanti)?
  - (d) Saldo awal dompet Bersama: tampil sebagai tidak diatribusikan, setuju?
- **UX Designer:** desain blok "Tidak termasuk" mengikuti 13 kelas `x_*` (dikelompokkan jadi ±6 baris di UI). Label "dicatat oleh" vs "dibayar oleh" di Kontribusi. Persona fiktif dan skenario screenshot di R12 untuk disetujui.
- **DevOps/SRE:** pastikan pg-boss memakai `tz: 'Asia/Jakarta'`. Siapkan panel Grafana `dompetku_dq_findings`, jalankan `dq_reconcile` setelah restore uji mingguan, dan sediakan teks disclosure retensi backup 12 bulan untuk UI.
- **QA Engineer:** pegang `fixture-small` + `golden.json` (dihitung manual, ditinjau dua orang). Tambahkan tes property "1.000 operasi acak → DQ01–DQ05 nol temuan" ke suite M1 (ROADMAP M1).
