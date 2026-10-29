# Product Owner — Ronde 1

Peran: Product Owner DompetKu v2. Dasar: `docs/superpowers/specs/2026-10-29-dompetku-v2-design.md` (selanjutnya **SPEC**), `docs/v2/DESIGN.md` (**DESIGN**), `docs/v2/UX.md` (**UX**), `docs/v2/ROADMAP.md` (**ROADMAP**), `docs/audit/01-features.md` (**FEAT**), `docs/audit/02-integrity.md` (**INT**).

## 1. Ringkasan sikap

Tidak ada migrasi data, jadi v2 baru bernilai saat Novanda dan Farida **berhenti memakai v1/catatan lain dan mencatat setiap hari di v2**. Karena itu backlog diurutkan menuju satu target: **Irisan Harian #1** (login → dompet dengan saldo awal → catat pengeluaran ≤ 3 ketukan dengan saran kategori → lihat/edit/urungkan → data aman di-backup) secepatnya setelah M0, sebelum transfer, anggaran, atau fitur lain. Aturan uang v1 yang bernilai (FEAT §2) tidak dinegosiasikan: setiap aturan menjadi kriteria Given/When/Then yang dites di pgTAP/Playwright, bukan catatan di kepala. Ruang Pribadi/Bersama adalah batas privasi, bukan fitur tambahan: isolasi diuji sejak story pertama yang menyimpan data. Backlog dibatasi 40 story; yang tidak masuk tercatat di "Di luar backlog".

## 2. Rekomendasi

| # | Prioritas | Milestone | Isi | Alasan |
|---|---|---|---|---|
| R1 | wajib | M0–M1 | Tetapkan **Irisan Harian #1** (§7.1) sebagai tujuan rilis pertama ke produksi; semua story di dalamnya selesai sebelum story M1 lain dimulai. | Mulai dari nol → nilai baru muncul saat dipakai harian; umpan balik nyata paling cepat (SPEC §4.2 C). |
| R2 | wajib | M0 | Backup + uji restore (S-07) adalah syarat **sebelum** data nyata pertama masuk produksi, bukan pekerjaan M0 "nanti". | Anti-tujuan "kehilangan data" (SPEC §2); INT-02 membuktikan v1 kehilangan data. |
| R3 | wajib | M1 | Ruang entri **diturunkan dari dompet** yang dipilih, bukan dari pengalih ruang terpisah. Quick add menampilkan lencana ruang dan chip kategori mengikuti ruang dompet. | Menjaga ≤ 3 ketukan (UX §3.1) sekaligus mencegah salah ruang (kategori Bersama di dompet pribadi). Lihat §4-K2. |
| R4 | wajib | M1 | Saran kategori punya **cold start**: tanpa riwayat, tampilkan kategori seed paling umum per jam (mis. 11–14 → Makan). | Mulai dari nol berarti riwayat kosong; SPEC §5.6-1 hanya mendefinisikan saran dari riwayat. |
| R5 | wajib | M1 | Onboarding "Buat dompet + saldo awal" sebagai entri `opening_balance` (bukan kolom saldo), termasuk wizard 1 layar untuk banyak dompet. | Tanpa migrasi, saldo awal adalah satu-satunya jembatan ke kondisi nyata; INT-05. |
| R6 | wajib | M1–M2 | Aturan pribadi dipusatkan: kantor, transfer internal, pokok utang, talangan & penggantiannya **tidak** masuk pemasukan/pengeluaran di semua layar (Beranda, laporan, anggaran, export, AI). Satu fungsi DB, satu set tes golden numbers. | INT-08/09; FEAT §2.1 mencatat inkonsistensi v1. |
| R7 | wajib | M1 | Isolasi Pribadi vs Bersama diuji pgTAP dua user di setiap story yang menambah tabel/fungsi/laporan (masuk DoD). | Anti-tujuan "data pasangan terlihat" (SPEC §2, §5.4). |
| R8 | wajib | M0 | Perbarui `docs/v2/ROADMAP.md` ke revisi 2 sebelum M1 (masih menyebut Supabase, pg_cron, migrasi v1 di M7). | Dokumen bertentangan membuat DoD ambigu (lihat §4-K1). |
| R9 | sebaiknya | M1 | `MoneyInput` sudah menerima "35rb", "35k", "1,5jt" sejak M1 (parser nominal saja, tanpa LLM). | Murah, mempercepat catat harian; parser yang sama dipakai ulang di M6/M8. |
| R10 | sebaiknya | M1 | Feed aktivitas Bersama (siapa mencatat/mengedit apa) masuk M1, bukan menunggu M2. | Hak setara di Bersama (SPEC §7a) hanya aman bila perubahan terlihat oleh pasangan. |
| R11 | sebaiknya | M2 | Prototipe klik M0 dinilai pemilik **dan** Farida dengan skenario tertulis (catat makan siang, setor ke Bersama). | Pengguna kedua punya pola berbeda; murah diperbaiki sebelum UI dibangun. |
| R12 | nanti | M6 | Catat teks bebas tetap M6 (parser + fallback LLM), kecuali parser aturan sudah stabil dari R9 → boleh ditarik ke M2 sebagai "sebaiknya". | SPEC §5.6-2; nilai besar tetapi bergantung saran kategori dan alias dompet yang matang. |

## 3. Backlog

Konvensi: `S-xx` · **Persona** (N = Novanda, F = Farida) · Prioritas (W/Sb/N = wajib/sebaiknya/nanti) · ⭐ = bagian **Irisan Harian #1** · Rujukan.
Semua nominal bigint rupiah, tanggal kalender WIB. "Pribadi-N" = ruang Pribadi Novanda, "Pribadi-F" = milik Farida.

