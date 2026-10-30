# DompetKu v2 — Desain (revisi 2: self-hosted, ruang bersama)

Tanggal: 2026-10-29 · Status: menunggu persetujuan pemilik · Menggantikan bagian stack/auth/deploy di `docs/v2/DESIGN.md` revisi 1.
Detail domain uang (jurnal, fungsi, invarian, migrasi) tetap di `docs/v2/DESIGN.md`; UX di `docs/v2/UX.md`; milestone di `docs/v2/ROADMAP.md`.
Dasar temuan: `docs/audit/SUMMARY.md`.

## 1. Maksud

DompetKu v2 adalah aplikasi keuangan pribadi untuk **dua orang (pemilik dan pasangan) yang dipakai setiap hari**, dibangun ulang dari nol
karena v1 terbukti bisa salah menghitung uang dan kehilangan data (audit INT-01..04).
Yang membuatnya berhasil: angka selalu benar dan bisa dijelaskan, mencatat cepat (≤ 3 ketukan), tidak pernah kehilangan data, aman setara aplikasi finansial,
dan tampil rapi sehingga screenshot-nya layak jadi portofolio.

## 2. Tujuan, non-tujuan, anti-tujuan

**Tujuan**
- Semua aturan bisnis v1 yang bernilai bertahan (01-features §2) dengan perilaku teruji.
- Ruang **Pribadi** per orang + satu ruang **Bersama** per rumah tangga.
- Self-hosted di 2 VM OCI milik pemilik, domain `novandafadly.com`.
- Kualitas "enterprise": logika uang di DB, atomik, idempoten, teraudit; RLS teruji dua user; backup + restore teruji; CI wajib hijau; observabilitas.
- Mencatat semudah mengetik ("makan siang 35rb bca") dengan saran kategori otomatis.

**Non-tujuan**
- Bukan SaaS publik; tidak ada pendaftaran terbuka, billing, atau trial.
- Repo tetap **private**; tidak ada mode demo publik. Portofolio = screenshot dari data demo.
- Tidak multi-mata-uang, tidak berbagi selain satu ruang Bersama, tidak impor mutasi bank di MVP.

**Anti-tujuan** (gagal walau "jalan")
- Saldo yang bisa melenceng dari riwayatnya, atau edit yang bisa kehilangan data.
- Data pribadi pasangan bisa terlihat lewat jalur apa pun (laporan, ekspor, AI, log).
- Database terbuka ke internet.
- Mengganggu app lain di VM yang sama (insiden `:5435` di riwayat ops).
- UI generik/"AI slop", kontras gagal AA, aksi tersembunyi di hover.

## 3. Batasan

- **VM App** `rtp-prod-app-01` (IP publik): per 2026-09-10 1 vCPU, 5,8 GiB RAM, swap 2 GiB terpakai, disk 78%, menjalankan app lain + Prometheus/Grafana. Kapasitas harus dicek ulang dan dibereskan sebelum deploy (M0).
- **VM DB** `rtp-prod-db-01` (`10.0.1.68`, privat): 3 vCPU, 17 GiB RAM, idle; sudah ada Postgres app lain (`:5435`, `:5436`) dan Redis via Docker Compose.
- Arsitektur CPU kedua VM belum diketahui (Ampere ARM atau x86) → image dibangun multi-arch.
- Sesi Claude di cloud tidak bisa SSH ke VM; deploy lewat GitHub Actions atau dijalankan pemilik.
- v1 dan project Supabase v1 read-only sampai v2 dipakai; setelah itu v1 diarsipkan (ekspor CSV/JSON per akun untuk referensi pribadi, tidak diimpor).
- **Tidak ada migrasi data**: pemilik dan pasangan (Farida) mulai dari nol di v2 (keputusan pemilik 2026-10-29).

## 4. Pendekatan yang dipertimbangkan

