# Ronde 2 — Register Konflik dan Usulan Keputusan Tech Lead

Sumber: `docs/team/round1/*.md`. Status setiap butir: **usulan** sampai ditinjau ronde 2, lalu **final** di spec.
Butir bertanda **[PEMILIK]** hanya bisa diputuskan pemilik produk.

## A. Data & domain uang

| # | Konflik | Pihak | Usulan keputusan | Alasan |
|---|---|---|---|---|
| A1 | Transfer lintas ruang: 1 entri 2 line (spec §5.4/§7a) vs 2 entri bertaut | Backend, Data vs spec | **Dua entri `space_transfer`** (satu per ruang) diikat `link_id`, trigger pasangan memastikan jumlah sama & keduanya void bersama. Perilaku produk §7a tetap (ruang tujuan melihat "Setoran dari <nama>", tanpa nama dompet). Edit/void hanya oleh pencatat (anggota kedua ruang). | FK komposit `space_id` & RLS tetap sederhana; tidak perlu policy lintas ruang yang bisa bocor |
| A2 | Rumus fee transfer menghitung biaya 2× (DESIGN §5) | Backend, Data | Lines: `main = −amount`, `fee = −fee` (akun sumber), `counter = +amount`; Σ = −fee | Bug desain |
| A3 | `FORCE RLS` + `SECURITY DEFINER` | Backend, Security, Data | 4 role: `dompetku_owner` (DDL), `dompetku_api` (NOLOGIN, pemilik fungsi tulis, policy `TO dompetku_api`), `dompetku_app` (login web/worker), `dompetku_auditor` (dq/backup verify). Fungsi **baca** = `SECURITY INVOKER`; **tulis** = `SECURITY DEFINER` milik `dompetku_api`; `REVOKE EXECUTE … FROM PUBLIC` default | RLS tetap berlaku di laporan/ekspor/AI |
| A4 | Constraint deferrable tidak pernah dicek di pgTAP (rollback) | Backend | Tiap `api.*` diakhiri `set constraints all immediate`; pgTAP memanggil fungsi, bukan insert mentah | Mencegah tes hijau palsu |
| A5 | GUC di pool | Backend, Security | `app.current_user_id()` = `nullif(current_setting('app.user_id', true), '')::uuid`; hanya `set_config(..., true)` dalam transaksi; `SET` sesi dilarang (lint); `sql.raw` dilarang (lint) | Kebocoran antar request |
| A6 | Idempotensi | Backend, Data | Tabel `idempotency_keys (space_id, client_id, request_hash, result)`; kunci sama + isi beda → `DK410` | |
| A7 | Driver `pg` mengubah `date` → `Date` lokal | Backend | Parser tipe `date` (OID 1082) → string `YYYY-MM-DD`; `app.today()` & `app.now()` (bisa di-override di tes); `current_date` dilarang (lint) | Kelas bug INT-07 |
| A8 | View saldo menghilangkan akun tanpa entri | Backend | `accounts LEFT JOIN` agregat lines | |
| A9 | Hapus permanen 90 hari (keputusan pemilik) vs Backend menolak | Backend vs pemilik | **Tetap 90 hari** untuk entri yang di-void (keputusan pemilik), tetapi `entry_history` ringkas (tanpa deskripsi) disimpan 1 tahun untuk audit | Menghormati keputusan, tetap ada jejak |
| A10 | Saldo tidak cukup: error keras vs peringatan | Backend → PM | Peringatan + konfirmasi eksplisit (`p_allow_negative`), kecuali akun aset | Perilaku v1 dipertahankan, tidak diam |
| A11 | Snapshot net worth 23:55 | Data | 00:10 WIB untuk hari sebelumnya + daftar "hari kotor" untuk entri susulan | |
| A12 | Laporan | Data | Satu view `app.report_lines` + `app.report_class()` (15 kelas) dipakai laporan/anggaran/ekspor/AI/net worth; materialized view dilarang untuk data ruang | Satu sumber aturan |
| A13 | Saldo awal & cocokkan saldo (migrasi dihapus) | PM, UX | M1: entri `opening_balance` saat buat dompet + aksi "Cocokkan saldo" → `adjustment` bertanda | Mulai dari nol butuh ini |

## B. Infra & keamanan

