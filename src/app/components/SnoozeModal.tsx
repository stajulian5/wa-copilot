import { useState } from 'react'
import { useRemindersStore } from '../stores/remindersStore'

const PORT = () => window.api?.serverPort ?? 3847

interface Props {
  contactId: number
  onClose: () => void
}

const QUICK_OPTIONS = [
  { label: 'En 1 hora', hours: 1 },
  { label: 'Esta tarde (6 pm)', hours: null, time: '18:00' },
  { label: 'Tomorrow 9am', hours: null, time: 'tomorrow-09:00' },
  { label: 'In 3 days', hours: 72 },
  { label: 'Next week', hours: 168 },
]

function resolveQuickOption(opt: typeof QUICK_OPTIONS[0]): Date {
  const now = new Date()
  if (opt.hours != null) {
    return new Date(now.getTime() + opt.hours * 3_600_000)
  }
  if (opt.time === 'tomorrow-09:00') {
    const d = new Date(now)
    d.setDate(d.getDate() + 1)
    d.setHours(9, 0, 0, 0)
    return d
  }
  const [h, m] = (opt.time ?? '18:00').split(':').map(Number)
  const d = new Date(now)
  d.setHours(h, m, 0, 0)
  if (d <= now) d.setDate(d.getDate() + 1)
  return d
}

export function SnoozeModal({ contactId, onClose }: Props) {
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const { addReminder } = useRemindersStore()

  const save = async (dueAt: Date) => {
    setSaving(true)
    const r = await fetch(`http://127.0.0.1:${PORT()}/reminders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contactId, dueAt: dueAt.toISOString(), note: note.trim() || null })
    })
    const reminder = await r.json()
    addReminder(reminder)
    setSaving(false)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-end" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-72 m-4 p-4 border border-gray-100"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-gray-900 text-sm">🔔 Recordatorio</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>
        </div>

        <div className="flex flex-col gap-1.5 mb-3">
          {QUICK_OPTIONS.map(opt => (
            <button
              key={opt.label}
              onClick={() => save(resolveQuickOption(opt))}
              disabled={saving}
              className="text-left text-sm py-1.5 px-2 rounded-lg hover:bg-gray-50 text-gray-700 transition-colors"
            >
              {opt.label}
            </button>
          ))}
        </div>

        <input
          type="text"
          value={note}
          onChange={e => setNote(e.target.value)}
          placeholder="Nota opcional…"
          className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-gray-300 mb-2"
          onKeyDown={e => {
            if (e.key === 'Escape') onClose()
          }}
        />
      </div>
    </div>
  )
}
