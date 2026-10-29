# Ronde 1 · UI/UX Specialist

Dasar: `docs/v2/UX.md` (selanjutnya UX), spec revisi 2 `docs/superpowers/specs/2026-10-29-dompetku-v2-design.md` (selanjutnya Spec), `docs/audit/05-ux.md` (selanjutnya A5), screenshot `docs/audit/screenshots/v1/`.
Semua rasio kontras di dokumen ini dihitung dengan skrip contrast checker WCAG 2.x, bukan perkiraan.

Design Read: aplikasi keuangan harian untuk dua orang dewasa yang mengecek uang di HP beberapa kali sehari, dengan bahasa visual "buku kas" yang tenang, dial **ENERGY 1 / RHYTHM 2 / MOTION 1**.

## 1. Ringkasan sikap

UX.md sudah benar di hal yang paling mahal (rumus "aman dipakai" yang terlihat, dialog akibat uang, tidak ada hover-only, token kontras di level sistem), tetapi ditulis sebelum keputusan ruang Pribadi/Bersama dan karena itu buta terhadap risiko terbesar v2: **mencatat ke ruang yang salah**. UX tidak punya pengalih ruang, feed aktivitas, onboarding dua orang dari nol, atau aturan "ruang" pada catat cepat, dan memakai kata "Pribadi" untuk dua hal berbeda (segmen pocket di Transaksi dan ruang). Secara visual, token UX.md adalah palet fintech generik (biru primer + 5 warna semantik) dengan dua pasangan border yang ternyata gagal 3:1 dan tombol primer dark mode yang gagal bila teksnya putih. Saya mengusulkan IA dengan tombol Catat menyatu di tab bar (bukan FAB melayang), ruang sebagai konteks global berwarna dan berlabel, serta arah visual "buku kas" (kertas hangat, tinta nila untuk Pribadi, bata untuk Bersama, angka tabular rata kanan dengan garis total ganda) yang khas tanpa ribut. Semua ini harus terbukti di prototipe klik M0, bukan di dokumen.

## 2. Rekomendasi

### R1 · Ruang sebagai konteks global yang selalu terlihat · wajib · M0 (prototipe), M1 (fungsi)
Isi:
- **Pengalih**: segmented control dua opsi di header setiap tab utama: `Pribadi | Bersama`. Satu ketukan, kedua opsi selalu terlihat (bukan dropdown, karena tiap user tepat punya dua ruang). Desktop: di puncak sidebar. `role="radiogroup"` atau Radix ToggleGroup, `aria-label="Ruang"`.
- **Penanda ruang ganda (warna + teks)**: Pribadi memakai aksen tinta nila, Bersama memakai bata (lihat Lampiran A). Aksen ruang mewarnai tiga hal saja: garis bawah header, indikator tab aktif, dan tombol Catat. Label teks ruang selalu ada; warna tidak pernah satu-satunya pembeda (WCAG 1.4.1).
- **Per ruang, isi tab menyesuaikan tanpa tautan mati**: di Bersama, Rencana tidak menampilkan Utang & Piutang, Transaksi tidak menampilkan filter Kantor/Reimburse (Spec §5.4: hanya Pribadi). Item disembunyikan, bukan dinonaktifkan.
- **Mencegah salah catat ke ruang lain** (lapisan, dari wajib ke sebaiknya):
  1. *Wajib.* Judul sheet Catat menyebut ruang tujuan: "Pengeluaran · Bersama", berlatar tint ruang. Pilihan dompet di sheet hanya dompet ruang itu, sehingga ruang tujuan = ruang dompet (tidak ada kombinasi tidak sah).
  2. *Wajib.* Di dalam sheet ada tombol teks "Pindah ke Pribadi" / "Pindah ke Bersama". Pindah ruang mereset dompet dan kategori (kategori per ruang, Spec §5.4) dan nominal tetap.
  3. *Wajib.* Toast setelah simpan menyebut ruang: "Tersimpan di Bersama · Rp 35.000 dari Kas Rumah · Urungkan".
  4. *Wajib.* Detail transaksi punya aksi "Pindahkan ke ruang lain" (void + buat ulang atomik dengan jejak di `entry_history`, wajib pilih kategori di ruang tujuan). Tanpa ini, koreksi = hapus lalu ketik ulang, dan riwayat Bersama berisi entri batal yang membingungkan pasangan.
  5. *Sebaiknya (M1).* Bila deskripsi/kategori yang diketik hampir selalu dicatat di ruang lain (dari riwayat), tampilkan petunjuk sebaris di sheet: "Biasanya dicatat di Bersama. Pindah?" Tidak pernah memindahkan otomatis.
  6. *Wajib.* Ruang tidak pernah berganti diam-diam. Tautan dari feed Bersama membuka layar di ruang Bersama dan pengalih ikut berubah secara terlihat.
- **Transfer lintas ruang** tampil sebagai pintasan bernama di tab Transfer sheet: "Setor ke Bersama". Ringkasan sebelum simpan menyebut dua ruang: "Pribadi · BCA −Rp 500.000 → Bersama · Kas Rumah +Rp 500.000".

Alasan: Spec §4.4 memilih ruang terpisah dengan anggaran sendiri. Salah ruang merusak dua anggaran sekaligus dan terlihat oleh pasangan, jadi ini kesalahan sosial, bukan hanya angka. Catat ≤ 3 ketukan berarti hampir tidak ada momen untuk sadar ruang, sehingga penanda harus ada di jalur ketukan itu sendiri.

### R2 · Tombol Catat menyatu di tab bar; Laporan pindah ke Transaksi; Lainnya jadi Menu berlabel · wajib · M0
Isi: tab bar mobile `Beranda · Transaksi · [Catat] · Dompet · Rencana`. Catat adalah tombol (bukan link) di slot tengah, 56 px, berwarna aksen ruang, dengan label teks "Catat". Isi Lainnya (Trip, Kategori, Kontak, Export, Analisis, Pengaturan, Keluar) pindah ke tombol **"Menu"** berlabel di kanan header, bukan hamburger polos. Laporan menjadi tampilan kedua di tab Transaksi (`Daftar | Ringkasan`), karena laporan adalah agregat transaksi dan dibuka lebih sering daripada Kategori/Export. Desktop ≥ 1024 px: sidebar dengan pengalih ruang, tombol Catat, lima grup yang sama. Pintasan keyboard `c` untuk Catat hanya aktif bila fokus tidak di field teks dan bisa dimatikan di Pengaturan (WCAG 2.1.4).
Alasan: lihat §4 (ketidaksetujuan U1). FAB melayang menutupi baris terakhir daftar dan bersaing dengan toast di posisi yang sama (A5 §2 mencatat toast dan sheet v1 sudah saling tumpang). Tombol di bar punya posisi tetap untuk memori otot dan tidak pernah menutupi konten.