| # | Konflik | Pihak | Usulan keputusan | Alasan |
|---|---|---|---|---|
| B1 | Deploy: self-hosted runner (disetujui pemilik) vs pull-based (Security) vs runner terkunci + `sudo deploy <digest>` (DevOps) | Security, DevOps, QA | **Pull-based**: build & attestation di GitHub-hosted runner; di VM, timer systemd menarik digest `main` terbaru dari GHCR (token read-only), verifikasi attestation, jalankan `/opt/dompetku/bin/deploy` (preflight, migrasi, health, rollback). Tanpa runner & tanpa token tulis di VM produksi. | Runner di VM produksi = kode workflow berjalan di host data keuangan. Perlu konfirmasi pemilik karena mengubah pilihan sebelumnya **[PEMILIK, info]** |
| B2 | Port Postgres 5437 | DevOps, Security | Tidak ada port host; Postgres hanya di network Docker `internal`. Satu pintu `gw` (Caddy) mTLS di `10.0.1.68:8443` (app) & `:9443` (metrik) hanya dari IP privat VM App | |
| B3 | Header forward | Security | Dipercaya hanya dari `gw`; buang `x-middleware-subrequest` | CVE middleware Next |
| B4 | `backup_verify` | DevOps | Timer systemd di host (bukan pg-boss) + dead-man Healthchecks.io | Alert tetap jalan saat app mati |
| B5 | 2FA | PM vs Security | Wajib faktor kuat: **passkey** ATAU **password + TOTP**; ditegakkan di `requireUser`/`withUser` (sesi `pending_2fa` ditolak); reset password mencabut semua sesi dan tidak mematikan 2FA | Aman & tidak menghambat Farida |
| B6 | Route `/api/*` | Security, Frontend | Origin check sendiri; halaman berdata `Cache-Control: no-store`; cache data Next dilarang untuk data user (lint) | |
| B7 | Analisis kode | QA, Security | Semgrep OSS + gitleaks + osv-scanner + Trivy + actionlint/zizmor; Actions dipatok SHA | CodeQL butuh GHAS di repo private |
| B8 | Gemini tier gratis vs berbayar | AI, Security | Tier berbayar (estimasi < $1/bln) untuk data keuangan **[PEMILIK]** | Tier gratis berisiko dipakai untuk pelatihan |
| B9 | Arsitektur & tipe akun OCI | DevOps | Cek `uname -m` dan tipe akun; jika Always Free → upgrade ke Pay-As-You-Go (tetap Rp0 dalam kuota) **[PEMILIK]** | VM idle Always Free bisa direklamasi |

## C. Produk & UX

| # | Konflik | Pihak | Usulan keputusan | Alasan |
|---|---|---|---|---|
| C1 | FAB melayang (UX §1 opsi B) vs tombol Catat di tab bar | UI/UX | Tab bar `Beranda · Transaksi · [Catat] · Dompet · Rencana`; Laporan = tab kedua di Transaksi (`Daftar | Ringkasan`); "Menu" berlabel di header (Trip, Kategori, Kontak, Export, Analisis, Pengaturan) | FAB menutupi konten & bertabrakan dengan toast |
| C2 | Ruang aktif di cookie vs URL | Frontend | URL `/pribadi/...`, `/bersama/...`; action menerima `spaceId` eksplisit; ruang tujuan catat = ruang dompet | Dua tab tidak salah ruang |
| C3 | Segmen "Pribadi/Kantor/Reimburse" bentrok nama ruang | UI/UX | Segmen di Transaksi: `Semua · Kantor · Talangan` | |
| C4 | Net worth di Beranda | UI/UX, PM | Pindah ke Dompet; Beranda fokus "aman dipakai", tagihan, anggaran | |
| C5 | "Aman dipakai" butuh tagihan rutin (M5) | PM | Tagihan rutin dasar naik ke M2 | |
| C6 | Milestone | PM, PO | M0a prototipe + seed demo · M0b infra + auth · M1 inti + saldo awal + parser nominal "35rb" + saran kategori · M2 anggaran, laporan, Bersama penuh (setoran, feed, kontribusi), tagihan rutin dasar, export CSV · M3 utang & modal trading · M4 goal, aset, net worth · M5 trip, tagihan rutin lanjutan, export PDF · M6 catat teks bebas + AI analisis + PWA · M7 stabilisasi & portofolio (arsip v1, screenshot) · M8 bot Telegram (bila dipakai) | Irisan harian pertama secepatnya |
| C7 | Uji pakai bertahap | PM | Novanda 7 hari setelah M1; Farida bergabung awal M2 | |
| C8 | TanStack Query | Frontend | Tidak dipakai; RSC + Server Actions + optimistic UI | Lebih sederhana |
| C9 | Ikon & arah visual | UI/UX | Arah "buku kas" (kertas hangat, nila=Pribadi, bata=Bersama, angka tabular, garis total ganda), Phosphor icons; serif angka hero diuji di prototipe M0, pemilik memilih | Khas tanpa ribut |
| C10 | Token kontras border/primer dark | Frontend, UI/UX | Ganti token sesuai ukuran ui-ux.md (border ≥ 3:1 di `bg` & `surface`, teks tombol primer dark ≥ 4,5:1) | Klaim UX.md keliru |
| C11 | AI | AI dev | Kuota 15 parsing / 5 analisis per hari per user; tanya-bebas ditunda; Telegram long polling dari worker; chip saran diurutkan ulang setelah nominal diketik | |
| C12 | Metrik produk | PM | `product_events` tanpa nominal/deskripsi; north star % hari tercatat | |
| C13 | "Aman dipakai" sampai akhir bulan atau sampai gajian | UI/UX | Default akhir bulan; tanggal gajian opsional di Pengaturan **[PEMILIK]** | |
| C14 | Telegram dipakai sehari-hari? | PM | M8 hanya jika ya **[PEMILIK]** | |
