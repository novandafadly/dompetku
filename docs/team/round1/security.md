# Round 1 — Cybersecurity Engineer

Dasar: `docs/superpowers/specs/2026-10-29-dompetku-v2-design.md` (selanjutnya **SPEC**) revisi 2 termasuk §7a, `docs/v2/DESIGN.md`, `docs/v2/ROADMAP.md`, `docs/audit/03-security.md` (SEC-01..11), `docs/audit/SUMMARY.md`.

## 1. Ringkasan sikap

Desain sudah memilih pondasi yang benar: DB tidak terekspos, logika uang di fungsi Postgres, RLS + FK komposit, allowlist, passkey/TOTP. Risiko terbesar sekarang **bukan di aplikasi, tetapi di jalur deploy dan host**. Keputusan §7a menaruh GitHub self-hosted runner di VM yang juga menjalankan Postgres, web, dan worker. Artinya setiap kode yang dieksekusi runner (dependensi npm jahat, action pihak ketiga, workflow yang salah) berada satu langkah dari seluruh data keuangan dua orang. Saya minta runner diganti **deployer pull-based yang memverifikasi tanda tangan image** (atau, bila tetap runner, dikekang ketat; §2 R1, §4). Selain itu ada tiga celah desain yang harus ditutup sebelum M1: (1) RLS berbasis GUC `app.user_id` tidak melindungi dari SQL injection; (2) fungsi baca `SECURITY DEFINER` bisa melewati RLS; (3) transfer lintas ruang bisa membocorkan deskripsi entri pribadi. Hampir semua kontrol wajib jatuh di **M0**, karena auth, infra, dan CI dibangun di sana.

## 2. Rekomendasi (12)

### R1 — Ganti self-hosted runner di VM produksi dengan deployer pull-based bertanda tangan · **wajib** · M0
- **Isi:** CI (lint, test, build, scan) **hanya** di runner GitHub-hosted. Image di-push ke GHCR dan ditandatangani **cosign keyless** (OIDC GitHub, identitas workflow `release.yml` di `refs/heads/main`). Release menulis digest ke GitHub Release/tag. Di VM DB, `systemd` timer (mis. tiap 2 menit) menjalankan `/usr/local/sbin/dompetku-deploy`. Script ini root-owned, `chmod 0750`, dan bekerja berurutan:
  1. Baca digest release terbaru lewat token GitHub fine-grained read-only (`contents:read`, satu repo).
  2. Jalankan `cosign verify` dengan `--certificate-identity` dan `--certificate-oidc-issuer` yang dipatok.
  3. Jalankan container migrasi.
  4. Jalankan `docker compose up -d` dengan **digest**, bukan tag.
  5. Health check, lalu rollback ke digest sebelumnya bila gagal.
  6. Tulis status ke file yang di-scrape Prometheus dan kirim alert email bila gagal.
- **Alasan:** runner di VM = remote code execution by design. Token runner dan proses runner hidup permanen di host yang memegang DB. Kasus nyata 2025 (tj-actions/changed-files, kompromi `chalk`/`debug`, worm Shai-Hulud di npm) menunjukkan kode CI bisa dibajak tanpa kita menulis baris jahat. Pull-based: tidak ada kode dari GitHub yang dieksekusi di VM kecuali image yang lolos verifikasi tanda tangan; tidak ada inbound SSH; tidak ada kredensial GitHub bernilai tulis di VM.
- **Trade-off:** log deploy tidak di UI Actions (diganti status file + alert + `journalctl`); latensi deploy ≤ 2 menit; script perlu ditulis dan dites (±1 hari). Bila pemilik tetap memilih runner, kontrol minimum ada di §4-K1.

### R2 — Postgres hanya di network Docker internal, tanpa port host · **wajib** · M0
- **Isi:** karena web+worker kini di VM DB (SPEC §7a), Postgres **tidak perlu** `ports:` sama sekali. Taruh di network compose `dompetku_db` (`internal: true`) yang hanya diikuti `web`, `worker`, `migrate`, dan `backup-verify`. Hapus aturan OCI "5437 dari VM App" (SPEC §5.7). Web di-publish **hanya** ke `10.0.1.68:<port>`, bukan `0.0.0.0`. NSG OCI: port web hanya dari IP privat VM App. Tambahkan aturan `DOCKER-USER` iptables sebagai lapis kedua, karena Docker melewati `ufw`. `pg_hba`: `hostssl` + `scram-sha-256` hanya dari subnet network compose; `local` untuk superuser via `docker exec`.
- **Alasan:** anti-tujuan SPEC §2 "Database terbuka ke internet". Port host yang di-publish Docker adalah penyebab paling umum Postgres bocor walau firewall host terlihat menutupnya.
- **Tes:** `nmap -p- 10.0.1.68` dari VM App hanya menunjukkan 22 (bila perlu) dan port web; `ss -ltnp` di VM DB tidak menunjukkan 5432/5437 di interface host.

### R3 — TLS/terowongan terenkripsi antara proxy (VM App) dan web (VM DB) · **wajib** · M0
- **Isi:** lalu lintas proxy → web membawa cookie sesi dan data keuangan dalam plaintext di VCN. Pilih salah satu:
  - **WireGuard** point-to-point antar-VM (disarankan; juga bisa mengangkut scrape Prometheus dan `postgres_exporter`);
  - Caddy di VM DB sebagai sidecar TLS dengan CA internal dan **mTLS** (sertifikat klien dimiliki proxy VM App).

  Web hanya mempercayai `X-Forwarded-For`/`X-Forwarded-Proto`/`X-Forwarded-Host` dari IP terowongan proxy. Proxy **menghapus** header `x-middleware-subrequest` dan header `x-forwarded-*` yang datang dari klien.
- **Alasan:** VM App menjalankan app lain. Kompromi app tetangga = sniffing sesi DompetKu. Header forward yang dipercaya sembarangan merusak rate limit per IP dan origin check Server Actions (R6). Penghapusan `x-middleware-subrequest` menutup kelas bug CVE-2025-29927.