### R3 · Catat cepat yang terukur dan muat di atas keyboard · wajib · M0 (prototipe A/B), M1
Isi:
- **Definisi ketukan** (untuk tes Playwright): jumlah aksi pointer dari layar mana pun sampai entri tersimpan, *tidak termasuk* tombol angka. Jalur wajib: Catat (1) → chip kategori (2) → Simpan (3).
- **Tata letak dengan keyboard terbuka**: di 390×844 dan 360×640, nominal, label ruang, 6 chip, chip dompet, dan Simpan harus terlihat tanpa gulir saat keypad terbuka. Sheet diukur dengan `visualViewport`, bukan `100vh`.
- **Prototipe A/B di M0**: (A) keypad OS `inputmode="numeric"`; (B) keypad dalam aplikasi (tombol `0–9`, `000`, hapus, semuanya `<button>` berlabel, keyboard fisik tetap jalan). B memberi tata letak pasti dan tombol `000` (nominal Rupiah hampir selalu ribuan), tetapi menambah komponen yang harus diuji aksesibilitasnya. Pemilik memilih setelah mencoba keduanya di HP sendiri.
- **Kategori tidak pernah terpilih otomatis.** Chip saran disorot sebagai urutan pertama, tetapi user tetap mengetuknya. Pra-pilih membuat salah kategori tersimpan dalam 2 ketukan tanpa sadar.
- **Chip stabil**: 4 chip pertama = kategori paling sering di ruang ini (berubah paling cepat mingguan), 2 chip terakhir = kontekstual (jam, deskripsi). Posisi tidak berubah selama sheet terbuka. Chip ke-7 "Kategori lain…" membuka Combobox.
- Simpan: tombol nonaktif + teks "Menyimpan…" (bukan spinner saja); gagal → sheet tetap terbuka dengan semua isian utuh dan pesan sebaris (lihat R9).
Alasan: Spec §1 menjadikan ≤ 3 ketukan sebagai syarat berhasil, dan A5 §2 mengukur v1 di 5 sampai 6 ketukan. Keyboard yang menutupi chip (A5 §2, `mobile-quickadd.png`) membuat angka 3 ketukan hanya benar di atas kertas.

### R4 · Arah visual "buku kas" dan token pengganti UX §5 · wajib · M0
Isi: ganti tabel token UX §5 dengan Lampiran A. Inti perubahan:
- Palet dikurangi menjadi netral hangat + **dua warna ruang** (nila, bata) + semantik terbatas (hijau masuk, merah bahaya, kuning peringatan). Warna `kantor` ungu dihapus; Kantor ditandai label teks "Kantor".
- **Pengeluaran di daftar memakai warna teks biasa** dengan tanda "−". Hijau hanya untuk uang masuk, merah hanya untuk keadaan yang butuh tindakan (anggaran lewat, saldo kurang, error). v1 (`desktop-debts.png`) mewarnai hampir semua angka merah sehingga merah tidak lagi berarti "awas".
- Perbaiki pasangan yang gagal di UX §5 (terukur): `border` light `#8A94A3` di `bg #F6F7F9` = **2,86:1** (gagal 3:1 non-teks); `border` dark `#4A515C` di `surface #14171C` = **2,24:1** (gagal); teks putih di `primary` dark `#8EB4FF` = **2,07:1** (gagal), jadi tombol primer dark harus berteks gelap.
- Motif identitas: **kolom aritmetika buku kas**. Angka rata kanan tabular, baris pengurang bertanda "−", garis ganda tipis di atas total. Dipakai di rumus "aman dipakai", ringkasan transfer, dan dialog akibat uang. Motif ini fungsional (menunjukkan asal angka), bukan dekorasi.
Alasan: R-29 (maks 2–3 warna inti + 1 aksen) dan R-20 (identitas). Biru `#1D5BD8` + hijau + merah + ungu + kuning adalah komposisi default aplikasi keuangan mana pun; menukar logo tidak mengubah apa pun. Warna ruang memberi palet satu tugas nyata (R1), sehingga identitas dan fungsi datang dari keputusan yang sama.

### R5 · Aturan angka uang dalam satu komponen `MoneyText` · wajib · M0
Isi:
- `font-variant-numeric: tabular-nums lining-nums` di semua angka; nominal di daftar rata kanan.
- Tanda minus memakai U+2212 "−", bukan tanda hubung; format `−Rp 35.000`, `+Rp 9.500.000`. Nol ditulis `Rp 0` tanpa tanda.
- "Rp" sedikit lebih kecil dan berwarna `text-muted` (6,86:1 di putih, lulus) agar digit menjadi pusat baca.
- Teks tersembunyi untuk pembaca layar: "pengeluaran Rp 35.000", "pemasukan Rp 9.500.000" (tanda saja tidak cukup jelas dibacakan).
- Nominal penuh di Beranda hero, detail, dialog akibat, toast. Format ringkas (`Rp 1,25 jt`) hanya di grafik dan kartu sempit. Tidak ada tooltip sebagai satu-satunya jalan ke nominal penuh (tidak ada hover di layar sentuh); ketuk membuka detail.
- Angka panjang (`Rp 12.345.678.900`) di lebar 320 px boleh membungkus "Rp" ke baris sendiri; tidak pernah terpotong atau menggulir horizontal (WCAG 1.4.10).
- **Angka hero** (aman dipakai, saldo di detail dompet) memakai serif bertabular (usul: Source Serif 4, 600, subset Latin) untuk kesan "lembar saldo cetak". Status: *sebaiknya*, dibandingkan langsung dengan Plus Jakarta Sans di prototipe M0; pemilik memilih.
- Verifikasi di M0 bahwa Plus Jakarta Sans versi yang dimuat `next/font` benar-benar punya fitur OpenType `tnum`. Bila tidak, digit berpindah ke font yang punya (Source Serif 4 untuk hero, IBM Plex Sans untuk daftar) sebelum token dikunci.
- Tidak ada animasi hitung naik/turun pada saldo. Angka yang "berputar" menyiratkan perubahan yang tidak terjadi dan menunda angka yang benar.
Alasan: A5 §5 menemukan tiga format nominal bercampur di satu layar dan pembulatan ke atas. Angka adalah muatan utama aplikasi ini; satu komponen dengan satu aturan adalah satu-satunya cara agar konsisten di 30+ layar.

