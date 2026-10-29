# Round 1 — DevOps / SRE

Penulis: peran DevOps/SRE · 2026-10-29 · Dasar: `docs/superpowers/specs/2026-10-29-dompetku-v2-design.md` (selanjutnya **spec**) §3, §5, §5.7, §7a; `docs/v2/ROADMAP.md`; `docs/audit/SUMMARY.md`, `docs/audit/03-security.md`.
Semua angka infra (CPU, RAM, disk, port, isi VM) berasal dari snapshot 2026-09-10 dan **wajib diukur ulang** di langkah 0 runbook (Lampiran H) sebelum angka di dokumen ini dipakai.

---

## 1. Ringkasan sikap

Arsitektur spec §7a (web + worker + Postgres DompetKu di VM DB, proxy TLS di VM App, deploy via self-hosted runner) masuk akal untuk dua pengguna, asalkan tiga celah ditutup sejak M0.
Pertama, hop VM App → VM DB sekarang membawa cookie sesi dan data keuangan lintas VCN, jadi hop itu yang harus terenkripsi (mTLS), sedangkan Postgres tidak perlu lagi dibuka ke jaringan sama sekali (port 5437 di spec §5.7 jadi tidak perlu).
Kedua, self-hosted runner di host yang sama dengan Postgres adalah jalur eksekusi kode paling berbahaya: user runner **tidak boleh** masuk grup `docker` (setara root), hanya boleh memanggil satu skrip deploy lewat `sudo`, dan skrip itu hanya menerima image yang attestation-nya dibuat workflow rilis di `main`.
Ketiga, backup baru berarti kalau restore-nya teruji: restore otomatis mingguan + latihan PITR bulanan, metrik ke Prometheus, dan alarm "dead-man" di luar VM App karena monitoring yang ada ikut mati bila VM App mati.
Rasio 1+3 vCPU dan 5,8+17 GiB sangat cocok dengan kuota Always Free Ampere A1 (4 OCPU / 24 GB). Jadi kemungkinan besar kedua VM ARM64 di akun Always Free, dan VM DB yang "idle" berisiko diklaim ulang Oracle. Ini harus dicek di hari pertama.

---

## 2. Rekomendasi

| # | Prioritas | Milestone | Isi | Alasan |
|---|---|---|---|---|
| R1 | **wajib** | M0 (gerbang awal) | **Inventaris + housekeeping dulu, deploy kemudian.** Jalankan langkah 0–1 runbook: `uname -m`, tipe akun OCI (Always Free vs Pay-As-You-Go), proxy yang sudah ada di :80/:443, jaringan Docker & project compose yang ada, pemakai swap, isi disk 78%. Upgrade akun ke **PAYG** bila masih Always Free; tagihan tetap Rp0 selama dalam kuota. | Arsitektur CPU menentukan build image. VM App kehabisan swap padahal kini jadi jalur kritis DompetKu. Kebijakan reklamasi instance idle Always Free (CPU/jaringan/memori p95 < 20% selama 7 hari) bisa menghapus VM DB. |
| R2 | **wajib** | M0 | **Topologi "satu pintu" di VM DB** (Lampiran A–B). Container `gw` (Caddy) jadi satu-satunya port yang dipublikasikan: `10.0.1.68:8443` untuk app dan `10.0.1.68:9443` untuk metrik. Keduanya mTLS, hanya dari IP privat VM App. Postgres **tidak** dipublikasikan ke IP privat (hanya `127.0.0.1:5437` untuk admin lewat SSH tunnel). Network Docker `db` bersifat `internal: true`. Subnet Docker eksplisit. Compose `name: dompetku`. Data di bind mount `/srv/dompetku` pada **block volume khusus**. | Permukaan serangan terkecil, sesuai spec §2 anti-tujuan "DB terbuka ke internet". Nama project eksplisit dan bind mount mencegah ulangan insiden "setup app lain menghentikan stack lain" (spec §2 anti-tujuan, `:5435`). Volume khusus mencegah disk penuh milik app lain mematikan Postgres kita. |
| R3 | **wajib** | M0 | **Reverse proxy publik di VM App: pakai yang sudah ada.** Bila ada nginx/Caddy/Traefik di :443, tambahkan **satu file** `dompetku.conf`, validasi (`nginx -t`/`caddy validate`), lalu `reload`, bukan `restart`. Bila :80/:443 kosong, buat compose project `edge` (Caddy, ACME otomatis) yang terpisah. Blokir semua jalur selain app. Pasang HSTS. `X-Forwarded-For` ditimpa, bukan ditambah. Gunakan **IP publik reserved**. | Mengubah proxy milik app lain adalah titik outage terbesar. Reload aman, restart tidak. IP reserved bisa dipindah ke VM DB saat VM App mati, jadi DNS tidak perlu diubah (Lampiran G). |
| R4 | **wajib** | M0 | **Anggaran sumber daya + isolasi** (tabel Lampiran C): `deploy.resources.limits` untuk tiap service. Total DompetKu ≤ 1,7 vCPU dan ≤ 3,6 GiB di VM DB. Logging per-service `driver: local` dengan `max-size`, **bukan** lewat `daemon.json` karena itu memengaruhi app lain. Postgres diberi `oom_score_adj` negatif. | VM DB berbagi host dengan dua Postgres + Redis app lain. Limit melindungi kedua arah. |
| R5 | **wajib** | M0 | **Image:** `web`/`worker` di atas distroless Node (nonroot, `read_only`, `cap_drop: [ALL]`). `postgres` = `postgres:17-bookworm` + WAL-G dibangun dari source (multi-stage Go, jadi arsitektur apa pun bisa). Semua dirujuk **by digest**. Build untuk arsitektur hasil `uname -m`. Kemampuan multi-arch tetap ada di workflow lewat matrix, tetapi tidak dibayar tiap push. Build attestation (`actions/attest-build-provenance`) + SBOM. | Build multi-arch di bawah QEMU memperlambat build Next berkali lipat dan memakan menit CI repo private. Digest + attestation adalah dasar R6. |
| R6 | **wajib** | M0 | **CI/CD + runner aman** (Lampiran D–E). Build di runner GitHub-hosted. Self-hosted runner di VM DB **hanya** menjalankan `sudo /opt/dompetku/bin/deploy <digest>`. Skrip deploy: verifikasi attestation (signer = `release.yml` di `refs/heads/main`), preflight (disk, backup segar, archive sehat), penanda PITR, migrasi, `up -d`, health check, **rollback otomatis**. Rollback manual lewat `workflow_dispatch` dengan digest. | Repo private, tetapi siapa pun yang bisa push branch (termasuk sesi Claude) bisa menulis workflow `runs-on: self-hosted`. Tanpa batas ini, branch = shell di server produksi. |
| R7 | **wajib** | M0 (aturan), M1+ (diterapkan) | **Migrasi expand/contract** (Lampiran F): SQL maju saja (dbmate atau runner sendiri), `lock_timeout`, satu transaksi per file. Contract hanya setelah ≥ 1 rilis stabil. Fungsi `api.*` kompatibel mundur (argumen baru ber-default, atau `_v2`). **Uji N-1 di CI:** image produksi saat ini dijalankan terhadap skema baru + smoke test. Down-migration tidak dipakai di produksi; pilihannya fix-forward atau PITR. | Rollback app otomatis (R6) hanya aman bila app lama masih jalan di skema baru. Logika uang ada di fungsi DB, jadi perubahan fungsi = perubahan kontrak. |
| R8 | **wajib** | M0 | **Backup WAL-G** (Lampiran B `postgresql.conf`): `archive_timeout=300`, `wal_recycle=off`, `wal_compression=zstd`, enkripsi libsodium sisi klien, base backup harian 02:15 WIB (timer systemd host), backup permanen tanggal 1 (retensi 12 bulan), `delete retain FULL 30`. Bucket khusus + Customer Secret Key milik user IAM yang hanya punya akses ke bucket itu. **Sebaiknya:** `pg_dump -Fc` harian terenkripsi (`age`) sebagai jalur kedua yang independen. | RPO 5 menit (spec §5.7) butuh `archive_timeout`. DB dua orang sangat sepi, jadi tanpa itu satu segmen WAL bisa butuh berhari-hari untuk penuh. `wal_recycle=off` membuat sisa segmen berisi nol sehingga kompresinya kecil. Kuota Always Free 50 rb request/bulan: 300 detik ≈ 8,7 rb PUT/bulan, aman. Dengan 60 detik ≈ 43 rb, nyaris habis. |
| R9 | **wajib** | M0 | **Uji restore otomatis mingguan** (Minggu 03:30 WIB, timer systemd di host, **bukan** job pg-boss): container sementara `backup-fetch LATEST` + replay WAL → `pg_isready` → `select * from ops.verify_ledger()` (0 baris pelanggaran) → bandingkan waktu commit terakhir vs produksi (≤ RPO). Hasil masuk metrik textfile. Latihan PITR ke titik waktu tertentu **bulanan**, dicatat waktunya (bukti RTO). | Spec §5.5 menaruh `backup_verify` di worker. Worker tidak boleh punya akses socket Docker (= root host). Uji restore butuh menjalankan container, jadi tempatnya di host. |
| R10 | **wajib** | M0 | **Monitoring + alert email** (Lampiran G): Prometheus yang ada men-scrape `gw:9443` (mTLS) untuk metrik web, worker, `postgres_exporter`, `node_exporter` VM DB (+ textfile backup/cert). Alert lewat Grafana Alerting (SMTP), atau Alertmanager bila sudah ada. **Dead-man di luar VM App:** timer di VM DB memeriksa `https://dompet.novandafadly.com/api/health` lewat jalur publik tiap 5 menit dan ping Healthchecks.io bila sukses. Ditambah satu monitor uptime eksternal gratis. | Prometheus/Grafana hidup di VM App. Bila VM App mati, alert dari situ ikut mati. Kegagalan tak bersuara adalah pola v1 (cron gagal 2.090×, SUMMARY §1). |
| R11 | **sebaiknya** | M0 | **Log:** pino JSON dengan `redact` (nominal, deskripsi, email, token, cookie), `request_id` disebar web → DB (`application_name`/komentar), retensi 7 hari di driver `local`. Access log proxy tanpa query string. Error 5xx dipantau lewat metrik, bukan agregator log. Loki/GlitchTip **nanti** (VM App tidak muat; bisa di VM DB setelah M2 bila perlu). | Spec §5.7 melarang nominal/deskripsi di log. Agregator log menambah 300–500 MB RAM untuk dua pengguna. Tidak sebanding sekarang. |
| R12 | **sebaiknya** | M0–M1 | **SLO + DR tertulis** (Lampiran G): SLO ketersediaan 99,5%/bulan (jujur untuk satu host tanpa HA). Tabel RPO/RTO per skenario. Prosedur "VM App hilang" (pindah IP reserved + Caddy edge di VM DB). **Nanti:** salinan `pg_dump` mingguan ke luar OCI (laptop pemilik atau penyedia lain) untuk skenario akun OCI hilang. | RTO 1 jam di spec realistis untuk data rusak/volume hilang, tetapi belum untuk "VM hilang" sebelum provisioning di-skrip dan dilatih. |

