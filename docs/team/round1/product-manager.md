# Product Manager — Round 1

Peran: Product Manager DompetKu v2. Dasar: `docs/superpowers/specs/2026-10-29-dompetku-v2-design.md` (selanjutnya **SPEC**), `docs/v2/DESIGN.md`, `docs/v2/UX.md`, `docs/v2/ROADMAP.md`, `docs/audit/SUMMARY.md`, `docs/audit/00-schema-v1.md`, `docs/audit/01-features.md`, `docs/audit/05-ux.md`.

## 1. Ringkasan sikap

Masalah utama yang diselesaikan bukan "aplikasi keuangan yang lengkap", tetapi **kebiasaan mencatat yang bisa dipercaya untuk dua orang**: v1 dipakai ±5 transaksi/hari selama Mar–Sep 2026 lalu **berhenti total sejak 2026-09-05** (`00-schema-v1.md §2`), dan angkanya terbukti salah (INT-01..04). Artinya v2 berhasil hanya jika (a) angka benar sejak hari pertama, (b) mencatat lebih cepat daripada tidak mencatat, dan (c) Farida punya alasan sendiri untuk ikut — ruang Bersama adalah alasan itu. Saya setuju dengan arsitektur dan prinsip test-first, tetapi urutan milestone masih mewarisi rencana yang ada migrasinya: setelah migrasi dihapus, nilai harian harus datang lebih awal (dipakai sungguhan di akhir M1, Farida masuk di M2), dan ada celah baru yang belum dirancang, yaitu **onboarding saldo awal** (dompet, utang berjalan, aset) yang menggantikan peran migrasi. Fitur bernilai rendah/mahal (analisis AI, trip, PDF) saya geser ke belakang; tagihan rutin dan net worth saya majukan karena angka utama Beranda bergantung padanya.

## 2. Rekomendasi