### M0 — Fondasi (detail penuh)

**S-01 ⭐ Masuk dengan aman** · W · SPEC §5.3
Sebagai Novanda, saya ingin masuk dengan passkey atau email+password lalu TOTP, agar hanya saya yang bisa membuka data keuangan saya.
- Given email ada di `AUTH_ALLOWED_EMAILS` dan 2FA aktif, When password benar dan kode TOTP benar, Then sesi dibuat (cookie `HttpOnly; Secure; SameSite=Lax`) dan saya diarahkan ke Beranda.
- Given passkey terdaftar, When saya memilih "Masuk dengan passkey", Then saya masuk tanpa password dan tanpa TOTP tambahan.
- Given email tidak ada di allowlist, When mencoba mendaftar atau masuk, Then ditolak dengan pesan generik yang tidak membocorkan apakah email terdaftar.
- Given 5 percobaan gagal dari IP/akun yang sama dalam 15 menit, When percobaan ke-6, Then ditolak dengan rate limit/lockout bertahap dan tercatat di audit log.
- Given akun baru selesai onboarding tanpa TOTP, When membuka halaman apa pun selain pengaturan 2FA, Then diarahkan wajib mengaktifkan TOTP atau passkey.

**S-02 ⭐ Undang pasangan** · W · SPEC §5.3, §7a
Sebagai Novanda, saya ingin mengundang Farida lewat tautan sekali pakai, agar ia punya akun sendiri dan bergabung ke ruang Bersama.
- Given saya pemilik, When membuat undangan untuk email Farida, Then terbentuk tautan unik berlaku 72 jam, dan aksi tercatat di audit log.
- Given tautan sudah dipakai atau kedaluwarsa, When dibuka lagi, Then ditolak dengan pesan "Undangan tidak berlaku, minta undangan baru".
- Given Farida menyelesaikan pendaftaran, Then Pribadi-F dibuat dengan beranggota hanya Farida, dan Farida menjadi anggota ruang Bersama.
- Given akun Farida, When ia mencoba membuat undangan, Then ditolak (hanya pemilik rumah tangga).

**S-03 ⭐ Ruang Pribadi dan Bersama** · W · SPEC §5.4
Sebagai Farida, saya ingin punya ruang Pribadi yang tidak bisa dilihat Novanda dan satu ruang Bersama, agar saya bebas mencatat tanpa kehilangan privasi.
- Given dua akun aktif, Then terdapat tepat 1 `households`, 2 ruang `personal` (masing-masing 1 anggota) dan 1 ruang `shared` (2 anggota).
- Given saya di app, When membuka pengalih ruang, Then saya melihat "Pribadi" dan "Bersama" saja, dan ruang aktif terlihat di header di setiap layar.
- Given pgTAP sebagai Farida (`app.user_id` = F), When `select` dari setiap tabel domain dengan baris milik Pribadi-N, Then 0 baris; When `insert/update` merujuk `space_id` Pribadi-N, Then ditolak.
- Given koneksi tanpa `app.user_id`, When query tabel domain apa pun, Then 0 baris (bukan error yang membocorkan data).

**S-04 Kelola sesi dan perangkat** · Sb · SPEC §5.3
Sebagai Novanda, saya ingin melihat perangkat yang sedang masuk dan mencabutnya, agar HP yang hilang tidak bisa membuka data.
- Given 2 sesi aktif, When saya membuka Pengaturan › Keamanan, Then terlihat perangkat, perkiraan lokasi/IP, dan waktu terakhir aktif.
- When saya mencabut sesi lain, Then request berikutnya dari sesi itu mendapat 401 dan diarahkan ke login; aksi tercatat di audit log.

**S-05 Prototipe klik untuk dinilai** · W · SPEC §6 M0, UX §2–3
Sebagai Novanda, saya ingin mencoba prototipe klik Beranda, catat cepat, dan Transaksi dengan data demo, agar saya bisa menolak arah UI sebelum dibangun sungguhan.
- Given prototipe di 390px dan 1280px, When saya menjalankan skenario tertulis (catat makan siang Rp35.000 dari BCA; lihat daftar hari ini; setor Rp500.000 ke Bersama), Then setiap skenario selesai tanpa penjelasan lisan.
- Then axe 0 pelanggaran serious/critical; semua pasangan warna memakai token UX §5.
- Then keputusan pemilik (setuju/ubah) dicatat sebagai ADR sebelum UI M1 dimulai.

**S-06 ⭐ App dapat diakses di domainnya** · W · SPEC §5.7
Sebagai Novanda, saya ingin membuka `https://dompet.novandafadly.com` dari HP, agar saya bisa mencatat di mana saja.
- Given merge ke `main` dengan CI hijau, When job deploy berjalan, Then migrasi diterapkan, web+worker naik, `/api/health` 200, atau rollback otomatis ke image sebelumnya.
- Then port Postgres tidak terjangkau dari internet (uji dari luar VCN: koneksi ditolak).
- Then header HSTS, CSP (nonce), `X-Frame-Options: DENY` hadir di respons HTML.

**S-07 ⭐ Data tidak pernah hilang** · W · SPEC §5.7
Sebagai Novanda, saya ingin backup otomatis yang terbukti bisa dipulihkan, agar kerusakan VM tidak menghapus catatan keuangan kami.
- Given WAL-G aktif, When saya memeriksa bucket, Then ada base backup ≤ 24 jam dan WAL ≤ 5 menit terakhir (RPO ≤ 5 menit).
- Given job `backup_verify`, When dijalankan, Then backup dipulihkan ke container sementara, pgTAP rekonsiliasi lulus, hasil masuk `job_runs`; gagal → email alert ke pemilik.
- Given runbook restore, When pemilik menjalankannya di latihan, Then data kembali dalam ≤ 1 jam (RTO) dan langkah tercatat.
- Story ini **harus Done sebelum data nyata pertama** di produksi.

