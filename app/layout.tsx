import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'DompetKu — Personal Finance Manager',
  description: 'Kelola keuangan pribadi dengan mudah dan cerdas',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  )
}