### 4.1 Backend/hosting — dipilih **B**
| | Pendekatan | Trade-off |
|---|---|---|
| A | Supabase self-host di VM DB + Next.js di VM App | Plan rev 1 hampir utuh; tetapi 6–8 container untuk dirawat dan API DB terekspos publik |
| **B** | **Postgres 17 polos di VM DB + Next.js (auth sendiri) di VM App; DB hanya diakses server** | Paling ringan & permukaan serangan terkecil; auth, job, admin ditulis sendiri |
| C | Supabase cloud Pro + Next.js di VM | Ops paling sedikit; biaya ±$25/bln, data tidak di server sendiri |
Alasan B: VM App sempit; logika uang memang di Postgres sehingga Supabase hampir tidak menambah nilai; DB tidak terekspos.

### 4.2 Urutan kerja — dipilih **C (irisan vertikal)**
| | Pendekatan | Trade-off |
|---|---|---|
| A | Backend semua dulu, UI terakhir | Inti kokoh; lama tanpa app, celah model data ketahuan terlambat |
| B | UI dulu dengan data palsu | Cepat terasa; logika uang mengikuti bentuk UI (pola v1) |
| **C** | **M0 fondasi + design system + prototipe klik; lalu tiap fitur: skema+fungsi+tes → UI → dipakai** | Tiap milestone bisa dipakai; uang selalu test-first |

### 4.3 Akses — **domain publik** `dompet.novandafadly.com` (dipilih pemilik), bukan VPN.

### 4.4 Model berbagi — **ruang terpisah** (dipilih pemilik): pengeluaran dompet bersama hanya di tampilan Bersama dengan anggaran sendiri.

## 5. Arsitektur yang diputuskan

```
 Browser/PWA ──HTTPS──▶ [VM App] reverse proxy (TLS, rate limit, header)
                               │
                               ├─▶ web: Next.js (standalone, Node)  ──┐
                               └─▶ worker: job terjadwal (Node)    ───┤  TLS, jaringan privat VCN
                                                                     ▼
                                                     [VM DB] postgres-dompetku (container sendiri)
                                                                     │
                                                     WAL-G ──▶ OCI Object Storage (terenkripsi)
```

### 5.1 Aplikasi
- Next.js App Router (versi stabil terbaru saat M0) + React + TypeScript strict; RSC untuk baca, Server Actions untuk tulis.
- Akses DB **hanya dari server** memakai Kysely (query builder bertipe, SQL-first) di atas driver `pg`/`postgres`; tipe di-generate dari skema (kysely-codegen) di CI.
- Setiap request terautentikasi berjalan dalam transaksi `withUser(userId, spaceId?)` yang menjalankan `select set_config('app.user_id', $1, true)` sebelum query apa pun. RLS membaca `current_setting('app.user_id')` lewat fungsi `app.current_user_id()`.
- Fungsi uang = fungsi Postgres di skema `api` (lihat `docs/v2/DESIGN.md` §5), dipanggil `select api.create_entry(...)`. Semua aturan revisi 1 tetap: jurnal `entries`/`entry_lines`, saldo turunan, idempotensi `client_id`, `version`, soft delete, `entry_history`, FK komposit.
- Validasi Zod di batas input; error DB berkode dipetakan ke pesan Indonesia.
- UI: Tailwind + Radix (pola shadcn), lucide, token desain `docs/v2/UX.md` §5; dark mode; PWA.

### 5.2 Peran database
| Role | Hak | Dipakai oleh |
|---|---|---|
| `dompetku_owner` | pemilik skema, DDL | migrasi (CI/deploy) saja |
| `dompetku_app` | `USAGE` skema; `SELECT` tabel dengan RLS; `EXECUTE` fungsi `api.*`; R/W tabel auth; **tanpa** INSERT/UPDATE/DELETE langsung ke tabel ledger; `NOBYPASSRLS` | web + worker |
| `dompetku_readonly` | `SELECT` saja | backup verifikasi, debugging darurat |
`FORCE ROW LEVEL SECURITY` di semua tabel domain. Fungsi `api.*` `SECURITY DEFINER` dengan `search_path = ''`, memeriksa `app.current_user_id()` dan keanggotaan ruang.