### R4 — Auth Better Auth: konfigurasi eksplisit, 2FA ditegakkan di server, pemulihan aman · **wajib** · M0
- **Isi:**
  - `emailAndPassword.disableSignUp = true`. Akun pemilik dibuat via CLI bootstrap (`dompetku-admin create-owner`) di VM, bukan halaman daftar. Pasangan hanya lewat undangan.
  - **Undangan:** token 256-bit, disimpan sebagai hash SHA-256, sekali pakai, kedaluwarsa 72 jam, terikat ke email yang ada di `AUTH_ALLOWED_EMAILS`. Hanya pemilik yang membuat undangan, dengan sesi *fresh*. Menerima undangan → wajib daftar passkey atau TOTP sebelum sesi penuh diterbitkan. Undangan bisa dicabut. Setelah dua akun ada, endpoint undangan menolak semua permintaan (batas keras 2 user di DB: trigger/constraint).
  - **2FA wajib:** sesi tanpa faktor kedua berstatus `pending_2fa`. `requireUser()` dan `withUser()` **menolak** status ini; jangan mengandalkan redirect middleware. Faktor yang diterima: passkey (WebAuthn, `rpID=dompet.novandafadly.com`, `userVerification: required`) atau TOTP. Kode cadangan 10 buah, di-hash, sekali pakai.
  - **Reset password:** token hash, kedaluwarsa 30 menit, sekali pakai. Reset **mencabut semua sesi**, **tidak** menonaktifkan 2FA, dan mengirim email notifikasi. Login berikutnya tetap meminta faktor kedua.
  - **Kehilangan semua faktor:** tidak ada pemulihan lewat email. Pemulihan hanya lewat kode cadangan atau CLI break-glass di VM (`dompetku-admin reset-2fa <email>`, tercatat di audit log + email ke kedua akun).
  - **Sesi:** cookie `__Host-` prefix, `HttpOnly; Secure; SameSite=Lax; Path=/`. Idle 7 hari, absolut 30 hari, rotasi token saat login dan elevasi. **Step-up** (re-auth ≤ 10 menit) untuk ekspor, ubah password/2FA, buat undangan, cabut sesi, tautkan Telegram, ubah keanggotaan ruang. Daftar perangkat menampilkan perkiraan UA, IP terakhir, waktu; tombol "Keluar dari semua perangkat lain".
  - **Brute force & enumeration:** rate limit bawaan Better Auth dengan `storage: "database"` (bukan memori; tahan restart), dan IP diambil dari header yang dipercaya (R3). Lockout bertahap per akun: 5 gagal → jeda 1 menit, 10 → 15 menit, 20 → kunci + email. TOTP maks 5 percobaan per tantangan. Respons login/reset **seragam** ("Jika email terdaftar, tautan dikirim"), dengan waktu respons disamakan (hash dummy untuk email tak dikenal). Kebijakan password: minimal 12 karakter + tolak daftar password umum lokal (cek HIBP k-anonymity = *sebaiknya*).
  - **Notifikasi email** untuk login dari perangkat baru, perubahan password/2FA/passkey, undangan diterima, ekspor.
  - **Waktu host:** `chrony` aktif di VM. TOTP bergantung pada jam host.
- **Alasan:** domain publik = login page terpapar internet 24/7. SEC-11 v1 tidak punya MFA/reset. Bug klasik 2FA: faktor kedua hanya ditegakkan di UI/middleware, atau reset password menonaktifkan 2FA.

### R5 — Otorisasi DB: tutup tiga celah desain RLS/DEFINER · **wajib** · M0 (kerangka), M1 (semua fungsi)
- **Isi:**
  1. **GUC bukan batas keamanan terhadap SQL injection.** Siapa pun yang bisa menjalankan SQL sebagai `dompetku_app` bisa `set_config('app.user_id', <id pasangan>)`. RLS di desain ini melindungi dari *lupa WHERE*, bukan dari injeksi. Karena itu:
     - lint melarang `sql.raw`, `sql.lit`, `sql.id` dengan input non-literal di Kysely (ESLint `no-restricted-syntax` + semgrep), kecuali di file yang di-allowlist dan direview;
     - `withUser` memakai `set_config(..., true)` (transaction-local) **di dalam** transaksi yang sama. Tes: koneksi pool yang dipakai ulang tanpa `withUser` → `app.current_user_id()` = NULL → 0 baris;
     - `app.current_user_id()` mengembalikan NULL bila GUC kosong/invalid, dan semua policy gagal tertutup.
     - *Nanti:* GUC bertanda tangan (HMAC user_id + txid dengan kunci di tabel yang hanya dibaca role fungsi) bila ingin bertahan terhadap injeksi.
  2. **Fungsi baca (laporan, `dashboard_summary`, `budget_actuals`, ekspor, ringkasan AI) = `SECURITY INVOKER`** agar RLS berlaku. Hanya fungsi **tulis** yang `SECURITY DEFINER`. Fungsi DEFINER dimiliki role `NOLOGIN` khusus (`dompetku_api`), bukan `dompetku_owner` dan bukan superuser, dengan `search_path = ''`, tanpa SQL dinamis (`EXECUTE`). Setiap fungsi memanggil `app.assert_member(space_id)` untuk **setiap** id yang diterima: akun, kategori, ruang tujuan.
  3. `ALTER DEFAULT PRIVILEGES ... REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC` di migrasi pertama. `EXECUTE` diberikan eksplisit ke `dompetku_app` hanya untuk `api.*`. Fungsi trigger di skema `private` tanpa EXECUTE (SEC-03).
  4. Kolom yang menentukan hak (`space_members.role`, batas user, `access`) tidak bisa ditulis `dompetku_app` kecuali via fungsi (SEC-05).
  5. `dompetku_app` tidak punya `CREATE` di skema mana pun, bukan pemilik tabel, `NOBYPASSRLS`, `NOSUPERUSER`. Migrasi berjalan dengan `dompetku_owner` di container `migrate` sekali jalan. Kredensial owner **tidak** di-mount ke web/worker.
- **Alasan:** SEC-01, SEC-03, SEC-04, SEC-05 semuanya berakar pada "fungsi/policy percaya terlalu banyak". DEFINER untuk laporan adalah jalur paling mungkin bocornya ruang Pribadi pasangan (anti-tujuan SPEC §2).