### R6 · Onboarding dua orang dari data kosong · wajib · M0 (alur), M1 (data)
Isi:
- **Novanda (pemilik)**: Masuk → amankan akun (passkey, lalu TOTP sebagai cadangan; Spec §5.3 mewajibkan 2FA) → Beranda Pribadi berisi **daftar langkah nyata**, bukan kartu "Rp 0":
  1. "Tambah dompet yang kamu pakai sehari-hari" (nama, jenis pocket, **saldo hari ini** → dicatat sebagai entri "Saldo awal" yang terlihat di riwayat).
  2. "Catat satu pengeluaran" (membuka sheet Catat).
  3. "Undang Farida" (hanya pemilik; menghasilkan tautan sekali pakai, dengan masa berlaku tertulis).
  4. Di ruang Bersama: "Buat dompet bersama" (mis. kas rumah).
  Tiap langkah dicentang dari data, bukan dari klik. Daftar hilang setelah selesai atau ditutup.
- **Farida**: buka tautan → buat kata sandi, passkey, TOTP → masuk ke Pribadi miliknya yang kosong dengan daftar langkah yang sama (tanpa langkah undang). Ruang Bersama sudah memperlihatkan apa yang dibuat Novanda.
- "Aman dipakai" tidak tampil sampai ada minimal satu dompet operasional. Sebelum itu tempatnya diisi kalimat: "Tambahkan dompet operasional untuk melihat berapa yang aman dipakai bulan ini."
- Ruang Bersama kosong menjelaskan dirinya dalam satu kalimat: "Pengeluaran rumah tangga yang kalian bagi. Farida dan kamu sama-sama bisa mencatat dan mengubah di sini."
- WCAG 3.3.7 (Redundant Entry): email Farida yang sudah diketik pemilik saat mengundang sudah terisi di formulir pendaftaran.
Alasan: Spec §3 dan §7a: tidak ada migrasi, kedua akun mulai kosong. `mobile-dashboard-empty.png` menunjukkan kegagalan v1: lima kartu "Rp 0", "UTANG −Rp 0" merah, tanpa satu ajakan pun. Hari pertama menentukan apakah aplikasi dipakai lagi di hari kedua.

### R7 · Revisi Beranda "aman dipakai" · wajib · M2 (prototipe di M0 dengan data demo)
Isi:
- **Per ruang**: Pribadi hanya dompet operasional Pribadi; Bersama punya "aman dipakai" sendiri dari dompet dan anggaran Bersama. Judul menyebut ruang.
- Label kalimat biasa "Aman dipakai sampai 31 Okt", bukan `AMAN DIPAKAI` huruf besar berjarak lebar (R-06).
- Rumus tampil sebagai kolom buku kas (Lampiran B, layar 5), nilai rata kanan, baris kosong (tanpa tagihan/anggaran wajib) disembunyikan dengan catatan "Belum ada tagihan rutin" yang bisa diketuk.
- **Hasil negatif** ditulis sebagai kalimat, bukan `−Rp`: "Kurang Rp 340.000 sampai 31 Okt" dengan warna bahaya + ikon + baris penyebab terbesar.
- Per hari: "≈ Rp 156.000 per hari untuk 15 hari", dengan definisi hari tersisa yang tertulis (termasuk hari ini).
- **Kekayaan bersih keluar dari Beranda** (pindah ke Dompet). Angka itu berubah lambat, baru tersedia M6, dan "▲ 2,1%" tidak membantu keputusan harian.
- Header tidak berisi sapaan "Selamat sore" (memakan ruang tanpa informasi); tempatnya untuk pengalih ruang dan Menu.
- Waktu hitung tertulis kecil: "dihitung 10.32".
Alasan: Beranda menjawab satu pertanyaan (A5 §7 butir 5). Satu titik fokus per layar; sisa Beranda (tagihan dekat, anggaran hampir habis, transaksi terakhir) adalah daftar polos yang mendukung angka itu.

### R8 · Feed aktivitas Bersama · wajib · M1
Isi:
- Lokasi: bagian "Aktivitas" di Beranda Bersama (5 terbaru) + tampilan penuh di Transaksi Bersama (filter "Oleh: Semua / Kamu / Farida").
- Setiap baris: inisial pencatat dalam lingkaran (tanpa foto; R-23), kalimat aktif dengan pelaku: "Farida mencatat Belanja bulanan · Rp 412.000", "Kamu mengubah Listrik: Rp 450.000 → Rp 465.000", "Farida membatalkan Bensin · Rp 50.000", "Novanda menyetor Rp 500.000 ke Kas Rumah". Waktu relatif ("10 menit lalu", "Kemarin 19.40").
- Setoran lintas ruang **tidak** menyebut dompet pribadi sumber (Spec §7a). Feed tidak pernah memuat data ruang Pribadi.
- Penanda "3 baru sejak kamu terakhir buka" dari `last_seen` per user; tanpa titik berdenyut.
- Ketuk baris → detail transaksi dengan riwayat perubahan (siapa, kapan, sebelum/sesudah).
- Kosong: "Belum ada aktivitas. Yang kamu dan Farida catat di Bersama akan muncul di sini, terbaru di atas."
Alasan: Spec §7a memberi hak edit setara di Bersama dan menjanjikan feed aktivitas. Tanpa feed, perubahan oleh pasangan terasa seperti angka yang bergeser sendiri, persis rasa tidak percaya yang membuat v1 ditinggalkan.

