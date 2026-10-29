# Round 1 — Frontend Engineer

Peran: arsitektur `apps/web` (Next.js App Router), design system, performa, tes frontend, PWA.
Dasar: `docs/superpowers/specs/2026-10-29-dompetku-v2-design.md` (selanjutnya **SPEC**), `docs/v2/DESIGN.md` (**DESIGN**), `docs/v2/UX.md` (**UX**), `docs/v2/ROADMAP.md` (**ROADMAP**), `docs/audit/04-code-quality.md` dan `05-ux.md`.

## 1. Ringkasan sikap

Arah SPEC §5.1 (RSC untuk baca, Server Actions untuk tulis, logika uang di Postgres) tepat, dan saya ingin frontend tetap "tipis": tidak ada aturan uang di TypeScript selain format dan validasi bentuk input.
Tiga hal di frontend yang paling bisa merusak uang atau privasi harus dikunci di M0, bukan nanti: (1) ruang aktif yang terbaca dari cookie bisa membuat transaksi tercatat di ruang yang salah, (2) cache data Next.js yang tidak dikunci per user bisa menampilkan data pasangan, (3) `client_id` yang dibuat ulang saat retry membuat transaksi ganda.
Saya mengusulkan menghapus TanStack Query dari stack (DESIGN §3) dan memakai `useOptimistic` + RSC saja, serta membuat formatter uang/tanggal sendiri yang deterministik alih-alih `Intl` mentah.
Dua token warna di UX §5 gagal kontras non-teks 3:1 setelah saya ukur ulang; perbaikannya ada di §4.

## 2. Rekomendasi

Versi di bawah adalah garis yang saya usulkan; versi exact dikunci di ADR saat M0 (SPEC §8) setelah dicek rilis stabil terbaru. Tidak memakai canary/beta.

| Area | Pilihan | Alasan singkat |
|---|---|---|
| Runtime | Node.js 24 LTS, image `node:24-bookworm-slim` (multi-arch) | LTS aktif; multi-arch karena arsitektur VM belum pasti (SPEC §3) |
| Framework | Next.js 16.x, React 19.2.x, TypeScript 5.9+ `strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` | `useOptimistic`/`useActionState` stabil; `proxy.ts` (pengganti `middleware.ts` di 16) berjalan di Node |
| Paket | pnpm 10 workspaces (tanpa Turborepo dulu) | Dependensi ketat (tidak ada impor "kebetulan jalan"), cache CI cepat; Turborepo baru bila build > 5 menit |
| Styling | Tailwind CSS 4.1+ dengan `@theme` | Token sebagai CSS variable; palet bawaan bisa dimatikan (rek. 8) |
| Primitif | paket `radix-ui` (tunggal) 1.4+, pola shadcn sebagai generator kode saja; `cmdk` 1.x untuk Combobox | Focus trap, Escape, role benar (menutup CQ-07, 05-ux §4) |
| Form | Zod 4, React Hook Form 7 + `@hookform/resolvers` 5 | Satu skema Zod dipakai client dan server (UX §4 "Form") |
| Toast | Radix Toast (bukan sonner) | Satu keluarga primitif; pause saat fokus/hover, hotkey F8, `aria-live` bawaan |
| Sheet | Radix Dialog bergaya bottom sheet, tanpa `vaul` | `vaul` tidak lagi dirawat aktif; drag-to-dismiss tidak wajib |
| Grafik | SVG tulisan sendiri untuk sparkline/progress; Recharts 3 dinamis hanya di Laporan | Beranda tetap di bawah budget JS (ROADMAP M2) |
| Ikon | `lucide-react`, lewat satu wrapper `Icon` (ukuran 16/20/24, stroke 1.75) | Konsisten, tree-shakable; satu wrapper membuat ganti set ikon murah bila nanti ingin identitas lain |
| Tes | Vitest 3.2+ (atau 4.x), `@testing-library/react` 16, `user-event` 14, Playwright 1.5x, `@axe-core/playwright` 4.10+ | |
| Tidak dipakai | TanStack Query, next-intl, Storybook, next-pwa/Serwist, date-fns-tz, vaul | Alasan di rekomendasi terkait |

