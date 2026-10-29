# 02 — Integritas Uang dan Data

Metode: telusuri setiap jalur tulis dari UI ke trigger (00-schema §5), lalu buktikan temuan paling serius di Postgres 16 lokal
memakai replika skema v1 ([`repro/v1_schema_replica.sql`](repro/v1_schema_replica.sql)) dan skrip
[`repro/scenarios.sql`](repro/scenarios.sql). Output asli: [`repro/scenarios.out.txt`](repro/scenarios.out.txt).
Skrip meniru urutan panggilan PostgREST yang persis dilakukan kode v1, sebagai role `authenticated` dengan RLS aktif.
Bug tanggal dibuktikan dengan Node 22 `TZ=Asia/Jakarta`. Data produksi hanya dibaca secara agregat (00-schema §10).

## 1. Invarian

| ID | Invarian | Dijaga di v1? |
|---|---|---|
| I1 | `wallets.balance` = saldo awal + Σ income − Σ expense + Σ transfer masuk − Σ (transfer keluar + fee) | Sebagian: trigger INSERT/DELETE saja; saldo awal tidak dicatat; UPDATE tidak ditangani |
| I2 | `debts.paid_amount` = Σ pembayaran tercatat (transaksi `[Bayar…]/[Terima…]` + transfer pengembalian modal) | Tidak: angka disimpan terpisah dan bisa diketik manual |
| I3 | `debts.is_completed` ⇔ `paid_amount ≥ total_amount` | Tidak: toggle manual |
| I4 | `assets.qty/avg_price/value` konsisten dengan `investment_lots`; nilai aset non-saham = nilai awal + Σ transfer masuk − Σ transfer keluar | Sebagian: trigger lot menimpa `value`, client juga menulis `value` |
| I5 | Progres goal = Σ saldo dompet terhubung (atau nilai aset) + sisa modal trading terkait | Dihitung ulang di client; dua rumus berbeda (01-features §3) |
| I6 | Setiap perpindahan uang internal (transfer, modal trading, top up/cairkan goal) **tidak** mengubah total income/expense | Dilanggar oleh pencairan goal aset (transaksi income) dan auto-aset investasi |
| I7 | Dompet kantor tidak masuk angka pribadi | Dilanggar di laporan, export, AI |
| I8 | Laporan bulan M mencakup semua transaksi bertanggal 1..akhir M (zona Asia/Jakarta) | Dilanggar: tanggal terakhir bulan hilang |
| I9 | Setiap baris hanya menunjuk baris milik user yang sama | Dilanggar: RLS tidak memeriksa sebagian FK |
| I10 | Operasi gabungan (edit, bayar cicilan, reimburse, top up) atomik: semua langkah atau tidak sama sekali | Tidak ada satu pun yang atomik |

## 2. Temuan

Severity: **critical** = uang/saldo salah atau data hilang tanpa disadari pada alur normal; **high** = salah pada alur yang umum atau bisa dieksploitasi;
**medium** = salah pada kasus tepi; **low** = kosmetik/kecil.

### INT-01 — Edit catatan utang menghapus seluruh cicilan dan membalik saldonya · critical
- **Bukti:** `app/debts/page.tsx:76-81` (`reverseDebtEffects` menghapus **semua** transaksi dan transfer ber-`debt_id`), `:263-289` (mode edit), `:236` (`paid_amount` diambil dari form), `:286` (tanggal transaksi pokok baru = hari ini).
- **Repro S4:** utang Rp1.000.000 ke dompet Cash (saldo awal 500.000), dua cicilan @200.000. Saldo sebelum edit 1.100.000. User hanya mengganti keterangan.
  Hasil: saldo **1.500.000** (seharusnya 1.100.000), `paid_amount` tetap 400.000, baris cicilan tersisa **0**, tanggal pokok pindah ke 2026-10-29.