### R9 · Matriks keadaan: kosong, memuat, gagal, basi, konflik, offline · wajib · M0 (komponen), tiap milestone (layar)
Isi (minimal per layar data):

| Keadaan | Aturan | Contoh salinan |
|---|---|---|
| Kosong pertama kali | Sebab + satu aksi yang mengisinya | "Belum ada transaksi di Bersama. Catat belanja pertama kalian." [Catat] |
| Kosong karena filter | Beda dari kosong pertama; aksi hapus filter | "Tidak ada transaksi Transport di September." [Hapus filter] |
| Memuat | Skeleton sebentuk baris nyata; **angka uang tidak pernah tampil `Rp 0` saat memuat** | teks tersembunyi "Memuat transaksi" untuk pembaca layar |
| Gagal muat | Dibedakan dari kosong (CQ-03); data lama tetap tampil bila ada | "Transaksi belum bisa dimuat. Periksa koneksi lalu coba lagi." [Coba lagi] |
| Gagal simpan | Sheet tetap terbuka, isian utuh, pesan sebaris; aman diulang karena `client_id` | "Belum tersimpan. Koneksi terputus saat mengirim. Coba lagi tidak akan mencatat dua kali." [Coba lagi] |
| Validasi | Di bawah field, `aria-describedby`, teks dulu baru warna | "Nominal harus lebih dari Rp 0." |
| Konflik versi | Sebut siapa dan apa yang berubah, tawarkan pilihan | "Farida mengubah transaksi ini 2 menit lalu (Rp 50.000 → Rp 45.000). Muat versi terbaru untuk melanjutkan." |
| Basi/offline | Banner atas, waktu data, aksi tulis nonaktif dengan alasan | "Offline. Data per 10.32. Mencatat butuh koneksi." |

Alasan: R-27 dan A5 §3 (v1 tidak membedakan gagal dari kosong; spinner layar penuh). Di aplikasi uang, "Rp 0" yang muncul sesaat saat memuat dibaca sebagai "uangku hilang".

### R10 · Kriteria WCAG 2.2 AA yang spesifik untuk produk ini · wajib · M0
Isi (tambahan atas UX §4–5):
- **1.4.10 Reflow**: uji di **320 px** CSS, bukan hanya 390 px. Tanpa gulir horizontal, angka panjang membungkus.
- **2.4.11 Focus Not Obscured**: tab bar, header lengket, dan toast tidak boleh menutupi elemen yang sedang fokus; `scroll-padding-bottom` = tinggi tab bar + safe area.
- **2.5.7 Dragging**: setiap aksi geser (swipe baris) punya tombol setara di detail atau menu "⋯".
- **2.5.8 Target Size**: kita memakai 44×44 px dengan jarak ≥ 8 px (melebihi 24 px minimal).
- **3.3.8 Accessible Authentication**: passkey sebagai jalur utama; field kata sandi dan TOTP mengizinkan tempel dan isi otomatis (`autocomplete="current-password"`, `autocomplete="one-time-code"`); tidak ada teka-teki.
- **1.4.1 / 1.4.11**: ruang, pemasukan/pengeluaran, status anggaran selalu punya teks atau ikon selain warna; batas komponen ≥ 3:1 di kedua tema.
- **4.1.3 Status Messages**: toast `role="status"`; error simpan `role="alert"`.
- Grafik Laporan punya tabel data sebagai alternatif (tombol "Lihat sebagai tabel").
- `lang="id"` di `<html>`; urutan heading tanpa loncat; satu `<main>`.
- axe 0 serious/critical **di tema terang dan gelap**, di 320, 390, 1280 px.
Alasan: A5 §4 menemukan 233 pelanggaran kontras dan modal tanpa focus trap. UX.md menyebut "WCAG 2.2 AA" tanpa menyebut kriteria 2.2 yang baru; tanpa daftar konkret, tes hanya menangkap yang ditangkap axe.

### R11 · Saran kategori dan catat teks bebas · sebaiknya · M1 (saran), M6 (teks bebas)
Isi:
- `api.suggest_categories` mengembalikan skor dan, bila ada, **ruang tempat pola itu biasa dicatat** (untuk petunjuk R1.5).
- Mode "Ketik" di sheet Catat (M6): satu field "makan siang 35rb bca". Hasil parse tampil sebagai baris chip yang masing-masing bisa diketuk untuk dikoreksi: `Rp 35.000` · `Makan › Makan siang` · `BCA` · `Pribadi`. Token yang tidak dikenali diberi garis bawah putus dan label "tidak dikenali". Tidak ada simpan tanpa ketukan Simpan (Spec §5.6).
- Bila kategori berasal dari tebakan LLM, chip berlabel teks "ditebak". Tanpa ikon sparkle atau bintang (R-04); yang penting user tahu mana yang perlu dicek.
- Ambiguitas nominal ("35" tanpa satuan) ditampilkan apa adanya ("Rp 35") dan disorot, bukan dikalikan diam-diam.
Alasan: Spec §5.6. Kecepatan teks bebas hanya bernilai bila koreksinya sama cepat; pratinjau per bagian menghindari "hapus semua dan ketik ulang".

### R12 · Tiga keadaan tata letak, bukan dua · sebaiknya · M0
Isi: < 600 px: satu kolom + tab bar. 600–1023 px: tab bar tetap, konten maks 640 px di tengah, sheet Catat menjadi dialog tengah. ≥ 1024 px: sidebar 248 px + konten dua kolom di Beranda (kolom utama: aman dipakai, tagihan, anggaran; kolom samping: transaksi terakhir atau aktivitas Bersama), daftar Transaksi maks 760 px dengan panel detail di kanan.
Alasan: UX hanya mendefinisikan 390 px dan ≥ 1024 px. Tablet dan jendela browser setengah layar jatuh ke celah di antaranya (antislop-layoutmobile, "Two-State Layout").

## 3. Risiko utama dan mitigasi

