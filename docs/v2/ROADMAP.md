# DompetKu v2 — Rencana Pengerjaan

Setiap milestone bisa dijalankan dan diuji sendiri. Definisi selesai umum (berlaku untuk semua milestone):
`tsc --noEmit`, ESLint, Prettier, Vitest, pgTAP (`supabase test db`), build, dan Playwright alur terkait **lulus di CI**;
aplikasi dijalankan dan diverifikasi di browser pada 390px dan 1280px (screenshot di PR); axe 0 pelanggaran serious/critical pada layar baru;
logika uang ditulis **test-first** (tes invarian & kegagalan dulu, implementasi kemudian). Hasil dilaporkan apa adanya.
Penyimpangan dari DESIGN/UX dicatat sebagai ADR di `docs/v2/DECISIONS.md`.

Pembagian kerja: skema, fungsi uang, RLS, migrasi data, dan review oleh model utama (Opus); halaman, komponen, dan form didelegasikan ke subagent Sonnet
dengan brief berisi kontrak data (tipe RPC/query), token, dan kriteria penerimaan, lalu ditinjau sebelum digabung.

## M0 — Fondasi
- **Lingkup:** repo baru `dompetku-v2` (atau folder terpisah — keputusan pemilik), Next.js + TS strict, Tailwind v4 + token, primitif UI inti (Button, Dialog, Sheet, Toast, MoneyInput, Skeleton, EmptyState), layout + navigasi 5 tab + sidebar, dark mode, auth (login, logout, reset password, allowlist `access`), middleware sesi, header keamanan, `.env.example` + validasi env Zod, Supabase lokal + migrasi awal (profiles, access), pgTAP harness, CI GitHub Actions, Renovate, README/CONTRIBUTING.
- **Selesai jika:** login/logout jalan di lokal & preview; user di luar allowlist ditolak; CI hijau; Lighthouse a11y ≥ 95 di halaman login & shell.
- **Tes wajib:** pgTAP "setiap tabel public punya RLS"; Vitest `money.ts`, `date.ts` (format, parse, `todayWIB` lintas tengah malam); Playwright login + navigasi + axe.
- **Risiko:** setup CI Supabase lambat (mitigasi: cache image Docker); keputusan repo/project tertunda.

## M1 — Dompet, kategori, transaksi, transfer
- **Lingkup:** `accounts`, `categories` (2 level + seed default), `entries`, `entry_lines`, `entry_history`, view `account_balances`; RPC `create_entry`, `update_entry`, `void_entry`, `restore_entry`, `create_transfer`, `adjust_balance`; quick add global (≤ 3 ketukan), daftar transaksi (paginasi, cari, filter, segmen Pribadi/Kantor/Reimburse), detail & edit, halaman Dompet & detail dompet, transfer (termasuk ke/dari aset kas), talangan kantor + `settle_reimbursement`.
- **Selesai jika:** T1–T5, T12, T13, T16, T18 (02-integrity §4) lulus; catat pengeluaran ≤ 3 ketukan terukur di Playwright; tidak ada `insert/update/delete` langsung ke ledger dari client (grep + RLS).
- **Tes wajib:** pgTAP per RPC: sukses, validasi gagal, rollback saat exception di tengah, idempotensi `client_id`, konflik `version`, kepemilikan lintas user (dua user), invarian saldo = Σ lines setelah 1.000 operasi acak (property test di SQL).
- **Risiko:** desain bentuk `entry_lines` per `kind` perlu iterasi → kunci di ADR sebelum UI.

## M2 — Anggaran dan laporan
- **Lingkup:** `budgets`, `budget_plans` + allocations, fungsi `budget_actuals`, `period_summary`, `dashboard_summary`; halaman Anggaran, Rencana zero-based, Laporan (lazy Recharts), Beranda "aman dipakai".
- **Selesai jika:** T17 lulus; laporan bulan memasukkan transaksi tanggal terakhir (T13); kantor & non-operasional dikecualikan dengan rincian "tidak termasuk"; Beranda First Load JS ≤ 150 kB.
- **Tes wajib:** pgTAP angka laporan pada dataset fixture tetap (golden numbers); Playwright buat anggaran → catat → progres berubah.
- **Risiko:** rumus "aman dipakai" perlu validasi pemilik.