### 5.3 Auth
- Better Auth (self-hosted library, tabel di skema `auth` Postgres): email + password (argon2/scrypt sesuai library), **passkey** dan **TOTP 2FA** (wajib untuk kedua akun setelah onboarding), sesi di DB dengan cookie `HttpOnly; Secure; SameSite=Lax`, rotasi sesi, daftar perangkat aktif + cabut sesi.
- Pendaftaran tertutup: allowlist email dari env `AUTH_ALLOWED_EMAILS`; pasangan diundang lewat tautan undangan sekali pakai dari akun pemilik.
- Rate limit login & reset password (per IP + per akun), lockout bertahap, email reset lewat penyedia SMTP transaksional (Resend sudah pernah dipakai pemilik — keputusan builder, lihat §8).
- Middleware hanya menyegarkan sesi & redirect UX; otorisasi selalu di server (`requireUser()`) + RLS.

### 5.4 Ruang (Pribadi & Bersama)
- Tabel `households` (1 baris), `spaces (id, household_id, kind personal|shared, owner_user_id null untuk shared)`, `space_members (space_id, user_id, role)`.
- Setiap tabel domain punya `space_id` (FK komposit), menggantikan `user_id` sebagai batas kepemilikan; `created_by`/`updated_by` = user. RLS: baris terlihat bila `app.current_user_id()` anggota `space_id`-nya. Ruang Pribadi hanya beranggota pemiliknya.
- Kategori, anggaran, tujuan, tagihan rutin, laporan: per ruang. Ruang Bersama di-seed kategori rumah tangga.
- Transfer lintas ruang (dompet pribadi → dompet Bersama) = satu entri `transfer` dengan dua line di ruang berbeda; di laporan pribadi tampil "Setor ke Bersama" (bukan pengeluaran), di Bersama "Setoran dari <nama>" (bukan pemasukan). Fungsi transfer memvalidasi user anggota kedua ruang.
- Utang/piutang, modal trading, pocket kantor & reimburse: hanya ruang Pribadi.
- Net worth: per ruang; "total keluarga" ditunda.
- pgTAP: dua user × semua tabel × semua operasi, termasuk laporan/ekspor/AI tidak pernah menyentuh ruang Pribadi orang lain.

### 5.5 Job terjadwal
Worker Node terpisah memakai **pg-boss** (antrean + cron di Postgres, retry, tanpa Redis): `recurring_materialize` (00:05 WIB), `net_worth_snapshot` (23:55 WIB), `price_refresh` (16:30 WIB hari bursa), `purge_voided` (mingguan), `backup_verify` (mingguan). Semua idempoten; status di tabel `job_runs`; gagal → alert.

### 5.6 Catat cepat & kategorisasi (permintaan pemilik)
1. **M1:** saran kategori dari riwayat ruang aktif (kata kunci deskripsi, jam, nominal, dompet) — fungsi DB `api.suggest_categories(text, amount, account)`; 6 chip saran di quick add.
2. **M6:** kolom ketik bebas "makan siang 35rb bca" → parser aturan (nominal "35rb/35k/35.000", alias dompet) + fallback LLM (server, tanpa data selain teks itu) → pratinjau → konfirmasi. Tidak pernah menyimpan tanpa konfirmasi.
3. **M8 (setelah stabil):** bot **Telegram** memakai parser yang sama, akun ditautkan lewat kode sekali pakai; WhatsApp ditunda (Business API butuh verifikasi Meta & berbayar; library tidak resmi berisiko blokir nomor).