### M1 — Dompet, kategori, transaksi, transfer (detail penuh)

**S-10 ⭐ Buat dompet dengan saldo awal** · W · FEAT §2.1, DESIGN §4–5, INT-05
Sebagai Novanda, saya ingin membuat dompet (nama, jenis, pocket, saldo awal), agar saldo di app sama dengan saldo nyata hari ini.
- Given ruang Pribadi aktif, When saya membuat "BCA", jenis bank, pocket Operasional, saldo awal Rp4.100.000, Then terbentuk akun dan satu entri `opening_balance` +4.100.000; saldo = Σ lines = 4.100.000.
- Given wizard onboarding, When saya mengisi 4 dompet sekaligus, Then 4 akun + 4 entri dibuat dalam satu transaksi; satu gagal validasi → tidak ada yang tersimpan.
- Given ruang Bersama aktif, When membuat dompet, Then pilihan pocket hanya Operasional/Tabungan (pocket Kantor hanya di Pribadi, SPEC §5.4).
- Given saldo awal Rp0, Then tidak ada entri dibuat (amount ≠ 0).
- Then tidak ada kolom saldo yang bisa ditulis; edit nama/pocket tidak mengubah saldo.

**S-11 Sesuaikan saldo** · W · INT-05
Sebagai Farida, saya ingin mengoreksi saldo dompet ke angka nyata, agar selisih terlihat sebagai penyesuaian, bukan diam-diam.
- Given saldo app Rp1.000.000 dan saldo nyata Rp950.000, When saya pilih "Sesuaikan saldo" dan isi 950.000, Then dibuat entri `adjustment` −50.000 dengan keterangan, saldo = 950.000.
- Then entri `adjustment` tidak masuk pemasukan/pengeluaran di laporan, tetapi tampil di riwayat dompet dengan label "Penyesuaian".

**S-12 ⭐ Kategori 2 level per ruang** · W · FEAT §2.8, DESIGN §5
Sebagai Novanda, saya ingin kategori dan subkategori siap pakai di tiap ruang, agar saya langsung bisa mencatat tanpa menyiapkan apa pun.
- Given ruang Pribadi baru, Then ter-seed kategori default pengeluaran & pemasukan; ruang Bersama ter-seed kategori rumah tangga (mis. Belanja dapur, Listrik, Air, Sewa).
- When saya membuat sub dari sub, Then ditolak (maks 2 level); sub harus bertipe sama dengan induk.
- Given kategori sudah dipakai entri, When saya menghapusnya, Then kategori diarsipkan (tidak muncul di pemilih) dan entri lama tetap menunjuknya.
- Given entri memakai subkategori, Then `entries.category_id` = subkategori (paling spesifik) dan induk diturunkan.
- Then kategori Pribadi-N tidak terlihat dan tidak bisa dirujuk dari Pribadi-F atau Bersama (FK komposit + pgTAP).

**S-13 ⭐ Catat pengeluaran/pemasukan ≤ 3 ketukan** · W · UX §3.1, ROADMAP M1
Sebagai Novanda, saya ingin mencatat "makan siang Rp35.000" dari layar mana pun dalam 3 ketukan, agar saya tidak malas mencatat.
- Given layar apa pun, When saya ketuk (+), ketik 35000, ketuk chip "Makan", ketuk Simpan, Then entri `expense` −35.000 tersimpan, tanggal = hari ini WIB, dompet = terakhir dipakai; Playwright menghitung ≤ 3 ketukan setelah nominal.
- Given pukul 00:30 WIB, When mencatat tanpa ubah tanggal, Then `occurred_on` = tanggal WIB hari itu (bukan kemarin; INT-07).
- Given koneksi lambat, When Simpan ditekan dua kali atau request diulang, Then hanya satu entri (idempotensi `client_id`); tombol nonaktif + spinner selama menyimpan.
- Then toast "Tersimpan · Rp 35.000 dari BCA" dengan **Urungkan** 10 detik; Urungkan → entri di-void, saldo kembali.
- Given nominal 0, negatif, atau desimal, Then ditolak di client dan server dengan pesan Indonesia; tidak ada entri.
- Given dompet dari ruang Bersama dipilih, Then lencana ruang berubah ke "Bersama", chip kategori berganti ke kategori Bersama, dan entri tersimpan di ruang Bersama (R3).
- Given tab Pemasukan, When mencatat gaji Rp9.500.000, Then entri `income` +9.500.000 dengan kategori pemasukan.

**S-14 ⭐ Saran kategori** · W · SPEC §5.6-1
Sebagai Farida, saya ingin app menebak kategori yang saya maksud, agar cukup satu ketukan untuk memilih.
- Given riwayat ruang aktif berisi ≥ 5 entri "Makan" pada 11.00–14.00 dari dompet GoPay, When saya membuka quick add pukul 12.10 dengan dompet GoPay, Then "Makan" ada di 6 chip teratas.
- Given saya mengetik keterangan "kopi", When riwayat punya "kopi" berkategori "Jajan", Then "Jajan" menjadi chip pertama.
- Given ruang tanpa riwayat (cold start), Then 6 chip berisi kategori seed dengan urutan default per rentang jam (R4), tidak pernah kosong.
- Then `api.suggest_categories` hanya membaca entri ruang aktif yang boleh dilihat user (pgTAP: riwayat Pribadi-N tidak memengaruhi saran Farida).
- Then latensi p95 saran ≤ 150 ms pada 20.000 entri (tes kinerja di CI dengan fixture).