| Risiko | Dampak | Mitigasi |
|---|---|---|
| Salah catat ke ruang lain | Dua anggaran salah, terlihat pasangan | R1 (label di sheet, toast menyebut ruang, aksi pindah, petunjuk); metrik: jumlah "Pindahkan ke ruang lain" per bulan sebagai sinyal desain |
| Ruang terakhir "terbawa" saat membuka app esok hari | Catatan pribadi masuk Bersama | Tanya PM (§6): buka di ruang terakhir atau selalu Pribadi setelah 30 menit tidak aktif. Apa pun pilihannya, label ruang di sheet tetap wajib |
| Keyboard menutupi chip/Simpan | Janji 3 ketukan gagal di HP nyata | R3: uji visual viewport 360×640 dan 390×844, A/B keypad |
| Urutan chip berubah-ubah | Salah ketuk karena memori otot | R3: 4 chip stabil + 2 kontekstual, posisi beku selama sheet terbuka |
| Feed membocorkan info Pribadi lewat setoran lintas ruang | Melanggar anti-tujuan Spec §2 | R8: tanpa nama dompet sumber; tes Playwright dua user memeriksa teks feed |
| Desain dipoles untuk screenshot portofolio, bukan untuk pakai harian | Beranda indah, catat lambat | Prototipe M0 dinilai dengan tugas nyata (catat 5 transaksi, temukan pengeluaran kemarin), bukan dengan tampilan |
| Font kedua (serif hero) menambah bobot | LCP Beranda naik | Subset Latin digit, satu bobot, `next/font` self-host; batal bila First Load JS/CSS melewati anggaran M2 (≤ 150 kB) |
| Dark mode tertinggal saat fitur bertambah | Kontras gagal di satu tema | Token semantik saja (tidak ada warna mentah di komponen), axe di dua tema di CI |
| "Rp 0" sesaat saat memuat | User panik/kehilangan percaya | R9: skeleton untuk angka; tes visual memastikan tidak ada `Rp 0` sebelum data |

## 4. Ketidaksetujuan dengan desain saat ini

1. **UX §1 U1, rekomendasi B (Dompet sebagai tab + FAB melayang).** UX sendiri mencatat minusnya: "FAB menutupi konten; 6 elemen di bar". Alternatif saya (R2): Catat menyatu di slot tengah tab bar, Lainnya menjadi Menu berlabel di header, Laporan masuk Transaksi. Trade-off: Lainnya butuh satu ketukan di header alih-alih di bar; item di dalamnya jarang dibuka harian, jadi itu harga yang wajar. Dompet tetap jadi tab.
2. **UX §1 tabel Transaksi: segmen "Pribadi / Kantor / Reimburse".** Kata "Pribadi" kini nama ruang (Spec §5.4). Ganti menjadi filter pocket `Semua · Operasional · Tabungan · Kantor` plus filter status "Menunggu reimburse", hanya di ruang Pribadi.
3. **UX §5 token.** Tiga pasangan gagal (terukur di R4). Palet terlalu banyak hue (biru, hijau, merah, ungu, kuning) tanpa tugas yang jelas. Pengganti di Lampiran A.
4. **UX §5 ikon lucide-react.** Bukan larangan, tetapi alasannya belum tertulis. Usul: Phosphor (bobot regular + fill) karena varian fill memberi penanda tab aktif yang bukan warna (1.4.1) dan cakupan glif kategori Indonesia lebih luas (mangkuk, pom bensin, motor). Bila tetap lucide, tab aktif butuh penanda non-warna lain (garis bawah tebal + teks tebal).
5. **UX §2 Beranda**: sapaan di header, label huruf besar berjarak lebar, dan kekayaan bersih dengan "▲ 2,1%" di Beranda (R7).
6. **UX §5 skala tipografi**: body 14 px untuk deskripsi transaksi terlalu kecil untuk dibaca sekilas di HP. Usul body 15 px, meta 13 px minimal, 12 px hanya untuk label grafik.
7. **UX §4 "nominal penuh di tooltip"** (UX §7): tooltip tidak ada di layar sentuh. Nominal penuh lewat detail (R5).
8. **UX §3.1 "dompet = terakhir dipakai"**: harus "terakhir dipakai **di ruang ini**", jika tidak, default dompet bisa menarik user ke ruang lain.

## 5. Kriteria penerimaan (bisa dicek/dites)

1. Playwright mobile 390×844: dari Beranda, Transaksi, Dompet, dan Rencana, catat pengeluaran = **3 aksi pointer** (tidak termasuk tombol angka), di ruang Pribadi dan Bersama.
2. Dengan keyboard/keypad terbuka di 360×640 dan 390×844, elemen label ruang, chip kategori pertama, dan Simpan berada di dalam visual viewport (cek `getBoundingClientRect` terhadap `visualViewport`).
3. Sheet Catat selalu memuat teks nama ruang; toast sukses memuat nama ruang dan dompet. Snapshot teks di tes.
4. Dompet yang ditawarkan di sheet hanya dari ruang aktif (tes dua user, dua ruang).
5. "Pindahkan ke ruang lain" menghasilkan satu entri di ruang tujuan, entri asal batal, dua baris `entry_history`, saldo kedua ruang benar (pgTAP + Playwright).
6. Feed Bersama tidak pernah memuat nama dompet Pribadi atau entri Pribadi (Playwright dua user, assert teks).
7. axe-core: 0 pelanggaran serious/critical di tema terang **dan** gelap, pada 320, 390, 1280 px, untuk semua layar prototipe M0.
8. Tidak ada gulir horizontal di 320 px pada semua layar, termasuk dengan nominal `Rp 12.345.678.900`.
9. Semua pasangan token di Lampiran A tercatat dengan rasio di file token dan diuji otomatis (skrip kontras di CI terhadap file token).
10. Tidak ada `Rp 0` yang dirender sebelum data saldo selesai dimuat (tes dengan respons tertunda).
11. Setiap layar data punya keadaan kosong, memuat, gagal yang berbeda, terlihat di `/dev/ui` dan di tes komponen.
12. `MoneyText`: tes unit untuk tanda U+2212, format ringkas tanpa pembulatan ke atas, teks pembaca layar, nol tanpa tanda.
13. Fokus keyboard tidak pernah tertutup tab bar/toast (tes Tab melalui daftar panjang, cek elemen fokus di atas tab bar).
14. Tab aktif dan ruang aktif bisa dibedakan dalam mode grayscale (screenshot dengan filter `grayscale(1)` ditinjau).
15. Pemilik dan Farida masing-masing menyelesaikan tugas prototipe M0 (catat 5 transaksi, satu ke Bersama, temukan pengeluaran kemarin, pindahkan satu ke ruang lain) tanpa bantuan; hasil dan hambatan dicatat di ADR.