### R6 — Server Actions, Route Handlers, CSRF & origin · **wajib** · M0
- **Isi:**
  - Server Actions diperlakukan sebagai **endpoint publik**: ID action bisa ditemukan dari bundle. Setiap action wajib memanggil `requireUser()`, validasi Zod, lalu `withUser`. Lint/semgrep: setiap file `"use server"` mengekspor fungsi yang baris pertamanya memanggil `requireUser`/`requireFreshUser` (atau anotasi `// public-action: alasan`).
  - Pemeriksaan Origin bawaan Next (Origin vs Host/X-Forwarded-Host) hanya benar bila proxy meneruskan Host dengan benar (R3). `serverActions.allowedOrigins` dikosongkan atau berisi tepat `dompet.novandafadly.com`.
  - **Route Handlers (`app/api/*`) tidak dilindungi** origin check bawaan Next. Helper `assertSameOrigin(req)` wajib untuk semua metode non-GET. Pengecualian hanya untuk webhook Telegram (diverifikasi dengan secret token, R9) dan `/api/health` (GET, tanpa data).
  - Better Auth: `trustedOrigins = ["https://dompet.novandafadly.com"]`.
  - GET tidak pernah mengubah state.
- **Alasan:** SEC-02 v1 = route API tanpa auth karena matcher mengecualikan `api/`. Default di v2 harus "tertolak sampai dibuktikan".

### R7 — Header & CSP ketat, cache-control untuk data keuangan · **wajib** · M0
- **Isi:**
  - **CSP berbasis nonce** (middleware): `default-src 'self'; script-src 'self' 'nonce-…' 'strict-dynamic'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; upgrade-insecure-requests; report-to csp`.
  - `style-src 'unsafe-inline'` diterima karena Radix/Next menyuntik style inline. Risikonya rendah selama script ketat.
  - Header lain: `Strict-Transport-Security: max-age=63072000; includeSubDomains` (+ `preload` setelah 1 bulan stabil), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` minimal (`camera=(), microphone=(), geolocation=()`; `publickey-credentials-get=(self)` untuk passkey), `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-origin`.
  - Semua halaman/respons terautentikasi: `Cache-Control: private, no-store`.
  - **Service worker PWA (M6):** tidak meng-cache respons API/RSC yang berisi data keuangan kecuali daftar eksplisit untuk offline-baca. Cache dihapus saat logout, dan saat sesi 401.
  - Larang `dangerouslySetInnerHTML` (lint), kecuali untuk skrip nonce yang direview.
- **Alasan:** SEC-06 (tanpa header) dan SEC-09 (XSS di ekspor). CSP adalah jaring terakhir bila XSS lolos. Data keuangan di cache browser/proxy = kebocoran pada perangkat bersama.

### R8 — Rantai pasok: dependensi, image, GitHub Actions · **wajib** · M0
- **Isi:**
  - **npm/pnpm:** lockfile wajib; `pnpm install --frozen-lockfile` dengan `onlyBuiltDependencies` allowlist (skrip install lain tidak dijalankan), atau `npm ci --ignore-scripts` + rebuild eksplisit. Renovate dengan `minimumReleaseAge: "3 days"` untuk semua paket (menahan publikasi jahat yang biasanya ditarik dalam hitungan jam). Patch keamanan Next/React/Better Auth: SLA merge **≤ 48 jam** untuk critical/high. Contoh relevan: CVE-2025-29927 (middleware bypass) dan CVE-2025-55182 (RCE pada React Server Components, Des 2025). Jalankan `npm audit signatures`/provenance check di CI.
  - **Image:**
    - base dipatok **digest** (`node:22-bookworm-slim@sha256:…` atau distroless);
    - multi-stage, tanpa devDependencies, user non-root (`USER 10001`);
    - `read_only: true` + `tmpfs` untuk `/tmp` dan `.next/cache`;
    - `cap_drop: [ALL]`, `security_opt: [no-new-privileges:true]`, limit `mem_limit`/`cpus`/`pids_limit`;
    - SBOM (syft) dan scan Trivy/Grype; gagal pada critical yang ada perbaikannya;
    - cosign sign (R1). Image Postgres+WAL-G juga dipatok digest dan di-rebuild via Renovate.
  - **GitHub Actions:**
    - semua `uses:` dipatok **SHA commit penuh**, dengan komentar versi (Renovate memperbarui);
    - `permissions: {}` di level workflow, dibuka per job seminimal mungkin;
    - tanpa `pull_request_target` dan tanpa `workflow_run` yang memproses artefak tak tepercaya;
    - `persist-credentials: false` di checkout; tanpa interpolasi `${{ github.event.* }}` langsung ke `run:` (pakai env);
    - lint workflow dengan `actionlint` + `zizmor`;
    - environment `production` dengan reviewer wajib (pemilik) dan hanya branch `main`;
    - branch protection `main`: PR wajib, CI hijau, tanpa force push; tag rilis dilindungi.
- **Alasan:** SEC-10 (Next critical, tanpa Renovate/CI audit). Untuk app 2 user, penyerang paling realistis bukan orang yang menargetkan Novanda, tetapi malware massal di ekosistem npm/Actions.

### R9 — Kebocoran lewat log, ekspor, AI, Telegram, notifikasi · **wajib** (M0 log; M5 ekspor; M6 AI; M8 Telegram)
- **Isi:**
  - **Log:** pino `redact` untuk `req.headers.cookie`, `authorization`, `set-cookie`, `*.password`, `*.token`, `*.totp*`, `*.description`, `*.amount`, `*.email` (diganti `user_id`). Error yang di-log hanya kode + `digest`, tanpa payload. Postgres: `log_statement = 'none'`, `log_parameter_max_length_on_error = 0`, `log_min_error_statement = error` (teks statement berparameter tanpa nilai). Payload job pg-boss hanya id, tanpa deskripsi/nominal. Metrik Prometheus tanpa label ber-PII (bukan email, bukan nama dompet). Tes Vitest: snapshot log dari request fixture tidak mengandung nominal/deskripsi/email.
  - **Ekspor (M5):** per ruang yang user menjadi anggotanya, lewat fungsi INVOKER (R5). Membutuhkan step-up, rate limit 10/jam, dicatat di audit log, dan memicu email notifikasi. File dibuat on-the-fly, tidak disimpan di disk/objek. Nama file tanpa nama orang. CSV: sel yang diawali `= + - @ \t \r` di-prefix `'` (SEC-09). PDF dirender server dengan escaping. Tidak ada `document.write` atau `window.open('')` di origin app.
  - **AI (M6):** hanya agregat dari **ruang aktif** yang dikirim. Tidak ada deskripsi mentah, nama kontak, atau nama dompet. Prompt template ada di server, dan input bebas dibatasi 500 karakter. Kunci dikirim via header `x-goog-api-key` (SEC-02). Keluaran divalidasi Zod dan dirender sebagai teks, tidak pernah HTML/markdown mentah. Kuota `ai_usage` 20/hari/user. Parser teks bebas (SPEC §5.6) hanya mengirim teks yang diketik. **Gunakan tier berbayar Gemini API**: pada tier gratis Google dapat memakai konten untuk perbaikan produk. Bila tetap tier gratis, nyatakan di halaman privasi dan dapatkan persetujuan Farida.
  - **Telegram (M8):**
    - webhook diverifikasi lewat header `X-Telegram-Bot-Api-Secret-Token` (bandingkan konstan-waktu); token bot di secret file;
    - penautan dengan kode sekali pakai 8+ karakter, kedaluwarsa 10 menit, dibuat dengan step-up; `chat_id` diikat ke user;
    - tolak chat grup/channel; perintah `/putus` + cabut dari UI;
    - balasan bot **tidak** memuat saldo/ringkasan secara default, karena pesan Telegram bot tidak E2E;
    - entri dari Telegram masuk ruang Pribadi kecuali pengguna menyebut "bersama", dan tetap lewat pratinjau + konfirmasi;
    - rate limit per chat.
  - **Email notifikasi:** tanpa nominal/deskripsi; cukup "Ada login baru dari …".