- **Dampak:** saldo dompet naik sebesar total cicilan yang sudah dibayar; riwayat cicilan hilang permanen; untuk modal trading, transfer pengembalian juga terhapus.
- **Saran v2:** edit utang hanya mengubah metadata; perubahan pokok = entri penyesuaian. Pembayaran adalah tabel sendiri; `paid_amount` diturunkan (view) dari pembayaran.

### INT-02 — Edit = DELETE lalu INSERT dari client, tanpa transaksi DB · critical
- **Bukti:** transaksi `app/transactions/page.tsx:180-196`; transfer `app/wallets/page.tsx:99-115`, `app/transfers/page.tsx:141-158`; riwayat goal `app/savings-goals/page.tsx:525-543`. Validasi jumlah transaksi hanya `!amount` (`transactions/page.tsx:172`), sehingga `-50000` lolos.
- **Repro S3:** edit transaksi "makan" dengan jumlah `-50000`. DELETE sukses, INSERT ditolak `transactions_amount_check`. Hasil: transaksi **hilang**, saldonya sudah dibalik.
- **Dampak:** kegagalan jaringan, tab ditutup, atau constraint di langkah kedua menghilangkan data. Edit juga mengganti `id` dan `created_at`, sehingga baris `trip_excluded_transactions` ikut terhapus (FK CASCADE) dan transaksi yang dikecualikan dari trip muncul lagi; kolom yang tidak disalin (mis. `savings_goal_id`) hilang.
- **Saran v2:** satu fungsi Postgres per operasi (`update_transaction(...)`) yang memperbarui baris dan saldo dalam satu transaksi; id stabil.

### INT-03 — UPDATE `transactions` tidak menyesuaikan saldo · critical
- **Bukti:** trigger `on_transaction_change` hanya `AFTER INSERT OR DELETE` (00-schema §5); `app/savings-goals/page.tsx:513-515` melakukan `update({ amount, date })` pada transaksi pencairan aset; policy UPDATE `transactions` mengizinkan user mengubah `amount`/`type`/`wallet_id` lewat API.
- **Repro S1:** expense 100.000 lalu UPDATE jadi 300.000. Saldo 900.000, seharusnya 700.000.
- **Dampak:** saldo melenceng diam-diam. Data produksi: 3 dompet punya selisih **negatif** terhadap ledger (−15.000; −174.921; −2.000.000) yang tidak bisa dijelaskan saldo awal (00-schema §10).
- **Saran v2:** saldo bukan kolom yang bisa ditulis; turunan dari ledger (view) atau dijaga trigger yang menangani INSERT/UPDATE/DELETE plus tes rekonsiliasi.

### INT-04 — Edit riwayat top-up goal berbasis aset membuang `to_asset_id` · critical
- **Bukti:** `app/savings-goals/page.tsx:531-542` menyusun ulang transfer tanpa `to_asset_id` (dan `to_wallet_id = h.to_wallet_id = null`).
- **Repro S5:** top-up 500.000 ke RDPU, lalu edit menjadi 600.000. Hasil: nilai RDPU **0** (seharusnya 600.000), dompet bank berkurang 600.000. Uang "lenyap" dari net worth.
- **Saran v2:** fungsi `edit_goal_contribution` yang mempertahankan sumber/tujuan; tes invarian Σ net worth sebelum = sesudah untuk transfer internal.

### INT-05 — Edit saldo dompet diam-diam diabaikan · high
- **Bukti:** `app/wallets/page.tsx:57,61-62` mengirim `balance`, UI memperingatkan "akan menimpa saldo" (`:331`) dan menampilkan toast "Dompet diperbarui!"; trigger `prevent_direct_balance_update` mengembalikan `NEW.balance := OLD.balance` tanpa error.
- **Repro S2:** UPDATE balance ke 42 → `RETURNING balance` = 500.000.
- **Dampak:** user mengira sudah mengoreksi saldo; tidak ada cara resmi untuk penyesuaian saldo (reconcile).
- **Saran v2:** aksi "Sesuaikan saldo" yang membuat entri penyesuaian bertanda (bukan income/expense).