## 6. Pertanyaan/permintaan untuk peran lain

- **Product Manager**: (a) "Aman dipakai sampai" akhir bulan atau sampai tanggal gajian berikutnya (bisa diatur per orang)? (b) Saat app dibuka, ruang terakhir atau selalu Pribadi setelah 30 menit tidak aktif? (c) Setuju Laporan pindah ke Transaksi dan kekayaan bersih keluar dari Beranda? (d) Logo/ikon PWA: ada konsep dari pemilik? Sampai ada, wordmark teks "DompetKu" dan penanda `[IKON]` di manifest prototipe (R-23).
- **Backend/DB**: (a) fungsi `api.move_entry_to_space(entry_id, target_space, category_id, expected_version)` atomik dengan riwayat; (b) `suggest_categories` mengembalikan skor dan ruang dominan; (c) sumber feed: turunan `entry_history` atau tabel `activity_events`, plus `space_last_seen(user, space)`; (d) `dashboard_summary(space_id, until)` per ruang dan parameter akhir periode; (e) error konflik versi membawa `updated_by` dan nilai lama/baru untuk salinan R9.
- **Security**: (a) masa berlaku dan tampilan tautan undangan (apa yang dilihat Farida bila kedaluwarsa); (b) setuju field TOTP/kata sandi mengizinkan tempel (3.3.8); (c) tinjau teks feed Bersama terhadap anti-tujuan kebocoran Pribadi.
- **QA**: adopsi definisi ketukan R3, viewport 320/360/390/1280, axe dua tema, dan tes "tidak ada `Rp 0` saat memuat".
- **Frontend**: (a) cek `tnum` Plus Jakarta Sans di `next/font`; (b) sheet berbasis `visualViewport`; (c) prototipe keypad A/B; (d) file token tunggal (CSS variables) sebagai sumber skrip kontras CI.
- **AI/parser (M6)**: kontrak pratinjau per token (nominal, kategori, dompet, ruang, token tidak dikenali, sumber "aturan" vs "ditebak").

---

## Lampiran A · Arah visual

**Karakter**: buku kas di meja rumah. Kertas hangat, tinta gelap, angka rapi rata kanan. Tenang karena uang adalah urusan serius; khas karena warnanya punya tugas (menandai ruang) dan motifnya (kolom aritmetika dengan garis total ganda) berasal dari cara orang memang menghitung uang di kertas.

### A.1 Palet (semua rasio terukur)

Terang:

| Token | Nilai | Pemakaian | Kontras |
|---|---|---|---|
| `bg` | `#F6F4EF` | latar halaman (kertas hangat) | - |
| `surface` | `#FFFFFF` | sheet, dialog, field | - |
| `surface-2` | `#EFECE5` | baris terpilih, chip tidak aktif | `text-muted` di atasnya 5,82:1 |
| `text` | `#1C1B18` | teks utama, nominal pengeluaran | 17,22:1 putih; 15,67:1 `bg` |
| `text-muted` | `#5E5A52` | meta, "Rp", tanggal | 6,86:1 putih; 6,24:1 `bg` |
| `border` (non-teks) | `#8C877C` | batas field, chip, toggle | 3,58:1 putih; 3,25:1 `bg` |
| `hairline` | `#E3DFD6` | pemisah dekoratif saja, bukan batas komponen | - |
| `space-pribadi` (nila) | `#2B3F8F` | aksen ruang Pribadi, tombol primer, fokus | 9,50:1 putih; teks putih di atasnya 9,50:1 |
| `space-pribadi-tint` | `#E6E9F5` | latar judul sheet Pribadi | teks 14,22:1; nila 7,84:1 |
| `space-bersama` (bata) | `#A3461E` | aksen ruang Bersama | 6,08:1 putih; teks putih di atasnya 6,08:1 |
| `space-bersama-tint` | `#F5E6DC` | latar judul sheet Bersama | teks 14,13:1; bata 4,99:1; muted 5,63:1 |
| `income` | `#1F6B45` | "+Rp" pemasukan | 6,47:1 putih |
| `danger` | `#B3261E` | saldo kurang, lewat anggaran, error | 6,54:1 putih |
| `warning` | `#8A5A00` | anggaran ≥ 80% | 5,93:1 putih |

Gelap (bukan hitam murni, tetap hangat):

| Token | Nilai | Kontras |
|---|---|---|
| `bg` | `#121210` | - |
| `surface` | `#1A1A17` | - |
| `surface-2` | `#23221F` | `text-muted` 6,33:1 |
| `text` | `#EDEAE3` | 14,52:1 `surface`; 15,61:1 `bg` |
| `text-muted` | `#A8A398` | 6,94:1 `surface`; 7,46:1 `bg` |
| `border` | `#6E6A61` | 3,24:1 `surface`; 3,48:1 `bg` |
| `space-pribadi` | `#9DAEF0` | 8,09:1 `surface`; tombol: teks `#121210` di atasnya 8,70:1 |
| `space-pribadi-tint` | `#1E2233` | teks 13,12:1; nila 7,32:1 |
| `space-bersama` | `#F0A07A` | 8,32:1 `surface`; tombol: teks `#121210` 8,94:1 |
| `space-bersama-tint` | `#2E241E` | teks 12,60:1; bata 7,22:1; muted 6,02:1 |
| `income` | `#6FD39A` | 9,52:1 |
| `danger` | `#FF8A80` | 7,64:1 |
| `warning` | `#F2C14E` | 10,39:1 |

Aturan: tombol primer di tema gelap berteks gelap (`#121210`), tidak pernah putih. Kedalaman di tema gelap dari tingkat terang `surface`, bukan bayangan. Tema mengikuti sistem dengan pilihan manual di Pengaturan (UX §5 sudah benar).