### 5.7 Deploy & operasi
- **Repo baru private** `novandafadly/dompetku-v2` (dibuat pemilik), monorepo: `apps/web`, `apps/worker`, `packages/db` (migrasi SQL, tipe, pgTAP), `infra/` (compose, proxy, backup), `docs/`.
- **CI (GitHub Actions):** lint, typecheck, unit, Postgres service + migrasi + pgTAP, build, Playwright (desktop & mobile, axe), `npm audit`/osv, build image multi-arch → GHCR private.
- **CD:** pada tag/merge ke `main`: job deploy (SSH key khusus deploy, environment protection GitHub) → `docker compose pull` → migrasi (role owner) → `up -d` web+worker → health check `/api/health` → rollback otomatis ke image sebelumnya bila gagal. Migrasi wajib maju-kompatibel (expand/contract) agar rollback aman.
- **VM DB:** compose project `dompetku` terpisah: image Postgres 17 + WAL-G, volume sendiri, port hanya di IP privat, `listen_addresses` + `pg_hba` hanya IP VM App, `scram-sha-256`, TLS. Batas memori/CPU container agar tidak mengganggu app lain.
- **VM App:** compose project `dompetku` (web, worker) dengan limit memori; reverse proxy: pakai yang sudah ada di VM App bila ada (dicek di M0), bila tidak **Caddy** (HTTPS otomatis). DNS `dompet.novandafadly.com` → IP publik VM App. OCI security list: 443 publik; 5437 (port Postgres DompetKu) hanya dari VM App.
- **Backup:** WAL-G base backup harian + WAL archiving kontinu ke OCI Object Storage (S3-compatible, kunci Customer Secret khusus bucket, enkripsi sisi klien), retensi 30 hari + bulanan 12 bulan. Target **RPO ≤ 5 menit, RTO ≤ 1 jam**. Job mingguan me-restore ke container sementara dan menjalankan pgTAP rekonsiliasi; gagal → alert.
- **Observabilitas:** log JSON terstruktur (pino) tanpa nominal/deskripsi; `postgres_exporter` + metrik app ke Prometheus/Grafana yang sudah ada; alert: app down, backup gagal, job gagal, disk > 80%, error rate. Error tracking: Sentry self-hosted terlalu berat → GlitchTip opsional atau log + alert (keputusan builder).
- **Keamanan tambahan:** header CSP (nonce)/HSTS/XFO/Referrer/Permissions; secrets di file env di VM (`chmod 600`) dan GitHub Environments, tidak di repo; Renovate; `unattended-upgrades` di VM; audit log aksi sensitif (login, ekspor, undang, cabut sesi).

## 6. Rencana fitur (konsolidasi)

Matriks pertahankan/gabung/ubah/buang di `docs/audit/SUMMARY.md` §2 tetap berlaku, ditambah: ruang Pribadi/Bersama (M1), saran kategori (M1), catat teks bebas (M6), bot Telegram (M8).
Milestone (detail kriteria di `docs/v2/ROADMAP.md`, diperbarui untuk revisi ini):
- **M0** fondasi: repo, CI/CD, infra VM (Postgres terisolasi, proxy, backup + uji restore), auth + undangan pasangan + 2FA, ruang, design system, **prototipe klik** Beranda/catat cepat/Transaksi dengan data demo untuk dinilai pemilik.
- **M1** dompet, kategori + saran, transaksi, transfer (termasuk lintas ruang), talangan kantor.
- **M2** anggaran (pribadi & bersama), laporan, Beranda "aman dipakai".
- **M3** utang/piutang & modal trading.
- **M4** tujuan tabungan & aset/saham.
- **M5** tagihan rutin, trip, export.
- **M6** AI, net worth, PWA offline-baca, catat teks bebas.
- **M7** ~~migrasi data v1~~ dihapus; diganti arsip ekspor v1 + cutover sederhana (mulai dipakai, v1 dimatikan).
- **M8** bot Telegram.

## 7. Diputuskan pemilik (2026-10-29)
Semua rekomendasi `docs/v2/DESIGN.md` §12 disetujui (allowlist pribadi, migrasi data dengan entri penyesuaian, piutang = aset, cicilan bukan pengeluaran,
talangan kantor bukan pengeluaran pribadi, 1 dompet = 1 tujuan, tolak bayar lebih, soft delete 90 hari, kartu kredit ditunda, Gemini 20/hari);
self-hosted opsi B; urutan C; domain publik `novandafadly.com`; ruang Bersama terpisah dengan anggaran sendiri; repo private, portofolio via screenshot data demo.

## 7a. Jawaban atas builder check (2026-10-29)

