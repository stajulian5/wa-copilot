import { useEffect, useRef, useState } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { ContactCard } from './ContactCard'
import type { Contact } from '../../server/db/schema'
import confetti from 'canvas-confetti'

interface Props {
  stage: Contact['stage']
  label: string
  contacts: Contact[]
  columnIndex: number
  onSelectContact: (id: number) => void
  onContactContextMenu: (e: React.MouseEvent, contactId: number) => void
}

// Curated Unsplash puppy photo IDs — one pool shared across all columns
const PUPPY_PHOTOS = [
  'photo-1587300003388-59208cc962cb',
  'photo-1548199973-03cce0bbc87b',
  'photo-1534361960057-19f4434a4f8b',
  'photo-1517849845537-4d257902454a',
  'photo-1583511655857-d19b40a7a54e',
  'photo-1568393691622-c7ba131d63b4',
  'photo-1601758124510-52d02ddb7cbd',
  'photo-1574158622682-e40e69881006',
  'photo-1518020382113-a7e8fc38eac9',
  'photo-1592194996308-7b43878e84a6',
]

// Each column gets a stable but different puppy (rotates daily)
const COLUMN_PHOTO_OFFSET: Record<string, number> = {
  new: 0, open_conversation: 3, waiting_for: 6, all_resolved: 9,
}

const COLUMN_MESSAGES: Record<string, { title: string; sub: string }> = {
  new:               { title: 'All caught up! 🎉',      sub: 'No new conversations waiting.' },
  open_conversation: { title: 'Inbox zero! ✨',          sub: 'Every conversation is handled.' },
  waiting_for:       { title: 'Nothing pending',         sub: 'No one is waiting on a response.' },
  all_resolved:      { title: 'Clean slate',             sub: 'All conversations resolved.' },
}

function fireConfetti(origin: { x: number; y: number }) {
  confetti({
    particleCount: 80,
    spread: 70,
    origin: { x: origin.x / window.innerWidth, y: origin.y / window.innerHeight },
    colors: ['#25D366', '#128C7E', '#075E54', '#34B7F1', '#ffffff'],
    scalar: 0.9,
    zIndex: 9999,
  })
}

export function KanbanColumn({ stage, label, contacts, onSelectContact, onContactContextMenu }: Props) {
  const { setNodeRef, isOver } = useDroppable({ id: stage })
  const totalUnread = contacts.reduce((sum, c) => sum + (c.unreadCount ?? 0), 0)
  const isEmpty = contacts.length === 0
  const prevCountRef = useRef(contacts.length)
  const columnRef = useRef<HTMLDivElement>(null)

  // Pick a stable puppy for this column (rotates daily)
  const offset = COLUMN_PHOTO_OFFSET[stage] ?? 0
  const photoId = PUPPY_PHOTOS[(Math.floor(Date.now() / 86400000) + offset) % PUPPY_PHOTOS.length]
  const photoUrl = `https://images.unsplash.com/${photoId}?auto=format&fit=crop&w=400&q=80`

  const [showCelebration, setShowCelebration] = useState(false)

  useEffect(() => {
    const prev = prevCountRef.current
    const curr = contacts.length
    prevCountRef.current = curr

    // Went from 1+ to 0 → celebrate
    if (prev > 0 && curr === 0) {
      setShowCelebration(true)
      const rect = columnRef.current?.getBoundingClientRect()
      if (rect) {
        fireConfetti({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
      }
      // Hide celebration overlay after a few seconds
      setTimeout(() => setShowCelebration(false), 4000)
    }
  }, [contacts.length])

  return (
    <div ref={columnRef} className="flex flex-col flex-1 min-w-0 max-w-xs">
      {/* Header */}
      <div className="flex items-center justify-between px-2 py-2 mb-2">
        <span className="text-sm font-semibold text-gray-700 truncate">{label}</span>
        <div className="flex items-center gap-1.5">
          {totalUnread > 0 && (
            <span className="bg-green-500 text-white text-xs font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center">
              {totalUnread}
            </span>
          )}
          <span className="text-xs text-gray-400">{contacts.length}</span>
        </div>
      </div>

      {/* Drop zone */}
      <div
        ref={setNodeRef}
        className={`flex-1 overflow-y-auto rounded-xl transition-colors min-h-[200px] relative ${
          isOver ? 'ring-2 ring-blue-300 ring-inset' : ''
        } ${isEmpty ? '' : 'bg-white shadow-sm'}`}
      >
        <SortableContext
          items={contacts.map(c => String(c.id))}
          strategy={verticalListSortingStrategy}
        >
          {contacts.map((contact) => (
            <ContactCard
              key={contact.id}
              contact={contact}
              onClick={() => onSelectContact(contact.id)}
              onContextMenu={onContactContextMenu}
            />
          ))}
        </SortableContext>

        {isEmpty && (
          <div className="absolute inset-0 rounded-xl overflow-hidden">
            {/* Background photo */}
            <img
              src={photoUrl}
              alt=""
              className="absolute inset-0 w-full h-full object-cover"
            />
            {/* Gradient overlay */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent" />

            {/* Celebration flash */}
            {showCelebration && (
              <div className="absolute inset-0 bg-white/30 animate-ping rounded-xl pointer-events-none" />
            )}

            {/* Message */}
            <div className="absolute bottom-0 left-0 right-0 p-4 text-white">
              <p className="text-sm font-semibold drop-shadow">
                {COLUMN_MESSAGES[stage]?.title ?? 'All clear!'}
              </p>
              <p className="text-xs opacity-80 mt-0.5 drop-shadow">
                {COLUMN_MESSAGES[stage]?.sub ?? ''}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
