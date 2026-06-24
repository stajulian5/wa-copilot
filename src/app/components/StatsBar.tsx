import { useEffect, useState } from 'react'

interface Stats {
  unanswered: number
  open_conversations: number
  waiting_for: number
  resolved_today: number
  new_today: number
  avg_response_minutes: number | null
  oldest_unanswered_minutes: number | null
}

const PORT = () => window.api?.serverPort ?? 3847

function fmtMinutes(mins: number | null): string {
  if (mins == null) return '—'
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

interface StatPillProps {
  label: string
  value: string | number
  sub?: string
  alert?: boolean
}

function StatPill({ label, value, sub, alert }: StatPillProps) {
  return (
    <div className={`flex flex-col items-center px-4 py-1.5 rounded-lg ${alert ? 'bg-red-50 border border-red-100' : 'bg-gray-50 border border-gray-100'}`}>
      <span className={`text-lg font-bold leading-tight ${alert ? 'text-red-600' : 'text-gray-800'}`}>{value}</span>
      <span className="text-[10px] text-gray-400 font-medium uppercase tracking-wide">{label}</span>
      {sub && <span className="text-[10px] text-gray-400">{sub}</span>}
    </div>
  )
}

export function StatsBar() {
  const [stats, setStats] = useState<Stats | null>(null)

  const load = () =>
    fetch(`http://127.0.0.1:${PORT()}/stats`)
      .then(r => r.json())
      .then(setStats)
      .catch(() => {})

  useEffect(() => {
    load()
    const interval = setInterval(load, 60_000)
    return () => clearInterval(interval)
  }, [])

  if (!stats) return null

  return (
    <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-100 bg-white overflow-x-auto shrink-0">
      <StatPill
        label="Sin respuesta"
        value={stats.unanswered}
        alert={stats.unanswered > 0}
      />
      <StatPill
        label="Resp. promedio"
        value={fmtMinutes(stats.avg_response_minutes)}
        sub="7 días"
      />
      <StatPill
        label="Espera más larga"
        value={fmtMinutes(stats.oldest_unanswered_minutes)}
        alert={(stats.oldest_unanswered_minutes ?? 0) > 120}
      />
      <StatPill
        label="En conversación"
        value={stats.open_conversations}
      />
      <StatPill
        label="En espera"
        value={stats.waiting_for}
      />
      <StatPill
        label="Resueltos hoy"
        value={stats.resolved_today}
      />
      <StatPill
        label="Nuevos hoy"
        value={stats.new_today}
      />
    </div>
  )
}