- **Alasan:** anti-tujuan SPEC §2 "Data pribadi pasangan bisa terlihat lewat jalur apa pun (laporan, ekspor, AI, log)".

### R10 — Secrets & backup terenkripsi tahan-hapus · **wajib** · M0
- **Isi:**
  - **Inventaris secret:** `BETTER_AUTH_SECRET`, password per role DB (owner, app, readonly, api tidak login), SMTP key, Gemini key, Telegram token + webhook secret, kredensial WAL-G, kunci enkripsi backup, token GHCR read-only, token GitHub read-only deployer.
  - **Penyimpanan:** di VM, `/etc/dompetku/secrets/<nama>` milik root, `0400`, di-mount sebagai **Docker secrets/file** per service. Bukan env global, dan setiap service hanya menerima yang dibutuhkan; worker tidak menerima SMTP bila tidak mengirim email. Validasi Zod saat start; gagal → container tidak jalan. Salinan master di password manager pemilik. Di GitHub hanya secret CI yang memang perlu; deploy pull-based tidak butuh secret produksi di GitHub. `.env.example` tanpa nilai (SEC-08). Gitleaks di pre-commit + CI.
  - **Rotasi:** tahunan, dan segera saat insiden; prosedur tertulis per secret di runbook. Rotasi `BETTER_AUTH_SECRET` mencabut semua sesi.
  - **Backup:** WAL-G dengan enkripsi sisi klien (libsodium atau PGP). Bucket OCI terpisah dengan **retention rule** (mis. 30 hari, locked) agar objek tidak bisa dihapus/ditimpa. Kredensial Customer Secret Key milik user IAM yang kebijakannya hanya `OBJECT_CREATE`/`OBJECT_READ`/`OBJECT_INSPECT`, **tanpa** `OBJECT_DELETE`. Penghapusan retensi dijalankan oleh kredensial terpisah milik pemilik atau oleh lifecycle policy bucket.
  - **Kunci enkripsi backup:** ada di VM (dibutuhkan `backup_verify`) **dan** password manager pemilik. Cek sidik jari kunci tiap kuartal (SPEC §7a).
  - **Uji pemulihan:** restore uji dari **mesin lain** (laptop pemilik) tiap 6 bulan untuk membuktikan kunci cadangan benar-benar bisa dipakai.
- **Alasan:** backup tanpa retention lock bisa dihapus penyerang yang menguasai VM (skenario ransomware). Kunci yang hanya ada di VM = backup tak terpulihkan bila VM hilang.

### R11 — Hardening VM & Docker, isolasi dari app tetangga · **wajib** · M0
- **Isi:**
  - **SSH:** key-only (ed25519), `PermitRootLogin no`, `PasswordAuthentication no`, `AllowUsers` eksplisit. VM DB tanpa IP publik (sudah). SSH ke VM DB hanya via OCI Bastion atau dari VM App. Pertimbangkan menutup port 22 publik VM App dan memakai OCI Bastion.
  - **Patch:** `unattended-upgrades` keamanan + reboot terjadwal (jendela malam WIB); `chrony`; `auditd` untuk `/etc/dompetku`, `docker.sock`, `sudoers`; `fail2ban` sshd di VM App. Dashboard OCI: aktifkan MFA akun Oracle Cloud pemilik + akun GitHub pemilik dan Farida (2FA wajib), karena akun cloud/GitHub adalah kunci kerajaan.
  - **Docker:** compose project `dompetku` dengan network sendiri, tidak berbagi network/volume dengan app lain atau Redis tetangga. Tidak ada container yang me-mount `docker.sock`. Hanya root dan deployer yang ada di grup `docker` (**grup docker = root**). Log driver `json-file` `max-size: 10m, max-file: 5`. Limit CPU/RAM/PIDs per container. Volume data Postgres `0700`. Cek `daemon.json`: `"no-new-privileges": true`, `"live-restore": true`. *Nanti:* `userns-remap`.
  - **Postgres config:** `ssl = on` (tetap, walau hanya internal), `password_encryption = scram-sha-256`, `shared_preload_libraries` minimal, tanpa ekstensi `untrusted` (`plpython3u`, `adminpack`). Role app `CONNECTION LIMIT` dan `statement_timeout` 15 s, `idle_in_transaction_session_timeout` 30 s (mitigasi DoS kunci).
  - **Proxy VM App:** bila memakai Caddy, rate limit butuh modul `caddy-ratelimit` (build kustom, `xcaddy`). Alternatifnya rate limit di Better Auth + aplikasi dan `fail2ban` pada log proxy. Tetapkan batas body (mis. 1 MB) dan timeout header. Hanya TLS 1.2+. OCSP stapling bawaan Caddy.
- **Alasan:** SPEC §3 menyebut VM App sesak dan berbagi app lain. Kompromi tetangga adalah jalur lateral paling mungkin. Insiden `:5435` di riwayat ops menunjukkan isolasi compose belum disiplin.