**S-15 ⭐ Edit transaksi dengan aman** · W · INT-02/03, T1–T3, T5
Sebagai Novanda, saya ingin mengubah nominal atau kategori transaksi, agar salah ketik bisa diperbaiki tanpa merusak saldo.
- Given expense 100.000, When diedit jadi 300.000, Then saldo berkurang 300.000 total, id entri sama, `version` +1, versi lama ada di `entry_history` (T1).
- Given edit dengan nominal ≤ 0, Then ditolak dan entri asli utuh (T2).
- Given exception di tengah `update_entry`, Then rollback penuh; saldo dan baris seperti semula (T3).
- Given dua perangkat membuka entri yang sama, When keduanya menyimpan dengan `version` lama, Then yang kedua ditolak dengan pesan "Transaksi sudah diubah di perangkat lain. Muat ulang?" (T5).
- Given entri di ruang Bersama, When Farida mengedit entri yang dicatat Novanda, Then diizinkan, `updated_by` = Farida, dan muncul di feed aktivitas (S-23).

**S-16 ⭐ Hapus dan pulihkan transaksi** · W · DESIGN §4 (soft delete), §12-8
Sebagai Farida, saya ingin menghapus transaksi dengan akibat yang jelas dan bisa dibatalkan, agar tidak ada data hilang karena salah ketuk.
- Given expense 35.000 dari BCA, When saya pilih Hapus, Then dialog menampilkan akibat dari server: "Saldo BCA akan bertambah Rp 35.000".
- When dikonfirmasi, Then entri di-void (`voided_at`, `voided_reason`), saldo kembali, toast Urungkan 10 detik.
- Given entri void < 90 hari, When saya pulihkan dari riwayat, Then entri aktif lagi dengan id sama.
- Given entri void > 90 hari, When job `purge_voided` berjalan, Then entri dihapus permanen; dua kali jalan = hasil sama.

**S-17 ⭐ Daftar transaksi** · W · UX §1, §4; ROADMAP M1
Sebagai Novanda, saya ingin melihat, mencari, dan memfilter transaksi, agar saya bisa menemukan catatan kapan pun.
- Given 120 entri, When membuka Transaksi, Then 50 pertama tampil dikelompokkan "Hari ini/Kemarin/Sen, 27 Okt"; "Muat lagi" memuat 50 berikutnya (kursor); tidak ada pemotongan diam-diam.
- When mencari "kopi", Then hanya entri berketerangan/kategori cocok di ruang aktif.
- Given ruang Pribadi, Then ada segmen Pribadi / Kantor / Reimburse; Kantor = entri dari dompet pocket kantor; Reimburse = expense `reimbursable` belum dilunasi.
- Then empty state ber-CTA, skeleton saat load, error state "Coba lagi"; axe 0 serious/critical.

**S-18 Detail dompet** · W · UX §1 (tab Dompet)
Sebagai Farida, saya ingin melihat saldo dan riwayat per dompet dikelompokkan per pocket, agar saya tahu uang ada di mana.
- Given dompet di 3 pocket, Then halaman Dompet mengelompokkan per pocket dengan subtotal; total "Uang pribadi" **tidak** termasuk pocket kantor (FEAT §2.1).
- When membuka satu dompet, Then saldo = Σ lines entri non-void dan riwayat berurutan tanggal; pgTAP rekonsiliasi T18 lulus.
- Given dompet diarsipkan dengan saldo ≠ 0, Then ditolak dengan pesan "Pindahkan saldo dulu".

**S-19 Transfer antar dompet sendiri** · W · FEAT §3 (gabung transfer), UX §3.2
Sebagai Novanda, saya ingin memindahkan uang BCA → Darurat dengan biaya admin, agar saldo kedua dompet benar dan biaya tercatat.
- Given BCA 2.000.000, When transfer 1.000.000 + biaya 6.500 ke Darurat, Then satu entri `transfer` dengan lines BCA −1.006.500, Darurat +1.000.000, fee 6.500; ringkasan sebelum simpan menampilkan ketiga angka.
- Then pemasukan/pengeluaran laporan tidak berubah kecuali biaya 6.500 tampil sebagai "Biaya admin" (I6).
- Given saldo BCA kurang, Then peringatan inline (bukan `confirm()`), tetap bisa lanjut dengan konfirmasi eksplisit.
- Given edit transfer, Then id stabil, lines diganti atomik, `entry_history` bertambah (tidak ada hapus+insert seperti v1, INT-02).

**S-20 Setor ke Bersama dan ambil dari Bersama** · W · SPEC §5.4, §7a
Sebagai Farida, saya ingin menyetor Rp500.000 dari dompet pribadi ke dompet Bersama, agar kontribusi saya tercatat tanpa terlihat sebagai pengeluaran.
- Given GoPay (Pribadi-F) dan Kas Rumah (Bersama), When transfer 500.000, Then satu entri `transfer` header di ruang sumber; Pribadi-F menampilkan "Setor ke Bersama", Bersama menampilkan "Setoran dari Farida" **tanpa nama dompet sumber**.
- Then laporan Pribadi-F: bukan pengeluaran; laporan Bersama: bukan pemasukan; kontribusi Farida +500.000.
- Given Novanda di ruang Bersama, When mencoba mengedit/membatalkan setoran Farida, Then ditolak (hanya pencatat).
- Given Novanda mengambil 200.000 dari Bersama ke BCA, Then Bersama menampilkan "Diambil oleh Novanda", diizinkan untuk anggota mana pun.
- Then pgTAP: Novanda tidak dapat membaca line atau akun GoPay milik Farida lewat entri lintas ruang ini.

