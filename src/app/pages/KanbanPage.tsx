import { useEffect, useRef, useState } from 'react'
import {
  DndContext, closestCenter,
  DragEndEvent, DragStartEvent, DragOverlay,
  PointerSensor, useSensor, useSensors
} from '@dnd-kit/core'
import { useContactsStore } from '../stores/contactsStore'
import { KanbanColumn } from '../components/KanbanColumn'
import { ContactCardContent } from '../components/ContactCard'
import { CardContextMenu } from '../components/CardContextMenu'
import { EscalateModal } from '../components/EscalateModal'
import { SnoozeModal } from '../components/SnoozeModal'
import { ChatPanel } from '../components/ChatPanel'
import { DailyBriefing } from '../components/DailyBriefing'
import { NavBar } from '../components/NavBar'
import { StatsBar } from '../components/StatsBar'
import type { Contact, Account } from '../../server/db/schema'

const STAGES: { key: Contact['stage']; label: string; emoji: string }[] = [
  { key: 'new', label: 'New', emoji: '🆕' },
  { key: 'open_conversation', label: 'Open Conversation', emoji: '💬' },
  { key: 'waiting_for', label: 'Waiting For', emoji: '⏳' },
  { key: 'all_resolved', label: 'All Resolved', emoji: '✅' }
]

const STAGE_KEYS: Contact['stage'][] = ['new', 'open_conversation', 'waiting_for', 'all_resolved']

interface Props {
  waStatus: string
  accounts: Account[]
  activeAccountId: number
  lastSyncAt: Date | null
  onOpenSettings: () => void
  onSwitchAccount: (id: number) => void
  onAddAccount: () => void
}