### INT-06 — Lintas-tenant: user B dapat mengubah saldo dompet user A · high
- **Bukti:** policy UPDATE `transfers` hanya `auth.uid() = user_id` (00-schema §7); trigger DELETE `update_wallet_balance_on_transfer` membalik saldo tanpa cek kepemilikan.
- **Repro S6:** B membuat transfer miliknya, UPDATE `to_wallet_id` ke dompet A, lalu DELETE. Saldo A turun dari 300.000 ke **299.999**. Hal serupa berlaku untuk `from_wallet_id` (menambah saldo korban) dan `to_asset_id`/`from_asset_id`.
- **Prasyarat:** B harus tahu UUID dompet A (tidak bisa dibaca lewat RLS). Saat ini hanya 2 akun yang bisa mendaftar, sehingga risiko praktis rendah, tetapi desainnya rusak.
- **Saran v2:** composite FK `(user_id, wallet_id) → wallets(user_id, id)`; transfer immutable (tanpa policy UPDATE); semua mutasi lewat fungsi yang memeriksa kepemilikan.

### INT-07 — Tanggal terakhir bulan hilang dari laporan dan anggaran (zona waktu) · high
- **Bukti:** `new Date(y, m, 0).toISOString().split('T')[0]` di `app/budgets/page.tsx:64`, `app/reports/page.tsx:13`, `app/ai-analysis/page.tsx:27,33`. Di WIB (UTC+7) tengah malam lokal = 17:00 UTC hari sebelumnya.
- **Bukti eksekusi:** `TZ=Asia/Jakarta node -e "new Date(2026,10,0).toISOString()"` → `2026-10-30` (seharusnya 31).
- **Dampak di produksi:** **46** transaksi bertanggal akhir bulan (Mar–Agu 2026) tidak masuk laporan bulanan, perbandingan bulan lalu, analisis AI, dan realisasi anggaran.
- Pola serupa: tanggal default form memakai `new Date().toISOString().split('T')[0]` (41 kemunculan), sehingga transaksi yang dicatat pukul 00:00–06:59 WIB mendapat tanggal **kemarin**; shortcut "Bulan lalu" (`transactions/page.tsx:673-676`) dimulai dari tanggal terakhir bulan sebelumnya; snapshot net worth (`dashboard/page.tsx:84`) ditulis ke tanggal kemarin.
- **Saran v2:** tanggal kalender sebagai `date` di zona `Asia/Jakarta`, satu util tanggal dengan tes; filter periode dihitung di server (`date_trunc` + `AT TIME ZONE`).

### INT-08 — Aturan "kantor dikecualikan" tidak diterapkan di laporan, export, dan AI · high
- **Bukti:** `grep -n "pocket\|kantor" app/reports/page.tsx app/export/page.tsx app/ai-analysis/page.tsx` → 0 hasil.
- **Dampak:** income/expense laporan, free cashflow, dan skor AI ikut menghitung kas kantor (dompet kantor di produksi bersaldo Rp15 juta).
- **Saran v2:** satu view/fungsi `personal_transactions` dipakai semua laporan.

### INT-09 — Income/expense menggembung oleh perpindahan non-operasional · high
- **Bukti:** pokok utang/piutang dicatat sebagai income/expense tanpa kategori (`debts/page.tsx:303-316`); cicilan juga (`:380-391`); income reimburse (`transactions/page.tsx:254-263`); pencairan goal aset sebagai income (`savings-goals/page.tsx:440-448`); auto-aset investasi mencatat expense **dan** menambah aset (`transactions/page.tsx:117-128`). Laporan tidak memfilter `debt_id`/`savings_goal_id` (`reports/page.tsx:62-64`).
- **Data:** 52 transaksi `debt_id`, 10 income reimburse, 2 transaksi goal, 67 transaksi tanpa kategori.
- **Dampak:** savings rate dan free cashflow salah; meminjam Rp1 juta tampil sebagai "pemasukan".
- **Saran v2:** klasifikasi eksplisit setiap entri (`operating` / `transfer` / `debt_principal` / `debt_payment` / `reimbursement` / `adjustment`) dan laporan hanya memakai `operating` (pemilik produk memutuskan perlakuan cicilan; lihat SUMMARY).

