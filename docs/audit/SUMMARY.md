# Audit DompetKu v1 — Ringkasan

Dokumen rinci: [00 skema](00-schema-v1.md) · [01 fitur & aturan](01-features.md) · [02 integritas uang](02-integrity.md) ·
[03 keamanan](03-security.md) · [04 kualitas kode](04-code-quality.md) · [05 UI/UX](05-ux.md) · [repro SQL](repro/).

Konteks: v1 dipakai 2 akun (whitelist email), 892 transaksi, 25 dompet, 46 utang/piutang, data Mar–Sep 2026.
Tidak ada transaksi baru sejak 2026-09-05. Project Supabase sempat paused.

## 1. Sepuluh temuan teratas (urut dampak)

| # | ID | Severity | Temuan | Bukti utama |
|---|---|---|---|---|
| 1 | INT-01 | critical | Mengedit catatan utang menghapus semua cicilan dan "mengembalikan" uangnya ke dompet, sementara `paid_amount` tetap | `debts/page.tsx:76-81,263-289`; repro S4: saldo 1,5 jt, seharusnya 1,1 jt |
| 2 | INT-02 | critical | Edit = DELETE lalu INSERT dari browser; langkah kedua gagal → data hilang (jumlah negatif lolos validasi) | `transactions/page.tsx:172,180-196`; repro S3 |
| 3 | INT-03 | critical | UPDATE transaksi tidak menyesuaikan saldo (trigger hanya INSERT/DELETE); 3 dompet produksi selisih negatif terhadap ledger | 00-schema §5, §10; repro S1 |
| 4 | INT-04 | critical | Edit riwayat top-up tujuan tabungan berbasis aset membuang tujuan aset → uang hilang dari net worth | `savings-goals/page.tsx:531-542`; repro S5 |
| 5 | INT-07 | high | Transaksi di tanggal terakhir bulan hilang dari laporan, anggaran, dan AI (bug zona waktu); 46 transaksi terdampak | `budgets/page.tsx:64`, `reports/page.tsx:13`; eksekusi Node TZ=Asia/Jakarta |
| 6 | INT-08/09 | high | Laporan menghitung kas kantor, pokok utang, reimburse, dan pencairan sebagai income/expense → cashflow & savings rate salah | grep 0 filter `kantor` di reports/export/AI |
| 7 | SEC-02 | high | `/api/ai-analysis` tanpa auth dan rate limit — proxy Gemini gratis untuk siapa pun | `middleware.ts:53`, `route.ts`; curl tanpa cookie lolos |
| 8 | SEC-01/INT-06 | high | RLS UPDATE `transfers` tidak cek kepemilikan dompet → user lain bisa mengubah saldo | repro S6 |
| 9 | INT-10/11 | high | Anggaran subkategori selalu 0; 63 transaksi kategori tidak konsisten | `budgets/page.tsx:184`; 00-schema §10 |
| 10 | INT-05 + UX | high | Edit saldo dompet diam-diam diabaikan; aksi hover-only tak terlihat di HP; kontras 2,56:1 sistemik; 5–6 ketukan untuk catat pengeluaran | `wallets/page.tsx:61`; repro S2; 05-ux |

Temuan penting lain: cron trial gagal 2.090× (fungsi sudah dihapus); tagihan bulanan tgl 29–31 melompati Februari; daftar transaksi dipotong 300 baris diam-diam; 0 tes/lint/CI; Next 14.2.35 punya advisory critical.

**Konsekuensi untuk v2:** saldo v1 tidak bisa dipercaya sebagai turunan ledger. Migrasi harus membawa saldo yang dilihat user hari ini
dan mencatat selisihnya sebagai entri penyesuaian yang eksplisit (lihat `docs/v2/DESIGN.md` §9).

## 2. Matriks fitur

| Fitur v1 | Keputusan | Alasan |
|---|---|---|
| Dompet + 3 pocket | **Pertahankan** | Inti; aturan kantor dipusatkan di satu view |
| Transaksi + kategori 2 level | **Ubah** | Satu `category_id` (paling spesifik), induk diturunkan; edit atomik |
| Quick add | **Ubah** | Global dari layar mana pun, ≤3 ketukan, dompet & kategori terakhir sebagai default |
| Transfer (3 form) | **Gabung** | Satu operasi `transfer` + satu form; fee sebagai pengeluaran terkait |
| Reimbursement | **Ubah** | Klaim reimburse terhubung ke transaksi asal; pelunasan sebagai `reimbursement` (bukan income) |
| Utang/piutang + kontak + cicilan | **Ubah** | Pembayaran jadi tabel sendiri; `paid_amount` diturunkan; edit tidak menyentuh cicilan |
| Modal Trading | **Pertahankan (ubah model)** | Jadi jenis pinjaman internal di modul utang; tetap lewat transfer |
| Tujuan Tabungan (multi dompet/aset) | **Ubah** | Progres dari dompet/aset terhubung (satu rumus di DB); dompet eksklusif per goal (keputusan) |
| Aset & saham IDX | **Pertahankan** | Harga lewat server + cache; lot sebagai sumber kebenaran; P/L terealisasi |
| Setor dana ke aset | **Gabung** ke transfer | Transfer dompet↔aset dua arah (termasuk jual RDPU ke dompet) |
| Tagihan rutin | **Ubah** | Job terjadwal idempoten; kalender bulan benar; status per periode |
| Trip & Healing | **Pertahankan** | Tag + rentang + exclude; id transaksi stabil |
| Anggaran + budget_plan | **Pertahankan, rapikan** | Realisasi via fungsi DB; anggaran induk menjumlah anak; rencana zero-based tetap |
| Net worth snapshot | **Ubah** | Job harian server, termasuk piutang (keputusan) |
| Laporan | **Ubah** | Agregat di DB; konsisten aturan pribadi |
| Export CSV/PDF | **Pertahankan, ubah** | CSV aman formula; PDF server-side |
| Analisis AI | **Ubah** | Terautentikasi, ringkasan dihitung server, rate limit, Zod |
| Kartu kredit | **Buang (atau tunda)** | 0 baris, tidak terhubung ke apa pun; bisa dimodelkan sebagai dompet jenis `credit` di v2 jika dibutuhkan |
| Auto-aset dari kategori "investasi" | **Buang** | Menggandakan uang (expense + aset); diganti transfer ke aset |
| Halaman trial-expired + cron trial | **Buang** | Mati; model akses diputuskan ulang |
| `wallets.currency/exchange_rate`, `budgets.rollover_enabled` | **Tunda** | Tidak dipakai; masuk backlog |

## 3. Keputusan untuk pemilik produk

Dikumpulkan di checkpoint Fase 2 (lihat `docs/v2/DESIGN.md` §12 untuk rekomendasi masing-masing):
1. Model akses v2: tetap pribadi (allowlist) atau publik dengan trial? Jika trial: batasi akses atau hapus data?
2. Migrasi data v1: bawa data (dengan entri penyesuaian saldo) atau mulai kosong?
3. Piutang (termasuk modal trading) dihitung sebagai aset di net worth?
4. Cicilan utang: dihitung sebagai pengeluaran di laporan atau tidak (pokok vs bunga)?
5. Kartu kredit: buang, atau jadikan dompet jenis kredit?
6. Satu dompet boleh terhubung ke lebih dari satu tujuan tabungan?
7. Bayar cicilan melebihi sisa: tolak atau catat kelebihan sebagai piutang/penyesuaian?
8. Hapus data keuangan: soft delete dengan undo (disarankan) atau hapus permanen?
9. Supabase project baru v2: region & plan; siapa yang membuatnya (butuh izin biaya)?