### R1 — Build standalone yang aman untuk self-host · **wajib** · M0
- `next.config.ts`: `output: 'standalone'`, `outputFileTracingRoot` = root monorepo, `poweredByHeader: false`, `images: { unoptimized: true }` (app tidak memakai gambar raster; menghindari `sharp` di image), `serverActions.allowedOrigins: ['dompet.novandafadly.com']`, `serverActions.bodySizeLimit: '256kb'`.
- Dockerfile multi-stage menyalin `.next/standalone`, `.next/static`, `public`; jalan sebagai user non-root; `HOSTNAME=0.0.0.0`; `NODE_OPTIONS=--max-old-space-size=<~75% limit container>` agar OOM tidak terjadi diam-diam di container ber-limit (SPEC §7a).
- **Version skew:** set `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` tetap (secret env, bukan per build) dan `deploymentId` = git SHA. Setelah deploy, tab lama yang memanggil Server Action yang ID-nya berubah mendapat error; klien menangkapnya dan menampilkan "Versi baru tersedia. Muat ulang" **tanpa** mengulang aksi uang secara otomatis.
- Reverse proxy wajib meneruskan `Host`/`X-Forwarded-Host` asli; jika tidak, cek Origin bawaan Server Actions menolak semua tulis (atau lebih buruk: dimatikan orang untuk "memperbaiki").
- Alasan: deploy di VM DB dengan limit memori (SPEC §7a) dan rollback otomatis (SPEC §5.7) membuat skew dan OOM kasus nyata, bukan teori.

### R2 — Struktur monorepo dan batas impor · **wajib** · M0
```
apps/web/src/
  app/(auth)/{masuk,undangan/[token],verifikasi}/
  app/(app)/[ruang]/{beranda,transaksi,dompet,rencana,lainnya}/   ruang ∈ {pribadi, bersama}
  app/(app)/pengaturan/            (tidak bergantung ruang)
  app/api/health/route.ts
  app/dev/ui/                      (notFound() kecuali ENABLE_DEV_UI=1)
  features/<domain>/
    queries.ts      import 'server-only'; dipanggil RSC
    actions.ts      'use server'; satu-satunya tempat 'use server'
    schema.ts       Zod, dipakai client & server
    components/     komponen domain (boleh client)
  components/ui/    primitif design system (satu-satunya yang impor radix-ui)
  components/app/   shell, nav, QuickAddHost, SpaceBadge
  lib/              db.ts (withUser), auth.ts, action.ts, errors.ts, env.ts
packages/domain/    money.ts, date.ts, parser teks bebas (M6), Zod skema bersama; tanpa React, tanpa Node API
packages/db/        migrasi, tipe kysely-codegen, pgTAP
```
- Aturan ESLint (`no-restricted-imports` + `eslint-plugin-boundaries`): `features/a` tidak impor internal `features/b` (hanya lewat `index.ts`); hanya `components/ui` yang impor `radix-ui`; `queries.ts`/`lib/db.ts` wajib `server-only`; `'use server'` di luar `features/*/actions.ts` gagal lint (setiap export file `'use server'` adalah endpoint POST publik).
- `packages/domain` dipisah karena worker (SPEC §5.5) dan bot Telegram (SPEC §5.6 M8) memakai parser dan format yang sama.
- Alasan: menutup CQ-01/CQ-05 (logika tersebar, duplikasi 9 titik insert).

### R3 — Batas RSC/client dan strategi cache · **wajib** · M0
- Semua halaman `(app)` dinamis (cookie sesi + nonce CSP). Tidak ada `'use cache'`, `unstable_cache`, atau `fetch` cache untuk data user. Lint melarang API itu di `features/**` dan `app/(app)/**`. Satu-satunya memo = `React.cache` (per request).
- Alasan: cache data Next.js dikunci oleh argumen fungsi, bukan oleh sesi. Lupa menyertakan `userId` di kunci = data Pribadi Farida tampil ke Novanda, yang adalah anti-tujuan SPEC §2.
- Setelah tulis: action memanggil `revalidatePath('/[ruang]', 'layout')` untuk ruang yang terdampak (transfer lintas ruang = dua ruang). Router Cache dinamis Next 16 `staleTimes.dynamic = 0` (default) dibiarkan.
- Beranda dipecah per kartu dengan `<Suspense>`: angka "Aman dipakai" (UX §2) dirender dulu, kartu lain streaming. Setiap segmen punya `loading.tsx` (skeleton seukuran konten asli, CLS 0) dan `error.tsx` yang menampilkan apa yang gagal + "Coba lagi" + kode `digest` untuk dicocokkan dengan log pino.
- Komponen client hanya untuk: QuickAdd sheet, MoneyInput, Combobox, filter interaktif, Toast, grafik. Target: < 25% file `.tsx` di `features/` ber-`'use client'` (v1: 19/19 halaman, 04-code-quality §1).

