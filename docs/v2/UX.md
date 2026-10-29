# DompetKu v2 — UX, Alur, dan Design System

> **Catatan 2026-10-29:** sebagian dokumen ini sudah digantikan oleh `docs/superpowers/specs/2026-10-29-dompetku-v2-design.md` §9 (self-hosted, ruang Pribadi/Bersama, keputusan tim). Bila bertentangan, spec yang berlaku.

Dasar: temuan 05-ux. Target: WCAG 2.2 AA, mobile-first (390px), desktop ≥ 1024px dengan sidebar.

## 1. Arsitektur informasi

### Keputusan U1 — Navigasi utama
| Alternatif | Plus | Minus |
|---|---|---|
| A. 5 tab: **Beranda · Transaksi · [+] · Rencana · Lainnya**, Dompet di Beranda | FAB tengah selalu ada; ≤ 5 tujuan | Dompet satu ketukan lebih jauh |
| B. 5 tab: Beranda · Transaksi · Dompet · Rencana · Lainnya + FAB melayang | Dompet langsung | FAB menutupi konten; 6 elemen di bar |
| C. 4 tab + FAB | Lebih lega | Rencana & Lainnya bercampur |
**Rekomendasi: B** — sesuai brief (Dompet adalah tujuan utama di v1), FAB melayang di kanan bawah di atas tab bar dan tersedia di **semua** layar.

| Tab | Isi |
|---|---|
| Beranda | "Aman dipakai", tagihan mendatang, anggaran hampir habis, net worth ringkas, 5 transaksi terakhir |
| Transaksi | Daftar + cari + filter tersimpan; segmen Pribadi / Kantor / Reimburse |
| Dompet | Dompet per pocket, aset, transfer; detail dompet = riwayat + saldo |
| Rencana | Anggaran bulan ini, Tujuan tabungan, Tagihan rutin, Utang & piutang (termasuk Modal Trading) |
| Lainnya | Laporan, Trip, Kategori, Kontak, Export, Analisis AI, Pengaturan, Keluar |

Desktop: sidebar dengan grup yang sama (5 grup, bukan 15 item datar). Semua navigasi memakai `<Link>` dengan `aria-current="page"`.

## 2. Beranda — "berapa yang aman dipakai?"

```
┌─────────────────────────────────────┐
│ Selamat sore, Novanda        [⚙]    │
│                                     │
│ AMAN DIPAKAI SAMPAI 31 OKT          │
│ Rp 2.340.000                        │
│ = Operasional Rp 4.100.000          │
│   − Tagihan sebelum 31 Okt Rp 960rb │
│   − Sisa anggaran wajib Rp 800rb    │
│ ≈ Rp 156.000/hari · 15 hari lagi    │
├─────────────────────────────────────┤
│ ⚠ 2 tagihan dalam 7 hari     Lihat › │
│   Listrik · Rp 450.000 · Besok      │
├─────────────────────────────────────┤
│ Anggaran Oktober            Lihat › │
│ Makan   ███████░░  78% Rp 1,17 jt   │
│ Transport ██████████ 104% ⚠         │
├─────────────────────────────────────┤
│ Kekayaan bersih  Rp 48,2 jt  ▲ 2,1% │
│ (sparkline 6 bulan)                 │
├─────────────────────────────────────┤
│ Terakhir                    Semua › │
│ Hari ini                            │
│  Makan siang · BCA      −Rp 35.000  │
│ Kemarin                             │
│  Gaji · BCA          +Rp 9.500.000  │
└─────────────────────────────────────┘
 [Beranda][Transaksi][Dompet][Rencana][Lainnya]   (+)
```

Rumus "aman dipakai" (fungsi `dashboard_summary`): saldo pocket operasional − tagihan rutin jatuh tempo s/d akhir bulan yang belum diposting − Σ max(0, sisa anggaran kategori bertanda "wajib").
Penjelasan rumus selalu terlihat (bukan angka ajaib). Tanpa anggaran/tagihan → rumus disederhanakan dan ditampilkan apa adanya.

## 3. Alur utama

### 3.1 Catat pengeluaran (≤ 3 ketukan dari layar mana pun)
1. Ketuk **(+)** → bottom sheet terbuka, fokus di nominal, keypad angka bawaan (`inputmode="numeric"`), tampilan "Rp 35.000" langsung berformat ribuan.
2. Ketuk **chip kategori** (6 saran: terakhir dipakai + paling sering pada jam ini; "Lainnya…" membuka Combobox cari). Subkategori langsung ditampilkan sebagai chip ("Makan › Makan siang").
3. Ketuk **Simpan**.
Default: tipe Pengeluaran, dompet = terakhir dipakai (bisa diubah satu ketuk), tanggal = hari ini WIB, keterangan opsional (saran dari riwayat).
Setelah simpan: sheet tertutup, toast "Tersimpan · Rp 35.000 dari BCA" dengan **Urungkan** 10 detik. Tombol nonaktif + spinner selama menyimpan; `client_id` mencegah ganda.

