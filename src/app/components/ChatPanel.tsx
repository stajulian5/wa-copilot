import { useEffect, useRef, useState } from 'react'
import { useContactsStore } from '../stores/contactsStore'
import { useMessagesStore } from '../stores/messagesStore'
import { MessageBubble } from './MessageBubble'
import { AISuggestion } from './AISuggestion'
import { SnoozeModal } from './SnoozeModal'
import { TemplatesPicker } from './TemplatesPicker'
import type { Message } from '../../server/db/schema'

const PORT = () => window.api?.serverPort ?? 3847

function formatFallbackName(whatsappId: string, phone: string | null): string {
  if (whatsappId.endsWith('@lid')) return 'Contacto WA'  // LID ≠ phone number
  if (!phone) return whatsappId
  if (phone.startsWith('521') && phone.length === 13) {
    return `+52 1 ${phone.slice(3, 6)} ${phone.slice(6, 9)} ${phone.slice(9)}`
  }
  if (phone.startsWith('52') && phone.length === 12) {
    return `+52 ${phone.slice(2, 4)} ${phone.slice(4, 8)} ${phone.slice(8)}`
  }
  return `+${phone}`
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
  const [editingName, setEditingName] = useState(false)
  const [nameValue, setNameValue] = useState(contact?.name ?? '')

  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Load initial messages + mark read
  useEffect(() => {
    if (!messages.length) {
      fetch(`http://127.0.0.1:${PORT()}/messages/${contactId}`)
        .then(r => r.json())
        .then((msgs: Message[]) => { setMessages(contactId, msgs); setHasMore(msgs.length === 20) })
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
    setHasMore(older.length === 20)
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

  const saveName = () => {
    setEditingName(false)
    fetch(`http://127.0.0.1:${PORT()}/contacts/${contactId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: nameValue })
    })
    updateContact(contactId, { name: nameValue })
  }

  if (!contact) return null

  return (
    <div className="fixed right-0 top-0 bottom-0 w-[480px] bg-white shadow-2xl flex flex-col border-l border-gray-200 z-40">

      {/* Contact header */}
      <div className="px-4 pt-12 pb-3 border-b border-gray-100 bg-gray-50">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            {editingName ? (
              <input
                autoFocus
                value={nameValue}
                onChange={e => setNameValue(e.target.value)}
                onBlur={saveName}
                onKeyDown={e => e.key === 'Enter' && saveName()}
                className="font-semibold text-gray-900 text-base border-b border-gray-300 outline-none bg-transparent w-full"
              />
            ) : (
              <h2
                className="font-semibold text-gray-900 text-base truncate cursor-pointer hover:opacity-70"
                onClick={() => setEditingName(true)}
                title="Click para editar"
              >
                {contact.name ?? formatFallbackName(contact.whatsappId, contact.phone)}
              </h2>
            )}
            <p className="text-xs text-gray-400 mt-0.5">{contact.phone}</p>

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
          </div>

          <div className="flex items-center gap-2 ml-3">
            {/* Snooze */}
            <button onClick={() => setShowSnooze(true)} className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg" title="Recordatorio ⌘N">
              🔔
            </button>
            {/* Close */}
            <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg">
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
              <button onClick={loadEarlier} disabled={loading} className="text-xs text-center text-blue-500 hover:underline py-1">
                {loading ? 'Cargando…' : 'Mensajes anteriores'}
              </button>
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