### R12 — Audit log, deteksi, respons insiden, dan gerbang keamanan CI · **wajib** (M0), sebagian **sebaiknya**
- **Isi:**
  - **Audit log** `audit.events` (append-only): `dompetku_app` hanya `INSERT` via fungsi `audit.log()`; trigger menolak UPDATE/DELETE; retensi 1 tahun. Kolom: waktu, `user_id`, `event`, `ip` (dari header tepercaya), UA ringkas, `space_id`, metadata tanpa nominal.
    - Event wajib: `login_success`, `login_failed`, `2fa_*`, `passkey_*`, `password_*`, `session_revoked`, `invite_*`, `export`, `telegram_link`, `space_member_change`, `admin_cli_*`, `deploy`.
    - Halaman "Aktivitas keamanan" per user menampilkan event miliknya sendiri.
    - *Nanti:* hash chain anti-tamper.
  - **Alert** (email; Telegram setelah M8): ≥ 10 login gagal/jam, login dari negara baru (*sebaiknya*, GeoIP lokal), 2FA dinonaktifkan/di-reset, ekspor, deploy gagal/sukses, verifikasi tanda tangan gagal, perubahan `/etc/dompetku` (auditd), backup/backup_verify gagal, sertifikat < 14 hari.
  - **Rencana respons insiden:** `infra/runbooks/incident.md`, dites tabletop 1× sebelum cutover. Skenario minimum:
    - HP hilang: cabut sesi + passkey dari perangkat lain atau CLI;
    - secret bocor: rotasi per secret;
    - akun diambil alih: `dompetku-admin lock-user`, cabut sesi, reset 2FA, tinjau audit log;
    - VM terkompromi: matikan web (`maintenance` di proxy), snapshot disk untuk forensik, bangun VM baru dari runbook, restore PITR ke titik sebelum kompromi, rotasi **semua** secret, tinjau audit log;
    - dependensi jahat: pin versi, rebuild, cek SBOM image yang ter-deploy.

    Kontak: pemilik (primer), Farida (diberi tahu untuk setiap insiden yang menyentuh datanya).
  - **CI security gate** (gagal = merge diblok): gitleaks, semgrep (`p/typescript`, `p/nextjs`, `p/secrets` + aturan kustom R5/R6/R7), `osv-scanner` + `npm audit --omit=dev --audit-level=high`, `actionlint` + `zizmor`, Trivy (image + `config` untuk Dockerfile/compose), pgTAP keamanan (§5), Playwright keamanan (header, 401/403, CSRF, enumeration), cek kysely-codegen tidak usang.
    - CodeQL untuk repo private butuh GitHub Advanced Security berbayar, jadi semgrep OSS jadi pengganti.
    - Secret scanning bawaan GitHub untuk repo private juga berbayar, jadi gitleaks jadi pengganti.
    - Jadwal mingguan: scan ulang image yang sedang berjalan (digest produksi) terhadap DB CVE terbaru.
- **Alasan:** v1 punya 0 CI dan cron gagal 2.090× tanpa ada yang tahu (SUMMARY §1). Kontrol tanpa deteksi = kita tidak tahu kapan kontrol gagal.

## 3. Risiko utama + mitigasi (model ancaman STRIDE)

Aset: data transaksi dua orang, kerahasiaan ruang Pribadi masing-masing terhadap pasangan, integritas saldo, ketersediaan harian, kredensial cloud/GitHub.
Aktor: (a) penyerang internet oportunis/bot; (b) malware rantai pasok; (c) pencuri perangkat/sesi; (d) app tetangga di VM yang terkompromi; (e) pasangan yang penasaran. Aktor (e) bukan musuh, tetapi kebutuhan privasi antar-ruang adalah tujuan produk.

| # | STRIDE | Ancaman | Kemungkinan / Dampak | Mitigasi (rujukan) |
|---|---|---|---|---|
| T1 | E, T | Kode CI jahat (npm/action) berjalan di runner VM DB → baca/ubah DB, curi secret | sedang / kritis | R1 (pull-based + cosign), R8 |
| T2 | S | Credential stuffing / brute force login & TOTP di domain publik | tinggi / tinggi | R4 (rate limit DB, lockout, 2FA wajib, notifikasi) |
| T3 | I | Enumeration email via login/reset/undangan | tinggi / rendah | R4 (respons & waktu seragam) |
| T4 | S, E | 2FA hanya di middleware → bypass via Server Action/route langsung atau bug middleware (CVE-2025-29927) | sedang / kritis | R4 (`pending_2fa` ditolak di `requireUser`), R3 (strip header), R6 |
| T5 | S | Reset password jadi pintu belakang (menonaktifkan 2FA, token bocor di log) | sedang / tinggi | R4 (reset ≠ disable 2FA, token hash 30 menit), R9 (redact) |
| T6 | S | Undangan dicegat/dipakai ulang → orang ketiga jadi anggota Bersama | rendah / tinggi | R4 (hash, sekali pakai, terikat email, batas 2 user di DB) |
| T7 | I | Fungsi laporan/ekspor/AI DEFINER membaca ruang Pribadi pasangan | sedang / tinggi | R5-2 (INVOKER untuk baca), pgTAP 2 user (§5) |
| T8 | I | Transfer lintas ruang membocorkan deskripsi/nama dompet pribadi ke Bersama | tinggi / sedang | §4-K3, view proyeksi aman |
| T9 | E | SQL injection → `set_config('app.user_id', …)` → baca semua | rendah / kritis | R5-1 (larang `sql.raw`, semgrep), parameterisasi Kysely |
| T10 | T | ID asing di argumen fungsi (SEC-01 pola v1) | sedang / tinggi | FK komposit `(space_id, id)`, `assert_member` per id, pgTAP |
| T11 | T | CSRF ke Server Action / route handler | rendah / tinggi | R6 (origin check, `SameSite=Lax`, Host benar di proxy) |
| T12 | I | XSS (deskripsi, nama kategori, ekspor, keluaran AI) → curi data | sedang / tinggi | Escaping React, larang `dangerouslySetInnerHTML`, CSP nonce (R7), ekspor aman (R9) |
| T13 | I | Sniffing proxy→web di VCN oleh tetangga terkompromi | rendah / tinggi | R3 (WireGuard/mTLS) |
| T14 | I | Postgres terekspos (port Docker melewati firewall) | sedang / kritis | R2 |
| T15 | I | Data keuangan di log, metrik, pg-boss, Postgres log, email | tinggi / sedang | R9 (redact + tes) |
| T16 | I | AI provider menyimpan/melatih data; prompt injection via teks user | sedang / sedang | R9 (agregat saja, tier berbayar, Zod, render teks) |
| T17 | S, I | Webhook Telegram dipalsukan; chat_id dibajak; saldo terkirim ke Telegram | sedang / sedang | R9 (secret header, kode tautan, tanpa saldo default) |
| T18 | D | Flood login/AI/ekspor; query berat mengunci DB; VM tetangga makan CPU | sedang / sedang | Rate limit (R4, R9), `statement_timeout`, limit container (R11) |
| T19 | R | Tidak bisa membuktikan siapa mengubah entri Bersama / siapa mengekspor | sedang / sedang | `entry_history` + `audit.events` append-only (R12) |
| T20 | T, D | Backup dihapus/dienkripsi penyerang; kunci backup hilang | rendah / kritis | R10 (retention lock, kredensial tanpa delete, kunci ganda, restore dari mesin lain) |
| T21 | E | Kompromi akun GitHub/OCI pemilik → push image/ubah infra | rendah / kritis | 2FA hardware/passkey di GitHub & OCI (R11), branch protection + environment reviewer (R8), cosign identitas workflow |
| T22 | I | Perangkat bersama: cache PWA/ browser menyimpan data setelah logout | sedang / sedang | `no-store`, SW cache allowlist + hapus saat logout (R7) |
| T23 | E | Container escape / kontainer root / docker.sock | rendah / kritis | Non-root, read-only, cap_drop, tanpa socket (R8, R11) |