Keputusan pemilik:
- Pasangan = Farida (akun v1 kedua). Ruang Pribadi kedua akun dan ruang Bersama **mulai kosong**; tidak ada migrasi.
- VM App sempit → web + worker DompetKu dijalankan di **VM DB** (container terpisah, limit CPU/RAM), reverse proxy TLS tetap di VM App meneruskan ke IP privat VM DB. Postgres tetap hanya mendengar di network Docker internal + IP privat.
- Deploy via **GitHub self-hosted runner** (di VM yang menjalankan app, user khusus tanpa sudo luas); setup awal infra lewat runbook yang dijalankan pemilik (atau sesi Claude Code di VM).

Keputusan builder (dapat ditinjau pemilik):
- Transfer lintas ruang: header entri milik ruang **sumber**; hanya pencatat yang bisa mengedit/membatalkan; ruang tujuan melihat "Setoran dari <nama>" tanpa nama dompet sumber. Arah sebaliknya (Bersama → pribadi) diizinkan untuk anggota mana pun, tercatat "Diambil oleh <nama>". Laporan Bersama menampilkan kontribusi per orang (dihitung, tanpa logika pelunasan).
- Hak di Bersama setara untuk kedua anggota (catat, edit, batal, kelola dompet/anggaran); setiap perubahan tercatat di `entry_history` + feed aktivitas Bersama.
- Tidak ada staging permanen; staging = stack compose sementara saat dibutuhkan + preview lokal; CI memakai Postgres efemeral.
- Alert dikirim ke email pemilik (dan Telegram setelah M8). Kunci enkripsi backup disimpan pemilik di password manager; runbook memuat langkah verifikasinya.

## 8. Diserahkan ke builder
- Pilihan versi tepat library (Next, Better Auth, Kysely, pg-boss, WAL-G) saat M0, dicatat di ADR.
- Penyedia email transaksional (Resend/SMTP lain).
- GlitchTip vs log+alert untuk error tracking.
- Nama subdomain akhir (usulan `dompet.novandafadly.com`) dan port Postgres DompetKu (usulan 5437).
- Struktur detail monorepo (npm workspaces vs pnpm).

**Status: DISETUJUI pemilik 2026-10-30** (termasuk 5 fitur tambahan di §9.4).

## 9. Keputusan tim (final setelah ronde 1–2, 2026-10-29)

Sumber: `docs/team/round1/*` (10 peran), `docs/team/round2/register.md` + tinjauan PM, Backend, Security.
Bagian ini **mengalahkan** §1–8 di atas dan `docs/v2/*` bila bertentangan.