## M3 — Utang/piutang dan modal trading
- **Lingkup:** `contacts`, `loans`, view `loan_balances`, RPC `create_loan`, `record_loan_payment`, `void_loan_payment`, `update_loan_meta`, `close_loan`; modal trading (internal, sumber dompet/aset, peringatan shortfall); halaman per kontak & semua.
- **Selesai jika:** T6–T10 lulus; edit utang tidak mengubah saldo/riwayat; pembayaran berlebih ditangani sesuai keputusan §12-7.
- **Tes wajib:** pgTAP skenario repro S4 versi v2 (harus lulus), pembatalan cicilan, hapus utang (soft) membalik semua efek, modal trading dari aset tidak mengubah income/expense.
- **Risiko:** pemetaan riwayat v1 (prefix deskripsi) untuk migrasi.

## M4 — Tujuan tabungan dan aset
- **Lingkup:** `goals`, `goal_accounts`, RPC `goal_contribute`/`goal_withdraw`, proyeksi; aset non-kas (`valuation`), saham & reksa dana (`investment_lots`, `record_lot`, P/L terealisasi), route harga + `price_quotes` + "terakhir diperbarui".
- **Selesai jika:** T11 lulus; repro S5 versi v2 lulus; progres goal satu rumus (DB) dipakai di semua layar; harga gagal → UI tetap jalan dengan nilai terakhir & label.
- **Tes wajib:** pgTAP lot buy/sell (qty, biaya rata-rata, P/L), goal dengan modal trading; Vitest validator harga; Playwright setor ke goal.
- **Risiko:** sumber harga tidak resmi (D7).

## M5 — Tagihan rutin, trip, export
- **Lingkup:** `recurring_rules`, `recurring_occurrences`, job `recurring_materialize` (pg_cron, WIB), posting manual/otomatis; trip + exclusions; export CSV (aman formula) & PDF server-side; `job_runs` + alert.
- **Selesai jika:** T14, T15 lulus; job dijalankan dua kali = satu transaksi; export cocok dengan laporan.
- **Tes wajib:** pgTAP kalender (31 → akhir Feb, kabisat), idempotensi job; Vitest escape CSV; Playwright export.
- **Risiko:** pg_cron di Supabase lokal/CI (mitigasi: panggil fungsi job langsung di tes).

## M6 — AI, net worth, PWA
- **Lingkup:** snapshot net worth harian (job), grafik; analisis AI server-side (ringkasan DB, Zod, `ai_usage` rate limit, cache per bulan); PWA manifest + offline baca-saja.
- **Selesai jika:** endpoint AI menolak tanpa sesi (401) dan setelah batas harian (429); respons tidak valid → pesan anggun; Lighthouse PWA installable.
- **Tes wajib:** Vitest skema respons AI (fixture valid/invalid); Playwright rate limit dengan provider palsu; pgTAP `net_worth(on)`.
- **Risiko:** biaya/ketersediaan Gemini.

## M7 — Migrasi data dan cutover
- **Lingkup:** `scripts/migrate-v1` (DESIGN §9), staging berulang, laporan rekonsiliasi, daftar tinjau untuk pemilik, cutover, v1 read-only 30 hari.
- **Selesai jika:** saldo setiap akun v2 = v1 (selisih 0) setelah entri penyesuaian; jumlah baris cocok per tabel; total utang/piutang/aset/net worth cocok; pemilik menyetujui laporan; tidak ada tulis ke v1 (diverifikasi: koneksi read-only).
- **Tes wajib:** ETL dijalankan 2× menghasilkan hasil identik (hash); pgTAP invarian v2 pada data hasil migrasi.
- **Risiko:** kasus data yatim; akses dump v1 (butuh pemilik).

## Urutan & estimasi kasar
M0 → M1 → (M2 ∥ M3) → M4 → M5 → M6 → M7. M7 bisa dimulai lebih awal di staging setelah M4 untuk menemukan masalah data lebih cepat.
