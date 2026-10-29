# 03 — Keamanan

Bukti eksekusi diambil dari v1 yang dijalankan lokal (`next start` di port 3100, Supabase lokal) dan dari metadata produksi read-only (00-schema).

## SEC-01 — RLS tidak memeriksa kepemilikan FK pada UPDATE `transfers` → manipulasi saldo lintas user · high
- **Bukti:** policy `Users can update own transfers` hanya `auth.uid() = user_id` (00-schema §7); trigger DELETE `update_wallet_balance_on_transfer` tanpa cek kepemilikan.
- **Repro:** 02-integrity INT-06 / S6 — saldo dompet user A berubah oleh user B.
- **Pola yang sama** (tanpa efek saldo langsung, tetapi merusak integritas): `debts` UPDATE (`trading_wallet_id`, `asset_id`, `contact_id`), `transactions` (`category_id`, `subcategory_id`, `debt_id`, `trip_id`, `savings_goal_id`), `savings_goal_wallets.wallet_id`, `investment_lots.asset_id` (trigger `recalculate_asset_investment` akan menghitung ulang aset milik user lain jika `asset_id` asing dipakai), `trip_excluded_transactions.transaction_id`.
- **Mitigasi saat ini:** UUID tidak bisa dibaca lintas user; registrasi dibatasi 2 email.
- **Saran:** composite FK `(user_id, x_id) REFERENCES t(user_id, id)` di semua relasi; tabel ledger tanpa policy UPDATE/DELETE langsung; mutasi hanya via fungsi `SECURITY DEFINER` yang memvalidasi `auth.uid()`.

## SEC-02 — `/api/ai-analysis` terbuka untuk publik · high
- **Bukti:** `middleware.ts:53` matcher mengecualikan `api/`; `app/api/ai-analysis/route.ts:6-9` tidak memeriksa sesi; tidak ada rate limit; `prompt` dari body diteruskan utuh ke Gemini (`:19-21`).
- **Eksekusi:** `curl -X POST http://127.0.0.1:3100/api/ai-analysis -d '{"prompt":"tulis puisi tentang kucing"}'` tanpa cookie → mencapai pemeriksaan kunci (`{"error":"GEMINI_API_KEY not configured"}`); dengan kunci terpasang, request diteruskan ke Gemini.
- **Dampak:** siapa pun yang tahu URL deploy dapat memakai kuota/tagihan Gemini sebagai proxy LLM gratis (hingga 1.500 token output per request), memicu suspend kunci, atau menyisipkan prompt apa pun. Data keuangan tidak bocor lewat route ini karena route tidak membaca DB, tetapi data user dikirim ke Google dari prompt client (perlu disebut di kebijakan privasi).
- **Tambahan:** kunci API dikirim sebagai query string (`route.ts:14`) sehingga bisa tercatat di log perantara; pesan error Gemini mentah di-log server (`:31`); keluaran tidak divalidasi di server (parsing JSON di client `ai-analysis/page.tsx:186-191`); komentar model tidak sesuai (`:3-4`).
- **Saran:** route/server action terautentikasi; ringkasan keuangan dihitung server dari DB; rate limit per user (mis. 10/hari) di tabel; header `x-goog-api-key`; validasi Zod; batasi panjang pertanyaan bebas.

## SEC-03 — Fungsi SECURITY DEFINER dapat dieksekusi `anon`/`authenticated` · medium
- **Bukti:** advisor `anon_security_definer_function_executable` ×3 dan `authenticated_…` ×3 (00-schema §8): `handle_new_user`, `update_wallet_balance_on_transaction`, `update_wallet_balance_on_transfer`.
- Pemanggilan langsung lewat `/rest/v1/rpc/` akan gagal karena fungsi trigger butuh konteks trigger, sehingga dampak nyata rendah; tetapi ini kebiasaan berbahaya untuk fungsi uang di v2.
- `handle_new_user`, `check_category_depth`, `prevent_direct_balance_update` tanpa `SET search_path` (advisor `function_search_path_mutable`).
- **Saran:** `REVOKE EXECUTE ... FROM public, anon, authenticated` untuk fungsi trigger; fungsi RPC v2 di skema `api` dengan `search_path = ''` dan nama terkualifikasi penuh.

## SEC-04 — Penjaga saldo berbasis GUC yang bisa diatur · medium (dugaan)
- **Bukti:** `prevent_direct_balance_update` mengizinkan perubahan saldo jika `current_setting('app.allow_balance_update') = 'true'`.
- PostgREST tidak mengekspos `set_config`, dan user tidak punya fungsi yang mengaturnya, jadi saat ini tidak bisa dieksploitasi lewat API. Namun fungsi `SECURITY DEFINER` mana pun yang di masa depan menerima SQL dinamis atau dipanggil di transaksi yang sama akan membuka jalan. Dugaan; tidak dibuktikan.
- **Saran v2:** saldo bukan kolom yang bisa ditulis (view), atau kolom yang hanya boleh diubah oleh role pemilik fungsi (kolom privilege `REVOKE UPDATE (balance)`).

## SEC-05 — Profil dapat mengubah `role` miliknya · low
- **Bukti:** policy `Users can update own profile` tanpa pembatasan kolom (00-schema §7).
- Saat ini `role` tidak dipakai di mana pun, sehingga dampak nol. Akan menjadi eskalasi hak akses begitu `role`/`trial_expires_at` dipakai untuk menegakkan akses.
- **Saran:** kolom hak akses di tabel terpisah yang hanya ditulis service role, atau `REVOKE UPDATE (role, trial_expires_at)`.