**S-21 Talangan kantor dan reimburse** · W · FEAT §2.2, DESIGN §12-5
Sebagai Novanda, saya ingin menandai pengeluaran yang saya talangi untuk kantor dan mencatat penggantiannya, agar laporan pribadi tidak menggembung.
- Given expense 250.000 dari BCA (pocket operasional) ditandai `reimbursable`, Then tidak dihitung pengeluaran pribadi di laporan/anggaran/Beranda; tampil di segmen Reimburse "Menunggu reimburse Rp 250.000".
- When saya `settle_reimbursement` ke BCA tanggal tertentu, Then entri `reimbursement` +250.000 tertaut ke entri asal; bukan pemasukan; segmen Reimburse kosong.
- Given pembatalan reimburse, Then entri `reimbursement` di-void dan expense kembali ke status menunggu (tidak ada income yatim seperti v1).
- Given dompet pocket kantor, Then opsi `reimbursable` tidak tersedia; transaksi di dompet kantor tidak masuk angka pribadi (T16).
- Given ruang Bersama, Then fitur talangan tidak tersedia (SPEC §5.4).

**S-22 ⭐ Isolasi terbukti** · W · SPEC §5.4, T12
Sebagai Farida, saya ingin jaminan teruji bahwa Novanda tidak bisa melihat atau mengubah data Pribadi saya, agar saya percaya memakai app ini.
- Given pgTAP dua user, Then untuk **setiap** tabel domain × SELECT/INSERT/UPDATE/DELETE × setiap fungsi `api.*`: user A tidak bisa membaca, menulis, atau merujuk baris Pribadi user B.
- Given tabel baru tanpa RLS + `FORCE ROW LEVEL SECURITY`, Then tes "semua tabel domain ber-RLS" gagal di CI.
- Given role `dompetku_app`, When `insert into entries` langsung, Then ditolak (permission denied).

**S-23 Feed aktivitas Bersama** · Sb · SPEC §7a
Sebagai Novanda, saya ingin melihat siapa mencatat, mengedit, atau menghapus apa di ruang Bersama, agar kami tidak saling curiga soal angka.
- Given Farida mengedit entri Bersama dari 50.000 ke 75.000, Then feed menampilkan "Farida mengubah Belanja dapur: Rp 50.000 → Rp 75.000 · 10.32".
- Then feed hanya berisi kejadian ruang Bersama; tidak pernah kejadian ruang Pribadi.

### M2 — Anggaran, laporan, Beranda (detail penuh)

**S-30 Anggaran per kategori per ruang** · W · FEAT §2.8, T17, UX §3.5
Sebagai Farida, saya ingin anggaran bulanan per kategori di Pribadi dan di Bersama, agar kami tahu batas belanja masing-masing.
- Given anggaran Makan Rp1.500.000 Oktober, When ada expense Makan›Makan siang 35.000 dan Makan›Kopi 20.000, Then realisasi Makan = 55.000 (induk menjumlah anak, T17).
- Given expense tanggal 31 Okt 23:30 WIB, Then masuk realisasi Oktober (T13).
- Given expense dompet kantor atau `reimbursable`, Then tidak masuk realisasi.
- When "Salin dari bulan lalu", Then kategori yang sudah punya anggaran bulan ini tidak ditimpa.
- When kategori ditandai "wajib", Then sisa anggarannya dipakai rumus aman dipakai (S-33).
- Given anggaran Bersama, Then hanya pengeluaran ruang Bersama yang dihitung.

**S-31 Rencana zero-based** · Sb · FEAT §2.8
Sebagai Novanda, saya ingin merencanakan pemasukan − anggaran − alokasi tabungan = 0, agar setiap rupiah punya tujuan.
- Given estimasi pemasukan 10.000.000, anggaran total 7.000.000, alokasi tabungan 2.500.000, Then "Belum dialokasikan Rp 500.000"; = 0 → status "Seimbang".
- Then alokasi disimpan sebagai baris (`budget_plan_allocations`), bukan JSON.

**S-32 Laporan periode jujur** · W · INT-07/08/09, UX §3.6
Sebagai Novanda, saya ingin laporan pemasukan, pengeluaran, selisih, dan tingkat menabung, agar saya tahu kondisi keuangan yang sebenarnya.
- Given dataset fixture tetap, Then angka laporan = golden numbers tersimpan (pgTAP).
- Then pemasukan/pengeluaran mengecualikan: dompet kantor, transfer internal & lintas ruang, `opening_balance`, `adjustment`, pokok/cicilan utang, talangan & reimburse, pencairan goal; bagian "Tidak termasuk" menampilkan total tiap kelompok.
- Given periode bulan Oktober, Then mencakup 1–31 Okt WIB (T13).
- Then grafik 6 bulan di-load lazy; laporan Bersama menampilkan kontribusi per orang (setoran dikurangi pengambilan), tanpa logika pelunasan.

**S-33 Beranda "aman dipakai"** · W · UX §2
Sebagai Farida, saya ingin satu angka "aman dipakai sampai akhir bulan" beserta rumusnya, agar saya tahu boleh jajan atau tidak.
- Given operasional 4.100.000, tagihan belum diposting s/d akhir bulan 960.000, sisa anggaran wajib 800.000, Then tampil Rp2.340.000 dan rincian ketiga komponen; ≈ per hari = angka / hari tersisa (WIB, termasuk hari ini).
- Given tanpa anggaran dan tagihan, Then rumus disederhanakan menjadi saldo operasional dan dijelaskan apa adanya.
- Given hasil negatif, Then tampil negatif dengan warna `expense` dan teks penjelas, bukan disembunyikan.
- Then pocket tabungan dan kantor tidak masuk angka; Beranda Bersama memakai dompet operasional Bersama saja.
- Then First Load JS Beranda ≤ 150 kB.