### R4 — Ruang aktif di URL, bukan cookie · **wajib** · M0 (rute) / M1 (action)
| Opsi | Plus | Minus |
|---|---|---|
| **A. Segmen path `/pribadi/...`, `/bersama/...`** | Dua tab bisa beda ruang dengan aman; back/forward benar; server tahu ruang tanpa state tersembunyi; URL terbaca | URL lebih panjang; perlu redirect dari `/` |
| B. Cookie `active_space` | URL bersih | Tab A dan tab B berbagi cookie: ganti ruang di tab B, lalu simpan di tab A = transaksi masuk ruang salah |
| C. Query `?ruang=` | Mudah | Hilang saat link internal lupa meneruskannya |

**Pilih A.** Cookie `last_space` hanya dipakai untuk redirect `/` → ruang terakhir.
- `[ruang]` adalah alias (`pribadi` = ruang personal milik user yang login, `bersama` = ruang shared household). Layout `[ruang]` me-resolve alias → `space_id` di server lewat `space_members`; alias lain → `notFound()`.
- Setiap Server Action menerima `spaceId` **eksplisit** dari form (diisi dari layout, bukan cookie); DB memvalidasi keanggotaan (SPEC §5.2, RLS). Action tidak pernah "menebak" ruang.
- QuickAdd menampilkan ruang tujuan sebagai teks di header sheet ("Catat ke **Bersama**") plus ikon, bukan hanya warna, sehingga salah ruang terlihat sebelum Simpan.

### R5 — Pipeline Server Action + Zod + pemetaan error · **wajib** · M0
Satu helper `lib/action.ts`:
```ts
export const createEntryAction = action(createEntryInput, async (input, ctx) => {
  return ctx.db.call('api.create_entry', { ... , p_client_id: input.clientId });
});
// hasil: { ok: true, data } | { ok: false, code: 'SALDO_KURANG', message: string, fieldErrors?: Record<string,string> }
```
- Urutan tetap: `requireUser()` → `schema.safeParse` → `withUser(userId, spaceId)` → panggil fungsi `api.*` → `revalidatePath` → `Result`.
- Error yang diharapkan **dikembalikan**, tidak di-throw (pesan error yang di-throw disembunyikan Next di produksi, sehingga user hanya melihat pesan generik).
- `lib/errors.ts`: tabel SQLSTATE kustom (`DK001` saldo kurang, dst., DESIGN §5 "Fungsi RPC") → kode stabil + pesan Indonesia gaya UX §7 ("Saldo BCA kurang Rp 50.000. Ubah nominal atau pilih dompet lain.") + field yang ditandai. `23505` pada `client_id` = sukses idempoten, bukan error. Kode tak dikenal → pesan generik + log pino dengan `request_id` (tanpa nominal/deskripsi, SPEC §5.7).
- Tes Vitest: setiap kode di katalog error punya pesan; kode DB baru tanpa entri di peta = tes gagal (katalog dibagi dengan Backend, lihat §6).
- Tidak memakai `next-safe-action`: helper ± 80 baris, tanpa dependensi tambahan, dan kita kontrol bentuk `Result`.

### R6 — Catat cepat: optimistic, idempotensi, undo · **wajib** · M1
- **`client_id`:** `crypto.randomUUID()` dibuat saat sheet dibuka, dipertahankan untuk semua percobaan ulang (timeout, jaringan putus, klik ganda), dan baru diganti setelah server mengonfirmasi sukses atau user mengosongkan form. Tes: kirim dua kali dengan jaringan diputus di tengah → 1 entri.
- **Optimistic:** `PendingEntriesProvider` di layout `(app)` (sheet global, daftar di halaman). Saat Simpan: sheet tertutup, baris muncul di "Terakhir"/Transaksi berlabel "Menyimpan…" (teks, bukan hanya opasitas). Setelah RSC segar datang, baris nyata dengan `client_id` sama menggantikan baris pending (dedupe per `client_id`).
- **Toast hanya setelah server konfirmasi** (UX §4): "Tersimpan · Rp 35.000 dari BCA" + **Urungkan**. Gagal: baris pending berubah jadi "Gagal disimpan" + "Coba lagi" (client_id sama) / "Buang"; sheet bisa dibuka kembali dengan isian utuh.
- **Undo** memanggil `api.void_entry(entry_id, expected_version, reason='undo')`, jadi action create harus mengembalikan `entry_id` + `version`. Timer 10 detik berhenti saat toast difokus/di-hover (WCAG 2.2.1); jalur kedua selalu ada: detail transaksi → "Batalkan transaksi".
- Tombol Simpan `disabled` + teks "Menyimpan…" selama request (menutup INT-18). Enter di MoneyInput = Simpan bila field wajib lengkap.
- Playwright mengukur ≤ 3 ketukan dari Beranda, Transaksi, Dompet (ROADMAP M1).