### 9.1 Data & domain uang
- **Transfer lintas ruang = dua entri `space_transfer`** (satu per ruang) diikat `link_id`; trigger pasangan memastikan nominal sama dan void bersama. Kaki tujuan **tanpa deskripsi**; catatan untuk Bersama hanya lewat `shared_note` yang diisi eksplisit. Ruang tujuan melihat "Setoran dari <nama>", tanpa nama dompet sumber. Edit/void hanya oleh pencatat. Cek `space_mismatch` di setiap fungsi.
- **Lines transfer:** `main = −amount`, `fee = −fee` (akun sumber), `counter = +amount`; Σ = −fee (memperbaiki bug hitung fee 2× di DESIGN §5).
- **Role DB (5):** `dompetku_owner` (DDL, migrasi), `dompetku_api` (NOLOGIN, pemilik fungsi tulis `SECURITY DEFINER`, policy `TO dompetku_api`), `dompetku_web` (login web), `dompetku_worker` (login worker, hak minimal), `dompetku_auditor` (NOLOGIN, dipakai lewat `SET ROLE` oleh job dq/backup verify). Fungsi & view **baca** = `SECURITY INVOKER` / `security_invoker = true`; pengecualian DEFINER hanya `app.my_space_ids()` dan `app.space_roster()`. `REVOKE EXECUTE … FROM PUBLIC` default. Tabel Better Auth di skema `auth` di luar RLS, hanya bisa diakses role web.
- **Konteks request:** `app.current_user_id()` = `nullif(current_setting('app.user_id', true), '')::uuid`; hanya `set_config(..., true)` dalam satu transaksi pendek per loader/action; `SET` sesi, `sql.raw`, dan `current_date` dilarang lewat lint; `app.today()`/`app.now()` dengan override waktu **hanya** bila env dev/test; timeout statement & idle-in-transaction per role.
- **Constraint deferrable** dicek eksplisit (`set constraints all immediate`) di akhir setiap fungsi `api.*`; pgTAP memanggil fungsi, bukan insert mentah. Urutan lock tetap (akun naik menurut id), retry deadlock terbatas, tes konkurensi dua koneksi.
- **Idempotensi:** tabel `idempotency_keys (user_id, client_id, request_hash, result)`; kunci sama + isi beda → `DK410`.
- **Driver:** `pg` + Kysely + kysely-codegen; parser tipe `date` → string `YYYY-MM-DD`, `int8`/`numeric` → string lalu divalidasi ke bigint/number aman. Migrasi: **dbmate** (maju-saja di produksi, expand/contract, uji N-1).
- **Saldo:** view `account_balances` = `accounts LEFT JOIN` agregat lines. Dompet baru punya `opened_on` + entri `opening_balance`; saldo awal boleh diedit langsung 7 hari pertama. **"Cocokkan saldo"** menerima saldo nyata, selisihnya dihitung DB menjadi entri `adjustment`.
- **Saldo tidak cukup:** peringatan inline di sheet (bukan dialog), tetap bisa disimpan dengan `p_allow_negative`; akun aset tidak boleh negatif.
- **Hapus:** soft delete; entri void dipurge permanen setelah 90 hari (keputusan pemilik) dengan menyisakan `entry_tombstones` (id, ruang, jenis, tanggal, tanpa nominal/deskripsi; tanpa FK); `entry_history` append-only ikut terhapus bersama entrinya.
- **Laporan:** satu view `app.report_lines` + `app.report_class()` (15 kelas) dipakai laporan, anggaran, ekspor, AI, net worth; materialized view dilarang untuk data ruang. Snapshot net worth 00:10 WIB untuk hari sebelumnya + daftar "hari kotor". Job `dq_reconcile` 01:00 WIB (10 cek, alert tanpa nominal).
- **Kategori:** saran dari `api.suggest_categories` (skor teks/jam/nominal/dompet/kebaruan) dicampur kamus kata kunci awal saat riwayat kosong; chip diurutkan ulang setelah nominal diketik dan dibekukan begitu disentuh; kategori tidak pernah dipilih otomatis. Parser nominal "35rb/35k/1,5jt" ada sejak M1.

### 9.2 Infra & keamanan
- **Deploy pull-based** (menggantikan self-hosted runner, menunggu konfirmasi pemilik): build, tes, SBOM, attestation di GitHub-hosted runner → GHCR; di VM, timer systemd menarik digest `main` terbaru dengan token GHCR read-only, memverifikasi attestation, **menolak digest lebih lama** dari yang berjalan, lalu `/opt/dompetku/bin/deploy` (kunci migrasi, preflight, migrasi, health, rollback otomatis).
- **Jaringan:** Postgres tanpa port host (network Docker `internal`). Satu pintu `gw` (Caddy) dengan mTLS di `10.0.1.68:8443` (app) dan `:9443` (metrik), hanya dari IP privat VM App. Header forward hanya dipercaya dari `gw`; `x-middleware-subrequest` dibuang.
- **Auth:** faktor kuat wajib — passkey ATAU password+TOTP; kode pemulihan wajib saat daftar; ditegakkan di `requireUser`/`withUser` (sesi `pending_2fa` ditolak, `amr` disimpan di sesi); reset password mencabut semua sesi dan tidak mematikan 2FA; undangan pasangan hash + sekali pakai; batas keras 2 user; respons login/reset seragam; rate limit + lockout bertahap.
- **Aplikasi:** origin check untuk `/api/*`; CSP nonce; `Cache-Control: no-store` untuk halaman berdata; cache data Next dilarang untuk data user; ruang aktif di URL (`/pribadi/…`, `/bersama/…`) dan setiap action menerima `spaceId` eksplisit.
- **Audit log** append-only (login, 2FA, ekspor, undangan, sesi dicabut, pindah ruang) + alert untuk anomali.
- **Backup:** WAL-G terenkripsi (kunci di password manager pemilik), bucket dengan retention lock, kredensial tanpa izin hapus, `archive_timeout=300`; uji restore mingguan via timer host + dead-man Healthchecks.io; latihan PITR bulanan. RPO ≤ 5 menit; RTO ≤ 1 jam (≤ 3 jam bila VM DB hilang sampai provisioning dilatih).
- **Rantai pasok & CI:** gitleaks, Semgrep OSS, osv-scanner, Trivy, actionlint + zizmor, pgTAP keamanan, Playwright keamanan; Actions dipatok SHA; lockfile + `pnpm` dengan `minimumReleaseAge` / Renovate 3 hari; patch critical ≤ 48 jam. Secrets per file (`chmod 600`), redaksi log (tanpa nominal/deskripsi).

