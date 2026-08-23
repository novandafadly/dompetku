import type { Pocket } from './supabase'

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)
}

export function formatShort(amount: number): string {
  const abs = Math.abs(amount)
  const sign = amount < 0 ? '-' : ''
  if (abs >= 1_000_000_000) return `${sign}Rp ${(abs / 1_000_000_000).toFixed(1)}M`
  if (abs >= 1_000_000) return `${sign}Rp ${(abs / 1_000_000).toFixed(1)}jt`
  if (abs >= 1_000) return `${sign}Rp ${(abs / 1_000).toFixed(0)}rb`
  return `${sign}Rp ${abs}`
}

export const CURRENCIES = ['IDR', 'USD', 'EUR', 'SGD', 'MYR', 'JPY', 'AUD', 'GBP', 'CNY', 'THB'] as const

export function formatCurrencyIn(amount: number, currency: string = 'IDR'): string {
  return new Intl.NumberFormat(currency === 'IDR' ? 'id-ID' : 'en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: currency === 'IDR' ? 0 : 2,
  }).format(amount)
}

export function formatDate(date: string): string {
  return new Date(date).toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

export function cn(...classes: (string | boolean | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ')
}

export const WALLET_ICONS: Record<string, string> = {
  cash: '💵',
  bank: '🏦',
  ewallet: '📱',
  investment: '📈',
}

export const WALLET_COLORS: Record<string, string> = {
  cash: '#22c55e',
  bank: '#3b82f6',
  ewallet: '#a855f7',
  investment: '#f59e0b',
}

export const ASSET_ICONS: Record<string, string> = {
  investment: '📈',
  property: '🏠',
  vehicle: '🚗',
  electronics: '💻',
  other: '📦',
}

export const POCKET_META: Record<Pocket, { label: string; icon: string; color: string; bg: string; desc: string }> = {
  operasional: {
    label: 'Operasional',
    icon: '💳',
    color: 'text-blue-600',
    bg: 'bg-blue-50',
    desc: 'Uang untuk kebutuhan sehari-hari',
  },
  tabungan: {
    label: 'Tabungan',
    icon: '🏦',
    color: 'text-green-600',
    bg: 'bg-green-50',
    desc: 'Dana yang tidak disentuh',
  },
  kantor: {
    label: 'Kantor',
    icon: '🏢',
    color: 'text-purple-600',
    bg: 'bg-purple-50',
    desc: 'Dana reimbursement / operasional kantor',
  },
}

export const FREQUENCY_META: Record<string, { label: string; icon: string }> = {
  daily:   { label: 'Harian',   icon: '📅' },
  weekly:  { label: 'Mingguan', icon: '📆' },
  monthly: { label: 'Bulanan',  icon: '🗓️' },
  yearly:  { label: 'Tahunan',  icon: '📋' },
}

export const MONTHS = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
]

export const DAYS = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu']