### INT-10 — Anggaran pada subkategori selalu 0 · high
- **Bukti:** pilihan kategori anggaran memuat subkategori (`budgets/page.tsx:69` hanya filter `type='expense'`, opsi di `:423`); realisasi membandingkan `t.category_id === b.category_id` (`:184-185,379`) padahal transaksi menyimpan induk di `category_id` dan anak di `subcategory_id` (`transactions/page.tsx:333`). Dashboard dan AI sama (`dashboard/page.tsx:299`, `ai-analysis/page.tsx:54`).
- **Data:** 4 anggaran produksi memakai subkategori.
- **Saran v2:** anggaran pada induk menjumlah semua anak; anggaran pada anak menjumlah `subcategory_id`; satu fungsi realisasi.

### INT-11 — Data kategori tidak konsisten · medium
- 53 transaksi punya `subcategory_id` dengan induk ≠ `category_id` (30 di antaranya `category_id = subcategory_id`), 10 transaksi punya subkategori tanpa induk (00-schema §10). Penyebab: migrasi data otomatis 2026-06-27 (`auto_assign_subcategories_*`) dan form yang mengizinkan memilih subkategori sebagai `category_id` (quick add `transactions/page.tsx:428-429`).
- Tidak ada CHECK `type` anak = `type` induk, dan tidak ada guard `parent_id <> id`.
- **Saran v2:** satu kolom `category_id` (yang paling spesifik); induk diturunkan dari pohon. Migrasi menormalkan 63 baris ini.

### INT-12 — Pembayaran cicilan tidak atomik dan bisa melebihi sisa · high
- **Bukti:** `debts/page.tsx:360-362` update `paid_amount` dulu (dibatasi ke total), lalu `:380-391` insert transaksi sebesar `amount` **tanpa** pembatasan; error kedua langkah tidak diperiksa.
- **Skenario uji:** sisa 100.000, input 150.000 → `paid_amount` = total (lunas), dompet berkurang 150.000. Diharapkan: ditolak atau dibatasi 100.000.
- **Skenario uji:** insert transaksi gagal (jaringan) → `paid_amount` sudah naik, saldo tidak berubah.
- Batal cicilan (`:418-433`) memakai `historyDebt.paid_amount` yang bisa basi bila dua cicilan dibatalkan cepat.
- `toggleComplete` (`:335-340`) membuat `is_completed` lepas dari `paid_amount` (8 baris produksi lunas-tapi-belum-dibayar).

### INT-13 — Reimburse dua langkah dan batal reimburse tidak membalik income · medium
- **Bukti:** `transactions/page.tsx:249-264` (update lalu insert, tidak atomik); `:233-237` batal hanya mengosongkan `reimbursed_at`.
- **Skenario uji:** konfirmasi reimburse Rp200.000, lalu klik ✓ lagi (batal), lalu konfirmasi ulang → dua income Rp200.000 untuk satu pengeluaran.

### INT-14 — Tagihan rutin bulanan melompati bulan · medium
- **Bukti:** `recurring/page.tsx:29-36` `setMonth(+1)` meluap. Eksekusi: `computeNextDue('monthly','2026-01-31','31')` → `2026-03-31` (Februari terlewat). Fungsi DB `next_due_date` punya bug serupa (31 Feb → 3 Mar).
- Eksekusi manual mencatat tanggal **hari ini**, bukan `next_due` (`:109`); tagihan yang terlambat 3 periode hanya tercatat sekali; tidak ada idempotensi (dua tab → dua transaksi); `auto_execute` tidak pernah dijalankan.
- Free cashflow mengurangi estimasi tagihan rutin **dan** transaksi hasil eksekusinya (`dashboard/page.tsx:109`, `reports/page.tsx:80`) → dihitung dua kali (dugaan; tabel `recurring_transactions` kosong di produksi).

