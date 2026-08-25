import { createBrowserClient } from '@supabase/ssr'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createBrowserClient(supabaseUrl, supabaseAnonKey)

export type Profile = {
  id: string
  full_name: string | null
  role: 'permanent' | 'trial'
  trial_expires_at: string | null
}
export type Pocket = 'operasional' | 'tabungan' | 'kantor'

export type Wallet = {
  id: string
  user_id: string
  name: string
  type: 'cash' | 'bank' | 'ewallet' | 'investment'
  pocket: Pocket
  balance: number
  icon: string | null
  color: string | null
  is_active: boolean
  created_at: string
}

export type Category = {
  id: string
  user_id: string
  name: string
  type: 'income' | 'expense'
  icon: string | null
  color: string | null
  is_default: boolean
  created_at: string
}

export type Transaction = {
  id: string
  user_id: string
  wallet_id: string
  category_id: string | null
  debt_id: string | null
  type: 'income' | 'expense'
  amount: number
  description: string | null
  date: string
  created_at: string
  // Reimbursement — untuk transaksi pribadi yang dipakai keperluan kantor
  is_reimbursable: boolean
  reimbursed_at: string | null
  wallets?: Wallet
  categories?: Category
}

export type Transfer = {
  id: string
  user_id: string
  from_wallet_id: string
  to_wallet_id: string
  amount: number
  note: string | null
  date: string
  created_at: string
  from_wallet?: Wallet
  to_wallet?: Wallet
}

export type Budget = {
  id: string
  user_id: string
  category_id: string
  amount: number
  period_month: number
  period_year: number
  categories?: Category
}

export type Asset = {
  id: string
  user_id: string
  name: string
  type: 'investment' | 'property' | 'vehicle' | 'electronics' | 'other'
  value: number
  purchase_date: string | null
  description: string | null
  ticker: string | null
  qty: number | null
  avg_price: number | null
  current_price: number | null
  last_price_update: string | null
  created_at: string
}

export type InvestmentLot = {
  id: string
  user_id: string
  asset_id: string
  action: 'buy' | 'sell'
  qty: number
  price: number
  total_amount: number
  date: string
  note: string | null
  created_at: string
}

export type CreditCard = {
  id: string
  user_id: string
  name: string
  bank: string
  card_limit: number
  used_amount: number
  billing_date: number | null
  due_date: number | null
  color: string | null
}

export type Contact = {
  id: string
  user_id: string
  name: string
  phone: string | null
  note: string | null
  avatar_color: string
  created_at: string
}

export type Debt = {
  id: string
  user_id: string
  contact_id: string | null
  wallet_id: string | null
  type: 'debt' | 'receivable'
  person_name: string
  total_amount: number
  paid_amount: number
  description: string | null
  due_date: string | null
  is_completed: boolean
  // Modal trading — piutang ke "diri sendiri" yang dipinjam dari pos tabungan
  is_capital_loan: boolean
  trading_wallet_id: string | null
  // Sumber alternatif untuk capital loan kalau pos-nya berupa aset (mis. RDPU), bukan wallet
  asset_id: string | null
  contacts?: Contact
  wallets?: Wallet
  trading_wallet?: Wallet
  asset?: Asset
}

export type RecurringTransaction = {
  id: string
  user_id: string
  wallet_id: string | null
  category_id: string | null
  type: 'income' | 'expense'
  amount: number
  description: string | null
  frequency: 'daily' | 'weekly' | 'monthly' | 'yearly'
  day_of_month: number | null
  day_of_week: number | null
  next_due: string
  last_executed: string | null
  is_active: boolean
  auto_execute: boolean
  created_at: string
  wallets?: Wallet
  categories?: Category
}

export type SavingsGoal = {
  id: string
  user_id: string
  wallet_id: string
  name: string
  target_amount: number
  target_date: string | null
  icon: string
  color: string
  is_completed: boolean
  created_at: string
  updated_at: string
  wallets?: Wallet
}

export type NetWorthSnapshot = {
  id: string
  user_id: string
  snapshot_date: string
  total_balance: number
  total_assets: number
  total_debt: number
  net_worth: number
  created_at: string
}

// ── Helper: cek apakah wallet adalah pocket kantor ────────
export function isKantorWallet(wallet?: Wallet | null): boolean {
  return wallet?.pocket === 'kantor'
}

// ── Helper: filter transaksi pribadi saja (exclude kantor) ─
export function filterPersonalTransactions(transactions: Transaction[]): Transaction[] {
  return transactions.filter(t => t.wallets?.pocket !== 'kantor')
}