### 9.3 Produk & UX
- **IA:** tab bar `Beranda · Transaksi · [Catat] · Dompet · Rencana` (Catat di slot tengah, bukan FAB); Rencana disembunyikan sampai ada isinya; Laporan = tampilan `Ringkasan` di tab Transaksi; "Menu" berlabel di header (Trip, Kategori, Kontak, Export, Analisis, Pengaturan). Segmen Transaksi: `Semua · Kantor · Talangan`.
- **Ruang:** pengalih `Pribadi | Bersama` di header, warna aksen per ruang selalu dengan label; sheet Catat menyebut ruang tujuan, dompet terbatas ke ruang itu, "Pindah ke Bersama/Pribadi" atomik; feed aktivitas Bersama dengan pelaku dan sebelum/sesudah.
- **Beranda:** "aman dipakai" per ruang (default sampai akhir bulan, tanggal gajian per orang opsional), tagihan mendatang, anggaran; net worth pindah ke Dompet. Tombol "Tidak ada pengeluaran hari ini".
- **Visual:** arah "buku kas" (kertas hangat, nila = Pribadi, bata = Bersama, angka tabular, garis total ganda, minus U+2212), ikon Phosphor, gerak minimal; serif untuk angka hero diuji di prototipe M0a. Token warna diganti mengikuti ukuran kontras di `docs/team/round1/ui-ux.md` (border ≥ 3:1 di `bg` dan `surface`; teks tombol primer dark ≥ 4,5:1).
- **Frontend:** Next 16 standalone, React 19, Node 24 LTS, pnpm workspaces, Tailwind v4, Radix, Zod + React Hook Form; **tanpa** TanStack Query; formatter uang & tanggal sendiri (deterministik server/klien); `client_id` dibuat sekali per sheet; optimistic UI + undo; budget JS diukur di Playwright.
- **AI:** Gemini tier berbayar (menunggu pemilik) di balik `LlmProvider` yang bisa diganti; kuota 15 parsing + 5 analisis per hari per user; tanya-bebas ditunda; catat tetap jalan saat kuota habis (parser aturan). Telegram long polling dari worker.
- **Metrik:** `product_events` tanpa nominal/deskripsi; north star % hari tercatat (Novanda ≥ 85%, Farida ≥ 60%), median waktu catat ≤ 8 dtk, ≥ 70% catatan ≤ 3 ketukan.

