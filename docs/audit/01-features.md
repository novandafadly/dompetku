# 01 — Inventaris Fitur dan Aturan Bisnis v1

Semua halaman v1 adalah client component (`'use client'`) yang memanggil Supabase langsung dari browser
(`lib/supabase.ts:6` `createBrowserClient`). Tidak ada server action, RPC, atau API route kecuali `/api/ai-analysis`.
"Baca/Tulis" di bawah adalah tabel yang disentuh lewat `supabase.from(...)` di file tersebut.

## 1. Peta halaman

| Route | Tujuan | Baca | Tulis | Aksi utama | State lokal | Aturan bisnis tertanam |
|---|---|---|---|---|---|---|
| `/` (`app/page.tsx`) | Redirect | session | — | `getSession` → `/dashboard` atau `/auth` | — | Cek auth ganda (middleware + client) |
| `/auth` | Login | — | — | `signInWithPassword` | email, password, error | Tidak ada daftar/lupa password; registrasi diblok di DB (00-schema §5) |
| `/trial-expired` | Info trial habis | — | — | `signOut` saat mount | — | Teks mengklaim "semua data telah dihapus otomatis"; tidak ada yang mengarahkan ke halaman ini (grep `trial-expired` → hanya file itu sendiri) |
| `/dashboard` | Ringkasan | wallets, transactions (bulan ini), budgets, assets, debts, recurring_transactions, net_worth_snapshots, categories | net_worth_snapshots (upsert setiap kunjungan) | — | 7 array + loading | Net worth = saldo non-kantor + nilai aset − sisa utang (`:81-83`, `:100-103`); Free cashflow = income − expense − estimasi tagihan rutin bulanan (`:109`); kantor dikecualikan dari transaksi & anggaran (`:105`, `:299`) |
| `/wallets` | Dompet + transfer cepat | wallets, transfers (30), savings_goals | wallets, transfers | tambah/edit/hapus dompet, transfer, edit/hapus transfer | 2 modal, 2 form | Pocket operasional/tabungan/kantor; edit transfer = hapus + insert (`:99-115`); progres goal di kartu dompet = `balance/target` (`:203`) |
| `/transfers` | Riwayat transfer | transfers (200, tanpa goal), wallets, assets | transfers | tambah/edit/hapus | modal, form, filter | Transfer ke aset lewat halaman Aset; konfirmasi `window.confirm` jika saldo kurang (`:136-138`); fee ditanggung dompet asal |
| `/transactions` | Catat & daftar transaksi | transactions (300), wallets, categories, trips | transactions, assets | tambah (form + quick add), edit, hapus, reimburse, undo reimburse, export CSV | 3 tab, 6 filter, 2 form, quick-add 8 state | Tab Pribadi/Kantor/Reimburse; reimbursable hanya untuk dompet non-kantor (`:176`); trip hanya untuk non-kantor (`:177`); kategori investasi (nama mengandung invest/saham/reksa/obligasi/crypto) otomatis menambah aset (`:110-128`, `:213`) |
| `/recurring` | Tagihan rutin | recurring_transactions (+join wallets, categories), wallets, categories | recurring_transactions, transactions | tambah/edit/hapus, aktif/nonaktif, "Catat sekarang" | modal, form, executing | Normalisasi bulanan: weekly×4,33, daily×30, yearly/12 (`:38-46`); eksekusi manual mencatat transaksi tanggal hari ini lalu memajukan `next_due` (`:104-116`); `auto_execute` tidak dipakai |
| `/budgets` | Anggaran & rencana | budgets, categories (expense), transactions (expense bulan terpilih +wallets.pocket), wallets (tabungan), budget_plan | budgets, budget_plan | set/edit/hapus anggaran, salin bulan lalu, rencana zero-based | tab, bulan/tahun, 2 modal | Realisasi = Σ expense non-kantor dengan `category_id` sama (`:184-185`); rencana: income − Σ anggaran − Σ alokasi tabungan = 0 (`:183-189`); salin bulan lalu melewati kategori yang sudah ada (`:121-137`) |
| `/assets` | Aset & saham | assets, wallets, investment_lots | assets, investment_lots, transfers | tambah/edit/hapus aset, tambah/hapus lot, refresh harga, setor dana | 4 modal | Aset bertiker = saham IDX (`.JK`), nilai dari lot (trigger) × harga; non-saham diisi manual atau via "Setor Dana" (transfer `to_asset_id`); jual dibatasi qty milik (`:230-233`) |
| `/credit-cards` | Kartu kredit | credit_cards | credit_cards | tambah/hapus | form | Tidak terhubung ke transaksi, dompet, net worth, atau utang (0 baris di DB) |
| `/debts` | Utang/piutang & kontak | debts (+contacts, wallets, trading_wallet, asset), contacts, wallets, assets, transactions (riwayat) | contacts, debts, transactions, transfers | CRUD kontak, CRUD utang/piutang, catat bayar, riwayat cicilan, batalkan cicilan, tandai selesai | 5 modal, 3 form | Lihat §2.3 dan §2.4 |
| `/trips` | Trip & healing | trips, transactions (500), wallets, categories, trip_excluded_transactions | trips, transactions, trip_excluded_transactions | CRUD trip, exclude/include transaksi, tambah transaksi trip | 3 modal | Lihat §2.7 |
| `/savings-goals` | Tujuan tabungan | savings_goals, wallets, assets, savings_goal_wallets, debts (capital loan), transfers & transactions (riwayat) | savings_goals, savings_goal_wallets, transfers, transactions, assets | CRUD goal, top up, cairkan, edit/hapus riwayat, tandai selesai | 3 modal, 4 form | Lihat §2.5 |
| `/categories` | Kategori 2 level | categories | categories | CRUD kategori/subkategori | modal, form, expand | Maks 2 level (trigger); hapus induk diblok di client jika punya anak (`:136-140`); kategori default tidak bisa dihapus (RLS) |
| `/reports` | Laporan 6 bulan | transactions (6 bln), wallets, categories, recurring_transactions | — | pilih bulan | bulan/tahun | Free cashflow sama dengan dashboard; **tidak** mengecualikan kantor (lihat 02-integrity INT-08) |
| `/export` | Export CSV/PDF | transactions (1000 + join), wallets, categories | — | filter, unduh CSV, cetak PDF via `window.open` | 7 filter | CSV ber-BOM; PDF = HTML yang di-`document.write` |
| `/ai-analysis` | Analisis Gemini | transactions (3 bln, 500), budgets (bulan berjalan) | — | analisis bulanan (JSON), pertanyaan bebas | mode, bulan, hasil | Prompt dirakit di client (`:141-172`), dikirim mentah ke `/api/ai-analysis` |
| `POST /api/ai-analysis` | Proxy Gemini | — | — | — | — | Tanpa auth, rate limit, atau validasi (03-security SEC-02) |