Alasan per warna, satu baris: nila = tinta pena dan warna ruang milik sendiri, gelap dan tenang; bata = hangat, rumah, mudah dibedakan dari nila juga oleh penderita buta warna merah-hijau (beda terang dan hue); kertas hangat = membedakan dari putih-abu fintech generik tanpa menambah hue; hijau/merah/kuning = semantik saja, dosisnya kecil.

### A.2 Tipografi

| Peran | Font | Ukuran/bobot | Alasan |
|---|---|---|---|
| UI dan teks | Plus Jakarta Sans (`next/font`, 400/600) | body 15, meta 13, judul 18/22 | dirancang di Jakarta untuk identitas kota; bentuk huruf lebar terbaca baik di layar kecil |
| Angka hero | Source Serif 4, 600, tabular (usulan, diuji A/B di M0) | 32–40 via `clamp()` | kesan lembar saldo cetak; satu-satunya tempat serif, jadi menjadi titik fokus |
| Angka daftar | Plus Jakarta Sans `tnum` (diverifikasi) | 15/600 | kolom rata kanan sejajar |
| Input nominal | sama dengan hero | 28 | yang diketik terasa sama dengan yang nanti tampil |

Tidak ada monospace (v1 memakai JetBrains Mono untuk angka; `tnum` sudah memberi lebar sama tanpa kesan terminal). Tidak ada label huruf besar berjarak lebar. Input 16 px minimum untuk mencegah zoom iOS.

### A.3 Kepadatan dan bentuk

- Baris transaksi 60 px: baris 1 deskripsi (15/400), baris 2 kategori · dompet (13, muted), nominal rata kanan. Pengelompokan per hari dengan judul tanggal ("Hari ini", "Kemarin", "Sen, 27 Okt") dan total harian kecil di kanan.
- Beranda bukan tumpukan kartu berbayang. Bagian dipisah ruang kosong 24–32 px dan satu `hairline`. Kartu dengan batas hanya untuk objek yang bisa diketuk sebagai satu kesatuan (dompet, tujuan).
- Radius: field dan tombol 8; sheet 16 (sudut atas); chip penuh (bentuk pil menandai "token yang bisa dipilih", beda dari tombol aksi); avatar inisial penuh.
- Elevasi: datar secara default; satu tingkat bayangan hanya untuk sheet/dialog dan toast (penanda lapisan di atas konten).
- Kolom buku kas: pengurang diawali "−", garis ganda 3 px (dua garis 1 px) di atas total, total 600. Hanya dipakai di rumus aman dipakai, ringkasan transfer, dan dialog akibat.

### A.4 Ikonografi

- Phosphor regular 20/24 px; versi fill untuk tab aktif. Setiap ikon di navigasi berlabel teks.
- Kategori: ikon + nama; tanpa emoji dari sistem. Emoji hanya bila user memilihnya sendiri untuk tujuan tabungan, selalu dengan label (UX §5 sudah benar).
- Tidak ada sparkle/bintang/petir untuk fitur teks bebas atau analisis. Tidak ada panah dekoratif di tombol; "›" hanya di baris yang membuka layar lain.
- Avatar = inisial di lingkaran warna ruang. Tanpa foto.

### A.5 Gerak (MOTION 1)

| Gerak | Durasi | Tujuan |
|---|---|---|
| Sheet naik/turun | 200 ms ease-out | menunjukkan dari mana sheet datang dan ke mana pergi |
| Toast masuk/keluar | 150 ms fade | tidak mengalihkan dari layar |
| Ganti ruang | 120 ms silang warna aksen header | konfirmasi perubahan konteks |
| Progress anggaran | tanpa animasi | angka uang tidak dianimasikan |

`prefers-reduced-motion: reduce` → semua instan. Tidak ada loop, denyut, atau hitung naik.

## Lampiran B · Layar prototipe M0 (data demo, klik)

Data demo diberi banner kecil "Data demo" di prototipe. Wireframe di bawah untuk 390 px; `[ ]` = tombol, `( )` = chip, `|` = segmented control.

**1. Masuk**
```
DompetKu
Masuk ke dompetmu
[Masuk dengan passkey]
atau
Email      [..............]
Kata sandi [..............] [Tampilkan]
[Masuk]
Lupa kata sandi?
```

**2. Amankan akun (sekali, wajib)**
```
Langkah 1 dari 2 · Passkey
Masuk berikutnya cukup dengan sidik jari atau PIN HP.
[Buat passkey]
Langkah 2 dari 2 · Kode cadangan (TOTP)
[QR]  Kode dari aplikasi autentikator [......]
[Simpan dan lanjut]
```

**3. Beranda Pribadi, kosong**
```
[ Pribadi | Bersama ]                 [Menu]
Mulai dari sini
 ✓ Akun aman
 ○ Tambah dompet sehari-hari          ›
 ○ Catat satu pengeluaran             ›
 ○ Undang Farida                      ›
Tambahkan dompet operasional untuk melihat
berapa yang aman dipakai bulan ini.
[Beranda][Transaksi][ Catat ][Dompet][Rencana]
```

**4. Tambah dompet**
```
Dompet baru · Pribadi
Nama         [BCA            ]
Jenis        ( Operasional ) ( Tabungan ) ( Kantor )
Saldo hari ini  Rp [ 4.100.000 ]
Dicatat sebagai "Saldo awal" di riwayat dompet ini.
[Simpan dompet]
```

**5. Beranda Pribadi, terisi**
```
[ Pribadi | Bersama ]                 [Menu]
Aman dipakai sampai 31 Okt
            Rp 2.340.000            (serif, hero)
 Saldo operasional        Rp 4.100.000
 Tagihan sebelum 31 Okt  −Rp   960.000
 Sisa anggaran wajib     −Rp   800.000
                         ═════════════
                          Rp 2.340.000
≈ Rp 156.000 per hari untuk 15 hari · dihitung 10.32
────────────────────────────────────
Tagihan 7 hari ke depan
 Listrik · besok              Rp 450.000
Anggaran hampir habis
 Transport  104% · lewat Rp 40.000  (ikon + teks)
Terakhir                          Semua ›
 Hari ini
  Makan siang · BCA          −Rp 35.000
```

