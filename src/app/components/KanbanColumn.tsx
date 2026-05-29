import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { ContactCard } from './ContactCard'
import type { Contact } from '../../server/db/schema'

interface Props {
  stage: Contact['stage']
  label: string
  contacts: Contact[]
  columnIndex: number
  onSelectContact: (id: number) => void
}

export function KanbanColumn({ stage, label, contacts, onSelectContact }: Props) {
  const { setNodeRef, isOver } = useDroppable({ id: stage })
  const totalUnread = contacts.reduce((sum, c) => sum + (c.unreadCount ?? 0), 0)

  return (
    <div className="flex flex-col flex-1 min-w-0 max-w-xs">
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
        className={`flex-1 flex flex-col gap-2 overflow-y-auto rounded-xl p-1.5 transition-colors min-h-[200px] ${
          isOver ? 'bg-blue-50 ring-2 ring-blue-300' : 'bg-gray-200/60'
        }`}
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
            />
          ))}
        </SortableContext>

        {contacts.length === 0 && (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-xs text-gray-400">Sin contactos</p>
          </div>
        )}
      </div>
    </div>
  )
}