### INT-15 — Nilai aset ditulis dari banyak tempat · medium
- Trigger lot menimpa `value = qty × harga` (00-schema §5); client menulis `value` saat refresh harga (`assets/page.tsx:117-121`), edit aset non-saham (`:183-190`), pencairan goal aset (`savings-goals/page.tsx:450-451`, dengan `Math.max(0, …)` yang diam-diam menelan selisih), edit/hapus riwayat goal (`:518-523,563-569`); trigger transfer menambah/mengurangi `value`.
- Read-modify-write dari state client yang bisa basi → race antar tab.
- Setor dana ke aset bertiker akan tertimpa saat lot berikutnya disimpan.
- `avg_price` = rata-rata semua pembelian, tidak berubah setelah penjualan; tidak ada P/L terealisasi.
- Label satuan tidak konsisten: "lembar" (`assets/page.tsx:397,629`) vs pesan "lot" (`:232`); 1 lot IDX = 100 lembar.

### INT-16 — Progres goal ganda dan rapuh · medium
- Progres memakai **seluruh** saldo dompet terhubung: belanja apa pun dari dompet itu menurunkan progres; dua goal pada dompet yang sama dihitung dua kali di "Sudah Terkumpul" (`savings-goals/page.tsx:581`); tidak ada constraint eksklusif.
- Kartu dompet memakai rumus lain (1 dompet, tanpa modal trading) (`wallets/page.tsx:201-203`).
- Penautan ulang dompet = hapus semua + insert (`:344-348`); gagal di tengah → goal tanpa dompet.
- `saveEditHistory` memeriksa status selesai memakai closure `goals` yang basi (`:551`).

### INT-17 — Daftar dan agregat terpotong diam-diam · medium
- `limit(300)` transaksi (`transactions/page.tsx:78`) dipakai untuk total, filter tanggal, dan CSV; `limit(500)` trips (`trips/page.tsx:63`) dan AI; `limit(1000)` export; `limit(200)` transfers; laporan 6 bulan tanpa limit sehingga tunduk pada `max-rows` PostgREST (default 1000).
- Produksi: 892 transaksi; Mei–Agustus rata-rata 180/bulan, jadi tab Transaksi hanya menampilkan ±7 minggu terakhir dan filter "30 hari"/"Bulan lalu" bisa kosong tanpa peringatan; trip lama kehilangan transaksi.
- **Saran v2:** agregat dihitung di DB; daftar dengan paginasi kursor.

### INT-18 — Double-submit dan race · medium
- Hanya quick add (`transactions/page.tsx:422,1086`) dan eksekusi rutin (`recurring/page.tsx:107`) yang men-disable tombol. Form transaksi lengkap, transfer, bayar cicilan, top up, setor dana, reimburse tidak punya guard → klik ganda membuat entri ganda.
- Tidak ada idempotency key; tidak ada optimistic locking; dua tab bisa mengedit baris yang sama (edit = hapus+insert → baris ganda atau hilang).
- Cek saldo cukup hanya di client dengan data basi (`assets/page.tsx:268-272`, `transfers/page.tsx:136`).

### INT-19 — Tipe angka · low
- `numeric` dikirim/diterima sebagai `number` JS; nominal IDR saat ini bulat (0 baris pecahan di produksi), sehingga presisi float belum bermasalah.
- Risiko: `Math.round(rem * pct / 100)` (`debts/page.tsx:1131`), `monthlyNeeded` (`savings-goals/page.tsx:589`), `normalizeToMonthly` ×4,33 menghasilkan pecahan; `type="number"` menerima `1e3`, desimal, dan negatif.
- `wallets.balance` nullable dan tanpa CHECK; `investment_lots.qty/price` tanpa CHECK > 0; `recurring_transactions.amount` tanpa CHECK.
- **Saran v2:** `bigint` rupiah (atau `numeric(18,0)`), CHECK > 0, satu util `Money` (parse/format) dengan tes.