**S-34 Beranda ringkas** · Sb · UX §2
Sebagai Novanda, saya ingin Beranda menampilkan anggaran hampir habis dan 5 transaksi terakhir, agar saya tidak perlu membuka banyak layar.
- Given anggaran ≥ 80%, Then tampil di kartu Anggaran dengan persen sebagai teks (bukan hanya warna); > 100% diberi label "Lewat".
- Then 5 transaksi terakhir ruang aktif tampil dikelompokkan per hari.

### M3–M8 — ringkas (kriteria inti; dirinci saat refinement)

| ID | Ms | Prio | Story | Kriteria inti (dites) |
|---|---|---|---|---|
| S-40 | M3 | W | Sebagai Novanda, saya ingin mencatat utang/piutang ke kontak dan cicilannya, agar sisa selalu benar. | Pokok `debt_principal` bukan pemasukan/pengeluaran (§12-4); sisa = pokok − Σ pembayaran (view); edit keterangan tidak mengubah saldo/cicilan (T6, repro S4 v2); bayar > sisa ditolak + tawaran "Bayar sisa Rp…" (T7, §12-7); batal cicilan membalik saldo & sisa, riwayat menandai batal (T8); hapus utang = void semua efek atomik (T9); hanya ruang Pribadi. |
| S-41 | M3 | W | Sebagai Novanda, saya ingin mencatat modal trading dari dompet/aset ke dompet trading, agar uang yang "dipinjam ke diri sendiri" tetap terlacak. | Lewat transfer (I6: income/expense tidak berubah, T10); pengembalian sebagian benar; peringatan "Kurang Rp…" bila Σ sisa modal > saldo dompet trading. |
| S-42 | M3 | Sb | Sebagai Farida, saya ingin ringkasan per kontak (net piutang − utang), agar saya tahu posisi dengan tiap orang. | Net = Σ sisa piutang − Σ sisa utang per kontak; kontak hanya di ruang Pribadi pemiliknya. |
| S-43 | M4 | W | Sebagai Novanda, saya ingin tujuan tabungan yang terhubung ke dompet/aset, agar progres dihitung otomatis. | Satu rumus di DB dipakai semua layar (FEAT §3); 1 dompet = 1 tujuan aktif (§12-6); setor/cairkan = transfer bertanda goal; edit setoran ke aset → nilai aset mengikuti, net worth tetap (T11, repro S5 v2); "Perlu Rp X/bulan" benar; tersedia di Bersama. |
| S-44 | M4 | W | Sebagai Novanda, saya ingin mencatat aset non-kas dan setor/tarik dana dompet↔aset, agar kekayaan lengkap. | Transfer dompet↔aset dua arah; perubahan nilai = entri `valuation` (bukan income); tidak ada auto-aset dari kategori "investasi" (dibuang). |
| S-45 | M4 | Sb | Sebagai Novanda, saya ingin mencatat lot saham IDX dan melihat P/L, agar portofolio akurat. | Beli = transfer RDN → akun saham + lot; qty, biaya rata-rata, P/L terealisasi teruji pgTAP; harga gagal → nilai terakhir + label "Diperbarui …"; validasi harga > 0 dan perubahan harian < 35%. |
| S-46 | M5 | W | Sebagai Farida, saya ingin tagihan rutin (listrik, sewa) tercatat per periode, agar tidak ada yang terlewat. | Tgl 31 → 31 Jan, 28/29 Feb, 31 Mar (T14); job dua kali = satu transaksi (T15); status due/posted/skipped; peringatan ≤ 7 hari di Beranda; per ruang. |
| S-47 | M5 | Sb | Sebagai Novanda, saya ingin trip dengan budget dan transaksi ditag atau dalam rentang tanggal, agar biaya liburan terlihat. | Keanggotaan: tag `trip_id` atau rentang; exclude tetap setelah edit (id stabil); kantor dikecualikan; total boncos/surplus. |
| S-48 | M5 | W | Sebagai Novanda, saya ingin ekspor CSV/PDF transaksi, agar punya salinan di luar app. | Angka ekspor = laporan periode yang sama; sel diawali `= + - @` di-escape; ekspor hanya ruang aktif & tercatat di audit log; tidak pernah berisi data Pribadi pasangan. |
| S-49 | M6 | W | Sebagai Farida, saya ingin mengetik "makan siang 35rb gopay" lalu melihat pratinjau, agar mencatat semudah chat. | Parser aturan: "35rb/35k/35.000/1,5jt" → bigint; alias dompet; kategori dari S-14; fallback LLM hanya menerima teks itu (tanpa data lain); **tidak pernah menyimpan tanpa konfirmasi**; ambigu → field disorot untuk dipilih. |
| S-50 | M6 | Sb | Sebagai Novanda, saya ingin grafik kekayaan bersih 6 bulan per ruang, agar tren terlihat. | Job 23:55 WIB idempoten; piutang dihitung aset (§12-3); kantor dikecualikan; `net_worth(on)` teruji. |
| S-51 | M6 | Sb | Sebagai Novanda, saya ingin analisis AI bulanan, agar dapat insight tanpa menghitung sendiri. | 401 tanpa sesi, 429 setelah 20/hari; input hanya agregat kategori ruang aktif (tanpa nama kontak/deskripsi mentah); respons divalidasi Zod, gagal → pesan anggun. |
| S-52 | M6 | Sb | Sebagai Farida, saya ingin app terpasang di HP dan bisa dibaca saat offline, agar saldo terlihat di tempat tanpa sinyal. | Installable; Beranda & Transaksi terakhir terbaca offline dengan banner "Offline — data per …"; mencatat offline ditolak dengan jelas. |
| S-53 | M7 | W | Sebagai Novanda, saya ingin arsip ekspor v1 per akun lalu v1 dimatikan, agar tidak ada dua sumber kebenaran. | Ekspor CSV/JSON per akun dibuat read-only dari v1 dan disimpan pemilik; tidak ada tulis ke v1; tanggal cutover disepakati; setelah cutover URL v1 tidak menerima login. |
| S-54 | M8 | N | Sebagai Farida, saya ingin mencatat lewat bot Telegram, agar tidak perlu membuka app. | Tautan akun via kode sekali pakai (kedaluwarsa); parser sama dengan S-49; konfirmasi wajib sebelum simpan; idempoten; pesan dari chat tak tertaut ditolak; bisa diputus dari Pengaturan. |