## SEC-06 — Middleware, sesi, dan cek auth ganda · medium
- `middleware.ts:28` memakai `getUser()` (benar), tetapi halaman memakai `getSession()` di client (`components/AppShell.tsx:26`, 27 kemunculan `getSession` di `app/`) yang tidak memverifikasi JWT; tidak berbahaya karena RLS tetap memverifikasi token di DB, tetapi ada dua sumber kebenaran.
- Setiap halaman client-only: `AppShell` menunggu `getSession` sebelum render, lalu setiap halaman memanggil `getSession` lagi sebelum menulis (mis. `wallets/page.tsx:52`) — waterfall dan kode berulang.
- Pengecualian `api/` di matcher berarti route API baru default tidak terlindungi.
- Logout hanya di client (`Sidebar.tsx:34-37`); `/trial-expired` melakukan `signOut` di `useEffect`.
- Tidak ada header keamanan (`curl -I /auth` → tidak ada CSP, `X-Frame-Options`, HSTS, `Referrer-Policy`, `Permissions-Policy`).
- **Saran v2:** satu helper `requireUser()` di server (RSC/server action), middleware hanya menyegarkan sesi; header keamanan di `next.config`; CSP ketat.

## SEC-07 — Harga saham lewat proxy CORS publik dari browser · medium
- **Bukti:** `app/assets/page.tsx:15-18` memakai `api.allorigins.win` dan `corsproxy.io` untuk Yahoo Finance; hasilnya ditulis ke DB dari client (`:117-121`).
- **Dampak:** pihak ketiga melihat ticker dan IP user dan dapat mengembalikan harga palsu yang langsung menjadi `assets.value` dan net worth; ketersediaan bergantung pada layanan gratis; melanggar ToS Yahoo (dugaan).
- **Saran v2:** route server dengan cache (mis. 15 menit) dan sumber data yang jelas; validasi angka (> 0, perubahan harian wajar); simpan `price_source` dan `priced_at`; UI menampilkan "terakhir diperbarui" dan gagal dengan anggun.

## SEC-08 — Konfigurasi dan secret di repo · low
- **Bukti:** `DEPLOY.md:5-8,58-63,76-78` dan `setup.sh:24-27` berisi URL project dan **anon key** produksi; `DEPLOY.md:44-48` menyebut scope Vercel pribadi.
- Anon key memang publik (ikut ter-bundle ke JS), sehingga bukan kebocoran rahasia, tetapi menyalinnya ke repo membuat rotasi sulit dan mengikat repo ke satu project. `GEMINI_API_KEY` tidak ada di repo (baik).
- Riwayat migrasi Supabase menyimpan email pemilik dan UUID user secara literal (00-schema intro); fungsi `handle_new_user` dan policy `profiles` meng-hardcode email.
- **Saran v2:** `.env.example` tanpa nilai; allowlist email di tabel/env; dokumen deploy tanpa nilai rahasia/identitas.

## SEC-09 — Injeksi HTML di export PDF · low
- **Bukti:** `app/export/page.tsx:101-110` menyisipkan `description`, nama kategori, dan nama dompet mentah ke HTML; `:47-50` `window.open('')` + `document.write`. Dokumen `about:blank` mewarisi origin aplikasi, sehingga `<img src=x onerror=…>` di deskripsi transaksi berjalan dengan akses ke sesi Supabase (localStorage/cookie).
- Karena data berasal dari user sendiri, ini self-XSS; menjadi nyata jika v2 mengimpor mutasi bank/CSV atau berbagi dompet.
- CSV tidak menetralkan formula (`=`, `+`, `-`, `@`) (`transactions/page.tsx:384`, `export/page.tsx:75`).
- **Saran v2:** PDF dibuat server-side (atau render React yang meng-escape); CSV di-prefix `'` untuk sel berawalan karakter formula.

## SEC-10 — Dependensi · medium
- **Bukti:** `npm audit --omit=dev` (2026-10-29): 3 kerentanan (1 critical, 2 high): `next@14.2.35` (beberapa advisory, a.l. GHSA-9g9p-9gw9-jx7f, GHSA-h25m-26qc-wcjf, GHSA-ggv3-7p47-pfv8), `postcss` bawaan Next (GHSA-qx2v-qp2m-jg93 dkk.), `source-map-js` (GHSA-68fv-2mgg-jv7q). Perbaikan Next memerlukan major upgrade.
- `recharts@2.15.4` deprecated (cabang 2.x tidak aktif), `@supabase/ssr@0.5.2` jauh tertinggal, `lucide-react@0.400.0` terpasang tetapi tidak dipakai (grep `lucide-react` di `app/`, `components/` → 0).
- Versi memakai `^` tanpa Renovate/Dependabot; tidak ada CI yang menjalankan audit.

## SEC-11 — Auth Supabase · low
- Advisor: proteksi password bocor mati.
- Tidak ada alur lupa password, verifikasi ulang, atau MFA di UI; pendaftaran diblok di DB dengan pesan generik (`RAISE EXCEPTION 'Registrasi tidak diizinkan.'`).
- 1 `auth.users` tanpa profil (00-schema §2) — kemungkinan akun yang dibuat sebelum trigger atau sebelum whitelist; perlu ditinjau pemilik.
