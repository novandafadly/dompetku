export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)
}

export function formatShort(amount: number): string {
  if (amount >= 1_000_000_000) return `Rp ${(amount / 1_000_000_000).toFixed(1)}M`
  if (amount >= 1_000_000) return `Rp ${(amount / 1_000_000).toFixed(1)}jt`
  if (amount >= 1_000) return `Rp ${(amount / 1_000).toFixed(0)}rb`
  return `Rp ${amount}`
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

export const MONTHS = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
]