## 4. Ketidaksetujuan dengan desain saat ini

**K1 — Self-hosted runner di VM DB (SPEC §7a).** Saya tidak setuju. Usulan: deployer pull-based (R1).

| Opsi | Keamanan | Ops | Catatan |
|---|---|---|---|
| A. Runner persisten di VM DB (desain) | Buruk: RCE by design di host DB | Mudah, log di Actions | Tidak disarankan |
| **B. Pull-based + cosign (usulan)** | Baik: hanya image bertanda tangan yang dijalankan; tanpa inbound | Sedang (script + timer) | Disarankan |
| C. GitHub-hosted + SSH via OCI Bastion/VM App | Sedang: kunci SSH deploy di GitHub; perlu jalur SSH ke VM DB | Sedang | Kunci SSH = akses shell bila tidak dikekang `command=` di `authorized_keys` |
| D. Runner di VM kecil terpisah, deploy via SSH `command=` terbatas | Sedang-baik | Butuh VM ketiga (OCI free tier Ampere memungkinkan) | Alternatif bila pemilik ingin UI Actions |

Bila pemilik tetap memilih A, kontrol **minimum** berikut wajib:
- runner hanya untuk job `deploy` (`runs-on: [self-hosted, dompetku-deploy]`), dan tidak pernah menjalankan `npm install`/build/test;
- runner `--ephemeral` dengan service wrapper yang mendaftar ulang;
- user `ghrunner` **tidak** di grup `docker`; satu-satunya hak sudo adalah `NOPASSWD: /usr/local/sbin/dompetku-deploy` dengan argumen digest yang divalidasi regex `^sha256:[a-f0-9]{64}$`, dan script tetap menjalankan `cosign verify`;
- environment `production` dengan reviewer wajib;
- repo private dengan "Require approval for all external contributors";
- runner tidak membaca `/etc/dompetku/secrets`.

**K2 — Aturan OCI "5437 dari VM App" dan Postgres di IP privat (SPEC §5.7, §7a).** Sejak web+worker pindah ke VM DB, Postgres tidak perlu didengar di IP host sama sekali (R2). Setiap port yang tidak perlu adalah permukaan serangan.

**K3 — Transfer lintas ruang: header milik ruang sumber (SPEC §7a).** Dengan RLS per `space_id`, anggota Bersama tidak bisa membaca header entri, karena header ada di ruang Pribadi A. Tim akan tergoda menyelesaikannya dengan fungsi DEFINER yang membaca header, dan itulah jalur bocornya deskripsi/nama dompet pribadi. Usulan:
- line di ruang tujuan dibaca lewat view `security_invoker` yang memproyeksikan hanya `occurred_on`, `amount`, `created_by` (nama), dan label tetap ("Setoran dari Novanda");
- deskripsi entri lintas ruang disimpan terpisah: `shared_note` untuk sisi Bersama, opsional, diisi eksplisit;
- pgTAP: B tidak pernah melihat `description`, `account_id` sumber, atau nama dompet A.

Arsitek DB perlu memutuskan bentuknya. Saya hanya menuntut kriteria §5-C8.

**K4 — Fungsi baca `SECURITY DEFINER` (SPEC §5.2: "Fungsi `api.*` SECURITY DEFINER").** Semua fungsi tulis memang perlu DEFINER, tetapi fungsi baca harus INVOKER (R5-2). Satu kalimat di SPEC §5.2 perlu diubah.

**K5 — Middleware "menyegarkan sesi & redirect" (SPEC §5.3).** Setuju, dengan catatan: penegakan 2FA wajib berada di `requireUser()`/`withUser()`, bukan middleware (T4).

**K6 — CSP di SPEC §5.7 tidak menyebut `style-src`.** Saya menerima `'unsafe-inline'` untuk style (R7) dan mencatatnya sebagai ADR, agar tidak ada yang melonggarkan `script-src` untuk "memperbaiki" error CSP.

## 5. Kriteria penerimaan (bisa dicek/dites)