---

## 3. Risiko utama + mitigasi

| Risiko | Dampak | Mitigasi |
|---|---|---|
| VM DB diklaim ulang sebagai instance idle (Always Free) | Semua data + app hilang | R1: upgrade PAYG. Backup off-host (R8). DR runbook (Lampiran G). |
| Runner jadi pintu belakang (branch berisi workflow `runs-on: self-hosted`) | RCE di host Postgres | R6: runner tanpa grup `docker`, sudo hanya ke skrip, verifikasi attestation `main`, secret di GitHub Environment `production` dengan aturan branch `main`, CODEOWNERS untuk `.github/` & `infra/`, branch protection `main`. |
| Ubah konfigurasi proxy app lain → outage app lain | Insiden ulang | R3: file terpisah, validasi, reload. Langkah 1 runbook mencatat konfigurasi awal (backup file) dan prosedur kembali. |
| `docker compose down`/prune dari app lain mengenai DompetKu | Downtime, risiko data | `name: dompetku`, bind mount di luar `/var/lib/docker`, alert `up==0` 2 menit. Runbook memuat larangan `docker system prune --volumes`/`image prune -a`. |
| WAL archive macet → `pg_wal` membengkak → disk penuh → Postgres berhenti | Outage + RPO terlewati | Alert `pg_stat_archiver` (gagal > 0 atau umur arsip terakhir > 15 menit). Alert ukuran `pg_wal` > 2 GiB. Volume khusus. |
| Kunci libsodium WAL-G hilang | Backup tak bisa dibuka = tidak ada backup | Kunci di password manager pemilik + salinan cetak/kedua. Uji restore mingguan membuktikan kunci di host = kunci yang tersimpan. Verifikasi sidik jari kunci tiap kuartal (runbook). |
| VM App OOM (swap penuh) membunuh proxy | DompetKu tak terjangkau walau VM DB sehat | R1 housekeeping. Proxy diberi `oom_score_adj=-500`. Alert memori/swap VM App. Opsi pemilik: pindahkan Prometheus/Grafana ke VM DB (lihat §4-5). |
| Migrasi merusak data / rollback app gagal karena skema | Angka salah (anti-tujuan #1) | R7: expand/contract + uji N-1. Penanda LSN/waktu sebelum migrasi. `pg_dump` cepat pra-migrasi. PITR terlatih (R9). |
| Sertifikat mTLS internal kedaluwarsa | Outage total diam-diam | Masa berlaku 1 tahun. Metrik `dompetku_cert_not_after_seconds`. Alert 30 hari. Prosedur rotasi di runbook. |
| Alert email tidak sampai (SMTP/penyedia bermasalah) | Masalah tak diketahui | Dead-man Healthchecks.io (email terpisah dari penyedia SMTP app). Uji alert dari ujung ke ujung di kriteria penerimaan. |
| Kuota menit GitHub Actions habis (repo private) | Deploy tertahan | Build satu arsitektur. Cache npm/Playwright/buildx. Playwright penuh hanya di PR ke `main`. Pantau pemakaian (Lampiran I). |

---

## 4. Ketidaksetujuan dengan desain saat ini

1. **Port 5437 + `pg_hba` untuk IP VM App (spec §5.7, §7a) tidak perlu lagi.** Web/worker kini satu host dengan Postgres, jadi koneksi DB lewat network Docker `internal`. Usul: Postgres tidak dipublikasikan ke IP privat. Security list **tidak** membuka 5437. Yang dibuka hanya 8443/9443 dari IP VM App. Trade-off: admin DB dari luar butuh SSH tunnel ke `127.0.0.1:5437`.
2. **TLS di jalur yang salah.** Diagram spec §5 menaruh TLS di app→DB. Jalur itu kini berada di dalam host, sehingga TLS tidak menambah perlindungan dan cukup `scram-sha-256` di network internal. Hop yang benar-benar lewat jaringan adalah proxy VM App → web VM DB, dan hop itu wajib mTLS (R2). Alternatif: WireGuard antar-VM. Kelebihannya mengenkripsi semua (termasuk scrape), kekurangannya konfigurasi host di luar repo + port UDP tambahan. Saya pilih Caddy `gw` karena deklaratif di repo dan bisa sekalian menahan request saat restart (`lb_try_duration`).
3. **CD "SSH key khusus deploy" (spec §5.7) bertentangan dengan §7a (self-hosted runner).** Usul: §5.7 diperbarui. Tidak ada SSH masuk dari GitHub. Runner hanya keluar (outbound) dengan hak minimum. Perbandingan opsi ada di Lampiran E.
4. **"User khusus tanpa sudo luas" (spec §7a) belum cukup.** Masuk grup `docker` = root. Tuntutan: user `gh-runner` **bukan** anggota `docker`, sudoers satu baris ke skrip deploy, dan skrip memvalidasi argumen.
5. **`backup_verify` sebagai job pg-boss (spec §5.5) dipindah** ke timer systemd di host (R9). Worker hanya membaca hasil (opsional: tampil di halaman admin).
6. **RTO ≤ 1 jam (spec §5.7) diberlakukan per skenario.** Targetnya realistis untuk data rusak dan volume hilang, tetapi untuk "VM DB hilang" sebelum latihan targetnya ≤ 3 jam (Lampiran G). Angka 1 jam baru diklaim setelah latihan tercatat di bawah 1 jam.
7. **ROADMAP masih menyebut Supabase/pg_cron** (`supabase test db`, pg_cron di M5, "Supabase lokal" di M0) dan migrasi v1 di M7. Usul ke PM/arsitek: perbarui ke `pg_prove` + Postgres 17 service, pg-boss, dan hapus M7 lama. Tambahkan ke M0 tiga item ops: "uji restore lulus", "alert terkirim end-to-end", "rollback otomatis terbukti".
8. **Opsi untuk pemilik (bukan keharusan):** VM App 1 vCPU dengan swap penuh menjalankan Prometheus+Grafana, padahal VM DB punya 17 GiB nganggur. Memindahkan stack monitoring ke VM DB mengurangi risiko OOM proxy, tetapi menyentuh monitoring app lain. Itu keputusan pemilik, setelah M0, dan tidak dibutuhkan DompetKu untuk berjalan.

---

## 5. Kriteria penerimaan (area DevOps/SRE, semua bisa dicek)

**Jaringan & isolasi**
- [ ] Dari internet: `nmap -Pn -p 1-65535 <IP publik>` hanya menunjukkan port yang sudah ada sebelumnya + 80/443. Dari VM App: `pg_isready -h 10.0.1.68 -p 5437` **gagal**.
- [ ] Dari VM App tanpa sertifikat klien, `curl -k https://10.0.1.68:8443/` gagal di TLS handshake. Dengan sertifikat `edge`: 200.
- [ ] `curl -I https://dompet.novandafadly.com/_m/web` dan `/metrics` → 404 (metrik tidak bocor lewat jalur publik).
- [ ] `docker compose -p <app-lain> down` di direktori app lain tidak menghentikan container `dompetku-*` (diuji di stack dummy, bukan app lain sungguhan).
- [ ] `docker inspect` semua service DompetKu menunjukkan `Memory`/`NanoCpus` > 0 dan `LogConfig.Type=local`.
- [ ] `web`/`worker`: `ReadonlyRootfs=true`, `User` bukan root, `CapDrop=[ALL]`.

**CI/CD**
- [ ] Merge ke `main` → image ber-attestation di GHCR → deploy ke produksi otomatis ≤ 15 menit, tanpa langkah manual selain approval Environment (bila diaktifkan).
- [ ] Deploy image yang sengaja membuat `/api/health/ready` gagal → rollback otomatis ke digest sebelumnya ≤ 3 menit, workflow merah, email alert diterima.
- [ ] `sudo -u gh-runner docker ps` → permission denied. `sudo -u gh-runner sudo /opt/dompetku/bin/deploy sha256:<digest dari branch non-main>` → ditolak oleh verifikasi attestation.
- [ ] Job CI `compat-n-1` (image produksi saat ini terhadap migrasi baru + smoke) wajib hijau sebelum merge.
- [ ] Tidak ada secret di repo (gitleaks hijau). `.env` di VM `root:root 600`.

**Backup & restore**
- [ ] `select archived_count, failed_count, last_archived_time from pg_stat_archiver` → `failed_count=0`, `now()-last_archived_time < 10 min`.
- [ ] `wal-g backup-list` menunjukkan base backup ≤ 26 jam. Objek di bucket terenkripsi: mengunduh satu objek tanpa kunci tidak menghasilkan data yang bisa dibaca.
- [ ] Uji restore mingguan pertama lulus. Metrik `dompetku_restore_test_last_success_timestamp_seconds` ada, `ops.verify_ledger()` = 0 baris, selisih commit terakhir ≤ 5 menit.
- [ ] Latihan PITR: sisipkan baris penanda, catat waktu, hapus baris, lakukan PITR ke sebelum penghapusan → baris kembali. Durasi dari mulai sampai app melayani tercatat dan ≤ 60 menit.

**Monitoring**
- [ ] Hentikan `web` → email "DompetkuDown" ≤ 5 menit. Nyalakan → email resolved.
- [ ] Rusak `archive_command` sementara → email "WalArchiveFailing" ≤ 20 menit.
- [ ] Matikan proxy VM App (jendela uji) → email Healthchecks.io ≤ 15 menit, yang membuktikan dead-man independen dari VM App.
- [ ] Dashboard Grafana "DompetKu" ter-provision dari `infra/grafana/` dan menampilkan request rate, p95 latency, 5xx, koneksi DB, umur backup, status job.

**Housekeeping**
- [ ] VM App: disk < 70%, swap terpakai < 50% setelah langkah 1, dengan sebab dicatat. Retensi Prometheus dibatasi ukuran.
- [ ] VM DB: `/srv/dompetku` di block volume terpisah. Alert disk aktif untuk kedua VM.

---

## 6. Pertanyaan/permintaan untuk peran lain

- **Backend/DB:**
  (1) Sediakan `GET /api/health/live` (proses hidup, tanpa DB) dan `GET /api/health/ready` (DB bisa di-query, versi migrasi = yang diharapkan image, pg-boss terhubung). Keduanya tanpa data pribadi.
  (2) Fungsi `ops.verify_ledger()` → baris pelanggaran invarian (Σ lines per entri = 0, FK komposit, saldo turunan) untuk uji restore. Dijalankan role `dompetku_readonly`.
  (3) Tool migrasi: setuju dbmate (biner Go tunggal, SQL murni) atau usul lain?
  (4) Kebijakan versi fungsi `api.*` untuk expand/contract.
  (5) `timezone` server: usul `UTC` di `postgresql.conf` dan WIB eksplisit di fungsi (`at time zone 'Asia/Jakarta'`). Setuju?
  (6) Role `dompetku_monitor` (`pg_monitor`) untuk exporter.
  (7) pg-boss di skema `pgboss` dengan pemilik `dompetku_owner`, dan `dompetku_app` cukup hak pakai.
- **Keamanan:**
  (1) Setuju CA internal (kunci CA offline di laptop/password manager pemilik, sertifikat 1 tahun)?
  (2) Rate limit berlapis: `limit_req` di proxy untuk `/api/auth/*` + rate limit Better Auth per akun. Siapa pemilik angka ambangnya?
  (3) CSP nonce di app, sementara HSTS/XFO di proxy. Pastikan tidak dobel atau bertentangan.
  (4) Verifikasi attestation (`gh attestation verify` vs `cosign`) untuk skrip deploy.
- **QA:** Tandai subset Playwright `@smoke` (≤ 2 menit, akun demo, tanpa menulis data nyata) untuk dipakai di uji N-1 dan pasca-deploy terhadap produksi. Pasca-deploy di produksi hanya baca (login demo ditolak di prod?). Usul: smoke produksi = `GET` publik + `/api/health/ready` saja.
- **Frontend:** Endpoint `/metrics` app harus memakai label rute ter-template (`/transaksi/[id]`), bukan path mentah, agar kardinalitas Prometheus kecil.
- **PM/Arsitek:** Perbarui ROADMAP (§4-7 di atas) dan spec §5/§5.7 (port 5437, SSH deploy, letak `backup_verify`). Terima SLO 99,5% dan tabel RTO per skenario?
- **Pemilik (Novanda):**
  (1) Hasil `uname -m` kedua VM dan tipe akun OCI (Always Free/PAYG).
  (2) Apa yang sudah mendengar di :80/:443 VM App?
  (3) Setuju block volume ±50 GB untuk `/srv/dompetku` (masih di kuota 200 GB bila boot volume default)?
  (4) Penyedia SMTP untuk alert (usul: Resend, sama dengan email transaksional) + akun Healthchecks.io gratis.
  (5) Lokasi kedua untuk kunci backup.
  (6) Mau approval manual di GitHub Environment `production` per deploy, atau otomatis setelah CI hijau?

---

# Lampiran

## A. Topologi

```
                         Internet
                            │ 443 (80 → redirect/ACME)
                            ▼
 ┌─────────────────────── rtp-prod-app-01 (IP publik reserved) ───────────────────────┐
 │  reverse proxy yang sudah ada (nginx/Caddy) ATAU compose project "edge" (Caddy)    │
 │    server dompet.novandafadly.com: TLS publik (ACME), HSTS, limit_req /api/auth,   │
 │    tolak /_m/*, XFF ditimpa, body ≤ 2 MB                                           │
 │  Prometheus + Grafana (sudah ada) ── scrape mTLS ───────────────┐                  │
 └────────────────────┬────────────────────────────────────────────┼──────────────────┘
                      │ mTLS (cert klien "edge")                   │ mTLS (cert klien "prometheus")
                      │ TCP 8443, hanya dari IP privat VM App      │ TCP 9443
                      ▼  (OCI NSG/security list)                   ▼
 ┌─────────────────────── rtp-prod-db-01  10.0.1.68 (privat) ──────────────────────────┐
 │  compose project "dompetku"   (/opt/dompetku/infra, data di /srv/dompetku = volume) │
 │                                                                                     │
 │   ┌────────────── network front (bridge, egress OK) ───────────────┐                │
 │   │ gw (Caddy) :8443 ──▶ web:3000         :9443 ──▶ web:9464/metrics│                │
 │   │                                           ├──▶ worker:9465      │                │
 │   │                                           ├──▶ pg-exporter:9187 │                │
 │   │                                           └──▶ node-exporter:9100 (pid/rootfs host)│
 │   │ web (Next.js)   worker (pg-boss)   ── keluar ke SMTP, Gemini, harga │          │
 │   └──────┬─────────────────┬───────────────────────────────────────┘                │
 │   ┌──────┴─────────────────┴──── network db (internal: true, tanpa egress) ─┐       │
 │   │  postgres:5432 (127.0.0.1:5437 untuk admin)   migrate (one-shot)   pg-exporter │ │
 │   └──────┬───────────────────────────────────────────────────────────────────┘     │
 │   network pg_egress (postgres saja) ── WAL-G ──▶ OCI Object Storage (HTTPS, terenkripsi libsodium)
 │                                                                                     │
 │  host: systemd timers → backup harian, uji restore mingguan, dead-man 5 menit,      │
 │        cek sertifikat; github runner (user gh-runner, tanpa docker) → sudo deploy   │
 │                                                                                     │
 │  app lain (TIDAK disentuh): postgres :5435, :5436, redis — compose project sendiri  │
 └─────────────────────────────────────────────────────────────────────────────────────┘
                      ▲
                      │ dead-man: timer VM DB → GET https://dompet.novandafadly.com/api/health/ready
                      │ sukses → ping Healthchecks.io (email bila ping tak datang 15 menit)
```

Port dan aturan firewall (OCI NSG, stateful):

| Arah | Sumber → Tujuan | Port | Catatan |
|---|---|---|---|
| Masuk VM App | 0.0.0.0/0 | 443/tcp, 80/tcp | 80 hanya redirect + ACME HTTP-01 |
| Masuk VM DB | IP privat VM App/32 | 8443/tcp, 9443/tcp | Tidak ada 5437 |
| Masuk VM DB | (yang sudah ada untuk app lain) | — | Tidak diubah |
| Keluar VM DB | 0.0.0.0/0 | 443/tcp | GHCR, GitHub (runner), Object Storage, SMTP 465/587, Healthchecks |

Subnet Docker eksplisit (cek bentrok di langkah 0 dengan `docker network inspect` + `ip route`): `front` 172.31.250.0/26, `db` 172.31.250.64/26, `pg_egress` 172.31.250.128/28.

## B. Draf compose inti VM DB (`infra/vm-db/compose.yml`)

```yaml
# Project terisolasi DompetKu di rtp-prod-db-01. Jangan jalankan "down -v" atau "prune --volumes".
# Digest image diisi oleh /opt/dompetku/bin/deploy ke /opt/dompetku/state/images.env.
name: dompetku

x-logging: &logging
  driver: local
  options: { max-size: "20m", max-file: "5" }

x-node-hardening: &node-hardening
  read_only: true
  user: "65532:65532"          # nonroot distroless
  cap_drop: [ALL]
  security_opt: ["no-new-privileges:true"]
  tmpfs: ["/tmp:size=64m,mode=1777"]
  logging: *logging
  restart: unless-stopped

services:
  postgres:
    image: ghcr.io/novandafadly/dompetku-postgres@${PG_DIGEST:?}
    container_name: dompetku-postgres
    restart: unless-stopped
    shm_size: 256m
    command: ["postgres", "-c", "config_file=/etc/postgresql/postgresql.conf",
              "-c", "hba_file=/etc/postgresql/pg_hba.conf"]
    environment:
      PGDATA: /var/lib/postgresql/data/pgdata
      POSTGRES_PASSWORD_FILE: /run/secrets/pg_superuser
    env_file: [/srv/dompetku/env/walg.env]    # WALG_S3_PREFIX, AWS_*, AWS_ENDPOINT, WALG_LIBSODIUM_KEY, WALG_COMPRESSION_METHOD=zstd
    secrets: [pg_superuser]
    volumes:
      - /srv/dompetku/pgdata:/var/lib/postgresql/data
      - ./postgres/postgresql.conf:/etc/postgresql/postgresql.conf:ro
      - ./postgres/pg_hba.conf:/etc/postgresql/pg_hba.conf:ro
    ports: ["127.0.0.1:5437:5432"]           # admin via SSH tunnel saja; TIDAK di IP privat
    networks: [db, pg_egress]
    oom_score_adj: -800
    stop_grace_period: 90s
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres -d dompetku"]
      interval: 10s
      timeout: 5s
      retries: 6
    deploy:
      resources:
        limits: { cpus: "1.50", memory: 2g }
        reservations: { memory: 1g }
    security_opt: ["no-new-privileges:true"]
    logging: *logging

  migrate:                                  # dijalankan skrip deploy: compose run --rm migrate
    image: ghcr.io/novandafadly/dompetku-migrate@${MIGRATE_DIGEST:?}
    profiles: ["tools"]
    env_file: [/srv/dompetku/env/migrate.env] # DATABASE_URL role dompetku_owner
    networks: [db]
    depends_on: { postgres: { condition: service_healthy } }
    read_only: true
    cap_drop: [ALL]
    security_opt: ["no-new-privileges:true"]
    restart: "no"
    logging: *logging

  web:
    <<: *node-hardening
    image: ghcr.io/novandafadly/dompetku-web@${WEB_DIGEST:?}
    container_name: dompetku-web
    env_file: [/srv/dompetku/env/app.env]   # DATABASE_URL role dompetku_app, BETTER_AUTH_SECRET, SMTP, AUTH_ALLOWED_EMAILS, ...
    environment:
      NODE_ENV: production
      PORT: "3000"
      HOSTNAME: "0.0.0.0"
      METRICS_PORT: "9464"
      NODE_OPTIONS: "--max-old-space-size=448"
      TRUSTED_PROXY_CIDR: "172.31.250.0/26"  # hanya gw yang dipercaya untuk X-Forwarded-For
    networks: [front, db]
    depends_on: { postgres: { condition: service_healthy } }
    stop_grace_period: 30s
    healthcheck:
      test: ["CMD", "/nodejs/bin/node", "-e",
             "fetch('http://127.0.0.1:3000/api/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 15s
      timeout: 5s
      retries: 4
      start_period: 30s
    deploy:
      resources:
        limits: { cpus: "1.00", memory: 768m }

  worker:
    <<: *node-hardening
    image: ghcr.io/novandafadly/dompetku-worker@${WORKER_DIGEST:?}
    container_name: dompetku-worker
    env_file: [/srv/dompetku/env/app.env]
    environment:
      NODE_ENV: production
      METRICS_PORT: "9465"
      NODE_OPTIONS: "--max-old-space-size=256"
      TZ: Asia/Jakarta                      # cron pg-boss dalam WIB
    networks: [front, db]
    depends_on: { postgres: { condition: service_healthy } }
    stop_grace_period: 60s                  # pg-boss: selesaikan job aktif saat SIGTERM
    deploy:
      resources:
        limits: { cpus: "0.50", memory: 384m }

  gw:
    image: caddy:2-alpine@${CADDY_DIGEST:?}  # digest dipin oleh Renovate
    container_name: dompetku-gw
    restart: unless-stopped
    ports:
      - "10.0.1.68:8443:8443"               # app (mTLS, cert klien CN=edge)
      - "10.0.1.68:9443:9443"               # metrik (mTLS, cert klien CN=prometheus)
    volumes:
      - ./gw/Caddyfile:/etc/caddy/Caddyfile:ro
      - /srv/dompetku/certs:/certs:ro
    networks: [front]
    read_only: true
    tmpfs: ["/data:size=16m", "/config:size=16m"]
    cap_drop: [ALL]
    cap_add: [NET_BIND_SERVICE]
    security_opt: ["no-new-privileges:true"]
    deploy:
      resources:
        limits: { cpus: "0.25", memory: 96m }
    logging: *logging

  pg-exporter:
    image: quay.io/prometheuscommunity/postgres-exporter@${PGEXP_DIGEST:?}
    env_file: [/srv/dompetku/env/monitor.env]  # DATA_SOURCE_NAME role dompetku_monitor
    networks: [db, front]
    read_only: true
    user: "65534:65534"
    cap_drop: [ALL]
    restart: unless-stopped
    deploy: { resources: { limits: { cpus: "0.10", memory: 64m } } }
    logging: *logging

  node-exporter:                             # lewati bila VM DB sudah punya node-exporter: scrape yang ada
    image: quay.io/prometheus/node-exporter@${NODEEXP_DIGEST:?}
    command: ["--path.rootfs=/host", "--collector.textfile.directory=/host/var/lib/dompetku/textfile"]
    pid: host
    volumes: ["/:/host:ro,rslave"]
    networks: [front]
    read_only: true
    user: "65534:65534"
    cap_drop: [ALL]
    restart: unless-stopped
    deploy: { resources: { limits: { cpus: "0.10", memory: 64m } } }
    logging: *logging

networks:
  front:     { ipam: { config: [{ subnet: 172.31.250.0/26 }] } }
  db:        { internal: true, ipam: { config: [{ subnet: 172.31.250.64/26 }] } }
  pg_egress: { ipam: { config: [{ subnet: 172.31.250.128/28 }] } }

secrets:
  pg_superuser: { file: /srv/dompetku/env/pg_superuser }
```

`infra/vm-db/gw/Caddyfile`:

```caddyfile
{
	admin off
	auto_https off
	servers { trusted_proxies static 10.0.0.0/16 }   # ganti dengan /32 IP privat VM App
}

:8443 {
	tls /certs/gw.crt /certs/gw.key {
		client_auth {
			mode require_and_verify
			trust_pool file /certs/ca.crt
		}
	}
	@internal path /_m/* /metrics*
	respond @internal 404
	reverse_proxy web:3000 {
		lb_try_duration 30s          # tahan request selama web restart saat deploy
		lb_try_interval 500ms
		health_uri /api/health/live
	}
}

:9443 {
	tls /certs/gw.crt /certs/gw.key {
		client_auth {
			mode require_and_verify
			trust_pool file /certs/ca.crt
		}
	}
	handle /_m/web    { rewrite * /metrics
	                    reverse_proxy web:9464 }
	handle /_m/worker { rewrite * /metrics
	                    reverse_proxy worker:9465 }
	handle /_m/pg     { rewrite * /metrics
	                    reverse_proxy pg-exporter:9187 }
	handle /_m/node   { rewrite * /metrics
	                    reverse_proxy node-exporter:9100 }
	respond 404
}
```

Catatan: cert klien `edge` dan `prometheus` diterbitkan CA yang sama. Pemisahan port (bukan path) mencegah kesalahan konfigurasi proxy publik membocorkan metrik.

`infra/vm-db/postgres/postgresql.conf` (bagian penting; nilai awal untuk limit 2 GiB):

```ini
listen_addresses = '*'                 # di dalam container; publikasi hanya 127.0.0.1
max_connections = 40                   # web pool 10 + worker 5 + migrate/exporter/admin
password_encryption = scram-sha-256
shared_buffers = 512MB
effective_cache_size = 1280MB
work_mem = 8MB
maintenance_work_mem = 128MB
timezone = 'UTC'                       # WIB eksplisit di fungsi (konfirmasi Backend)
shared_preload_libraries = 'pg_stat_statements'

wal_level = replica
wal_compression = zstd
wal_recycle = off                      # segmen baru berisi nol → arsip kecil saat archive_timeout
max_wal_size = 1GB
archive_mode = on
archive_command = 'wal-g wal-push %p'
archive_timeout = 300                  # RPO ≤ 5 menit
restore_command = 'wal-g wal-fetch %f %p'   # dipakai saat recovery

idle_in_transaction_session_timeout = '60s'
lock_timeout = '0'                     # di-set per sesi migrasi (5s)
log_min_duration_statement = '500ms'   # tanpa parameter: log_parameter_max_length = 0
log_parameter_max_length = 0
log_parameter_max_length_on_error = 0  # nominal/deskripsi tidak masuk log
log_lock_waits = on
log_checkpoints = on
log_line_prefix = '%m [%p] %q%u@%d app=%a '
```

`pg_hba.conf`:

```
local   all  postgres                         peer
host    all  postgres          0.0.0.0/0      reject
host    dompetku  dompetku_app,dompetku_owner,dompetku_monitor,dompetku_readonly  172.31.250.64/26  scram-sha-256
host    all  all               0.0.0.0/0      reject
```

(Koneksi admin lewat `127.0.0.1:5437` masuk dari gateway network `db`/`pg_egress`; runbook memverifikasi alamat sumber sebenarnya dan menambah satu baris `/32` bila perlu.)

## C. Anggaran sumber daya

| Service | CPU limit | Memori limit | Catatan |
|---|---|---|---|
| postgres | 1,50 | 2 GiB | `shared_buffers` 512 MB; naik bila `pg_stat` menunjukkan perlu |
| web | 1,00 | 768 MiB | heap 448 MB; Next standalone biasanya 150–300 MB |
| worker | 0,50 | 384 MiB | |
| gw + exporter | 0,45 | 224 MiB | |
| **Total tetap** | **3,45 (burst)** | **≈ 3,4 GiB** | Limit CPU = batas atas, bukan reservasi |
| restore-test (sementara, Minggu 03:30) | 1,00 | 1,5 GiB | Hanya saat uji, `--rm` |
| VM App: proxy | — | +30–60 MB | `oom_score_adj=-500` |

Bila langkah 0 menunjukkan app lain di VM DB memakai > 10 GiB, turunkan limit web ke 512 MiB dulu, jangan Postgres.

## D. Pipeline CI/CD

```
PR → CI (GitHub-hosted, ubuntu-24.04[-arm]):
  1 lint · typecheck · unit (Vitest)
  2 db: Postgres 17 service → migrasi dari nol → pgTAP (pg_prove) → kysely-codegen diff = 0
  3 build Next (standalone) + worker
  4 Playwright desktop+mobile + axe (penuh di PR ke main; @smoke di push branch)
  5 keamanan: npm audit/osv-scanner, gitleaks, actionlint, hadolint, trivy (image)
  6 compat-n-1: pull digest produksi sekarang → jalankan terhadap DB dengan migrasi BARU → @smoke
merge ke main → release.yml:
  7 build image (arsitektur dari vars.TARGET_PLATFORMS, default hasil uname -m) → GHCR, tag sha
  8 attest-build-provenance + SBOM (syft) → attestation terikat ke workflow release.yml@refs/heads/main
  9 deploy job: environment=production (aturan branch: main), runs-on [self-hosted, dompetku-prod]
       langkah satu-satunya: sudo /opt/dompetku/bin/deploy --web sha256:… --worker sha256:… --migrate sha256:…
 10 pasca-deploy dari GitHub-hosted: GET https://dompet.novandafadly.com/api/health/ready = 200
workflow_dispatch rollback.yml(input: digest) → langkah 9 dengan digest lama (tanpa migrasi)
```

Semua action dipin SHA (Renovate memperbarui). `permissions:` minimal per job (`contents: read`, `packages: write` hanya di build, `id-token: write` + `attestations: write` hanya di attest).

Skrip `/opt/dompetku/bin/deploy` (root, `chmod 755`, isi dari repo `infra/vm-db/bin/deploy`, dipasang manual oleh pemilik, bukan oleh runner):

```
 0  flock /run/dompetku-deploy.lock; set -euo pipefail; argumen harus cocok ^sha256:[0-9a-f]{64}$
 1  verifikasi attestation tiap digest: signer workflow = novandafadly/dompetku-v2/.github/workflows/release.yml,
    source ref = refs/heads/main (gh attestation verify --owner … atau cosign verify-attestation) → gagal = stop
 2  preflight: df /srv/dompetku < 85%; postgres healthy; umur backup ≤ 26 jam; pg_stat_archiver.failed_count tidak naik 15 menit
 3  simpan state: /opt/dompetku/state/images.env → images.env.prev
 4  penanda PITR: select pg_switch_wal(), now(), pg_current_wal_lsn() → /opt/dompetku/state/premigrate-<ts>
    pg_dump -Fc cepat → /srv/dompetku/predeploy/<ts>.dump (simpan 3 terakhir)
 5  docker compose run --rm migrate  (lock_timeout 5s, statement_timeout 5min; gagal → stop, app lama tetap jalan, exit 2)
 6  tulis digest baru → docker compose up -d --no-deps web worker
 7  tunggu ≤ 120 s: /api/health/ready lewat gw (curl dengan cert klien lokal) DAN status healthy docker
 8  gagal → kembalikan images.env.prev → up -d web worker → cek health → exit 1 (workflow merah + alert)
    (skema tidak dibalik: aman karena expand/contract + uji N-1)
 9  sukses → hapus image dompetku yang tidak termasuk 3 digest terakhir (hanya repo ghcr.io/novandafadly/dompetku-*)
10  tulis metrik textfile: dompetku_deploy_last_success_timestamp_seconds, dompetku_deploy_info{digest}
```

`/etc/sudoers.d/dompetku-deploy`:
```
gh-runner ALL=(root) NOPASSWD: /opt/dompetku/bin/deploy
```

## E. Desain deploy: runner vs pull-based

| Opsi | Cara | Plus | Minus | Putusan |
|---|---|---|---|---|
| A. Self-hosted runner, user di grup `docker` | Workflow menjalankan `docker compose` langsung | Paling sederhana | Grup `docker` = root. Branch mana pun dengan `runs-on: self-hosted` = root di host Postgres | **Tolak** |
| **B. Runner tanpa docker + sudo ke skrip tetap + verifikasi attestation** | Runner hanya memanggil `deploy <digest>` | Hanya koneksi keluar. Tidak ada port masuk. Status terlihat di GitHub. Rollback via `workflow_dispatch` | Runner tetap menjalankan job dari branch mana pun sebagai `gh-runner` (hak minimum). Perlu verifikasi attestation | **Dipilih** |
| C. Agen pull (timer systemd) | Tiap 2 menit membaca "digest yang diinginkan" (mis. file di GitHub Release/branch `deploy`) → verifikasi attestation → deploy | Tidak ada runner. Tidak ada eksekusi kode dari GitHub di host | Status/log deploy tidak di GitHub (perlu dilaporkan balik). Latensi menit. Kode agen ditulis sendiri | **Cadangan** bila pemilik tidak ingin runner di VM DB |
| D. Watchtower | Pantau tag `latest`, tarik otomatis | Nol kode | Tidak menjalankan migrasi. Tidak ada health-gated rollback. Mendorong tag mutable. Pemeliharaan upstream tidak aktif (verifikasi status saat M0) | Tolak |
| E. Webhook masuk | GitHub → endpoint di proxy VM App → VM DB | Instan | Endpoint publik baru + HMAC + replay protection. VM DB privat butuh hop tambahan | Tolak |
| F. SSH dari runner GitHub-hosted | `ssh deploy@…` | Pola umum | SSH harus terbuka ke rentang IP GitHub yang luas. VM DB privat perlu jump host. Kunci SSH di secrets | Tolak (bertentangan spec §7a juga) |

Pengerasan runner (B):
- User `gh-runner` tanpa shell login dan tanpa grup `docker`. Home `/opt/gh-runner`.
- Service systemd berjalan dengan `ProtectSystem=strict`, `ProtectHome=yes`, `NoNewPrivileges=no` (sudo butuh setuid), `ReadWritePaths=/opt/gh-runner`.
- Label `dompetku-prod`. Runner didaftarkan ke repo `dompetku-v2` saja. Matikan "Allow GitHub Actions to create and approve pull requests".
- Branch protection `main`: PR wajib, CI wajib, CODEOWNERS (`.github/**`, `infra/**`) = pemilik.
- Environment `production`: deployment branches = `main` saja. Secret (bila ada) hanya di sana.
- Runner tidak memegang token baca GHCR. `docker pull` dilakukan skrip deploy (root) memakai token read-only yang disimpan di `/srv/dompetku/env/ghcr.token` (600).

## F. Aturan migrasi expand/contract

1. **Expand** (rilis N): tambah kolom nullable/ber-default, tabel baru, fungsi baru atau argumen baru ber-default, index `concurrently` (file terpisah, tanpa transaksi). App N menulis ke yang lama + baru bila perlu.
2. **Migrate data** (rilis N atau job): backfill bertahap, idempoten.
3. **Contract** (rilis ≥ N+2, setelah N+1 stabil ≥ 7 hari): hapus kolom/fungsi lama, `NOT NULL`, ganti constraint (`NOT VALID` lalu `VALIDATE`).
4. Dilarang dalam satu rilis: rename/drop yang dipakai app sebelumnya, mengubah tipe kolom ledger, mengubah semantik fungsi `api.*` yang sudah ada tanpa versi baru.
5. Setiap file migrasi: `set lock_timeout = '5s'; set statement_timeout = '5min';`. CI menolak `drop`/`rename` di luar folder `contract/` (lint sederhana `grep`/squawk).
6. Rollback: app → digest lama (otomatis). Skema → **tidak** dengan down migration. Data rusak → PITR ke penanda pra-migrasi (Lampiran G), lalu tulis ulang entri setelahnya dari `entry_history`/audit bila ada.

## G. Backup, PITR, monitoring, RPO/RTO, DR

**Jadwal host (systemd timer di VM DB, semua menulis metrik ke `/var/lib/dompetku/textfile/*.prom`)**

| Timer | Jadwal (WIB) | Isi | Metrik |
|---|---|---|---|
| `dompetku-basebackup` | harian 02:15 | `docker exec dompetku-postgres wal-g backup-push $PGDATA` (tgl 1: `--permanent`) lalu `wal-g delete retain FULL 30 --confirm` | `dompetku_backup_last_success_timestamp_seconds`, `_duration_seconds`, `_size_bytes` |
| `dompetku-monthly-prune` | tgl 2, 03:00 | hapus backup permanen > 12 bulan (`wal-g backup-mark -b <name>` → impermanent, lalu delete) | — |
| `dompetku-logical` (sebaiknya) | harian 02:45 | `pg_dump -Fc` → `age -r <pubkey>` → bucket prefix `logical/`, retensi 14 | `dompetku_logical_backup_last_success_timestamp_seconds` |
| `dompetku-restore-test` | Minggu 03:30 | lihat di bawah | `dompetku_restore_test_last_success_timestamp_seconds`, `_duration_seconds`, `_recovery_lag_seconds` |
| `dompetku-deadman` | tiap 5 menit | `curl -fsS https://dompet.novandafadly.com/api/health/ready && curl -fsS $HC_URL` | (Healthchecks.io) |
| `dompetku-certcheck` | harian | `openssl x509 -enddate` untuk ca/gw/edge/prometheus | `dompetku_cert_not_after_seconds{cert}` |

**Uji restore mingguan:**
```
docker run --rm --name dompetku-restoretest --network dompetku_pg_egress --memory 1536m --cpus 1 \
  --env-file /srv/dompetku/env/walg.env -v /srv/dompetku/restoretest:/var/lib/postgresql/data \
  ghcr.io/novandafadly/dompetku-postgres@$PG_DIGEST  restore-test.sh
# restore-test.sh (di image): wal-g backup-fetch $PGDATA LATEST → recovery.signal
#   (restore_command wal-fetch, recovery_target_action=promote) → start → pg_isready
#   → psql: select count(*) from ops.verify_ledger() = 0; select max(created_at) from entries (atau tabel audit)
#   → bandingkan dengan produksi (via psql ke dompetku-postgres) → lag ≤ 600 s → tulis .prom → hapus direktori
```
Bulanan (manual, 30 menit): PITR dengan `recovery_target_time` ke penanda yang dibuat, ikuti kriteria §5.

**Prosedur PITR produksi (ringkas):**
1. Umumkan maintenance (proxy mengembalikan 503 statis).
2. `docker compose stop web worker`.
3. `docker compose stop postgres`, lalu `mv /srv/dompetku/pgdata /srv/dompetku/pgdata.broken-<ts>` (jangan dihapus).
4. Jalankan `wal-g backup-fetch` ke direktori baru. Isi `recovery_target_time`/`_lsn` dari penanda pra-migrasi atau waktu kejadian. Tambah `recovery.signal`.
5. Start postgres, tunggu promote, jalankan `ops.verify_ledger()`.
6. `up -d web worker` dengan digest yang cocok dengan skema saat target.
7. Catat transaksi setelah target yang hilang (dari `pgdata.broken` bila bisa dibaca) untuk diinput ulang.

**Alert (Prometheus rules, `infra/prometheus/dompetku.rules.yml`, dimuat sebagai file terpisah di config yang ada):**

| Alert | Ekspresi (ringkas) | Untuk | Tingkat |
|---|---|---|---|
| DompetkuDown | `up{job=~"dompetku-(web|worker)"} == 0` atau `probe_success{job="dompetku-blackbox"} == 0` | 2–3 m | kritis |
| Dompetku5xx | `increase(http_requests_total{job="dompetku-web",status=~"5.."}[10m]) > 5` | 0 | peringatan |
| DompetkuLatency | p95 `http_request_duration_seconds` > 1,5 s | 15 m | peringatan |
| WalArchiveFailing | `increase(pg_stat_archiver_failed_count[15m]) > 0` atau `time() - pg_stat_archiver_last_archive_age...` > 900 | 5 m | kritis |
| PgWalTooBig | ukuran `pg_wal` (textfile) > 2 GiB | 10 m | kritis |
| BaseBackupStale | `time() - dompetku_backup_last_success_timestamp_seconds > 26*3600` | 0 | kritis |
| RestoreTestStale | `time() - dompetku_restore_test_last_success_timestamp_seconds > 8*86400` | 0 | kritis |
| JobFailed / JobLate | `dompetku_job_last_status{status="failed"} == 1`; `time() - dompetku_job_last_success_timestamp_seconds > batas per job` | 0 | peringatan |
| DiskFilling | `node_filesystem_avail_bytes/size < 0.2` (kritis < 0.1) atau `predict_linear(...[6h], 24*3600) < 0` (kedua VM) | 10 m | peringatan/kritis |
| VmAppMemoryPressure | `node_memory_SwapFree_bytes/SwapTotal < 0.1` dan `rate(node_vmstat_pgmajfault[5m]) > 50` | 15 m | peringatan |
| ContainerNearLimit | memori container > 90% limit (cAdvisor VM DB bila dipasang; atau metrik proses) | 10 m | peringatan |
| PgConnections | `sum(pg_stat_activity_count) / pg_settings_max_connections > 0.8` | 5 m | peringatan |
| AuthFailSpike | `increase(dompetku_auth_failures_total[10m]) > 20` | 0 | peringatan (keamanan) |
| CertExpiry | publik `probe_ssl_earliest_cert_expiry - time() < 14d`; internal `dompetku_cert_not_after_seconds - time() < 30d` | 0 | peringatan |

Probe blackbox: pakai `blackbox_exporter` bila sudah ada di VM App. Bila tidak, tambahkan (≈ 20 MB) atau andalkan dead-man + `up`. Pengiriman: Grafana Alerting → contact point email (SMTP). Pengelompokan 5 menit, ulang 4 jam. Dashboard `infra/grafana/dompetku.json` di-provision ke folder "DompetKu" saja, tanpa mengubah dashboard lain.

**RPO/RTO per skenario**

| Skenario | RPO | RTO target | Mekanisme |
|---|---|---|---|
| Container crash / OOM | 0 | < 1 menit | `restart: unless-stopped`, healthcheck |
| Deploy buruk (app) | 0 | ≤ 5 menit | rollback otomatis (R6) |
| Migrasi/bug merusak data | 0 sampai titik target (entri setelahnya diinput ulang) | ≤ 1 jam | PITR ke penanda pra-migrasi |
| Volume data VM DB rusak/hilang | ≤ 5 menit | ≤ 1 jam | volume baru + `backup-fetch` + WAL replay |
| VM DB hilang total | ≤ 5 menit | ≤ 3 jam (→ 1 jam setelah provisioning di-skrip & dilatih) | VM baru, langkah 2–5 runbook, restore |
| VM App hilang | 0 | ≤ 2 jam | pindahkan IP publik reserved ke VM DB, jalankan compose `edge` (Caddy) di VM DB → `gw`, buka 443 sementara |
| Akun/region OCI hilang | ≤ 24 jam (bila salinan off-OCI aktif) | ≤ 1 hari | **nanti**: dump mingguan ke luar OCI |
| SLO | — | ketersediaan 99,5%/bulan (≈ 3,6 jam) | single host, tanpa HA (disengaja) |

## H. Runbook M0 (draf ringkas, dijalankan pemilik)

Konvensi: `[App]` = rtp-prod-app-01, `[DB]` = rtp-prod-db-01. Langkah yang **mengubah** sistem ditandai ⚠. Simpan output langkah 0 ke `docs/ops/inventory-YYYYMMDD.md` (tanpa secret) di repo v2.

**0. Inventaris (hanya baca, kedua VM)**
```bash
uname -m; nproc; free -h; swapon --show; df -hT; lsblk
sudo ss -tlnp                                   # siapa di :80/:443/:5435/:5436/...
docker ps --format '{{.Names}}\t{{.Image}}\t{{.Ports}}\t{{.Label "com.docker.compose.project"}}'
docker compose ls; docker network ls; docker network inspect $(docker network ls -q) | grep -E '"Name"|Subnet'
docker system df; sudo du -xh --max-depth=2 / 2>/dev/null | sort -h | tail -25
for p in /proc/[0-9]*; do awk '/VmSwap/{print $2" kB '"$(cat $p/comm 2>/dev/null)"'"}' $p/status 2>/dev/null; done | sort -n | tail -10
systemctl list-units --type=service --state=running | grep -Ei 'nginx|caddy|traefik|haproxy|apache'
ls /etc/nginx/sites-enabled /etc/caddy 2>/dev/null; ip route; timedatectl
```
Di konsol OCI: tipe akun (Always Free/PAYG), shape instance, IP publik reserved atau ephemeral, NSG/security list, sisa kuota block volume dan Object Storage.

**1. ⚠ Housekeeping VM App** (setelah melihat langkah 0)
- `sudo journalctl --vacuum-size=200M` + `SystemMaxUse=200M` di `/etc/systemd/journald.conf`. `sudo apt-get clean`.
- `docker image prune` (hanya dangling; **jangan** `-a`, **jangan** `--volumes`). Log container app lain yang membengkak: catat dan laporkan, jangan dipotong tanpa persetujuan.
- Prometheus: set `--storage.tsdb.retention.size` (mis. 4GB) + `retention.time=30d` di compose monitoring (ubah satu flag, `up -d prometheus`).
- Catat 5 proses pemakai swap teratas. Bila penyebabnya kebocoran memori app lain, laporkan ke pemiliknya. Target: disk < 70%, swap < 50%.
- Ubah IP publik ke **reserved** bila masih ephemeral. Ini mengubah IP, jadi siapkan perubahan DNS app lain dulu.

**2. ⚠ OCI**
- Upgrade akun ke PAYG bila masih Always Free. Pasang budget alert $1.
- Buat block volume 50 GB → attach ke [DB] → `mkfs.ext4` → mount `/srv/dompetku` (fstab dengan `UUID=`, `nofail`).
- Buat bucket `dompetku-backup` (private, versioning off, Standard). Buat user IAM `dompetku-backup` + Customer Secret Key + policy hanya ke bucket itu.
- NSG [DB]: izinkan 8443, 9443/tcp dari IP privat [App]/32. **Jangan** buka 5437.
- DNS: `dompet.novandafadly.com` A → IP publik [App] (TTL 300).

**3. ⚠ Persiapan [DB]**
```bash
sudo useradd --system --home /opt/gh-runner --shell /usr/sbin/nologin gh-runner   # TIDAK ditambah ke grup docker
sudo install -d -m 750 /opt/dompetku /opt/dompetku/state /srv/dompetku/{pgdata,certs,env,predeploy,restoretest}
sudo install -d -m 755 /var/lib/dompetku/textfile
sudo git clone --depth 1 https://github.com/novandafadly/dompetku-v2 /opt/dompetku/src   # read-only deploy key; infra diambil dari sini
sudo ln -s /opt/dompetku/src/infra/vm-db /opt/dompetku/infra
sudo install -m 755 /opt/dompetku/infra/bin/deploy /opt/dompetku/bin/deploy
echo 'gh-runner ALL=(root) NOPASSWD: /opt/dompetku/bin/deploy' | sudo tee /etc/sudoers.d/dompetku-deploy && sudo visudo -c
```

**4. ⚠ Secret & sertifikat** (di laptop pemilik, bukan di VM, kecuali disebut)
- `openssl rand -base64 48` untuk: superuser PG, `dompetku_owner`, `dompetku_app`, `dompetku_monitor`, `dompetku_readonly`, `BETTER_AUTH_SECRET`.
- Kunci WAL-G: `openssl rand -hex 32` → `WALG_LIBSODIUM_KEY` (+ `WALG_LIBSODIUM_KEY_TRANSFORM=hex`). Simpan di password manager + salinan kedua. Catat sidik jari `sha256sum <<<"$KEY" | cut -c1-12`.
- Kunci `age` untuk dump logis: privat di password manager, publik ke VM.
- CA internal (`step certificate create` atau openssl): CA 5 tahun (kunci tetap di laptop), `gw` (SAN `dompetku-gw.internal`, IP `10.0.1.68`), `edge`, `prometheus` masing-masing 1 tahun.
- Salin ke [DB] `/srv/dompetku/env/*.env` dan `/srv/dompetku/certs/` (`root:root`, `600`). Salin cert `edge` ke [App] dan cert `prometheus` ke direktori config Prometheus.

**5. ⚠ Postgres pertama + backup + uji restore (sebelum app apa pun)**
```bash
cd /opt/dompetku/infra && sudo docker compose --env-file /opt/dompetku/state/images.env up -d postgres
sudo docker exec dompetku-postgres psql -U postgres -c "select name, setting from pg_settings where name in ('archive_mode','archive_timeout','wal_recycle')"
sudo docker exec dompetku-postgres psql -U postgres -c "select pg_switch_wal()"; sleep 60
sudo docker exec dompetku-postgres psql -U postgres -c "select * from pg_stat_archiver"   # failed_count = 0
sudo systemctl enable --now dompetku-basebackup.timer && sudo systemctl start dompetku-basebackup.service
sudo docker exec dompetku-postgres wal-g backup-list
sudo systemctl start dompetku-restore-test.service && cat /var/lib/dompetku/textfile/restore.prom
```
Role & skema dibuat oleh migrasi awal (`packages/db`) lewat pipeline. Langkah ini hanya membuktikan jalur backup.

**6. ⚠ Runner + deploy pertama**
- Daftarkan runner (Settings → Actions → Runners → New, label `dompetku-prod`) sebagai `gh-runner`. Pasang sebagai service (`./svc.sh install gh-runner`) dan tambah drop-in pengerasan Lampiran E.
- `sudo -u gh-runner docker ps` harus gagal.
- Jalankan `release.yml` (merge pertama) → periksa urutan log deploy (attestation → preflight → migrate → up → health).

**7. ⚠ Proxy [App]**
- Ada nginx: salin konfigurasi lama (`sudo tar czf ~/nginx-backup-$(date +%F).tgz /etc/nginx`), tambah `sites-available/dompetku.conf` (snippet di bawah), `sudo nginx -t && sudo systemctl reload nginx`, lalu `certbot --nginx -d dompet.novandafadly.com` (atau mekanisme ACME yang sudah dipakai).
- Ada Caddy: tambah blok situs di file `import` terpisah, `caddy validate`, lalu `caddy reload`.
- Tidak ada: `infra/vm-app/edge/compose.yml` (Caddy, `name: edge`) → `up -d`.
```nginx
limit_req_zone $binary_remote_addr zone=dk_auth:10m rate=10r/m;
server {
  listen 443 ssl; http2 on; server_name dompet.novandafadly.com;
  # ssl_certificate … (certbot)
  add_header Strict-Transport-Security "max-age=63072000; includeSubDomains" always;
  client_max_body_size 2m;
  location ~ ^/(_m|metrics) { return 404; }
  location /api/auth/ { limit_req zone=dk_auth burst=10 nodelay; include /etc/nginx/dompetku-upstream.conf; }
  location / { include /etc/nginx/dompetku-upstream.conf; }
}
# dompetku-upstream.conf
proxy_pass https://10.0.1.68:8443;
proxy_ssl_certificate /etc/nginx/dompetku/edge.crt; proxy_ssl_certificate_key /etc/nginx/dompetku/edge.key;
proxy_ssl_trusted_certificate /etc/nginx/dompetku/ca.crt; proxy_ssl_verify on;
proxy_ssl_name dompetku-gw.internal; proxy_ssl_server_name on;
proxy_set_header Host $host; proxy_set_header X-Forwarded-For $remote_addr; proxy_set_header X-Forwarded-Proto https;
proxy_read_timeout 60s;
```
Caddy di VM App: `reverse_proxy https://10.0.1.68:8443 { transport http { tls_client_auth /etc/caddy/dompetku/edge.crt /etc/caddy/dompetku/edge.key; tls_trust_pool file /etc/caddy/dompetku/ca.crt; tls_server_name dompetku-gw.internal } }`.

**8. ⚠ Monitoring**
- Tambah 4 job scrape (`https://10.0.1.68:9443/_m/{web,worker,pg,node}`, `tls_config` dengan cert `prometheus`), `rule_files: [dompetku.rules.yml]`, lalu reload Prometheus (`/-/reload` atau `kill -HUP`, bukan restart).
- Grafana: contact point email + import dashboard ke folder "DompetKu".
- Healthchecks.io: buat check "dompetku-deadman" (period 5 menit, grace 10 menit). Pasang `HC_URL` di [DB] dan aktifkan timer.

**9. Verifikasi** — jalankan semua kriteria §5. Lampirkan bukti (output perintah, tangkapan email alert, durasi PITR) ke `docs/ops/m0-acceptance.md`.

## I. Biaya (perkiraan bulanan)

| Item | Biaya | Catatan |
|---|---|---|
| Compute 2 VM | Rp0 | Asumsi Ampere A1 dalam kuota Always Free (4 OCPU/24 GB). Verifikasi langkah 0. PAYG tetap Rp0 dalam kuota |
| Block volume 50 GB | Rp0 | Dalam 200 GB Always Free bila boot volume ≤ 2 × 50 GB. Bila lewat ≈ US$0,0255/GB-bulan |
| Object Storage | Rp0 | DB 2 user: base backup ≪ 1 GB × 30 + permanen 12 + WAL ±1–3 GB → ≤ 20 GB gratis. Request ±9–10 rb/bulan (< 50 rb gratis). Bila lewat ≈ US$0,0255/GB-bulan |
| Egress | Rp0 | 10 TB/bulan gratis OCI |
| Email (alert + transaksional) | Rp0 | Resend gratis 3.000/bulan (100/hari) |
| Healthchecks.io + 1 monitor uptime eksternal | Rp0 | Tier gratis |
| GitHub Actions (repo private) | Rp0–±Rp70rb | Free 2.000 menit/bulan. CI penuh ±15 menit × ±80 run ≈ 1.200 menit. Bila lewat: Pro US$4/bulan (3.000 menit) atau batasi Playwright penuh ke PR `main` |
| GHCR private | Rp0 | Storage paket gratis dalam kuota akun. Hapus image > 30 digest lewat workflow cleanup |
| Domain | sudah ada | |
| **Total** | **Rp0 – ±Rp70rb/bulan** | Biaya utama adalah waktu pemilik: M0 ±1 hari, latihan PITR 30 menit/bulan |