Navigasi: sidebar desktop 15 item (`components/Sidebar.tsx:8-24`), bottom nav mobile 6 item (`components/AppShell.tsx:10-17`).
Di mobile, 9 fitur hanya terjangkau lewat hamburger (Aset, Kartu Kredit, Utang, Trip, Tujuan Tabungan, Kategori, Tagihan Rutin, Export, AI).

## 2. Aturan bisnis yang harus bertahan di v2

### 2.1 Pocket wallet
- Tiga pocket: `operasional` ("Bisa dipakai"), `tabungan` ("Dana yang tidak disentuh"), `kantor` ("Dana reimbursement/operasional kantor") — `lib/utils.ts:53-75`, CHECK `wallets.pocket`.
- Pocket kantor **dikecualikan** dari: total saldo dan net worth di dashboard (`dashboard/page.tsx:81,100`), transaksi pribadi, chart kategori, dan progres anggaran (`:105,113,299`), realisasi anggaran (`budgets/page.tsx:82` via `filterPersonalTransactions`), tab Pribadi (`transactions/page.tsx:272`), trip (`trips/page.tsx:103`), opsi reimburse (`transactions/page.tsx:176`).
- Pocket kantor **tidak** dikecualikan di: laporan (`reports/page.tsx`), export, analisis AI, halaman Dompet "Total semua" (`wallets/page.tsx:148`). Ini inkonsisten; v2 harus memusatkan aturan ini.
- `wallets.type` (cash/bank/ewallet/investment) hanya kosmetik (ikon/warna).

### 2.2 Reimbursement
- Transaksi expense dari dompet **non-kantor** dapat ditandai `is_reimbursable` (`transactions/page.tsx:176,891-906`).
- Menyelesaikan reimburse: set `reimbursed_at = now()` lalu insert transaksi **income** `Reimburse: <deskripsi>` tanpa kategori ke dompet non-kantor pilihan, tanggal pilihan (`:239-269`).
- Batal reimburse hanya mengosongkan `reimbursed_at`; transaksi income yang sudah dibuat tetap ada (`:233-237`).
- Transaksi expense asli tetap dihitung sebagai pengeluaran pribadi, dan income reimburse dihitung sebagai pemasukan pribadi.
  Efek bersihnya nol, tetapi laporan income/expense menggembung (10 pasang di DB).
- Tidak ada FK dari income reimburse ke transaksi asalnya.

