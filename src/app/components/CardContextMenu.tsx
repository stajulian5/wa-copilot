import { useEffect, useRef } from 'react'

interface MenuItem {
  label: string
  icon: string
  onClick: () => void
  loading?: boolean
}

interface Props {
  x: number
  y: number
  items: MenuItem[]
  onClose: () => void
}

export function CardContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)

  // Close on click outside or Escape
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [onClose])

  // Keep menu inside viewport
  const style: React.CSSProperties = {
    position: 'fixed',
    zIndex: 9999,
    top: Math.min(y, window.innerHeight - 120),
    left: Math.min(x, window.innerWidth - 220),
  }

  return (
    <div
      ref={ref}
      style={style}
      className="w-52 bg-white rounded-xl shadow-xl border border-gray-200 py-1 overflow-hidden"
    >
      {items.map((item) => (
        <button
          key={item.label}
          onClick={() => { item.onClick(); onClose() }}
          disabled={item.loading}
          className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 active:bg-gray-100 transition-colors text-left disabled:opacity-50"
        >
          <span className="text-base">{item.icon}</span>
          <span>{item.loading ? 'Loading…' : item.label}</span>
        </button>
      ))}
    </div>
  )
}