| # | Prioritas | Milestone | Isi | Alasan |
|---|---|---|---|---|
| R1 | **wajib** | sebelum M0 | Tulis ulang `docs/v2/ROADMAP.md` dan sinkronkan `docs/v2/UX.md §9`. ROADMAP masih menyebut Supabase, `supabase test db`, pg_cron, M7 migrasi, dan "Risiko: pemetaan riwayat v1" di M3; UX §9 masih menandai "Berbagi dompet" sebagai *tunda*, padahal SPEC §5.4 menaruh Bersama di M1. | Dua sumber kebenaran yang bertentangan membuat subagent membangun hal yang salah. SPEC §6 berlaku, tapi kriteria rinci hanya ada di ROADMAP. |
| R2 | **wajib** | M1 | **Onboarding "Mulai dari sekarang"** (pengganti migrasi): wizard 3 langkah per ruang — (1) dompet + saldo hari ini → entri `opening_balance` (DESIGN §5 baris 110), (2) utang/piutang yang masih berjalan dengan **sisa saat ini tanpa efek kas**, (3) aset & tujuan opsional, bisa dilewati. Empty state Beranda mengarah ke wizard ini. | Tanpa migrasi, saldo awal adalah satu-satunya sumber akurasi. v1 punya 46 utang & 7 modal trading aktif (`01-features §2.3–2.4`); jika tidak bisa diinput sebagai "utang berjalan", pembayarannya akan dicatat sebagai pengeluaran biasa dan laporan salah lagi (INT-08/09). |
| R3 | **wajib** | M1 | **"Cocokkan saldo"** sebagai ritual, bukan menu tersembunyi: di detail dompet, user mengetik saldo bank nyata → app menampilkan selisih → `adjust_balance` dengan alasan. Pengingat mingguan di Beranda ("3 dompet belum dicocokkan minggu ini"). | Ini satu-satunya cara mengukur metrik akurasi saldo dari dunia nyata (lihat §5). Invarian DB hanya menjamin konsistensi internal, bukan kecocokan dengan rekening. |
| R4 | **wajib** | M0 → M8 | Susun ulang milestone (detail di bawah tabel): pecah M0 jadi M0a/M0b; hapus M7 lama dan ganti dengan **M7 Stabilisasi & Portofolio**; majukan PWA installable ke M1, tagihan rutin dasar ke M2, net worth ke M4; analisis AI ke M7/nanti. | Migrasi dihapus → M7 kosong dan cutover bisa jauh lebih awal. Rumus "aman dipakai" (UX §2) di M2 bergantung pada tagihan rutin yang baru ada di M5. Net worth (M6) bergantung pada aset/utang (M3–M4), bukan pada AI. |
| R5 | **wajib** | M1 akhir, M2 awal | **Gerbang adopsi bertahap**: Novanda memakai produksi sendirian ≥ 7 hari setelah M1 (burn-in); Farida diundang di awal M2 setelah 0 bug data selama burn-in. v1 dibekukan (ekspor arsip) saat Novanda mulai, dimatikan saat Farida masuk. | Kesan pertama Farida menentukan adopsi. Bug uang di minggu pertama = kehilangan kepercayaan yang sama yang membunuh v1. v1 sudah tidak dipakai sejak Sep, jadi tidak ada biaya menunggu. |
| R6 | **wajib** | M1 | **Instrumentasi produk minimal, self-hosted, tanpa nominal/deskripsi**: tabel `product_events` (user_id, space_kind, event, duration_ms, tap_count, suggestion_rank, ts), ditulis server-side. Event: `quick_add_opened`, `entry_saved`, `entry_undone`, `balance_reconciled`, `nothing_today`. Halaman `/admin/metrik` hanya untuk pemilik. | Tanpa ini metrik §5 tidak bisa diukur dan "≤ 3 ketukan" hanya klaim Playwright, bukan perilaku nyata. Tidak ada pihak ketiga (anti-tujuan privasi SPEC §2). |
| R7 | **sebaiknya** | M1 | Tombol **"Tidak ada pengeluaran hari ini"** di Beranda (setelah 19.00 WIB bila belum ada catatan hari itu). Menulis event, bukan entri ledger. | Membuat "% hari tercatat" jujur: hari tanpa belanja tetap dihitung tercatat, sehingga metrik tidak mendorong entri palsu. Juga pemicu kebiasaan harian. |
| R8 | **wajib** | M1–M2 | **Bersama sebagai pengait adopsi Farida**: feed aktivitas Bersama ("Farida mencatat Belanja bulanan · Rp 412.000") dan kontribusi per orang di laporan Bersama (sudah di SPEC §7a) harus ada di M2 bersama anggaran Bersama — bukan ditunda. | Farida tidak butuh modal trading atau saham; ia butuh tahu "uang bersama kita aman?". Itu nilai pertamanya. |
| R9 | **sebaiknya** | M2 (parser aturan) / M6 (LLM) | Pecah "catat teks bebas" (SPEC §5.6 #2): **parser aturan** ("35rb", "35k", alias dompet) masuk M2 di kolom keterangan quick add; fallback LLM tetap M6. | Parser aturan murah, deterministik, dan langsung menurunkan waktu catat — permintaan eksplisit pemilik. LLM menambah biaya, latensi, dan risiko privasi; tunggu data apakah parser aturan sudah cukup (target ≥ 85% teks terurai tanpa LLM). |
| R10 | **sebaiknya** | M0a | **Seed data demo deterministik + harness screenshot** (`pnpm demo:seed`, Playwright memotret daftar layar tetap di 390px & 1280px, light & dark). Persona fiktif, nama & angka realistis Indonesia. Dipakai prototipe M0, review PR, dan portofolio. | SPEC §2 memutuskan portofolio = screenshot data demo; tanpa harness, screenshot dibuat manual, tidak konsisten, dan berisiko memuat data nyata. |
| R11 | **sebaiknya** | M7 | Definisi **"impressive"** dijadikan kriteria rilis portofolio (lihat §5 bagian Portofolio), termasuk pasangan sebelum/sesudah dengan `docs/audit/screenshots/v1/` (05-ux catatan "sebelum/sesudah"). | Tanpa definisi, "layak di-screenshot" jadi selera. Dengan daftar layar & syarat yang bisa dicek, desainer dan builder punya target yang sama. |
| R12 | **nanti** | setelah M8 | Backlog terkonfirmasi: kartu kredit sebagai dompet `credit`, impor mutasi CSV, lampiran struk, notifikasi push, total keluarga lintas ruang, offline-catat, rollover anggaran. Analisis AI (skor kesehatan) **nanti** kecuali pemilik menyatakan memakainya di v1. | Semua tidak menyentuh tiga syarat inti (benar, cepat, dipakai berdua). Tidak ada data pemakaian AI v1 yang menunjukkan nilainya. |

### Urutan milestone yang diusulkan (R4)

| Baru | Isi | Gerbang keluar | Perubahan vs SPEC §6 |
|---|---|---|---|
| **M0a** Prototipe & fondasi kode | repo, CI, Postgres efemeral + pgTAP harness, design system + `/dev/ui`, seed demo (R10), prototipe klik Beranda / quick add / Transaksi / Bersama | **Pemilik menyetujui prototipe** (tertulis di ADR) | Dipecah dari M0. Bisa dinilai dalam hitungan hari, sebelum infra VM. |
| **M0b** Infra & akses | VM DB compose, proxy TLS, backup + uji restore, auth + passkey/TOTP + undangan, ruang, CD self-hosted runner, ekspor arsip v1 (sekali, read-only) | login produksi di `dompet.novandafadly.com`; restore drill lulus | Dipecah dari M0. Ekspor arsip v1 dipindah dari M7 ke sini. |
| **M1** Catat harian | dompet, kategori + saran, transaksi, transfer (lintas ruang), talangan kantor, **onboarding saldo awal (R2)**, **cocokkan saldo (R3)**, **instrumentasi (R6)**, **PWA installable** | Novanda memakai produksi; burn-in 7 hari (R5) | + R2, R3, R6, R7; PWA installable dari M6. |
| **M2** Rencana bulan & Bersama | anggaran (pribadi & Bersama), laporan, Beranda "aman dipakai", **tagihan rutin dasar** (aturan + posting manual + daftar jatuh tempo), feed Bersama, parser aturan (R9), export CSV | **Farida aktif**; v1 dimatikan | + tagihan rutin dasar (dari M5), + export CSV (dari M5), + parser aturan (dari M6). |
| **M3** Utang/piutang & modal trading | sesuai ROADMAP M3, tanpa risiko "pemetaan riwayat v1" | T6–T10 lulus | Tetap. Pertimbangkan **M3 sebelum M2** bila pemilik sering mencatat cicilan (46 utang di v1). |
| **M4** Tujuan, aset, net worth | sesuai ROADMAP M4 + snapshot net worth harian + grafik | T11 lulus | + net worth (dari M6), karena bergantung pada aset & piutang. |
| **M5** Otomasi & trip | job `recurring_materialize`, trip, export PDF | T14, T15 lulus | Tagihan rutin dasar & CSV sudah di M2. |
| **M6** Catat lebih cepat | fallback LLM teks bebas, PWA offline baca | ≥ X% teks terurai, offline baca jalan | AI analisis & net worth keluar dari M6. |
| **M7** Stabilisasi & portofolio | (menggantikan "migrasi data") audit keamanan, sweep a11y & performa, harness screenshot final, sebelum/sesudah, analisis AI bila disetujui | kriteria §5 Portofolio | Baru. |
| **M8** Bot Telegram | tetap, **bersyarat**: hanya jika Farida/Novanda memakai Telegram sehari-hari (lihat §6) | — | Tetap, plus syarat. |

## 3. Risiko utama dan mitigasi

| Risiko | Dampak | Mitigasi |
|---|---|---|
| **Farida tidak ikut memakai** (pasangan adopsi rendah) | Ruang Bersama kosong; produk jadi aplikasi satu orang | R5 (masuk setelah stabil), R8 (Bersama sebagai nilai pertama), onboarding Farida tanpa memaksa TOTP bila passkey sudah dipasang (§4-2), metrik adopsi Farida terpisah (§5), wawancara 10 menit dengan Farida sebelum M2 tentang apa yang ia ingin lihat. |
| **Kebiasaan putus lagi** (pola v1 berhenti Sep 2026) | Data bolong → laporan & anggaran tak berarti → ditinggalkan | Quick add ≤ 3 ketukan dengan saran (SPEC §5.6), R7, pengingat lembut opsional jam 20.00 (nanti, butuh push/Telegram), metrik % hari tercatat dipantau mingguan. |
| **Saldo awal salah input** | Akurasi saldo buruk sejak hari pertama, tidak ada v1 sebagai pembanding | R2 menampilkan ringkasan sebelum simpan; R3 memberi jalan koreksi eksplisit yang tercatat; `opening_balance` bisa diedit 7 hari pertama tanpa jejak "penyesuaian". |
| **Scope creep sebelum dipakai** (M0 fondasi enterprise memakan minggu) | Momentum hilang, v1 tetap tidak dipakai, tidak ada data sama sekali | Pecah M0 (R4); gerbang "dipakai" di akhir M1; fitur hanya masuk milestone bila menyentuh benar/cepat/dipakai berdua. |
| **Rumus "aman dipakai" tidak dipercaya** | Angka utama Beranda diabaikan | Validasi rumus dengan pemilik di prototipe M0a (ROADMAP M2 "Risiko"); penjelasan rumus selalu terlihat (UX §2); tagihan rutin dasar di M2. |
| **Screenshot portofolio membocorkan data nyata** | Pelanggaran privasi pasangan | Hanya dari seed demo (R10); harness menolak berjalan bila `DATABASE_URL` mengarah ke produksi. |

## 4. Ketidaksetujuan dengan desain saat ini

1. **ROADMAP.md dan UX.md §9 basi** (R1). SPEC menang, tapi dokumen rinci harus diperbarui sebelum M0, bukan "diperbarui untuk revisi ini" yang belum terjadi.
2. **"TOTP 2FA wajib untuk kedua akun setelah onboarding" (SPEC §5.3).** Usul: syarat menjadi **passkey ATAU password + TOTP**. Passkey sudah faktor kuat dan tahan phishing; memaksa TOTP pada Farida yang sudah memakai passkey menambah gesekan tanpa menambah keamanan berarti. Trade-off: perangkat hilang → perlu passkey kedua atau kode pemulihan; wajibkan minimal 2 passkey atau kode pemulihan. Keputusan akhir di Security.
3. **Beranda "aman dipakai" di M2, tagihan rutin di M5.** Angka utama akan memakai rumus yang tidak lengkap selama 3 milestone. Usul: tagihan rutin dasar ke M2 (R4). Alternatif: tetap M5 dan Beranda M2 menampilkan rumus tanpa tagihan dengan label eksplisit — lebih murah, tetapi angka utama terlalu optimis.
4. **Net worth di M6 bersama AI.** Tidak ada ketergantungan pada AI; ketergantungannya pada aset & piutang (M3–M4). Pindah ke M4.
5. **M7 setelah migrasi dihapus**: SPEC §6 menyisakan "arsip ekspor v1 + cutover sederhana". Itu bukan milestone; ekspor arsip dipindah ke M0b, cutover menjadi gerbang M1/M2 (R5). Slot M7 dipakai untuk stabilisasi & portofolio.
6. **Analisis AI (skor kesehatan, insight)** dipertahankan di matriks (`SUMMARY.md §2` "Ubah"). Saya usul **nanti**: tidak ada bukti pemakaian di v1, biaya & risiko privasi nyata, dan nilainya kecil untuk dua orang yang melihat laporannya sendiri. Bila pemilik ingin untuk portofolio, letakkan di M7.
7. Matriks fitur `SUMMARY.md §2` lainnya **saya setujui**, dengan dua catatan: (a) **Trip** tetap dipertahankan tapi bukan prioritas (9 trip di v1) — M5 sudah tepat; (b) **Tagihan rutin** punya 0 baris di v1 — pertahankan karena dipakai rumus Beranda, tapi ukur pemakaiannya; bila tetap 0 setelah 8 minggu, sederhanakan rumus.

## 5. Kriteria penerimaan (bisa dicek/dites)

### Metrik keberhasilan produk (diukur dari `product_events`, R6)

| Metrik | Definisi | Target | Diukur mulai |
|---|---|---|---|
| **% hari tercatat** (north star) | hari WIB dengan ≥ 1 `entry_saved` atau `nothing_today`, per orang, jendela 28 hari | Novanda ≥ 85%, Farida ≥ 60% pada minggu ke-4 setelah masing-masing mulai; bertahan 8 minggu | M1 / M2 |
| Waktu catat | `quick_add_opened` → `entry_saved` terkonfirmasi server | median ≤ 8 dtk, p90 ≤ 20 dtk | M1 |
| Ketukan catat | `tap_count` pengeluaran via quick add | ≥ 70% catatan ≤ 3 ketukan | M1 |
| Akurasi saran kategori | kategori terpilih ada di 6 chip saran | ≥ 60% setelah 2 minggu data | M1 |
| **Akurasi saldo** | dari "Cocokkan saldo": % pencocokan dengan selisih 0; Σ\|penyesuaian\| ÷ Σ pengeluaran 28 hari | ≥ 90% cocok tanpa penyesuaian; rasio ≤ 2% | M1 |
| Integritas internal | saldo = Σ entry_lines untuk semua akun (job harian) | 0 selisih, selalu | M1 |
| Adopsi Bersama | minggu dengan ≥ 1 entri Bersama dari **masing-masing** orang | ≥ 3 dari 4 minggu | M2 |
| Pemakaian undo | `entry_undone` ÷ `entry_saved` | ≤ 5% (lebih tinggi = form membingungkan) | M1 |

### Kriteria penerimaan per area

- **Onboarding (R2):** akun baru tanpa dompet melihat CTA wizard di Beranda; wizard selesai ≤ 3 menit untuk 5 dompet + 3 utang (diukur di uji pemakaian dengan pemilik); utang berjalan tidak membuat entri income/expense (pgTAP: laporan periode berjalan tidak berubah setelah input utang berjalan).
- **Cocokkan saldo (R3):** Playwright: masukkan saldo nyata berbeda → dialog menampilkan selisih → simpan → saldo = angka nyata, `entry_history` mencatat alasan; selisih 0 → tidak membuat entri, hanya event.
- **Gerbang M1:** Novanda mencatat di produksi ≥ 7 hari berturut-turut, 0 insiden data (selisih invarian, entri hilang, kebocoran ruang).
- **Gerbang M2:** Farida login dengan passkey, mencatat ≥ 1 entri Pribadi dan ≥ 1 Bersama di minggu pertama; v1 dalam mode read-only/arsip.
- **Instrumentasi (R6):** grep CI memastikan `product_events` tidak punya kolom nominal/deskripsi; pgTAP: Farida tidak bisa membaca event Novanda; halaman metrik hanya untuk pemilik (tes 403).
- **Rumus aman dipakai:** angka Beranda = fungsi `dashboard_summary` pada dataset golden; komponen rumus tampil di layar (UX §2).

### Portofolio — definisi "impressive" (M7)

Set screenshot dari seed demo, dibuat otomatis oleh harness (R10), 390px dan 1280px, light dan dark:
1. Beranda "aman dipakai" dengan rumus terurai.
2. Quick add sheet dengan 6 chip saran + nominal terformat.
3. Daftar transaksi dengan pengelompokan "Hari ini/Kemarin" dan segmen Pribadi/Kantor/Reimburse.
4. Dialog akibat uang ("Saldo BCA bertambah Rp200.000. Sisa utang ke Budi menjadi Rp800.000.").
5. Laporan dengan blok "Tidak termasuk".
6. Ruang Bersama: kontribusi per orang + feed aktivitas.
7. Detail utang dengan riwayat pembayaran; tujuan tabungan dengan proyeksi.
8. Pasangan sebelum/sesudah v1 vs v2 pada alur & viewport yang sama dengan `docs/audit/05-ux.md`.

Syarat tiap screenshot: axe 0 serious/critical; tidak ada teks < 12px; semua angka `tabular-nums` dan format sesuai UX §7; tidak ada lorem/placeholder/"Rp 0" di semua kartu; tidak ada emoji sebagai ikon; nama & angka demo realistis (bukan "John Doe"). Pelengkap teknik (untuk studi kasus): jumlah tes pgTAP, property test 1.000 operasi acak, bukti restore drill, skor Lighthouse.

## 6. Pertanyaan / permintaan untuk peran lain

- **Pemilik (Novanda):** (1) Apakah Farida memakai Telegram sehari-hari? Bila tidak, M8 bot Telegram kehilangan nilai adopsi — apakah WhatsApp tetap ditunda? (2) Apakah analisis AI v1 pernah dipakai rutin? (3) Berapa banyak utang/piutang & modal trading yang masih berjalan dan harus diinput saat onboarding? (4) Setuju M3 (utang) sebelum M2 (anggaran)? (5) Bolehkan saya mewawancarai Farida 10 menit sebelum M2?
- **UX Designer:** rancang alur onboarding saldo awal (R2), "Cocokkan saldo" (R3), tombol "Tidak ada pengeluaran hari ini" (R7), dan feed Bersama; perbarui UX §9.
- **Backend / Data Engineer:** fungsi `create_loan` dengan mode "utang berjalan" (sisa awal tanpa efek kas); skema `product_events` dan query metrik §5.
- **Security Engineer:** tinjau usulan "passkey ATAU password+TOTP" (§4-2) dan kebijakan kode pemulihan.
- **QA / Test Engineer:** tes Playwright penghitung ketukan & durasi quick add; dataset golden untuk `dashboard_summary`; guard harness screenshot terhadap DB produksi.
- **DevOps / SRE:** apakah M0b (infra) bisa berjalan paralel dengan M0a tanpa memblokir penilaian prototipe? Estimasi waktu restore drill pertama.
- **Tech Lead:** setuju memecah M0 dan menyusun ulang M2/M4/M6/M7 seperti §2? Siapa memperbarui ROADMAP.md (R1)?
