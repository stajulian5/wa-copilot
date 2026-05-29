import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { formatDistanceToNow } from 'date-fns'
import { es } from 'date-fns/locale'
import { useRemindersStore } from '../stores/remindersStore'
import type { Contact } from '../../server/db/schema'

interface Props {
  contact: Contact
  onClick: () => void
}

/** Returns a readable fallback when contact has no saved name */
function formatFallbackName(whatsappId: string, phone: string | null): string {
  if (whatsappId.endsWith('@lid')) return 'Contacto WA'  // LID ≠ phone number
  if (!phone) return whatsappId
  // Format Mexican numbers: 521XXXXXXXXXX → +52 1 XXX XXX XXXX
  if (phone.startsWith('521') && phone.length === 13) {
    return `+52 1 ${phone.slice(3, 6)} ${phone.slice(6, 9)} ${phone.slice(9)}`
  }
  if (phone.startsWith('52') && phone.length === 12) {
    return `+52 ${phone.slice(2, 4)} ${phone.slice(4, 8)} ${phone.slice(8)}`
  }
  return `+${phone}`
}

function idleColor(lastAt: Date | null): string {
  if (!lastAt) return 'text-gray-400'
  const diffH = (Date.now() - new Date(lastAt).getTime()) / 3_600_000
  if (diffH < 2) return 'text-gray-400'
  if (diffH < 24) return 'text-amber-500'
  if (diffH < 72) return 'text-orange-500'
  return 'text-red-500'
}

function stageAgeLabel(stageChangedAt: Date | null): string | null {
  if (!stageChangedAt) return null
  const diffDays = (Date.now() - new Date(stageChangedAt).getTime()) / 86_400_000
  if (diffDays < 5) return null
  return `${Math.floor(diffDays)}d`
}

export function ContactCard({ contact, onClick }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: String(contact.id)
  })
  // Use .some() (returns boolean) so Zustand can compare by value — avoids infinite re-render loop
  const hasSnooze = useRemindersStore(s =>
    s.reminders.some(r => r.contactId === contact.id && !r.isDone)
  )

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1
  }

  const displayName = contact.name ?? formatFallbackName(contact.whatsappId, contact.phone)
  const lastAt = contact.lastMessageAt ? new Date(contact.lastMessageAt) : null
  const stageAge = stageAgeLabel(contact.stageChangedAt ? new Date(contact.stageChangedAt) : null)

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={onClick}
      className="bg-white rounded-lg p-3 shadow-sm border border-gray-100 cursor-pointer hover:shadow-md hover:border-gray-200 transition-all select-none"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="font-medium text-sm text-gray-900 truncate">{displayName}</span>
            {contact.isGroup && <span className="text-xs text-gray-400">👥</span>}
            {hasSnooze && <span className="text-xs">🔔</span>}
          </div>

          <p className="text-xs text-gray-500 truncate mt-0.5">
            {contact.lastMessage ?? 'Sin mensajes'}
          </p>

          {contact.property && (
            <p className="text-xs text-blue-600 truncate mt-0.5">🏠 {contact.property}</p>
          )}
        </div>

        <div className="flex flex-col items-end gap-1 shrink-0">
          {lastAt && (
            <span className={`text-xs ${idleColor(lastAt)}`}>
              {formatDistanceToNow(lastAt, { locale: es, addSuffix: false })}
            </span>
          )}
          {(contact.unreadCount ?? 0) > 0 && (
            <span className="bg-green-500 text-white text-xs font-bold w-5 h-5 flex items-center justify-center rounded-full">
              {contact.unreadCount}
            </span>
          )}
        </div>
      </div>

      {/* Pills row */}
      <div className="flex flex-wrap gap-1 mt-2">
        {contact.kycStatus && (
          <span className="text-xs bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded-full">
            KYC: {contact.kycStatus}
          </span>
        )}
        {contact.contractStatus && (
          <span className="text-xs bg-purple-50 text-purple-700 px-1.5 py-0.5 rounded-full">
            {contact.contractStatus}
          </span>
        )}
        {stageAge && (
          <span className="text-xs bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded-full">
            {stageAge} en etapa
          </span>
        )}
      </div>
    </div>
  )
}