### 3.2 Transfer
(+) → tab Transfer → Dari (chip dompet) → Ke (chip dompet/aset) → nominal → (biaya opsional, disembunyikan di "Biaya admin") → Simpan.
Ringkasan sebelum simpan: "BCA −Rp 1.006.500 · Darurat +Rp 1.000.000 · Biaya Rp 6.500". Saldo kurang → peringatan inline (bukan `confirm()`), tetap bisa lanjut dengan konfirmasi eksplisit.

### 3.3 Utang & cicilan
Rencana › Utang & Piutang → (+) Catat → Saya berutang / Saya meminjamkan / Modal trading → kontak (combobox, buat baru inline) → jumlah → dompet (opsional) → Simpan.
Detail utang: sisa, progres, riwayat pembayaran (tanggal, dompet, jumlah), tombol **Catat pembayaran** (25% / 50% / Lunas / nominal), **Batalkan** per pembayaran dengan dialog akibat:
"Pembayaran Rp200.000 tanggal 10 Sep dibatalkan. Saldo BCA bertambah Rp200.000. Sisa utang ke Budi menjadi Rp800.000."
Edit utang hanya mengubah nama/keterangan/jatuh tempo; ubah pokok = "Koreksi pokok" yang menampilkan selisih.

### 3.4 Tujuan tabungan
Rencana › Tujuan → (+) → nama, target, tanggal (opsional) → hubungkan dompet/aset (hanya yang belum dipakai goal lain) → Simpan.
Kartu: progres, "Perlu Rp X/bulan", proyeksi tercapai (berdasarkan rata-rata setoran 3 bulan), bagian modal trading.
Setor/Cairkan = transfer bertanda goal. Riwayat bisa diedit/dibatalkan dengan dialog akibat.

### 3.5 Anggaran
Rencana › Anggaran → bulan → daftar kategori induk (anak terlipat) dengan realisasi. "Salin dari bulan lalu". Tandai kategori "wajib" (dipakai rumus aman dipakai).
Rencana zero-based: income estimasi − anggaran − alokasi tabungan = sisa (target 0).

### 3.6 Laporan
Lainnya › Laporan → periode (bulan/3 bulan/tahun/kustom) → kartu: Pemasukan, Pengeluaran, Selisih, Tingkat menabung → grafik 6 bulan → per kategori (drill-down) → "Tidak termasuk": Kas kantor Rp…, Transfer internal Rp…, Pelunasan utang Rp… (transparan).

## 4. Pola interaksi

| Pola | Aturan |
|---|---|
| Form | Bottom sheet (mobile) / dialog (desktop) via satu komponen `ResponsiveSheet`; label terhubung (`htmlFor`), pesan error di bawah field + `aria-describedby`, validasi Zod yang sama dengan server |
| Hapus | Dialog `AlertDialog` dengan akibat uang yang dihitung server ("Saldo BCA akan bertambah Rp…") + undo toast; tidak ada `window.confirm` |
| Aksi item | Ketuk baris → detail; aksi di detail atau swipe/menu "⋯" (selalu terlihat), bukan hover |
| Daftar | Skeleton saat load, empty state dengan CTA, error state dengan "Coba lagi"; paginasi "Muat lagi" |
| Toast | `aria-live="polite"`, di atas tab bar, maks 1 aktif, sukses hanya setelah server mengonfirmasi |
| Angka | Selalu `font-variant-numeric: tabular-nums`; nominal penuh di detail, ringkas di kartu dengan aturan tunggal |
| Tanggal | "Hari ini", "Kemarin", lalu "Sen, 27 Okt"; di luar tahun berjalan tampil tahun |

## 5. Design tokens

Semua pasangan teks/latar di bawah diukur (WCAG, alat contrast checker) dan lulus AA teks normal.

| Token | Light | Dark | Kontras |
|---|---|---|---|
| `bg` | `#F6F7F9` | `#0E1013` | — |
| `surface` | `#FFFFFF` | `#14171C` | — |
| `text` | `#14171C` | `#ECEEF2` | — |
| `text-muted` | `#5B6472` | `#A3ABB8` | 5,58:1 di `bg` light; 7,76:1 di `surface` dark |
| `border` (komponen non-teks) | `#8A94A3` | `#4A515C` | 3,07:1 di putih (≥ 3:1 non-teks) |
| `primary` | `#1D5BD8` | `#8EB4FF` | putih di atas `#1D5BD8` 5,93:1; `#8EB4FF` di `#14171C` 8,66:1 |
| `income` | `#0F6E56` | `#4ADE9A` | 6,2:1 putih; 10,44:1 dark |
| `expense` | `#B42318` | `#FF8A80` | 6,57:1; 7,87:1 |
| `kantor` | `#6B3FC4` | `#B9A2F5` | 6,7:1; 8,17:1 |
| `warning` | `#8A5A00` | `#F5C451` | 5,93:1 putih |

