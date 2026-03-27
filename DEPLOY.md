# 🚀 DompetKu — Deploy Guide

## Supabase ✅ SUDAH SELESAI
Project **DompetKu** sudah dibuat dan dikonfigurasi:
- **Project ID:** `yvapmbjtuhqvsunkmkxw`
- **Region:** ap-southeast-1 (Singapore)
- **URL:** `https://yvapmbjtuhqvsunkmkxw.supabase.co`
- **Anon Key:** `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl2YXBtYmp0dWhxdnN1bmtta3h3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ2MTE5MTUsImV4cCI6MjA5MDE4NzkxNX0.43GX-erC2vZ0QdOC53bdWN7isBpKDrrSvYCuMF6g1Ro`

### Database yang sudah dibuat:
| Tabel | Fungsi |
|-------|--------|
| profiles | Data profil user |
| wallets | Dompet (cash, bank, ewallet) |
| categories | Kategori income/expense |
| transactions | Transaksi keuangan |
| transfers | Transfer antar dompet |
| budgets | Anggaran per kategori per bulan |
| assets | Aset (investasi, properti, dll) |
| credit_cards | Kartu kredit |
| debts | Utang & piutang |

### Security:
- ✅ Row Level Security (RLS) aktif di semua tabel
- ✅ Policies: user hanya bisa akses data milik sendiri
- ✅ Auto-create profile & default categories saat signup
- ✅ Auto-update saldo wallet saat transaksi/transfer

---

## Vercel — Deploy Steps

### Cara 1: Via Vercel CLI (Recommended)

```bash
# 1. Extract project
tar -xzf dompetku-app.tar.gz -C dompetku
cd dompetku

# 2. Install dependencies
npm install

# 3. Login ke Vercel (jika belum)
npx vercel login

# 4. Deploy
npx vercel

# 5. Saat ditanya:
#    - Set up and deploy? → Y
#    - Which scope? → Novanda's projects
#    - Link to existing project? → N
#    - Project name? → dompetku
#    - Directory? → ./
#    - Override settings? → N

# 6. Set environment variables
npx vercel env add NEXT_PUBLIC_SUPABASE_URL
# Paste: https://yvapmbjtuhqvsunkmkxw.supabase.co

npx vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY
# Paste: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl2YXBtYmp0dWhxdnN1bmtta3h3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ2MTE5MTUsImV4cCI6MjA5MDE4NzkxNX0.43GX-erC2vZ0QdOC53bdWN7isBpKDrrSvYCuMF6g1Ro

# 7. Deploy ulang dengan env vars
npx vercel --prod
```

### Cara 2: Via Vercel Dashboard (Tanpa CLI)

1. Buka https://vercel.com/new
2. Pilih **"Import Third-Party Git Repository"** atau upload folder
3. Atau push ke GitHub dulu, lalu connect repo

**Set Environment Variables di Dashboard:**
- Buka project → Settings → Environment Variables
- Tambahkan:
  - `NEXT_PUBLIC_SUPABASE_URL` = `https://yvapmbjtuhqvsunkmkxw.supabase.co`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY` = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...` (key lengkap ada di .env.local)

### Cara 3: Via GitHub (Paling Recommended untuk long-term)

```bash
# 1. Extract dan setup
tar -xzf dompetku-app.tar.gz -C dompetku
cd dompetku
git init
git add .
git commit -m "Initial commit - DompetKu Finance App"

# 2. Buat repo di GitHub
gh repo create dompetku --private --push

# 3. Connect di Vercel Dashboard
# Buka vercel.com → New Project → Import dari GitHub → Pilih repo dompetku
# Set environment variables di dashboard
```

---

## Setelah Deploy

1. Buka URL app yang diberikan Vercel (contoh: `dompetku.vercel.app`)
2. Klik **"Buat Akun Baru"** → isi email dan password
3. Login → Dashboard akan muncul
4. Mulai tambah dompet, transaksi, anggaran, dll!

## Konfigurasi Email Supabase (Opsional)

Secara default Supabase mengirim email verifikasi. Untuk development, kamu bisa disable ini:
1. Buka https://supabase.com/dashboard/project/yvapmbjtuhqvsunkmkxw/auth/providers
2. Di bagian **Email** → matikan "Confirm email"
3. User bisa langsung login setelah signup

---

## Tech Stack
- **Frontend:** Next.js 14 + React 18 + Tailwind CSS
- **Backend:** Supabase (PostgreSQL + Auth + RLS)
- **Charts:** Recharts
- **Icons:** Lucide React
- **Deploy:** Vercel