Total: 41 story (7 M0, 14 M1, 5 M2, 3 M3, 3 M4, 3 M5, 4 M6, 1 M7, 1 M8). Story baru dari pemakaian harian masuk dengan mengganti story Sb/N, bukan menambah.

**Di luar backlog (sadar):** kartu kredit, impor mutasi bank, lampiran struk, notifikasi push, multi-mata-uang, tag bebas, "total keluarga" net worth, WhatsApp, catat offline (UX §9, SPEC §2).

## 3a. Irisan Harian #1 (⭐)

S-01, S-02, S-03, S-06, S-07, S-10, S-12, S-13, S-14, S-15, S-16, S-17, S-22.
Hasil: Novanda dan Farida masuk dengan 2FA, membuat dompet dengan saldo awal di ruang masing-masing dan Bersama, mencatat pengeluaran/pemasukan ≤ 3 ketukan dengan saran kategori, mengedit/menghapus/mengurungkan dengan aman, mencari di daftar — dengan backup teruji.
Belum termasuk: transfer, talangan, anggaran, laporan. Mencatat setoran ke Bersama sebagai pengeluaran Pribadi + pemasukan Bersama sebagai jalan pintas **tidak diterima** (akan mencemari laporan, INT-09); karena itu S-20 adalah story pertama **Irisan Harian #2** (S-20, S-19, S-21, S-18, S-11, S-23), target ≤ 2 minggu setelah irisan #1. Sampai saat itu setoran dicatat belakangan.
Kriteria rilis irisan #1: kedua akun mencatat ≥ 7 hari berturut-turut di produksi; rekonsiliasi saldo vs nyata selisih 0 (atau dijelaskan entri `adjustment`); 0 insiden kehilangan data.

## 3b. Definition of Ready (story boleh masuk sprint bila)

1. Format "Sebagai <Novanda/Farida>, saya ingin …, agar …" dan prioritas W/Sb/N jelas.
2. Kriteria Given/When/Then dengan angka konkret, termasuk minimal satu kasus gagal dan satu kasus isolasi ruang (bila menyentuh data).
3. Ruang yang berlaku jelas (Pribadi/Bersama/keduanya) dan efek ke laporan dinyatakan (masuk/tidak masuk pemasukan-pengeluaran).
4. Kontrak data disepakati Arsitek: fungsi `api.*` (argumen, kode error `DKxxx`), tabel/kolom, kebutuhan `client_id` dan `version`.
5. Dependensi story lain sudah Done atau di sprint yang sama dan berurutan.
6. Desain layar (atau keputusan "pakai pola UX §4") tersedia untuk 390px dan 1280px, dengan state kosong/loading/error.
7. Teks UI dan pesan error berbahasa Indonesia sudah ditulis (UX §7).
8. Ukuran ≤ 3 hari kerja; lebih besar → dipecah.

## 3c. Definition of Done (story selesai bila)

1. Logika uang ditulis **test-first**: pgTAP untuk sukses, validasi gagal, rollback, idempotensi, konflik `version`, dan dua user/ruang; invarian Σ lines = saldo tetap lulus.
2. Setiap Given/When/Then punya tes otomatis (pgTAP, Vitest, atau Playwright) yang namanya merujuk ID story (`S-13`).
3. CI hijau: lint, `tsc --noEmit` strict, Vitest, migrasi + pgTAP, build, Playwright desktop & mobile + axe (0 serious/critical), audit dependensi.
4. Tidak ada tulis langsung ke tabel ledger dari app (role `dompetku_app` tanpa INSERT/UPDATE/DELETE; dicek grep + pgTAP).
5. RLS + `FORCE` pada tabel baru; tes isolasi Pribadi-N/Pribadi-F/Bersama ditambah.
6. Angka laporan/Beranda yang terdampak dibandingkan golden numbers fixture; aturan "tidak termasuk" (kantor, transfer, utang, talangan) tidak dilanggar.
7. UI diverifikasi di browser 390px dan 1280px, light & dark, screenshot di PR; kontras token UX §5; target sentuh ≥ 44px; tidak ada aksi hanya-hover.
8. Log tidak memuat nominal, deskripsi, atau nama kontak; aksi sensitif masuk audit log.
9. Migrasi maju-kompatibel (expand/contract), sudah dijalankan di stack lokal dari nol.
10. Ter-deploy ke produksi lewat pipeline, `/api/health` 200, dan PO memverifikasi kriteria di produksi (untuk irisan harian) atau di preview lokal.
11. Penyimpangan dari SPEC/DESIGN/UX dicatat sebagai ADR.