Larangan: `text-muted` adalah warna teks paling terang yang boleh dipakai (v1 memakai #94a3b8 = 2,56:1 dan #cbd5e1 = 1,48:1).

| Token | Nilai |
|---|---|
| Spasi | skala 4px: 4, 8, 12, 16, 20, 24, 32, 40, 48 |
| Radius | `sm 6`, `md 10`, `lg 14`, `full` |
| Elevasi | `0` datar (default), `1` kartu terangkat (sheet/dialog), `2` toast |
| Tipografi | `Plus Jakarta Sans` via `next/font` (400, 600); angka tabular. Skala: 12 (min, hanya meta), 14 body, 16 input (cegah zoom iOS), 18, 22, 28 (angka hero) |
| Ukuran sentuh | min 44×44 px; jarak antar target ≥ 8 px |
| Gerak | 150–200 ms, `prefers-reduced-motion` dihormati |
| Ikon | lucide-react; emoji hanya sebagai pilihan dekoratif user (ikon tujuan), selalu dengan label teks |
| Safe area | `env(safe-area-inset-*)` untuk tab bar dan sheet |

Dark mode: ikuti sistem, dengan pilihan manual di Pengaturan.

## 6. Komponen (`src/components/ui`)

Button (primary/secondary/ghost/danger, loading), IconButton (wajib `aria-label`), Link, Card, ListItem, MoneyInput (format ribuan, keypad, tolak negatif/desimal), MoneyText, DateField (WIB), Select, Combobox (cari kategori/kontak), ChipGroup, SegmentedControl, Tabs, Dialog, AlertDialog, Sheet/ResponsiveSheet, Toast (dengan undo), Tooltip, Skeleton, EmptyState, ErrorState, ProgressBar (dengan teks %), Badge, Avatar (inisial), Sparkline, Chart wrappers.
Primitif Radix memberi focus trap, Escape, `role` yang benar. Setiap komponen punya cerita contoh di halaman `/dev/ui` (hanya non-produksi) dan tes axe Playwright.

## 7. Konten

- Bahasa santai-sopan, "kamu"; kata kerja pada tombol ("Simpan", "Catat pembayaran", bukan "OK").
- Satu istilah: **Utang** (bukan Hutang), **Piutang**, **Dompet**, **Tujuan tabungan**, **Talangan kantor**.
- Format nominal: `Rp 1.250.000`; ringkas: `Rp 1,25 jt`, `Rp 12,5 rb`, `Rp 1,2 M` (koma desimal, spasi sebelum satuan, maks 2 desimal, tanpa pembulatan ke atas yang mengubah makna — tooltip/detail menampilkan nominal penuh).
- Pesan error: apa yang terjadi + apa yang bisa dilakukan ("Saldo BCA kurang Rp 50.000. Ubah nominal atau pilih dompet lain.").

## 8. PWA & offline

Manifest + ikon (installable), `theme-color` per tema, service worker cache aset statis dan **baca-saja** halaman terakhir (Beranda, Transaksi) dengan banner "Offline — data per 10.32". Mencatat saat offline: **ditunda** (butuh antrean + idempotensi; `client_id` sudah disiapkan).

## 9. Fitur turunan: MVP vs tunda

| Fitur | Status | Alasan |
|---|---|---|
| Pencarian + filter tersimpan | MVP (M1) | Sering dipakai, murah dengan query DB |
| Tag bebas | Tunda | Trip & kategori sudah menutup kebutuhan |
| Impor mutasi bank (CSV) | Tunda (setelah M7) | Butuh pemetaan per bank + deduplikasi; rawan injeksi (SEC-09) |
| Lampiran struk | Tunda | Butuh Storage + kebijakan privasi |
| Proyeksi target tabungan | MVP (M4) | Data sudah ada |
| Notifikasi tagihan (web push/email) | Tunda (setelah M5) | Butuh izin & infrastruktur push |
| Multi-mata-uang | Tunda | Kolom disiapkan, CHECK IDR |
| Berbagi dompet (rumah tangga) | Tunda | Mengubah model RLS; 2 akun v1 mungkin pasangan — tanyakan pemilik |
| Ekspor terjadwal | Tunda | Export manual cukup |
| Dark mode | MVP (M0) | Murah bila token benar sejak awal |
| PWA installable + offline baca | MVP (M0/M6) | |