**6. Beranda Bersama**
```
[ Pribadi | Bersama ]  (aksen bata)   [Menu]
Aman dipakai bersama sampai 31 Okt
            Rp 1.120.000
 (kolom rumus Bersama)
Aktivitas · 3 baru
 (F) Farida mencatat Belanja bulanan  Rp 412.000 · 10 mnt
 (N) Kamu menyetor ke Kas Rumah       Rp 500.000 · kemarin
 (F) Farida mengubah Listrik  Rp 450.000 → Rp 465.000
                                   Semua aktivitas ›
```

**7. Catat (varian A keypad OS, varian B keypad aplikasi)**
```
╭ Pengeluaran · Bersama ──── [Pindah ke Pribadi] ╮ (tint ruang)
| Keluar | Masuk | Transfer |
        Rp 35.000                       (28, serif)
(Makan)(Belanja)(Transport)(Rumah)(Jajan)(Listrik)(Kategori lain…)
Dari  (Kas Rumah ▾)   Hari ini ▾   Keterangan ▾
[Simpan]
── keypad (B): 1 2 3 / 4 5 6 / 7 8 9 / 000 0 ⌫ ──
```

**8. Catat, mode Ketik (konsep, fungsi M6)**
```
Ketik  [makan siang 35rb bca          ]
Terbaca:
 (Rp 35.000) (Makan › Makan siang · ditebak) (BCA) (Pribadi)
Ketuk bagian yang salah untuk mengubah.
[Simpan]
```

**9. Toast setelah simpan**
```
Tersimpan di Bersama · Rp 35.000 dari Kas Rumah   [Urungkan]
```

**10. Transaksi (daftar + keadaan)**
```
[ Pribadi | Bersama ]                 [Menu]
| Daftar | Ringkasan |
[Cari transaksi      ]  (Semua)(Operasional)(Kantor)(Menunggu reimburse)
Hari ini                         −Rp 47.000
 Makan siang                     −Rp 35.000
 Makan · BCA
 Parkir                          −Rp 12.000
 Transport · Tunai
Kemarin                       +Rp 9.465.000
 Gaji                        +Rp 9.500.000
 ...
[Muat lagi]
Kosong karena filter: "Tidak ada transaksi Kantor di Oktober." [Hapus filter]
```

**11. Detail transaksi**
```
Makan siang                      −Rp 35.000
Makan › Makan siang · BCA · Pribadi
Sen, 27 Okt 12.14 · dicatat oleh kamu
[Ubah]  [Pindahkan ke ruang lain]  [Batalkan]
Riwayat
 27 Okt 12.20  Nominal Rp 30.000 → Rp 35.000 (kamu)
Dialog Batalkan:
 "Transaksi Rp 35.000 dibatalkan. Saldo BCA bertambah Rp 35.000.
  Bisa dipulihkan 90 hari dari Sampah."  [Batalkan transaksi] [Kembali]
```

**12. Undang dan terima undangan**
```
Undang Farida
Email [farida@...]   Tautan berlaku 72 jam, sekali pakai.
[Buat tautan undangan]  →  [Salin tautan]
---
(Farida) Novanda mengundangmu ke DompetKu.
Email farida@... (terisi)  Kata sandi [....]
[Buat akun]  → layar 2
```

**13. Desktop Beranda (1280 px)**
```
┌ sidebar 248 ─────────┬ kolom utama ─────────────┬ kolom samping ──────┐
│ [Pribadi|Bersama]    │ Aman dipakai (hero+rumus)│ Terakhir / Aktivitas │
│ [Catat]   (c)        │ Tagihan 7 hari           │ (daftar per hari)    │
│ Beranda              │ Anggaran hampir habis    │                      │
│ Transaksi            │                          │                      │
│ Dompet · Rencana     │                          │                      │
│ Menu: Trip, Kategori │                          │                      │
└──────────────────────┴──────────────────────────┴──────────────────────┘
```

**14. `/dev/ui` (non-produksi)**: semua komponen dalam keadaan kosong, memuat, gagal, nonaktif, fokus, di dua tema, untuk tinjauan dan tes axe.

## Lampiran C · Yang ditinggalkan dari v1 (dari screenshot)

| Pola v1 | Bukti | Pengganti v2 |
|---|---|---|
| Lima kartu "Rp 0" berbayang, "UTANG −Rp 0" merah | `mobile-dashboard-empty.png` | daftar langkah nyata (R6) |
| Garis warna kiri di tiap kartu sebagai dekorasi | `mobile-dashboard-empty.png` | tanpa garis; ruang ditandai di header |
| Emoji sebagai ikon navigasi dan pocket | `desktop-debts.png`, bottom nav 6 item | ikon berlabel, pocket sebagai teks |
| Hamburger tetap menutupi judul | `mobile-dashboard-empty.png`, `mobile-quickadd.png` | tombol "Menu" berlabel di header |
| Angka monospace + format "Rp 1.3jt" | `desktop-debts.png` | `MoneyText` (R5) |
| Label huruf besar berjarak lebar ("NET WORTH", "HUTANG SAYA") | kedua screenshot | label kalimat biasa |
| Teks abu muda gagal kontras ("Belum ada pengeluaran") | `mobile-dashboard-empty.png` | `text-muted` 6,86:1 minimum |
| 15 item sidebar datar | `desktop-debts.png` | 5 tujuan + Menu |
| Tombol ikon ✏️ ✕ tanpa label | `desktop-debts.png` | aksi berlabel di detail |
| Merah di semua angka utang | `desktop-debts.png` | merah hanya untuk keadaan yang butuh tindakan |
| Sheet Catat tumpang dengan nav dan keyboard | `mobile-quickadd.png` | R3 |

## Catatan filter

Dokumen ini memakai antislop sebagai filter (tidak ada preferensi mode tersimpan; diterapkan sesuai instruksi pemanggil). Dial ENERGY 1 / RHYTHM 2 / MOTION 1. Satu titik fokus per layar (angka aman dipakai, nominal di sheet Catat). Satu aksen per ruang. Motif identitas: kolom buku kas dengan garis total ganda. Logo dan ikon PWA belum dibuat dan menunggu pemilik (R-23). Semua angka di wireframe adalah data demo.