### 2.3 Utang/piutang
- `type`: `debt` (saya berutang) atau `receivable` (orang berutang ke saya). Opsional terhubung ke `contacts`; kontak baru dibuat otomatis dari nama (`debts/page.tsx:210-218`).
- Jika dicatat dengan dompet: utang → transaksi **income** `[Hutang] <nama>` (uang masuk), piutang → transaksi **expense** `[Piutang] <nama>` (uang keluar) (`:303-316`). Tanpa kategori.
- Cicilan: `paid_amount += amount` (dibatasi ke `total_amount`), `is_completed` otomatis saat lunas, lalu insert transaksi expense `[Bayar Hutang]` atau income `[Terima Piutang]` jika dompet dipilih (`:351-396`). Tombol cepat 25%/50%/Lunas.
- Riwayat cicilan = transaksi dengan `debt_id` dan deskripsi berawalan `[Bayar Hutang]`/`[Terima Piutang]` (`:399-416`).
- Batalkan cicilan: hapus transaksi (trigger membalik saldo), `paid_amount -= amount`, `is_completed=false` (`:418-433`).
- Hapus utang: hapus semua transaksi dan transfer dengan `debt_id` (trigger membalik saldo), lalu hapus utang (`:324-333`).
- Ringkasan per kontak: net = Σ sisa piutang − Σ sisa utang (`:436-452`).
- Hanya sisa **utang** yang mengurangi net worth (`dashboard/page.tsx:83,102`); sisa **piutang tidak** menambah net worth, padahal uang yang dipinjamkan sudah mengurangi saldo dompet. Ini perlu keputusan pemilik produk (lihat SUMMARY).

### 2.4 Modal Trading (capital loan)
- Piutang ke diri sendiri: `type='receivable'`, `is_capital_loan=true`, wajib `trading_wallet_id`; sumber dompet (`wallet_id`) atau aset (`asset_id`, mis. RDPU) (`debts/page.tsx:222-243`).
- Perpindahan uang lewat **Transfer** (bukan Transaction) agar tidak tercatat sebagai income/expense: sumber → dompet trading, dengan `debt_id` (`:248-261`). Untuk sumber aset: `from_asset_id` (trigger mengurangi `assets.value`).
- Pengembalian: transfer dari dompet trading ke dompet/aset asal dengan `debt_id` (`:364-377`).
- Progres goal tabungan menambahkan kembali sisa modal trading yang bersumber dari dompet/aset goal tersebut ("masih dihitung aman") (`savings-goals/page.tsx:154-183`); pencairan dibatasi ke saldo fisik (`:166-170,433-435`).
- Peringatan shortfall: Σ sisa modal per dompet trading > saldo dompet trading → "Kurang Rp…" (`debts/page.tsx:659-686`, `savings-goals/page.tsx:197-212`).
- 7 modal trading aktif di DB.

### 2.5 Tujuan Tabungan
- Target berupa satu atau lebih dompet (`savings_goal_wallets`, 2026-07-28) **atau** satu aset (`asset_id`). `wallet_id` lama tetap diisi dompet pertama (`savings-goals/page.tsx:320`).
- Progres = Σ saldo dompet terhubung (atau nilai aset) + sisa modal trading terkait; **tidak** disimpan (kolom `current_amount` tidak dipakai).
- Top up = transfer dari dompet di luar goal ke salah satu dompet goal (atau ke aset) dengan `savings_goal_id`, `savings_type='topup'` (`:369-419`).
- Pencairan dompet = transfer dari dompet goal ke dompet lain (`savings_type='withdraw'`); pencairan aset = **transaksi income** + update manual `assets.value` (`:439-454`).
- Riwayat bisa diedit (transfer: hapus + insert; transaksi: update) dan dihapus (trigger membalik) (`:503-576`).
- `is_completed` dihitung ulang di client setelah top up/pencairan/edit, dan bisa di-toggle manual.
- Estimasi "Perlu nabung ~X/bulan" = sisa / (hari tersisa / 30) (`:589`).

### 2.6 Aset & investasi
- Jenis: investment, property, vehicle, electronics, other. Investment bertiker = saham IDX.
- Lot buy/sell → trigger `recalculate_asset_investment`: qty, avg_price (rata-rata biaya semua pembelian), value = qty × (harga pasar atau avg) (00-schema §5).
- Lot tidak memindahkan uang dari/ke dompet (tidak ada transfer/transaksi saat beli/jual saham).
- Refresh harga: Yahoo Finance via proxy CORS publik, lalu `value = qty × price` ditulis dari client (`assets/page.tsx:12-35,111-128`).
- P/L belum terealisasi = (harga − avg) × qty; tidak ada P/L terealisasi.
- "Setor Dana" ke aset non-saham = transfer `to_asset_id` (`:258-290`); cek saldo hanya di client.
- Transaksi expense berkategori "investasi" otomatis membuat/menambah aset bernama deskripsi (`transactions/page.tsx:110-128`) — tetapi uangnya tercatat sebagai pengeluaran **dan** sebagai aset (net worth tetap, laporan pengeluaran menggembung).

