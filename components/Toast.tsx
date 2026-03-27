'use client'

import { useEffect, useState } from 'react'

let showToastFn: (msg: string, icon?: string) => void = () => {}

export function toast(msg: string, icon?: string) {
  showToastFn(msg, icon)
}

export default function ToastProvider() {
  const [toasts, setToasts] = useState<{ id: number; msg: string; icon: string }[]>([])

  useEffect(() => {
    showToastFn = (msg: string, icon: string = '✅') => {
      const id = Date.now()
      setToasts((prev) => [...prev, { id, msg, icon }])
      setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3000)
    }
  }, [])

  return (
    <div className="fixed bottom-6 right-6 z-[100] flex flex-col gap-2">
      {toasts.map((t) => (
        <div key={t.id} className="toast">
          <span>{t.icon}</span>
          <span>{t.msg}</span>
        </div>
      ))}
    </div>
  )
}