### 9.4 Milestone (menggantikan §6 dan `docs/v2/ROADMAP.md`)
| | Isi | Gerbang keluar |
|---|---|---|
| **M0a** | Repo, CI dasar, design system + token, **prototipe klik** (Beranda, Catat, Transaksi, Dompet, onboarding) dengan seed `demo-full` | Novanda **dan** Farida menilai prototipe; arah visual dipilih |
| **M0b** | Infra VM (Postgres terisolasi, `gw` mTLS, proxy VM App, DNS, backup + uji restore), deployer pull-based, auth (passkey/TOTP, kode pemulihan, undangan, batas 2 user), ruang, audit log, PWA installable | Restore teruji; login 2 akun dengan 2FA; isolasi ruang lulus pgTAP |
| **M1** | Dompet + saldo awal + cocokkan saldo, kategori + saran, catat cepat + parser nominal, transaksi edit/void/undo, transfer (termasuk `space_transfer`), talangan kantor, `dq_reconcile` | Novanda memakai 7 hari berturut-turut, selisih rekonsiliasi 0 |
| **M2** | Bersama penuh (setoran, feed, kontribusi), anggaran pribadi & bersama, laporan, Beranda "aman dipakai", tagihan rutin dasar, export CSV, worker, **review bulanan** (bulan lalu vs rencana, salin anggaran 1 ketukan) | Farida bergabung; kedua akun 7 hari berturut-turut |
| **M3** | Utang/piutang (termasuk utang berjalan tanpa efek kas), modal trading, **bagi tagihan Bersama** (pengeluaran Bersama dibayar dari dompet pribadi → saldo antar-anggota + pelunasan) | T6–T10 lulus |
| **M4** | Tujuan tabungan, aset & saham (harga server), net worth | T11 lulus |
| **M5** | Trip, tagihan rutin lanjutan, export PDF, **kalender arus kas** (proyeksi saldo per tanggal), **deteksi langganan** (pola berulang → saran tagihan rutin) | T14–T15 lulus |
| **M6** | Catat teks bebas (aturan + LLM), analisis AI, PWA offline-baca, **foto struk** (lampiran terenkripsi, tanpa OCR) | Eval set lulus target |
| **M7** | Stabilisasi & portofolio: arsip ekspor v1, screenshot otomatis 390/1280 light/dark dari data demo, matikan v1 | Pemilik menyetujui |
| **M8** | ~~Bot Telegram~~ — ditunda ke backlog (otomatisasi catat) | |

### 9.5 Jawaban pemilik (2026-10-30)
1. Akun OCI **Pay-As-You-Go** (tidak ada risiko reklamasi Always Free). Arsitektur CPU diverifikasi saat M0b (`uname -m`); image tetap multi-arch.
2. **Deploy pull-based disetujui** (§9.2).
3. Pemilik punya API **Gemini dan Claude**. Provider AI di balik `LlmProvider`; pilihan model per tugas ditentukan pemilik (lihat §9.6).
4. **Tidak memakai Telegram** → M8 diganti kanal catat alternatif (§9.6).
5. Privasi ruang Pribadi terhadap admin server **diterima** (tanpa enkripsi sisi klien); akses DB manual tercatat di audit log.
6. 2FA GitHub & OCI **sudah aktif**.

### 9.6 Kanal catat & AI

**Keputusan pemilik 2026-10-30: semua otomatisasi catat (email, WhatsApp, Telegram) DITUNDA ke backlog. M8 dikosongkan.** Model LLM untuk M6 diputuskan saat M6 (usulan: parser aturan → Haiku 5.5 dengan structured output + cek silang → eskalasi ke Opus 5.5; analisis bulanan Opus 5.5).

Catatan opsi (arsip):
- M1: catat cepat di PWA terpasang (ikon di layar utama, shortcut "Catat") + parser nominal.
- M6: kolom teks bebas + dikte suara dari keyboard ponsel (tanpa izin mikrofon di app) memakai parser aturan + LLM.
- M8 (pengganti Telegram), urutan rekomendasi: (a) **teruskan email notifikasi bank/e-wallet** ke alamat khusus → draf transaksi menunggu konfirmasi di app; (b) WhatsApp Cloud API resmi (Meta) dengan nomor khusus — pesan yang dikirim user dibalas gratis dalam jendela 24 jam, tetapi butuh Meta Business account dan nomor terpisah dari nomor pribadi; sandbox Twilio hanya untuk uji (sesi kedaluwarsa, butuh kode join) sehingga tidak cocok harian; library WhatsApp tidak resmi ditolak (risiko blokir nomor).
- Model LLM: default `claude-opus-5-5` (estimasi kasar ±$15/bln untuk ±40 panggilan/hari, termasuk token thinking) atau `claude-haiku-5-5` untuk parsing (±$0,4/bln) — dipilih pemilik; Gemini tetap bisa dipakai lewat provider yang sama.