**M0 (sebelum login pertama di domain publik):**
- C1: `nmap` dari internet ke IP publik VM App hanya membuka 80/443 (dan 22 bila belum dipindah ke Bastion). Dari VM App ke VM DB: hanya port web via terowongan (+22 bila perlu). Di VM DB, `ss -ltnp` tidak menampilkan Postgres di interface host.
- C2: `curl -I https://dompet.novandafadly.com/masuk` menampilkan semua header R7. Skor securityheaders.com A+ (dicek manual sekali), dan Playwright memverifikasi daftar header.
- C3: Playwright: setiap route di `app/(app)` dan setiap Server Action dalam manifest menghasilkan 401/redirect tanpa sesi. Hasil yang sama dengan sesi `pending_2fa`.
- C4: Playwright: POST ke Server Action dan `/api/*` dengan `Origin: https://evil.example` → 403.
- C5: Tes enumeration: login dan reset untuk email terdaftar vs tidak terdaftar menghasilkan status + body identik, dan selisih median waktu < 50 ms (100 sampel).
- C6: Tes brute force: login gagal ke-6 dalam 1 menit → 429. Lockout tetap berlaku setelah restart container (storage DB). TOTP salah ke-6 → tantangan batal.
- C7: Undangan: dipakai 2× → gagal; kedaluwarsa → gagal; email di luar allowlist → gagal; user ke-3 → gagal di level DB.
- C8: pgTAP keamanan (CI):
  - setiap tabel non-sistem punya `relrowsecurity` dan `relforcerowsecurity`;
  - tidak ada fungsi dengan `EXECUTE` untuk `PUBLIC`;
  - setiap fungsi `SECURITY DEFINER` punya `proconfig` berisi `search_path=` kosong dan pemilik `dompetku_api`;
  - fungsi baca bersifat INVOKER;
  - `dompetku_app` tidak punya `INSERT/UPDATE/DELETE` pada tabel ledger;
  - tanpa `app.user_id` semua tabel domain mengembalikan 0 baris;
  - matriks 2 user × setiap tabel × setiap operasi × setiap fungsi `api.*` dengan id milik ruang Pribadi lawan → ditolak atau 0 baris;
  - entri lintas ruang tidak mengekspos `description`/akun sumber ke anggota tujuan.
- C9: Reset password mencabut semua sesi aktif (tes integrasi) dan login berikutnya meminta faktor kedua.
- C10: Tes log: request fixture yang mengandung nominal/deskripsi/email/cookie → output log tidak mengandung nilai tersebut.
- C11: CI gate R12 aktif dan memblok merge. Semua `uses:` berupa SHA 40 karakter (cek `zizmor`/skrip). `permissions` default kosong.
- C12: Image: `docker inspect` → `User` bukan root, `ReadonlyRootfs=true`, `CapDrop=[ALL]`, `SecurityOpt` berisi `no-new-privileges`. Trivy 0 critical yang punya perbaikan.
- C13: Deploy menolak image tanpa tanda tangan atau dengan identitas salah (tes negatif dijalankan sekali dan dicatat di runbook). Rollback otomatis terbukti dengan health check gagal yang disengaja.
- C14: Backup: restore PITR ke container sementara lulus pgTAP rekonsiliasi (mingguan, otomatis). Upaya `DELETE` objek dengan kredensial WAL-G → ditolak OCI. Restore dari laptop pemilik dengan kunci dari password manager berhasil (sekali sebelum cutover).
- C15: Audit log: setiap event wajib R12 muncul setelah aksi terkait (tes integrasi). `UPDATE`/`DELETE` pada `audit.events` sebagai `dompetku_app` → error.
- C16: Runbook insiden ada, dan tabletop "HP hilang" + "secret bocor" dijalankan sekali dengan hasil dicatat.

**M5:** C17: CSV dengan deskripsi `=HYPERLINK(...)` diekspor sebagai `'=HYPERLINK(...)`. PDF dengan deskripsi `<img src=x onerror=alert(1)>` tampil sebagai teks. Ekspor tanpa step-up → ditolak.
**M6:** C18: endpoint AI tanpa sesi → 401, kuota habis → 429. Payload ke provider (provider palsu di tes) tidak mengandung deskripsi/nama dompet/nama kontak dan hanya memuat ruang aktif. Cache SW dibersihkan setelah logout (Playwright).
**M8:** C19: webhook tanpa/dengan secret salah → 401. Kode tautan dipakai ulang/kedaluwarsa → gagal. Pesan dari grup → diabaikan. Balasan bot tidak memuat saldo kecuali diminta eksplisit.

### Daftar kontrol (prioritas × milestone)

| ID | Kontrol | Prioritas | Milestone | Pemilik usulan |
|---|---|---|---|---|
| K-01 | Deployer pull-based + cosign verify (atau runner terkekang §4-K1) | wajib | M0 | DevOps |
| K-02 | Postgres tanpa port host, network internal, NSG + DOCKER-USER | wajib | M0 | DevOps |
| K-03 | WireGuard/mTLS proxy→web, trusted proxy headers, strip `x-middleware-subrequest` | wajib | M0 | DevOps |
| K-04 | Better Auth: signup off, undangan aman, 2FA ditegakkan server, sesi `__Host-`, step-up | wajib | M0 | Backend |
| K-05 | Rate limit DB-backed + lockout bertahap + respons seragam | wajib | M0 | Backend |
| K-06 | Reset password aman + break-glass CLI + kode cadangan | wajib | M0 | Backend |
| K-07 | RLS FORCE, INVOKER untuk baca, DEFINER milik `dompetku_api`, REVOKE PUBLIC, `assert_member` | wajib | M0–M1 | DB |
| K-08 | Larangan `sql.raw`/`dangerouslySetInnerHTML`, action wajib `requireUser` (semgrep/ESLint) | wajib | M0 | Backend |
| K-09 | Origin check route handler + `trustedOrigins` + `allowedOrigins` | wajib | M0 | Backend |
| K-10 | CSP nonce + header + `no-store` | wajib | M0 | Frontend |
| K-11 | Lockfile, `onlyBuiltDependencies`, Renovate `minimumReleaseAge`, SLA patch 48 jam | wajib | M0 | DevOps |
| K-12 | Image non-root/read-only/cap_drop, base digest, SBOM, Trivy, cosign | wajib | M0 | DevOps |
| K-13 | Actions pin SHA, `permissions: {}`, actionlint+zizmor, env protection, branch protection | wajib | M0 | DevOps |
| K-14 | Secrets sebagai file per service, `.env.example` kosong, gitleaks | wajib | M0 | DevOps |
| K-15 | Backup terenkripsi + retention lock + kredensial tanpa delete + restore dari mesin lain | wajib | M0 | DevOps |
| K-16 | Hardening VM: SSH, Bastion, unattended-upgrades, chrony, auditd, MFA akun OCI/GitHub | wajib | M0 | DevOps/Pemilik |
| K-17 | Redaksi log + Postgres log config + tes log | wajib | M0 | Backend |
| K-18 | Audit log append-only + halaman aktivitas keamanan | wajib | M0 (tabel), M2 (halaman) | Backend/Frontend |
| K-19 | Alert keamanan (login gagal, 2FA, ekspor, deploy, backup) | wajib | M0 | DevOps |
| K-20 | CI security gate (semgrep, osv, gitleaks, Trivy, pgTAP keamanan, Playwright keamanan) | wajib | M0 | QA/DevOps |
| K-21 | Proyeksi aman entri lintas ruang + pgTAP | wajib | M1 | DB |
| K-22 | Runbook respons insiden + tabletop | wajib | sebelum cutover (M7) | Pemilik/DevOps |
| K-23 | Ekspor: INVOKER, step-up, CSV aman formula, PDF server, audit + notifikasi | wajib | M5 | Backend |
| K-24 | AI: agregat ruang aktif, tier berbayar, Zod, kuota, header kunci | wajib | M6 | Backend |
| K-25 | PWA: cache allowlist, hapus saat logout | wajib | M6 | Frontend |
| K-26 | Telegram: secret header, kode tautan, tanpa saldo default, tolak grup | wajib | M8 | Backend |
| K-27 | Notifikasi email login baru/perubahan keamanan | sebaiknya | M0 | Backend |
| K-28 | Cek password bocor (HIBP k-anonymity) | sebaiknya | M0 | Backend |
| K-29 | Alert login negara baru (GeoIP lokal) | sebaiknya | M2 | DevOps |
| K-30 | HSTS preload | sebaiknya | M1 (setelah 1 bulan stabil) | DevOps |
| K-31 | GUC `app.user_id` bertanda tangan HMAC | nanti | — | DB |
| K-32 | Hash chain audit log; Docker `userns-remap`; pentest eksternal sebelum portofolio publik | nanti | — | — |