## 4. Risiko utama + mitigasi

| Risiko | Dampak | Mitigasi |
|---|---|---|
| Irisan harian tertunda oleh M0 yang membengkak (infra, auth, design system penuh) | Pemakaian nyata mundur; motivasi turun | M0 hanya primitif yang dipakai irisan #1; komponen lain dibuat saat dibutuhkan story. |
| Salah ruang saat mencatat (entri pribadi masuk Bersama) | Privasi & angka Bersama salah | R3: ruang dari dompet + lencana ruang di quick add; dompet Bersama ditandai visual; edit bisa memindahkan entri antar dompet hanya dalam ruang yang sama (lintas ruang = batal + catat ulang). |
| Farida tidak mengadopsi (app terasa milik Novanda) | Ruang Bersama tidak berisi | R11: Farida ikut menilai prototipe; persona Farida di ≥ 1/3 story; onboarding undangan sederhana. |
| Saran kategori buruk di awal (data kosong) | Ketukan bertambah, kepercayaan turun | R4 cold start; ukur "% catat yang memakai chip saran" setelah 2 minggu. |
| Aturan pengecualian laporan tersebar lagi seperti v1 | Angka tidak konsisten antar layar | R6: satu fungsi DB + golden numbers di DoD #6. |
| Data nyata masuk sebelum backup teruji | Kehilangan data permanen | R2: S-07 gerbang rilis irisan #1. |

## 5. Ketidaksetujuan / celah dengan desain saat ini

- **K1 — ROADMAP usang.** `docs/v2/ROADMAP.md` masih menyebut Supabase (`supabase test db`, pg_cron), migrasi data di M7, dan tidak menyebut ruang/saran kategori; bertentangan dengan SPEC §5–6. Usul: perbarui di M0 (R8) dan jadikan backlog ini sumber kriteria milestone. Trade-off: sedikit kerja dokumen sekarang vs DoD ambigu nanti.
- **K2 — Penentuan ruang saat catat cepat tidak didefinisikan.** SPEC §5.4 menetapkan `space_id` per entri, UX §3.1 tidak menyebut ruang. Usul R3 (ruang = ruang dompet). Alternatif: pengalih ruang global yang memfilter dompet — lebih eksplisit tetapi menambah ketukan saat bergantian ruang.
- **K3 — Saran kategori tanpa cold start.** SPEC §5.6-1 bergantung riwayat, padahal tidak ada migrasi. Usul R4.
- **K4 — Catat teks bebas di M6 terlalu jauh untuk permintaan eksplisit pemilik.** Saya setuju LLM di M6, tetapi parser nominal (R9) sebaiknya di M1 dan parser aturan lengkap boleh ditarik ke M2/M3 bila kapasitas ada.
- **K5 — Transfer lintas ruang: hanya pencatat yang bisa mengedit (SPEC §7a).** Setuju untuk setoran, tetapi pengambilan dari Bersama yang salah oleh Novanda hanya bisa dikoreksi Novanda. Usul: anggota lain bisa **menandai** "perlu dicek" di feed (S-23), tanpa hak edit. Murah dan menjaga privasi dompet sumber.

## 6. Kriteria penerimaan yang saya tuntut (area produk)

1. Playwright: dari Beranda, catat pengeluaran = ≤ 3 ketukan setelah mengetik nominal, di 390px (S-13).
2. pgTAP: semua fungsi `api.*` × dua user × tiga ruang lulus isolasi; tes gagal bila tabel domain baru tanpa RLS (S-22).
3. pgTAP golden numbers: satu fixture memuat kantor, talangan+reimburse, transfer biaya, setoran lintas ruang, utang+cicilan, entri 31 Okt 23:30 WIB; laporan/anggaran/Beranda/export menghasilkan angka yang sama dengan file golden (S-32, S-33, S-48).
4. Rekonsiliasi T18 lulus setelah seluruh suite dan setelah 1.000 operasi acak.
5. Uji restore backup mingguan hijau ≥ 2 kali berturut-turut sebelum irisan #1 dirilis (S-07).
6. Irisan #1 dinyatakan berhasil bila kedua akun mencatat ≥ 7 hari berturut-turut dan rekonsiliasi saldo nyata selisih 0.

## 7. Pertanyaan / permintaan ke peran lain

- **Arsitek/Tech Lead:** (a) setujui R3 — `api.create_entry` menurunkan `space_id` dari akun dan menolak kategori beda ruang; (b) bentuk entri lintas ruang (header di ruang sumber, line di ruang tujuan) dan cara RLS menyembunyikan akun sumber dari ruang tujuan; (c) apakah `suggest_categories` p95 ≤ 150 ms realistis tanpa tabel statistik terpisah?
- **Desainer UX/UI:** lencana ruang di quick add dan header; tampilan Beranda Bersama (apa pengganti "aman dipakai" bila Bersama tanpa anggaran); empty state onboarding wizard dompet.
- **QA:** susun fixture golden numbers (§6-3) di M1 agar bisa dipakai M2; property test 1.000 operasi acak termasuk entri lintas ruang.
- **DevOps/SRE:** konfirmasi S-07 (WAL-G + restore teruji) bisa selesai sebelum irisan #1; alert email ke pemilik sudah jalan di M0.
- **Keamanan:** masa berlaku tautan undangan (usul 72 jam) dan kapan TOTP wajib (usul: sebelum data pertama disimpan); daftar aksi untuk audit log minimal di M0–M1.
- **Pemilik (Novanda):** setujui K2 (ruang dari dompet), K5 (tanda "perlu dicek"), dan target irisan #1 ≥ 7 hari pemakaian sebagai kriteria sukses.
