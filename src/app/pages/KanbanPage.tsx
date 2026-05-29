import { useEffect, useRef, useState } from 'react'
import { DndContext, closestCenter, DragEndEvent, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { useContactsStore } from '../stores/contactsStore'
import { KanbanColumn } from '../components/KanbanColumn'
import { ChatPanel } from '../components/ChatPanel'
import { DailyBriefing } from '../components/DailyBriefing'
import { NavBar } from '../components/NavBar'
import type { Contact } from '../../server/db/schema'

const STAGES: { key: Contact['stage']; label: string; emoji: string }[] = [
  { key: 'new', label: 'New', emoji: '🆕' },
  { key: 'open_conversation', label: 'Open Conversation', emoji: '💬' },
  { key: 'waiting_for', label: 'Waiting For', emoji: '⏳' },
  { key: 'all_resolved', label: 'All Resolved', emoji: '✅' }
]

interface Props {
  waStatus: string
  onOpenSettings: () => void
}

export function KanbanPage({ waStatus, onOpenSettings }: Props) {
  const { selectedContactId, setSelectedContactId, updateContact, getByStage } = useContactsStore()
  const [showBriefing, setShowBriefing] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)

  // Show daily briefing once per day
  useEffect(() => {
    const today = new Date().toDateString()
    const last = localStorage.getItem('briefing_shown')
    if (last !== today) {
      setShowBriefing(true)
      localStorage.setItem('briefing_shown', today)
    }
  }, [])

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey && e.key === 'k') {
        e.preventDefault()
        searchRef.current?.focus()
      }
      if (e.key === 'Escape') setSelectedContactId(null)
      if (e.metaKey && ['1', '2', '3', '4'].includes(e.key)) {
        e.preventDefault()
        // Focus first card in column
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const contactId = Number(active.id)
    const STAGE_IDS: Contact['stage'][] = ['new', 'open_conversation', 'waiting_for', 'all_resolved']

    // over.id is either a stage string (dropped on column) or a contact ID (dropped on a card)
    let newStage: Contact['stage']
    if (STAGE_IDS.includes(over.id as Contact['stage'])) {
      newStage = over.id as Contact['stage']
    } else {
      // Dropped on another card — use that card's stage
      const targetContact = useContactsStore.getState().contacts.find(c => c.id === Number(over.id))
      if (!targetContact) return
      newStage = targetContact.stage
    }

    updateContact(contactId, { stage: newStage, stageChangedAt: new Date() })
    await fetch(`http://127.0.0.1:${getPort()}/contacts/${contactId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stage: newStage })
    })
  }

  return (
    <div className="flex flex-col h-screen bg-gray-100">
      <NavBar
        waStatus={waStatus as any}
        searchRef={searchRef}
        onOpenSettings={onOpenSettings}
      />

      {showBriefing && <DailyBriefing onClose={() => setShowBriefing(false)} />}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <div className="flex flex-1 gap-3 p-3 overflow-hidden">
          {STAGES.map((stage, idx) => (
            <KanbanColumn
              key={stage.key}
              stage={stage.key}
              label={`${stage.emoji} ${stage.label}`}
              contacts={getByStage(stage.key)}
              columnIndex={idx + 1}
              onSelectContact={setSelectedContactId}
            />
          ))}
        </div>
      </DndContext>

      {selectedContactId !== null && (
        <ChatPanel
          contactId={selectedContactId}
          onClose={() => setSelectedContactId(null)}
        />
      )}
    </div>
  )
}

function getPort(): number {
  return window.api?.serverPort ?? 3847
}