### INT-20 — Snapshot net worth ditulis dari client setiap kunjungan · low
- `dashboard/page.tsx:75-92`: upsert snapshot setiap buka dashboard, dari data client; tanggal UTC (INT-07). Piutang (termasuk modal trading) tidak dihitung sebagai aset sehingga meminjamkan uang langsung menurunkan net worth.
- Kartu kredit tidak masuk utang/net worth.
- **Saran v2:** snapshot oleh job terjadwal dari fungsi DB `net_worth(user, date)`.

## 3. Rekonsiliasi produksi (ringkas dari 00-schema §10)

- 10 dari 25 dompet: saldo ≠ ledger; 3 di antaranya selisih negatif (bukti INT-02/03/05).
- 1 dompet tabungan bersaldo negatif.
- 1 utang `paid_amount` ≠ Σ cicilan; 8 utang `is_completed` tanpa lunas.
- 46 transaksi akhir bulan tidak terlihat di laporan (INT-07).
- 4 anggaran subkategori selalu 0 (INT-10).
- 63 transaksi dengan kategori tidak konsisten (INT-11).

Konsekuensi untuk migrasi v2: saldo tidak bisa diambil mentah dari `wallets.balance` maupun dihitung ulang dari ledger saja.
Rencana migrasi (docs/v2/DESIGN.md §Migrasi) membuat **entri saldo awal/penyesuaian** per dompet sebesar selisihnya sehingga
saldo v2 = saldo v1 yang dilihat user hari ini, dan selisih itu tercatat eksplisit untuk ditinjau pemilik.

## 4. Skenario uji untuk v2 (wajib lulus, ditulis sebelum implementasi)

| # | Skenario | Diharapkan |
|---|---|---|
| T1 | Catat expense 100k, edit jadi 300k | Saldo −300k; satu baris, id sama |
| T2 | Edit transaksi dengan jumlah ≤ 0 | Ditolak; transaksi asli tetap |
| T3 | Fungsi edit gagal di tengah (exception setelah update baris) | Rollback penuh; saldo & baris seperti semula |
| T4 | Kirim `create_transaction` dua kali dengan idempotency key sama | Satu baris |
| T5 | Dua sesi mengedit transaksi yang sama dengan `version` lama | Yang kedua ditolak (conflict) |
| T6 | Utang 1jt + 2 cicilan, lalu edit keterangan | Saldo, cicilan, sisa tidak berubah |
| T7 | Bayar cicilan > sisa | Ditolak atau dibatasi (keputusan produk) |
| T8 | Batalkan cicilan | Saldo dan sisa kembali; riwayat menandai batal |
| T9 | Hapus utang dengan cicilan | Semua efek dibalik atomik (atau soft delete) |
| T10 | Modal trading dari aset; kembalikan sebagian | Nilai aset dan saldo trading benar; income/expense tidak berubah |
| T11 | Top up goal aset lalu edit | Nilai aset mengikuti; net worth tetap |
| T12 | User B mencoba membuat/mengubah entri yang menunjuk dompet/aset/kategori/utang user A | Ditolak (FK komposit / RLS) |
| T13 | Transaksi 31 Okt 23:30 WIB | Masuk laporan Oktober |
| T14 | Tagihan bulanan tgl 31 mulai Jan | Jatuh tempo 31 Jan, 28/29 Feb, 31 Mar |
| T15 | Job tagihan rutin dijalankan dua kali di hari yang sama | Satu transaksi per periode |
| T16 | Transaksi di dompet kantor | Tidak masuk laporan, anggaran, net worth pribadi |
| T17 | Anggaran pada kategori induk | Menjumlah semua subkategorinya |
| T18 | Rekonsiliasi: Σ ledger per dompet = saldo untuk semua dompet setelah seluruh suite | Lulus |
