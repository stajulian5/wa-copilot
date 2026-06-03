import { useEffect, useState } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useRemindersStore } from '../stores/remindersStore'
import type { Contact } from '../../server/db/schema'

interface Props {
  contact: Contact
  onClick: () => void
  onContextMenu?: (e: React.MouseEvent, contactId: number) => void
}

// ── Avatar ────────────────────────────────────────────────────────────────────

const AVATAR_COLORS = [
  '#0ea5e9', '#8b5cf6', '#10b981', '#f59e0b',
  '#ef4444', '#ec4899', '#06b6d4', '#84cc16'
]

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0][0].toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function InitialsAvatar({ name, id, size }: { name: string; id: number; size: number }) {
  const bg = AVATAR_COLORS[id % AVATAR_COLORS.length]
  const initials = getInitials(name)
  return (
    <div
      className="rounded-full flex items-center justify-center shrink-0 text-white font-semibold"
      style={{ width: size, height: size, backgroundColor: bg, fontSize: size * 0.36 }}
    >
      {initials}
    </div>
  )
}

function GroupAvatar({ size }: { size: number }) {
  return (
    <div
      className="rounded-full flex items-center justify-center shrink-0 bg-gray-400"
      style={{ width: size, height: size, fontSize: size * 0.5 }}
    >
      <svg width={size * 0.6} height={size * 0.6} viewBox="0 0 24 24" fill="white">
        <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/>
      </svg>
    </div>
  )
}

function ContactAvatar({ contact, size, port }: { contact: Contact; size: number; port: number }) {
  const [imgFailed, setImgFailed] = useState(false)
  const displayName = contact.name ?? contact.phone ?? ''

  // When new avatars are downloaded mid-session, retry loading
  useEffect(() => {
    const off = window.api.onHistorySynced(() => setImgFailed(false))
    return off
  }, [])

  if (!imgFailed) {
    return (
      <img
        src={`http://127.0.0.1:${port}/avatars/${contact.id}`}
        alt={displayName}
        onError={() => setImgFailed(true)}
        className="rounded-full object-cover shrink-0"
        style={{ width: size, height: size }}
      />
    )
  }

  if (contact.isGroup) return <GroupAvatar size={size} />
  return <InitialsAvatar name={displayName || '?'} id={contact.id} size={size} />
}

// ── Time formatting ───────────────────────────────────────────────────────────

function formatWATime(date: Date | null): string {
  if (!date) return ''
  const now = new Date()
  const d = new Date(date)
  const diffMs = now.getTime() - d.getTime()
  const diffDays = Math.floor(diffMs / 86_400_000)

  if (diffDays === 0) {
    return d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false })
  }
  if (diffDays === 1) return 'Ayer'
  if (diffDays < 7) {
    return d.toLocaleDateString('es-MX', { weekday: 'short' })
  }
  return d.toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit' })
}

function formatFallbackName(whatsappId: string, phone: string | null): string {
  if (phone) {
    // Normalize old MX mobile format: 521XXXXXXXXXX → 52XXXXXXXXXX
    let p = phone
    if (p.startsWith('521') && p.length === 13) p = '52' + p.slice(3)
    if (p.startsWith('52') && p.length === 12)
      return `+52 ${p.slice(2, 5)} ${p.slice(5, 8)} ${p.slice(8)}`
    return `+${p}`
  }
  // No phone at all → anonymous privacy-mode contact
  if (whatsappId.endsWith('@lid')) return 'Usuario privado'
  return whatsappId
}

// ── Card content (visual-only, no sortable hooks) ─────────────────────────────
// Exported so KanbanPage can use it inside DragOverlay without sortable context.

export function ContactCardContent({ contact, port }: { contact: Contact; port: number }) {
  const hasSnooze = useRemindersStore(s =>
    s.reminders.some(r => r.contactId === contact.id && !r.isDone)
  )
  // Priority: WA name → Atlas sheet name → formatted phone → "Usuario privado"
  const displayName = contact.name ?? contact.sheetName ?? formatFallbackName(contact.whatsappId, contact.phone)
  const lastAt = contact.lastMessageAt ? new Date(contact.lastMessageAt) : null
  const unreadCount = contact.unreadCount ?? 0

  return (
    <div className="flex items-center gap-3 px-3 py-2.5">
      <ContactAvatar contact={contact} size={46} port={port} />

      <div className="flex-1 min-w-0">
        {/* Row 1: Name + time */}
        <div className="flex items-baseline justify-between gap-1">
          <span className="font-semibold text-gray-900 text-[14px] truncate leading-snug flex items-center gap-1">
            {contact.isGroup && (
              <span className="text-[10px] text-gray-400 font-normal shrink-0">👥</span>
            )}
            {displayName}
          </span>
          <span className={`text-[11px] shrink-0 tabular-nums ${unreadCount > 0 ? 'text-[#25D366] font-medium' : 'text-gray-400'}`}>
            {formatWATime(lastAt)}
          </span>
        </div>

        {/* Row 2: Last message + badges */}
        <div className="flex items-center justify-between gap-2 mt-0.5">
          <p className="text-[13px] text-gray-500 truncate flex-1 leading-tight">
            {contact.isGroup && contact.lastMessageSenderName && (
              <span className="text-gray-600 font-medium">{contact.lastMessageSenderName}: </span>
            )}
            {contact.lastMessage ?? <span className="text-gray-300">Sin mensajes</span>}
          </p>
          <div className="flex items-center gap-1 shrink-0">
            {hasSnooze && <span className="text-[11px]">🔔</span>}
            {unreadCount > 0 && (
              <span className="bg-[#25D366] text-white text-[11px] font-bold min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </div>
        </div>

        {/* Row 3: Property tag (optional) */}
        {contact.property && (
          <p className="text-[11px] text-blue-500 truncate mt-0.5">🏠 {contact.property}</p>
        )}
      </div>
    </div>
  )
}

// ── Sortable card (used in columns) ──────────────────────────────────────────

export function ContactCard({ contact, onClick, onContextMenu }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: String(contact.id)
  })
  const port = window.api?.serverPort ?? 3847

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    // Invisible placeholder while dragging — DragOverlay renders the visual
    opacity: isDragging ? 0 : 1
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={onClick}
      onContextMenu={onContextMenu ? (e) => { e.preventDefault(); onContextMenu(e, contact.id) } : undefined}
      className="bg-white border-b border-gray-100 cursor-pointer hover:bg-gray-50 active:bg-gray-100 transition-colors select-none last:border-b-0"
    >
      <ContactCardContent contact={contact} port={port} />
    </div>
  )
}