### R7 — Format uang dan tanggal deterministik · **wajib** · M0
- `packages/domain/money.ts`: `formatRupiah(n)` → `Rp 1.250.000` (spasi tak putus), negatif `−Rp 35.000` (U+2212), `formatRupiahCompact` → `Rp 1,25 jt` / `Rp 12,5 rb` / `Rp 1,2 M` dengan **pemotongan**, bukan pembulatan ke atas (UX §7; v1 menampilkan "Rp 1.3jt", 04-code-quality CQ-08). `parseRupiah` menerima "35.000", "35000"; tolak desimal/negatif/`e`. Semua `bigint`/`number` aman (`Number.isSafeInteger`).
- Tidak memakai `Intl.NumberFormat('id-ID', {style:'currency'})` untuk tampilan: default 2 desimal ("Rp 1.250.000,00") dan versi ICU Node vs browser bisa beda spasi → hydration mismatch.
- `packages/domain/date.ts`: tipe domain tanggal = string `YYYY-MM-DD` (`occurred_on`, DESIGN §5 "Zona waktu"). `todayWIB()` lewat `Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Jakarta'})`. Label "Hari ini" / "Kemarin" / "Sen, 27 Okt" / tahun bila beda tahun (UX §4) dari tabel nama hari/bulan sendiri (19 string). **Zona browser tidak pernah dipakai**, sehingga server dan client menghasilkan teks sama.
- Tidak perlu next-intl: produk satu bahasa (SPEC §2). String UI ditulis langsung dalam bahasa Indonesia; istilah baku (UX §7 "Utang", bukan "Hutang") dijaga lewat tes grep di CI.
- Tes: Vitest + fast-check (properti `parse(format(n)) === n`), tabel kasus compact (999 → "Rp 999", 1.250.000 → "Rp 1,25 jt", 1.259.999 → "Rp 1,25 jt"), `todayWIB` pada 23:59 WIB dan 00:01 WIB (= 16:59/17:01 UTC).

