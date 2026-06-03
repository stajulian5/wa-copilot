import { useEffect, useRef, useState } from 'react'
import { useContactsStore } from '../stores/contactsStore'
import { useMessagesStore } from '../stores/messagesStore'
import { MessageBubble } from './MessageBubble'
import { AISuggestion } from './AISuggestion'
import { SnoozeModal } from './SnoozeModal'
import { TemplatesPicker } from './TemplatesPicker'
import type { Contact, Message } from '../../server/db/schema'

const PORT = () => window.api?.serverPort ?? 3847

// ── Avatar (mirrors ContactCard logic) ────────────────────────────────────────

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

function PanelAvatar({ contact, size }: { contact: Contact; size: number }) {
  const [imgFailed, setImgFailed] = useState(false)
  const port = window.api?.serverPort ?? 3847
  const displayName = contact.name ?? contact.phone ?? ''

  // Retry when new avatars are downloaded
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

  if (contact.isGroup) {
    return (
      <div className="rounded-full flex items-center justify-center shrink-0 bg-gray-400" style={{ width: size, height: size }}>
        <svg width={size * 0.6} height={size * 0.6} viewBox="0 0 24 24" fill="white">
          <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/>
        </svg>
      </div>
    )
  }

  const bg = AVATAR_COLORS[contact.id % AVATAR_COLORS.length]
  const initials = getInitials(displayName || '?')
  return (
    <div
      className="rounded-full flex items-center justify-center shrink-0 text-white font-semibold"
      style={{ width: size, height: size, backgroundColor: bg, fontSize: size * 0.36 }}
    >
      {initials}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

function formatFallbackName(whatsappId: string, phone: string | null): string {
  if (phone) {
    // Normalize old MX mobile format: 521XXXXXXXXXX → 52XXXXXXXXXX
    let p = phone
    if (p.startsWith('521') && p.length === 13) p = '52' + p.slice(3)
    if (p.startsWith('52') && p.length === 12)
      return `+52 ${p.slice(2, 5)} ${p.slice(5, 8)} ${p.slice(8)}`
    return `+${p}`
  }
  if (whatsappId.endsWith('@lid')) return 'Usuario privado'
  return whatsappId
}

interface Props {
  contactId: number
  onClose: () => void
}

type Tab = 'chat' | 'notes'

export function ChatPanel({ contactId, onClose }: Props) {
  const contact = useContactsStore(s => s.contacts.find(c => c.id === contactId))
  const { updateContact } = useContactsStore()
  const { byContact, setMessages, prependMessages } = useMessagesStore()
  const messages = byContact[contactId] ?? []

  const [tab, setTab] = useState<Tab>('chat')
  const [input, setInput] = useState('')
  const [notes, setNotes] = useState(contact?.notes ?? '')
  const [loading, setLoading] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [showAI, setShowAI] = useState(false)
  const [aiSuggestion, setAiSuggestion] = useState<string | null>(null)
  const [aiLoading, setAiLoading] = useState(false)
  const [showSnooze, setShowSnooze] = useState(false)
  const [showTemplates, setShowTemplates] = useState(false)

  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Load initial messages + mark read
  useEffect(() => {
    setHasMore(true) // reset on contact switch
    if (!messages.length) {
      fetch(`http://127.0.0.1:${PORT()}/messages/${contactId}`)
        .then(r => r.json())
        .then((msgs: Message[]) => {
          setMessages(contactId, msgs)
          // If we got fewer than a full page, there's nothing older in the DB
          if (msgs.length < 20) setHasMore(false)
        })
    } else {
      // Messages already cached — check if there could be older ones
      if (messages.length < 20) setHasMore(false)
    }
    fetch(`http://127.0.0.1:${PORT()}/contacts/${contactId}/read`, { method: 'POST' })
    updateContact(contactId, { unreadCount: 0 })
  }, [contactId])

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return }
      if (e.metaKey && e.key === 'n') { e.preventDefault(); setShowSnooze(true) }
      if (e.metaKey && e.key === 'Enter' && aiSuggestion) { e.preventDefault(); sendText(aiSuggestion); setAiSuggestion(null) }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [aiSuggestion])

  const loadEarlier = async () => {
    const oldest = messages[0]
    if (!oldest) return
    setLoading(true)
    const url = `http://127.0.0.1:${PORT()}/messages/${contactId}?before=${new Date(oldest.timestamp).getTime()}`
    const older = await fetch(url).then(r => r.json()) as Message[]
    prependMessages(contactId, older)
    // Hide the button only when there's truly nothing left to load
    if (older.length === 0) setHasMore(false)
    setLoading(false)
  }

  const sendText = async (text: string) => {
    if (!text.trim() || !contact) return
    await window.api.sendMessage(contact.whatsappId, text.trim())
    setInput('')
    setAiSuggestion(null)
    inputRef.current?.focus()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendText(input)
    }
  }

  const fetchAI = async () => {
    setAiLoading(true)
    setShowAI(true)
    const r = await fetch(`http://127.0.0.1:${PORT()}/ai/suggest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contactId })
    })
    const data = await r.json()
    setAiLoading(false)
    if (data.suggestion) setAiSuggestion(data.suggestion)
    else if (data.error === 'NO_API_KEY') alert('Configura tu clave API de Anthropic en Ajustes.')
  }

  const saveNotes = () => {
    fetch(`http://127.0.0.1:${PORT()}/contacts/${contactId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes })
    })
    updateContact(contactId, { notes })
  }

  if (!contact) return null

  return (
    <div className="fixed right-0 top-0 bottom-0 w-[480px] bg-white shadow-2xl flex flex-col border-l border-gray-200 z-40">

      {/* Contact header */}
      <div className="px-4 pt-12 pb-3 border-b border-gray-100 bg-gray-50">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <PanelAvatar contact={contact} size={42} />
            <div className="flex-1 min-w-0">
            <h2 className="font-semibold text-gray-900 text-base truncate">
              {contact.name ?? formatFallbackName(contact.whatsappId, contact.phone)}
            </h2>
            {/* Only show phone if it looks like a real number (not an @lid numeric ID) */}
            {contact.phone && !contact.whatsappId.endsWith('@lid') && (
              <p className="text-xs text-gray-400 mt-0.5">
                {formatFallbackName(contact.whatsappId, contact.phone)}
              </p>
            )}

            {/* Property (inline editable) */}
            <div className="mt-1">
              <input
                value={contact.property ?? ''}
                onChange={e => updateContact(contactId, { property: e.target.value })}
                onBlur={e => fetch(`http://127.0.0.1:${PORT()}/contacts/${contactId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ property: e.target.value }) })}
                placeholder="🏠 Propiedad"
                className="text-xs text-blue-600 bg-transparent outline-none placeholder-gray-300 w-full"
              />
            </div>
            </div>{/* end text content */}
          </div>{/* end avatar+text row */}

          <div className="flex items-center gap-2 ml-3">
            {/* Snooze */}
            <button onClick={() => setShowSnooze(true)} className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg" title="Recordatorio ⌘N">
              🔔
            </button>
            {/* Close */}
            <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg" title="Cerrar (Esc)">
              ✕
            </button>
          </div>
        </div>

        {/* Stage picker + pills */}
        <div className="flex items-center gap-2 mt-2 flex-wrap">
          <select
            value={contact.stage}
            onChange={e => {
              const stage = e.target.value as any
              updateContact(contactId, { stage, stageChangedAt: new Date() })
              fetch(`http://127.0.0.1:${PORT()}/contacts/${contactId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stage }) })
            }}
            className="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white"
          >
            <option value="new">🆕 New</option>
            <option value="open_conversation">💬 Open Conversation</option>
            <option value="waiting_for">⏳ Waiting For</option>
            <option value="all_resolved">✅ All Resolved</option>
          </select>

          {contact.kycStatus && (
            <span className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full">{contact.kycStatus}</span>
          )}
          {contact.contractStatus && (
            <span className="text-xs bg-purple-50 text-purple-700 px-2 py-0.5 rounded-full">{contact.contractStatus}</span>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-100">
        {(['chat', 'notes'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-2 text-sm font-medium transition-colors ${
              tab === t ? 'text-gray-900 border-b-2 border-gray-900' : 'text-gray-400 hover:text-gray-600'
            }`}
          >
            {t === 'chat' ? 'Chat' : 'Notas'}
          </button>
        ))}
      </div>

      {tab === 'chat' ? (
        <>
          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-1">
            {hasMore && (
              <div className="flex justify-center py-2">
                <button
                  onClick={loadEarlier}
                  disabled={loading}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-200 rounded-full text-xs text-gray-500 hover:bg-gray-50 hover:text-gray-700 shadow-sm transition-colors disabled:opacity-50"
                >
                  {loading
                    ? <><span className="animate-spin">⏳</span> Cargando…</>
                    : <>↑ Mensajes anteriores</>}
                </button>
              </div>
            )}
            {messages.map(msg => (
              <MessageBubble key={msg.id} message={msg} />
            ))}
            <div ref={bottomRef} />
          </div>

          {/* AI suggestion */}
          {showAI && (
            <AISuggestion
              suggestion={aiSuggestion}
              loading={aiLoading}
              onEdit={text => { setInput(text); setShowAI(false); setAiSuggestion(null); inputRef.current?.focus() }}
              onSend={text => { sendText(text); setShowAI(false) }}
              onDismiss={() => { setShowAI(false); setAiSuggestion(null) }}
            />
          )}

          {/* Templates */}
          {showTemplates && (
            <TemplatesPicker
              onSelect={text => { setInput(prev => prev + text); setShowTemplates(false); inputRef.current?.focus() }}
              onClose={() => setShowTemplates(false)}
              contactName={contact.name ?? formatFallbackName(contact.whatsappId, contact.phone)}
            />
          )}

          {/* Input bar */}
          <div className="border-t border-gray-100 p-3">
            <div className="flex gap-2 items-end">
              <div className="flex gap-1">
                <button onClick={() => setShowTemplates(!showTemplates)} className="p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg text-sm" title="Plantillas">
                  📋
                </button>
                <button onClick={fetchAI} className="p-2 text-gray-400 hover:text-yellow-500 hover:bg-yellow-50 rounded-lg text-sm" title="Sugerencia IA">
                  ✨
                </button>
              </div>
              <textarea
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Escribe un mensaje…"
                rows={1}
                className="selectable flex-1 resize-none border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-300 max-h-32"
                style={{ minHeight: '40px' }}
              />
              <button
                onClick={() => sendText(input)}
                disabled={!input.trim()}
                className="p-2 bg-gray-900 text-white rounded-xl hover:bg-gray-700 disabled:opacity-30 transition-all"
                title="Enviar (Enter)"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M14 8L2 2l3 6-3 6 12-6z" fill="currentColor" />
                </svg>
              </button>
            </div>
          </div>
        </>
      ) : (
        /* Notes tab */
        <div className="flex-1 flex flex-col p-4">
          <textarea
            className="selectable flex-1 resize-none text-sm text-gray-700 outline-none placeholder-gray-300"
            placeholder="Notas privadas sobre este contacto (no se envían por WhatsApp)…"
            value={notes}
            onChange={e => setNotes(e.target.value)}
            onBlur={saveNotes}
          />
        </div>
      )}

      {showSnooze && (
        <SnoozeModal contactId={contactId} onClose={() => setShowSnooze(false)} />
      )}
    </div>
  )
}