### Pemetaan temuan audit v1 → kontrol v2 (agar tidak terulang)

| Audit | Kontrol v2 | Bukti/tes |
|---|---|---|
| SEC-01 RLS UPDATE tanpa cek FK | FK komposit `space_id`, ledger tanpa tulis langsung, `assert_member` (K-07) | C8 |
| SEC-02 API AI tanpa auth/rate limit | Default-deny route, `requireUser`, kuota, header kunci (K-08, K-09, K-24) | C3, C18 |
| SEC-03 DEFINER executable publik, search_path | REVOKE PUBLIC default, `search_path=''`, skema `private` (K-07) | C8 |
| SEC-04 Guard berbasis GUC | Saldo = view, tanpa kolom saldo; GUC hanya identitas, bukan izin (K-07, K-31) | C8 |
| SEC-05 User ubah kolom hak | Kolom hak hanya via fungsi (K-07) | C8 |
| SEC-06 Middleware jadi sumber auth, tanpa header | `requireUser` server, 2FA di server, header (K-04, K-10) | C2, C3 |
| SEC-07 Proxy CORS publik untuk harga | Harga via worker server, validasi, `connect-src 'self'` (K-10) | C2 + tes validator harga M4 |
| SEC-08 Secret/identitas di repo | `.env.example` kosong, gitleaks, migrasi tanpa email literal (K-14) | C11 |
| SEC-09 XSS & formula injection ekspor | K-23 | C17 |
| SEC-10 Dependensi usang tanpa CI | K-11, K-13, K-20 | C11 |
| SEC-11 Tanpa MFA/reset, leaked password off | K-04, K-06, K-28 | C6, C9 |
| Cron gagal 2.090× tanpa alert | K-19, `job_runs` + alert | C14 |

## 6. Pertanyaan / permintaan untuk peran lain

- **Pemilik (Novanda):**
  - (1) Setujui penggantian runner dengan deployer pull-based (§4-K1), atau pilih D bila ingin UI Actions.
  - (2) Konfirmasi tier berbayar Gemini, atau persetujuan Farida untuk tier gratis.
  - (3) Aktifkan 2FA (passkey/kunci hardware) di akun GitHub dan Oracle Cloud sekarang, sebelum M0.
  - (4) Simpan kunci backup + kode cadangan 2FA di password manager. Siapa kontak kedua bila pemilik tidak bisa dihubungi?
- **DevOps/SRE:**
  - Siapkan WireGuard VM App↔VM DB dan pastikan Prometheus/GlitchTip ikut lewat terowongan.
  - Konfirmasi apakah reverse proxy yang sudah ada di VM App mendukung rate limit dan penghapusan header. Bila Caddy, perlu build `xcaddy` + `caddy-ratelimit`.
  - Cek arsitektur CPU agar cosign/WAL-G multi-arch tersedia.
  - Tulis `dompetku-deploy` + tes negatif tanda tangan.
- **Arsitek DB:**
  - Putuskan bentuk proyeksi entri lintas ruang (K3).
  - Pisahkan fungsi baca (INVOKER) vs tulis (DEFINER).
  - Buat role `dompetku_api` NOLOGIN sebagai pemilik fungsi.
  - Tambahkan batas keras 2 user/2 anggota Bersama.
  - Tetapkan `statement_timeout` per role.
- **Backend:**
  - Implementasikan `requireUser`/`requireFreshUser`/`withUser` sebagai satu-satunya pintu.
  - Definisikan kode error yang tidak membocorkan keberadaan id lintas ruang. "Tidak ditemukan" dan "bukan milikmu" harus identik.
  - Konfigurasi Better Auth sesuai R4 dan catat versi + opsi di ADR.
- **Frontend/UX:**
  - Desain layar step-up (re-auth) dan layar "Aktivitas keamanan" + "Perangkat aktif".
  - Pesan login/reset yang seragam (tidak menyebut "email tidak terdaftar").
  - Onboarding pasangan yang memaksa passkey/TOTP sebelum masuk.
- **QA:** masukkan C1–C19 ke rencana tes. Suite Playwright `security.spec.ts` (header, 401, CSRF, enumeration, rate limit) wajib di CI sejak M0.
- **Product/PM:** konfirmasi kebijakan privasi singkat untuk dua pengguna: apa yang dikirim ke Gemini, Telegram, dan penyedia email; retensi audit log 1 tahun; Farida bisa melihat log aktivitas Bersama.