### R8 — Design system yang menegakkan dirinya sendiri · **wajib** · M0
- Tailwind v4 `@theme`: reset palet bawaan (`--color-*: initial;`) lalu definisikan hanya token semantik UX §5 (`bg`, `surface`, `text`, `text-muted`, `border-strong`, `divider`, `primary`, `income`, `expense`, `kantor`, `warning`). Hasilnya `bg-blue-500` atau `text-gray-400` **tidak ter-generate sama sekali**; inilah penegakan terkuat terhadap regresi kontras v1 (#94a3b8 = 2,56:1).
- Radius juga di-reset ke `sm/md/lg/full`; skala font hanya 12/14/16/18/22/28 (UX §5).
- `eslint-plugin-better-tailwindcss` (mendukung v4): `no-unregistered-classes`, `no-conflicting-classes`, dan larangan nilai arbitrer (`[#..]`, `text-[10px]`, `w-[..px]`); pengecualian butuh komentar `eslint-disable` dengan alasan. `eslint-plugin-jsx-a11y` aktif.
- Dark mode: `prefers-color-scheme` + atribut `data-theme` dari Pengaturan; skrip inline kecil (ber-nonce) di `<head>` agar tidak ada kedip tema.
- Base layer: `cursor: pointer` untuk elemen interaktif aktif, `cursor: not-allowed` untuk disabled; `:focus-visible` ring 2px `primary` dengan offset (≥ 3:1 di kedua tema); `prefers-reduced-motion` mematikan transisi sheet.
- Halaman `/dev/ui` (bukan Storybook): setiap komponen di semua varian dan state (default, hover/focus dipaksa, loading, disabled, error, empty), di light dan dark, di 390px dan 1280px. Halaman ini menjadi target axe dan visual regression (R10). Storybook ditolak: dependensi besar, sering tertinggal dari Next mayor, dan dua tempat render yang harus dirawat.
- Font: `next/font/local` dengan file variable Plus Jakarta Sans (woff2, subset latin) di-commit di repo, `display: swap`, fallback metrik disesuaikan. Bukan `next/font/google`: build tidak bergantung jaringan dan render font di visual regression stabil. Cek di M0 bahwa file punya fitur OpenType `tnum` (UX §4 "Angka"); jika tidak, angka nominal pakai fallback yang punya `tnum`.

### R9 — Piramida tes frontend · **wajib** · M0 (harness) lalu per milestone
| Lapis | Alat | Isi |
|---|---|---|
| Unit | Vitest | `money`, `date`, peta error, skema Zod, reducer pending entries |
| Komponen | Vitest + Testing Library + user-event (happy-dom) | MoneyInput (ketik "35000" → "35.000", caret, tempel "Rp 1.250.000", tolak "-"/"e"), QuickAdd (validasi field, tombol disabled, retry pakai client_id sama), Combobox keyboard |
| E2E | Playwright: proyek `desktop-chromium` 1280×800, `mobile-chromium` 390×844, `mobile-webkit` 390×844 | Alur per milestone; locale `id-ID`, `timezoneId: 'Asia/Jakarta'` |
| A11y | `@axe-core/playwright`, tag `wcag2a, wcag2aa, wcag21aa, wcag22aa` | Setiap rute di kedua tema; 0 serious/critical |
| Keyboard | Playwright | Catat pengeluaran hanya dengan keyboard; Escape menutup sheet dan fokus kembali ke FAB |
- RSC async tidak dites di Vitest (dukungannya belum matang); dites di Playwright terhadap Postgres nyata.
- Data tes: satu DB template (migrasi + seed demo) di-clone per worker Playwright (`CREATE DATABASE … TEMPLATE`), cepat dan terisolasi.
- Login di E2E memakai alur nyata: TOTP dibangkitkan dari secret seed (`otpauth`), passkey via virtual authenticator WebAuthn Chromium (CDP). `storageState` disimpan per user (Novanda, Farida demo). **Tidak ada endpoint backdoor tes** di build produksi.
- Wajib ada tes dua user di E2E: Farida-demo membuka `/pribadi/transaksi` tidak pernah melihat entri Novanda-demo; `/bersama` keduanya melihat hal sama.

### R10 — Visual regression dan screenshot portofolio · **sebaiknya** · M0 (harness) → M2
- Playwright `toHaveScreenshot` dijalankan di image resmi `mcr.microsoft.com/playwright:v1.xx-noble` (versi sama dengan paket) agar rendering font identik di lokal dan CI.
- Determinisme: `page.clock.setFixedTime('2026-10-29T10:32:00+07:00')`, seed demo tetap, `animations: 'disabled'`, `caret: 'hide'`, font lokal (R8). Target: `/dev/ui` + 6 layar inti (Beranda, Transaksi, QuickAdd terbuka, Dompet, Anggaran, Laporan) × light/dark × 390/1280.
- Baseline di-commit; pembaruan hanya lewat PR berlabel `visual-update` dengan diff gambar di artefak CI.
- Proyek terpisah `portfolio` (tidak berjalan di CI biasa) menghasilkan PNG 390×844 @3x dan 1440×900 @2x dari seed demo bernama fiktif. Tidak pernah dari data produksi (SPEC §2 non-tujuan "Portofolio = screenshot dari data demo").

### R11 — Budget performa yang terukur · **wajib** · M0 (alat) / M2 (target)
- Next 16 tidak lagi menampilkan "First Load JS" di output `next build`, jadi budget ROADMAP M2 (≤ 150 kB) diukur di Playwright: jumlah `encodedBodySize` semua JS pada cold load `/pribadi/beranda` dan `/pribadi/transaksi` (gzip/brotli seperti dikirim proxy). Gagal CI bila > 150 kB. Target saya lebih ketat: **≤ 120 kB** di M0 shell.
- Sparkline Beranda dan progress anggaran = SVG/`<div>` server-rendered (0 kB JS). Recharts hanya di Laporan via `next/dynamic` dengan placeholder setinggi grafik (CLS 0). Grafik punya judul berupa pertanyaan ("Pengeluaran per bulan, 6 bulan terakhir") dan tabel data alternatif untuk pembaca layar.
- `@next/bundle-analyzer` (atau `next experimental-analyze` di Turbopack) dijalankan manual saat budget dilanggar.
- INP: tidak ada pekerjaan berat di handler ketik MoneyInput; daftar transaksi paginasi kursor 50 baris (DESIGN §10), tanpa virtualisasi sampai terbukti perlu.

### R12 — PWA dan offline-baca · **sebaiknya** · manifest M0, service worker M6
- M0: `app/manifest.ts`, ikon maskable, `theme-color` per tema (UX §8).
- M6: service worker **ditulis tangan** (`public/sw.js`, ± 120 baris), tanpa Serwist/next-pwa (plugin bergantung webpack, sedangkan Next 16 build default Turbopack).
  - `/_next/static/*`: cache-first (immutable).
  - Navigasi dokumen ke `/pribadi/beranda`, `/pribadi/transaksi`, `/bersama/beranda`, `/bersama/transaksi`: network-first, simpan HTML terakhir. Offline: sajikan HTML tersimpan; HTML sudah berisi data hasil SSR, jadi tetap terbaca walau JS gagal hydrate. Banner "Offline — data per 10.32" dari timestamp yang ditanam saat render.
  - Server Actions, `/api/*`, request RSC (`RSC: 1`): **tidak pernah** di-cache.
  - **Privasi:** nama cache memuat `user_id`; logout dan pergantian akun menghapus semua cache (`caches.delete`) sebelum redirect. Di perangkat bersama, data Pribadi tidak boleh tersisa setelah logout.
- Catat offline tetap ditunda (UX §8); `client_id` (R6) sudah membuatnya mungkin nanti.

## 3. Risiko utama dan mitigasi

| Risiko | Dampak | Mitigasi |
|---|---|---|
| Ruang salah saat simpan (cookie/tab ganda) | Transaksi pribadi masuk Bersama (privasi + angka salah) | R4: ruang di URL, `spaceId` eksplisit, label ruang di sheet, tes E2E dua tab |
| Cache data Next tanpa kunci user | Data pasangan bocor | R3: larangan lint `'use cache'`/`unstable_cache`; tes E2E dua user |
| `client_id` dibuat ulang saat retry | Transaksi ganda | R6: siklus hidup client_id + tes jaringan putus |
| Version skew setelah deploy/rollback | Simpan gagal di tab lama, user mengulang dan bingung | R1: kunci enkripsi tetap, `deploymentId`, pesan "Muat ulang" tanpa auto-retry |
| Hydration mismatch format angka/tanggal | Teks berkedip, error konsol, potensi salah tanggal | R7: formatter sendiri, zona tetap `Asia/Jakarta` |
| Regresi kontras/token oleh subagent (ROADMAP: halaman didelegasikan) | Kembali ke slop v1 | R8: palet bawaan dimatikan, lint arbitrary value, axe + visual regression di CI |
| Service worker menyimpan HTML keuangan | Data terbaca di perangkat setelah logout | R12: hapus cache saat logout, cache per user, tes Playwright |
| Next 16 masih bergerak (perubahan `proxy.ts`, Cache Components) | Upgrade mayor merusak | Kunci minor di ADR; Renovate grouping Next+React; e2e penuh sebelum merge upgrade |
| Budget JS dilanggar diam-diam | Beranda lambat di HP | R11: ukuran JS diuji di Playwright, bukan dibaca dari log build |

## 4. Ketidaksetujuan dengan desain saat ini

1. **TanStack Query (DESIGN §3, "Cache client")** — usul dihapus. React 19 `useOptimistic` + `revalidatePath` + filter di `searchParams` sudah menutup quick add dan filter Transaksi. Menambah cache client kedua berarti dua tempat untuk di-invalidasi setelah setiap tulis uang, sumber data basi yang klasik. Trade-off: "Muat lagi" di Transaksi memakai Server Action yang mengembalikan halaman berikutnya (atau `?cursor=` RSC), sedikit lebih manual. Bila nanti ada layar yang benar-benar butuh polling/sinkron, tambahkan lewat ADR.
2. **Token `border` di UX §5 gagal klaim 3:1.** Diukur dengan skrip kontras:
   - `#8A94A3` di `bg #F6F7F9` = **2,86:1** (gagal; klaim 3,07:1 hanya berlaku di putih).
   - `#4A515C` (dark) di `surface #14171C` = **2,24:1**, di `bg #0E1013` = 2,38:1 (gagal).
   - Usul: pecah menjadi `border-strong` (batas input, checkbox, kontrol; wajib 3:1) dan `divider` (garis dekoratif antar baris, boleh lebih lemah karena tidak membawa informasi). `border-strong` light `#7E8898` (3,34:1 di `bg`, 3,58:1 di putih), dark `#6B7380` (3,75:1 di `surface`, 3,98:1 di `bg`). Token lain di UX §5 saya cek ulang dan lulus (mis. `text-muted` 5,58:1 di `bg` light; teks `#0E1013` di atas `primary` dark `#8EB4FF` = 9,18:1, jadi tombol primary dark wajib teks gelap, bukan putih; ini perlu ditulis di UX §5).
3. **ROADMAP belum mengikuti SPEC revisi 2.** Masih menyebut `supabase test db`, Supabase lokal, pg_cron, migrasi v1 di M7, dan DESIGN §3/§6 masih Vercel + `supabase gen types` + folder `supabase/`. Untuk frontend ini mengubah perintah CI, struktur repo, dan kriteria M0. Minta satu revisi ROADMAP sebelum M0 dimulai.
4. **Prototipe klik M0 (SPEC §6) dengan "data demo"** — setuju, dengan syarat prototipe dibangun dari komponen `components/ui` sungguhan di atas fixture bertipe sama dengan kontrak fungsi DB, bukan halaman sekali buang. Kalau tidak, M1 membangun ulang UI dan pola v1 (UI menentukan bentuk data, SPEC §4.2 B) masuk lewat pintu belakang.
5. **`middleware.ts` (SPEC §5.3)** — di Next 16 namanya `proxy.ts`. Isinya tetap sesuai SPEC: hanya refresh sesi, redirect UX, dan nonce CSP; otorisasi di `requireUser()` + RLS.
6. **Toast tanpa batas waktu tambahan (UX §3.1, 10 detik)** — setuju dengan 10 detik, asalkan timer berhenti saat fokus/hover dan undo juga tersedia dari detail (R6); tanpa itu, WCAG 2.2.1 tidak terpenuhi.

## 5. Kriteria penerimaan (bisa dicek/dites)

M0
- [ ] `docker build` menghasilkan image standalone multi-arch (amd64 + arm64); container jalan non-root; `GET /api/health` 200.
- [ ] `pnpm lint` gagal bila: kelas warna bawaan Tailwind/nilai arbitrer dipakai, `radix-ui` diimpor di luar `components/ui`, `'use server'` di luar `features/*/actions.ts`, `'use cache'`/`unstable_cache` di `features/**`.
- [ ] `/dev/ui` menampilkan setiap komponen UX §6 dalam semua state, di light/dark; axe 0 serious/critical; `notFound()` saat `ENABLE_DEV_UI` tidak diset.
- [ ] Semua pasangan token di UX §5 lolos skrip kontras di CI (teks 4,5:1; `border-strong`, focus ring, ikon status 3:1), di kedua tema.
- [ ] Vitest `money`/`date`: kasus tabel R7 + properti fast-check lulus; `todayWIB` benar di 16:59 dan 17:01 UTC.
- [ ] JS terkirim pada cold load shell `/pribadi/beranda` ≤ 120 kB (diukur Playwright).
- [ ] Login → navigasi 5 tab → logout lulus di 3 proyek Playwright; tiap link nav punya `aria-current="page"`.

M1
- [ ] Catat pengeluaran ≤ 3 ketukan dari Beranda, Transaksi, Dompet (Playwright menghitung klik).
- [ ] Simpan dengan jaringan diputus setelah request terkirim, lalu "Coba lagi" → tepat 1 entri di DB (cek `count(*)` lewat fixture).
- [ ] Klik ganda cepat pada Simpan → 1 entri.
- [ ] Urungkan dalam 10 detik → entri `voided_at` terisi, saldo kembali; toast tidak hilang selama difokus.
- [ ] Tab A di `/pribadi`, tab B di `/bersama`: simpan dari tab A setelah tab B dibuka → entri masuk ruang Pribadi.
- [ ] Farida-demo tidak melihat satu pun entri Pribadi Novanda-demo di Beranda/Transaksi/Dompet/laporan.
- [ ] Setiap kode error DB punya pesan Indonesia; error dari server menandai field terkait dengan `aria-describedby` dan `aria-invalid`.
- [ ] Hanya keyboard: buka quick add, isi, simpan, Escape menutup, fokus kembali ke pemicu.

M2
- [ ] Cold load `/pribadi/beranda` dan `/pribadi/transaksi` ≤ 150 kB JS; Laporan memuat Recharts hanya di rute itu.
- [ ] Visual regression 6 layar × 2 tema × 2 viewport stabil (0 diff) dalam 3 run berturut-turut di CI.
- [ ] CLS < 0,05 di semua layar inti (Playwright `PerformanceObserver`).

M6
- [ ] Offline (`context.setOffline(true)`): Beranda & Transaksi tampil dari cache dengan banner waktu data; simpan dinonaktifkan dengan pesan jelas.
- [ ] Setelah logout, `caches.keys()` kosong.
- [ ] Lighthouse: installable PWA.

## 6. Pertanyaan dan permintaan untuk peran lain

**Backend/DB Engineer**
1. Katalog error fungsi `api.*` (SQLSTATE kustom + nama field) sebagai satu file bersama (`packages/db/errors.ts` hasil generate dari SQL?) agar R5 bisa dites lengkap.
2. Fungsi tulis mengembalikan `{entry_id, version, space_id}` untuk undo (R6) dan revalidasi ruang yang tepat.
3. UNIQUE idempotensi: `(created_by, client_id)` atau `(space_id, client_id)`? SPEC §5.4 memindahkan batas ke `space_id`, DESIGN §4 masih `(user_id, client_id)`. Saya butuh: retry dengan client_id sama selalu mengembalikan hasil asli, termasuk bila user berbeda kebetulan memakai UUID sama (praktis mustahil, tapi definisikan).
4. Apakah `withUser` membuka satu transaksi per request (semua query RSC berurutan di satu koneksi) atau per query? Ini menentukan apakah Beranda sebaiknya satu panggilan `dashboard_summary` atau beberapa query paralel dalam `Suspense`. Usul saya: satu fungsi per kartu Beranda, maksimal 4 koneksi per render.
5. Fixture demo (seed) bertipe sama dengan keluaran fungsi, dipakai prototipe M0, E2E, dan screenshot portofolio.

**Security Engineer**
1. CSP nonce: setuju semua halaman dinamis? Skrip tema inline dan service worker perlu nonce/`worker-src 'self'`.
2. Konfirmasi pola tes login tanpa backdoor (TOTP dari secret seed, WebAuthn virtual authenticator) cukup untuk CI.
3. Kebijakan cache SW untuk HTML keuangan (R12): boleh, atau offline-baca dibatasi ke Beranda saja?

**DevOps/SRE**
1. Reverse proxy di VM App meneruskan `Host`/`X-Forwarded-Host`/`X-Forwarded-Proto` asli ke VM DB; brotli/gzip di proxy, bukan di Next (`compress: false`).
2. `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` sebagai secret tetap di GitHub Environments + file env VM.
3. Limit memori container web (untuk `--max-old-space-size`) dan arsitektur CPU VM DB (amd64/arm64) begitu diketahui.
4. Runner CI menyediakan image Playwright tetap untuk visual regression.

**UX/Product Designer**
1. Setujui pemecahan `border` → `border-strong` + `divider` dengan nilai di §4.2, dan aturan teks gelap di atas `primary` dark.
2. Bentuk penanda ruang di header dan quick add (teks + ikon; warna hanya pelengkap).
3. Teks status "Menyimpan…", "Gagal disimpan", "Versi baru tersedia. Muat ulang".
4. Konfirmasi: set ikon lucide dipertahankan dengan stroke 1.75, atau ingin set dengan karakter berbeda untuk portofolio?

**QA**
1. Ambil alih matriks Playwright (3 proyek) dan daftar kriteria §5 sebagai checklist definisi selesai per milestone.

**Pemilik produk**
1. URL `/pribadi/...` dan `/bersama/...` (bahasa Indonesia) disetujui?
2. Perangkat utama Farida iPhone atau Android? Menentukan apakah `mobile-webkit` wajib hijau sejak M0 (usul saya: ya).
