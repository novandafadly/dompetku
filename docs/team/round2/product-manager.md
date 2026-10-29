# Product Manager — Ronde 2

Tinjauan `round2/register.md` dari sisi produk: harus benar, cepat dicatat, dan dipakai berdua (Novanda + Farida).

## 1. Ditolak / minta diubah

| # | Sikap | Alasan | Usulan pengganti |
|---|---|---|---|
| **A10** | ubah | Dialog konfirmasi setiap kali saldo jadi negatif menambah 1 ketukan, sehingga target "≤ 3 ketukan" gagal (SPEC §5.6). Frasa "kecuali akun aset" juga ambigu: diblokir atau tanpa peringatan? | Peringatan **inline di sheet sebelum simpan** ("Saldo BCA jadi −Rp12.000"). Tombol Simpan tetap satu ketukan dan mengirim `p_allow_negative=true`. Setelah simpan, toast menawarkan aksi "Cocokkan saldo". Tulis eksplisit akun mana yang diblokir keras. |
| **A13** | ubah (tambah) | Saldo awal yang salah ketik di minggu pertama akan tercatat sebagai `adjustment`. Akibatnya metrik akurasi saldo tercemar oleh salah input, bukan oleh catatan yang terlewat. | `opening_balance` boleh diedit langsung selama 7 hari pertama dompet (tetap masuk `entry_history`). Sesudah 7 hari, koreksi hanya lewat "Cocokkan saldo". |
| **B5** | ubah (tambah) | Farida yang hanya memakai 1 passkey di HP akan terkunci bila HP hilang. Reset password tidak mematikan 2FA, dan Novanda tidak punya jalur untuk membantu. | Saat enrol, wajib **kode pemulihan** atau minimal 2 faktor (2 passkey, atau passkey + TOTP). Buat runbook pemulihan yang dijalankan pemilik di VM, tercatat di audit log. |
| **C6** | ubah | PWA installable (manifest + ikon, tanpa offline) murah dibuat. Tanpa itu, pemakaian harian di HP lewat tab browser dan kebiasaan sulit terbentuk. Analisis AI di M6 belum punya bukti pemakaian di v1. | PWA installable dipindah ke **M1**; offline-baca tetap di M6. Analisis AI menjadi **nanti/M7 bila pemilik meminta**. Tanyakan ke pemilik apakah M3 (utang) perlu didahulukan sebelum M2 (46 utang aktif di v1). |
| **C7** | ubah (tambah) | Gerbang belum bisa dicek. Selain itu Farida baru melihat produk saat M2, padahal UI sudah terkunci di M0a. | Gerbang M1 → M2: 7 hari berturut-turut **dan** 0 insiden data (selisih invarian, entri hilang, kebocoran ruang). Farida ikut menilai prototipe M0a dengan skenario tertulis (PO R11). |
| **C1** | ubah kecil | Pada M1 tab "Rencana" masih kosong (anggaran baru ada di M2). Tab kosong terasa belum jadi. | Tab muncul hanya bila sudah ada isinya. Pada M1 slot itu kosong atau berisi "Dompet" saja. |

## 2. Celah yang belum ada di register

1. **Privasi Pribadi Farida dari admin (wajib, M0b).** Novanda memegang VM, role `dompetku_owner`, dan `/admin/metrik`. RLS tidak melindungi dari pemilik server. Usul: halaman onboarding Farida menyatakan hal ini dengan jujur. `/admin/metrik` hanya menampilkan agregat per orang, tanpa entri. Akses DB manual ke data ruang tercatat di audit log. Tanpa kejujuran ini, kepercayaan Farida berisiko.
2. **Hari tanpa pengeluaran (wajib bersama C12, M1).** North star "% hari tercatat" jadi bias tanpa event `nothing_today` (tombol "Tidak ada pengeluaran hari ini"). Tanpa tombol ini, metrik mendorong entri palsu.
3. **Cold start saran kategori (wajib, M1).** Semua ruang mulai kosong, jadi 6 chip saran tidak berguna di minggu pertama. Fallback: kategori seed teratas menurut jam (PO R4).
4. **Utang/piutang berjalan (wajib, M3).** Perlu input sisa awal **tanpa efek kas atau laporan**. Bila tidak, cicilan pertama tercatat sebagai pengeluaran (INT-08/09). Uji di pgTAP: laporan periode berjalan tidak berubah.
5. **Visibilitas perubahan di Bersama (wajib, M2).** Hak edit/batal setara (SPEC §7a), tetapi feed hanya ada di M2 dan `entry_history` tanpa deskripsi setelah purge (A9). Usul: entri Bersama yang diubah atau dibatalkan pasangan tampil di feed dengan nama pengubah. Daftar "Dibatalkan" bisa dipulihkan ≤ 90 hari dan terlihat kedua anggota.
6. **Kuota AI habis (C11) tidak boleh menghambat catat.** Fallback ke parser aturan dan form biasa, dengan pesan netral. Bila B8 ditolak pemilik, fallback LLM dihapus dan hanya parser aturan yang dipakai.
7. **ROADMAP.md, UX.md §9, dan SPEC §5.4/§5.7 basi** setelah A1, B1, dan C6. Tetapkan siapa yang memperbarui sebelum M0a. Bila tidak, subagent membangun dari dokumen lama.
8. **C13 per orang:** tanggal gajian Novanda dan Farida bisa berbeda. Simpan sebagai pengaturan per user untuk ruang Pribadi. Ruang Bersama tetap memakai akhir bulan.

## 3. Setuju

A1, A2, A3, A4, A5, A6, A7, A8, A9 (lihat celah 5), A11, A12, B1 (catatan: pemilik perlu menerima jeda deploy beberapa menit), B2, B3, B4, B6, B7, B8, B9, C2 (sheet catat wajib menandai ruang tujuan dengan warna nila/bata), C3 (segmen disembunyikan di Bersama), C4, C5, C8, C9, C10, C11 (lihat celah 6), C12 (lihat celah 2), C13 (lihat celah 8), C14.