### 2.7 Trip & Healing
- Trip: nama, emoji, tujuan, tanggal mulai/akhir opsional, budget, catatan.
- Keanggotaan transaksi: ditag `trip_id` **atau** (tanpa tag) tanggal dalam rentang trip; dikecualikan: dompet kantor dan baris `trip_excluded_transactions` (`trips/page.tsx:99-116`).
- Total trip: expense − income ("boncos"/"surplus"); progres budget trip.
- Status: upcoming/ongoing/done/open (tanpa tanggal).

### 2.8 Anggaran
- Per kategori per bulan, unik (`budgets` UNIQUE). Salin dari bulan lalu.
- `budget_plan`: estimasi income + alokasi tabungan JSON (`[{id,label,wallet_id,amount}]`) → zero-based (`budgets/page.tsx:158-189`).
- Kategori bisa 2 level (`categories.parent_id`); transaksi menyimpan induk di `category_id` dan anak di `subcategory_id` (`transactions/page.tsx:323-338`); subkategori wajib jika induk punya anak (`components/CategoryPicker.tsx:13`, `transactions/page.tsx:421`).
- `rollover_enabled` ada di DB tetapi belum diimplementasikan.

### 2.9 Tagihan rutin
- Frekuensi daily/weekly/monthly/yearly, `day_of_month`/`day_of_week`, `next_due`, `auto_execute`.
- Peringatan jatuh tempo ≤ 7 hari di dashboard (`dashboard/page.tsx:121,153-173`); kelompok Terlambat/≤7 hari/Nanti/Nonaktif.
- 0 baris di DB: fitur belum dipakai.

### 2.10 Net worth, laporan, export, AI
- Snapshot harian `net_worth_snapshots` di-upsert setiap kali dashboard dibuka (`dashboard/page.tsx:75-92`), dipakai untuk grafik 6 bulan. 96 snapshot di DB.
- Laporan: income/expense/cashflow 6 bulan, perbandingan bulan lalu, top 5 pengeluaran, per kategori.
- Export: CSV transaksi (filter tanggal/dompet/tipe/kategori) dan PDF cetak.
- AI: skor kesehatan 1–100, 4–6 insight, 3 rekomendasi (JSON), atau tanya bebas ≤ 300 kata.

### 2.11 Trial dan akses
- **Penegakan saat ini:** hanya `handle_new_user` yang menolak email di luar whitelist 2 alamat (00-schema §5) dan policy INSERT `profiles` yang hanya mengizinkan 1 email. Semua profil `role='permanent'`.
- `profiles.role` dan `trial_expires_at` **tidak** dibaca oleh middleware, halaman, atau RLS.
- Penghapusan data trial pernah dilakukan `cleanup_expired_trials()` via pg_cron tiap jam; fungsi sudah dihapus, job masih gagal tiap jam sejak 2026-06-27 (00-schema §6).
- Halaman `/trial-expired` yatim.
- Kesimpulan: v1 saat ini adalah aplikasi **pribadi untuk 2 orang**, bukan produk dengan trial. Model akses v2 adalah keputusan pemilik produk.

## 3. Duplikasi logika yang harus disatukan di v2

| Logika | Lokasi |
|---|---|
| Form + insert transfer | `wallets/page.tsx:91-133`, `transfers/page.tsx:120-165`, `savings-goals/page.tsx:369-419,429-479,525-543`, `assets/page.tsx:258-290`, `debts/page.tsx:249-261,364-377` (6 titik insert) |
| Insert transaksi | `transactions/page.tsx` (3 titik), `debts/page.tsx` (3), `recurring/page.tsx:109`, `trips/page.tsx:203`, `savings-goals/page.tsx:440` |
| Normalisasi tagihan rutin ke bulanan | `dashboard/page.tsx:18-26`, `recurring/page.tsx:38-46`, `reports/page.tsx:15-23` |
| Akhir bulan via `toISOString` | `budgets/page.tsx:64`, `reports/page.tsx:13`, `ai-analysis/page.tsx:27,33` |
| Join manual wallet/kategori | `dashboard`, `transactions`, `trips`, `reports`, `budgets` |
| `daysUntil` | `dashboard/page.tsx:12-16`, `recurring/page.tsx:23-27`, `savings-goals/page.tsx:92-96` |
| Pemilih kategori 2 level | `components/CategoryPicker.tsx` (tidak dipakai di mana pun), `transactions/page.tsx` form + quick add (dua implementasi berbeda) |
| Progres goal | `wallets/page.tsx:203` (1 dompet, tanpa modal trading) vs `savings-goals/page.tsx:155-163` (multi dompet + modal trading) — dua rumus berbeda untuk angka yang sama |