export function KanbanPage({ waStatus, accounts, activeAccountId, lastSyncAt, onOpenSettings, onSwitchAccount, onAddAccount }: Props) {
  const {
    selectedContactId, setSelectedContactId,
    updateContact, getByStage, contacts,
    reorderContacts, moveToStage
  } = useContactsStore()

  const [showBriefing, setShowBriefing] = useState(false)
  const [showSyncBanner, setShowSyncBanner] = useState(() => !localStorage.getItem('sync_banner_dismissed'))
  const [activeContact, setActiveContact] = useState<Contact | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; contactId: number } | null>(null)
  const [escalateContactId, setEscalateContactId] = useState<number | null>(null)
  const [snoozeContactId, setSnoozeContactId] = useState<number | null>(null)
  const [syncingContactId, setSyncingContactId] = useState<number | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const port = window.api?.serverPort ?? 3847

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

  const handleCardContextMenu = (e: React.MouseEvent, contactId: number) => {
    setContextMenu({ x: e.clientX, y: e.clientY, contactId })
  }

  const syncContactAvatar = async (contactId: number) => {
    setSyncingContactId(contactId)
    try {
      // Re-fetch avatar AND force WA to re-push the full address book
      // (address book contains names for contacts saved in your phone)
      await Promise.all([
        window.api.syncAvatar(contactId),
        window.api.resyncContacts()
      ])
    } finally {
      setSyncingContactId(null)
    }
  }

  const handleDragStart = (event: DragStartEvent) => {
    const contactId = Number(event.active.id)
    const contact = useContactsStore.getState().contacts.find(c => c.id === contactId)
    setActiveContact(contact ?? null)
  }

  const handleDragEnd = async (event: DragEndEvent) => {
    setActiveContact(null)
    const { active, over } = event
    if (!over || active.id === over.id) return

    const contactId = Number(active.id)
    const draggedContact = useContactsStore.getState().contacts.find(c => c.id === contactId)
    if (!draggedContact) return

    if (STAGE_KEYS.includes(over.id as Contact['stage'])) {
      // Dropped directly on a column (not on a card)
      const newStage = over.id as Contact['stage']
      if (newStage === draggedContact.stage) return
      moveToStage(contactId, newStage)
      updateContact(contactId, { stage: newStage, stageChangedAt: new Date() })
      await fetch(`http://127.0.0.1:${port}/contacts/${contactId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage: newStage })
      })
    } else {
      // Dropped on another card
      const overId = Number(over.id)
      const targetContact = useContactsStore.getState().contacts.find(c => c.id === overId)
      if (!targetContact) return

      if (targetContact.stage === draggedContact.stage) {
        // Same column: reorder within column (no network call needed)
        reorderContacts(draggedContact.stage, contactId, overId)
      } else {
        // Different column: change stage and position
        const newStage = targetContact.stage
        moveToStage(contactId, newStage, overId)
        updateContact(contactId, { stage: newStage, stageChangedAt: new Date() })
        await fetch(`http://127.0.0.1:${port}/contacts/${contactId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stage: newStage })
        })
      }
    }
  }

  return (
    <div className="flex flex-col h-screen bg-gray-100">
      <NavBar
        waStatus={waStatus as any}
        searchRef={searchRef}
        onOpenSettings={onOpenSettings}
        accounts={accounts}
        activeAccountId={activeAccountId}
        onSwitchAccount={onSwitchAccount}
        onAddAccount={onAddAccount}
        lastSyncAt={lastSyncAt}
      />

      <StatsBar />

      {showBriefing && <DailyBriefing onClose={() => setShowBriefing(false)} />}

      {/* Sync banner: shown when few contacts, prompting full history import */}
      {showSyncBanner && contacts.length < 10 && waStatus === 'connected' && (
        <div className="flex items-center gap-3 px-4 py-2.5 bg-[#054640] text-white text-sm">
          <span className="text-lg">💬</span>
          <span className="flex-1 text-[13px]">
            Import <strong>all</strong> your conversations: go to <strong>Settings → Re-link WhatsApp</strong> and scan the QR code from WhatsApp on your phone.
          </span>
          <button
            onClick={() => onOpenSettings()}
            className="bg-[#25D366] hover:bg-[#1da851] text-white text-xs font-semibold px-3 py-1.5 rounded-full transition-colors shrink-0"
          >
            Configuración
          </button>
          <button
            onClick={() => { setShowSyncBanner(false); localStorage.setItem('sync_banner_dismissed', '1') }}
            className="text-white/60 hover:text-white text-lg leading-none shrink-0"
          >
            ×
          </button>
        </div>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="flex flex-1 gap-3 p-3 overflow-hidden">
          {STAGES.map((stage, idx) => (
            <KanbanColumn
              key={stage.key}
              stage={stage.key}
              label={`${stage.emoji} ${stage.label}`}
              contacts={getByStage(stage.key)}
              columnIndex={idx + 1}
              onSelectContact={setSelectedContactId}
              onContactContextMenu={handleCardContextMenu}
            />
          ))}
        </div>

        {/* Floating card shown while dragging */}
        <DragOverlay dropAnimation={null}>
          {activeContact ? (
            <div
              className="bg-white rounded-xl shadow-2xl border border-gray-200 overflow-hidden opacity-95"
              style={{ width: 300, transform: 'rotate(1deg) scale(1.02)' }}
            >
              <ContactCardContent contact={activeContact} port={port} />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {selectedContactId !== null && (
        <ChatPanel
          contactId={selectedContactId}
          onClose={() => setSelectedContactId(null)}
        />
      )}

      {/* Right-click context menu */}
      {contextMenu && (
        <CardContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          items={[
            {
              icon: '🔄',
              label: 'Sincronizar contacto',
              loading: syncingContactId === contextMenu.contactId,
              onClick: () => syncContactAvatar(contextMenu.contactId)
            },
            {
              icon: '🔔',
              label: 'Set reminder',
              onClick: () => setSnoozeContactId(contextMenu.contactId)
            },
            {
              icon: '⚡',
              label: 'Escalate conversation',
              onClick: () => setEscalateContactId(contextMenu.contactId)
            }
          ]}
        />
      )}

      {/* Escalation modal */}
      {escalateContactId !== null && (
        <EscalateModal
          contactId={escalateContactId}
          onClose={() => setEscalateContactId(null)}
        />
      )}

      {/* Reminder / snooze modal */}
      {snoozeContactId !== null && (
        <SnoozeModal
          contactId={snoozeContactId}
          onClose={() => setSnoozeContactId(null)}
        />
      )}
    </div>
  )
}
