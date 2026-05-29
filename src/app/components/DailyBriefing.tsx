import { useContactsStore } from '../stores/contactsStore'
import { useRemindersStore } from '../stores/remindersStore'

interface Props {
  onClose: () => void
}

export function DailyBriefing({ onClose }: Props) {
  const { contacts, setSelectedContactId } = useContactsStore()
  const { getDueToday } = useRemindersStore()

  const now = Date.now()
  const oneHour = 3_600_000
  const threeDays = 3 * 86_400_000

  const needsReply = contacts.filter(c =>
    c.lastMessageDirection === 'in' &&
    c.lastMessageAt &&
    now - new Date(c.lastMessageAt).getTime() > oneHour
  ).slice(0, 5)

  const goingStale = contacts.filter(c =>
    ['open_conversation', 'waiting_for'].includes(c.stage) &&
    c.lastMessageAt &&
    now - new Date(c.lastMessageAt).getTime() > threeDays
  ).slice(0, 5)

  const snoozesdue = getDueToday().slice(0, 5)

  const open = (contactId: number) => {
    setSelectedContactId(contactId)
    onClose()
  }

  if (needsReply.length === 0 && goingStale.length === 0 && snoozesdue.length === 0) {
    return null
  }

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-gray-900">Buenos días ☀️</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        <Section title="📬 Necesita respuesta" items={needsReply} onOpen={open} nameKey="name" />
        <Section title="⚡ Están quedando sin atención" items={goingStale} onOpen={open} nameKey="name" />

        {snoozesdue.length > 0 && (
          <div className="mt-4">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">🔔 Recordatorios de hoy</h3>
            {snoozesdue.map(r => {
              const contact = useContactsStore.getState().contacts.find(c => c.id === r.contactId)
              return (
                <button
                  key={r.id}
                  onClick={() => open(r.contactId)}
                  className="w-full text-left text-sm py-1.5 px-2 rounded hover:bg-gray-50 text-gray-700"
                >
                  {contact?.name ?? contact?.phone ?? '—'} <span className="text-gray-400 text-xs">· {r.note}</span>
                </button>
              )
            })}
          </div>
        )}

        <button onClick={onClose} className="mt-5 w-full py-2 bg-gray-900 text-white text-sm rounded-lg hover:bg-gray-700">
          Empezar el día
        </button>
      </div>
    </div>
  )
}

function Section({ title, items, onOpen, nameKey }: { title: string; items: any[]; onOpen: (id: number) => void; nameKey: string }) {
  if (items.length === 0) return null
  return (
    <div className="mb-4">
      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{title}</h3>
      {items.map(c => (
        <button
          key={c.id}
          onClick={() => onOpen(c.id)}
          className="w-full text-left text-sm py-1.5 px-2 rounded hover:bg-gray-50 text-gray-700 flex items-center justify-between"
        >
          <span>{c[nameKey] ?? c.phone}</span>
          <span className="text-gray-400 text-xs truncate max-w-32">{c.lastMessage}</span>
        </button>
      ))}
    </div>
  )
}
