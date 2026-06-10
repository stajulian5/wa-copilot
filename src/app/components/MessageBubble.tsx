import { useState } from 'react'
import { format } from 'date-fns'
import type { Message } from '../../server/db/schema'

interface Props {
  message: Message
  highlight?: string   // search term to highlight in message body
  jid: string          // chat jid, needed to send reactions
}

const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏']
const EMOJI_GRID = [
  '👍', '❤️', '😂', '😮', '😢', '🙏',
  '🔥', '🎉', '👏', '😍', '😘', '🥰',
  '😊', '😎', '🤔', '😡', '😱', '👌',
  '✌️', '🙌', '💯', '✅', '❌', '⭐'
]

const statusIcon = (status: Message['status']) => {
  switch (status) {
    case 'pending': return '🕐'
    case 'sent': return '✓'
    case 'delivered': return '✓✓'
    case 'read': return <span className="text-blue-400">✓✓</span>
    case 'failed': return <span className="text-red-500">✗</span>
    default: return null
  }
}

function HighlightedText({ text, term }: { text: string; term?: string }) {
  if (!term) return <>{text}</>
  const parts = text.split(new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'))
  return (
    <>
      {parts.map((p, i) =>
        p.toLowerCase() === term.toLowerCase()
          ? <mark key={i} className="bg-yellow-200 text-gray-900 rounded px-0.5">{p}</mark>
          : p
      )}
    </>
  )
}

export function MessageBubble({ message, highlight, jid }: Props) {
  const isOut = message.direction === 'out'
  const time = format(new Date(message.timestamp), 'HH:mm')
  const [showToolbar, setShowToolbar] = useState(false)
  const [showPicker, setShowPicker] = useState(false)

  if (message.type === 'reaction') {
    return (
      <div className={`flex ${isOut ? 'justify-end' : 'justify-start'} my-0.5`}>
        <span className="text-lg">{message.reactionEmoji}</span>
      </div>
    )
  }

  // Reactions added ON this message (JSON map of reactorJid|'me' -> emoji)
  let reactionsMap: Record<string, string> | null = null
  try { reactionsMap = message.reactions ? JSON.parse(message.reactions) : null } catch {}
  const myReaction = reactionsMap?.['me']
  const reactionCounts: Record<string, number> = {}
  if (reactionsMap) {
    for (const emoji of Object.values(reactionsMap)) {
      reactionCounts[emoji] = (reactionCounts[emoji] ?? 0) + 1
    }
  }
  const hasReactions = Object.keys(reactionCounts).length > 0

  const sendReaction = (emoji: string) => {
    const next = myReaction === emoji ? '' : emoji
    window.api.sendReaction(jid, message.whatsappMsgId, next)
    setShowPicker(false)
    setShowToolbar(false)
  }

  return (
    <div className={`flex flex-col ${isOut ? 'items-end' : 'items-start'} mb-0.5`}>
      {/* Group sender name above incoming bubble */}
      {!isOut && message.senderName && (
        <p className="text-[11px] font-semibold text-emerald-600 mb-0.5 ml-1 px-1">
          {message.senderName}
        </p>
      )}
      <div
        className={`flex ${isOut ? 'justify-end' : 'justify-start'} w-full relative`}
        onMouseEnter={() => setShowToolbar(true)}
        onMouseLeave={() => { setShowToolbar(false); setShowPicker(false) }}
      >
        {/* Quick-reaction toolbar (shown on hover) */}
        {showToolbar && !message.isDeleted && message.type !== 'reaction' && (
          <div
            className={`absolute -top-9 ${isOut ? 'right-0' : 'left-0'} z-10 flex items-center gap-0.5 bg-white rounded-full shadow-md border border-gray-100 px-1.5 py-1`}
          >
            {QUICK_REACTIONS.map(emoji => (
              <button
                key={emoji}
                onClick={() => sendReaction(emoji)}
                title="Reaccionar"
                className={`text-base leading-none hover:scale-125 transition-transform px-0.5 ${myReaction === emoji ? 'scale-125' : ''}`}
              >
                {emoji}
              </button>
            ))}
            <button
              onClick={() => setShowPicker(p => !p)}
              title="Más emojis"
              className="text-gray-400 hover:text-gray-600 text-sm px-1 leading-none"
            >
              ➕
            </button>
          </div>
        )}

        {/* Full emoji picker grid */}
        {showPicker && (
          <div
            className={`absolute -top-[11.5rem] ${isOut ? 'right-0' : 'left-0'} z-20 grid grid-cols-6 gap-1 bg-white rounded-lg shadow-lg border border-gray-100 p-2 w-52`}
          >
            {EMOJI_GRID.map(emoji => (
              <button
                key={emoji}
                onClick={() => sendReaction(emoji)}
                className="text-lg leading-none hover:bg-gray-100 rounded p-1"
              >
                {emoji}
              </button>
            ))}
          </div>
        )}

      <div
        className={`selectable max-w-[85%] rounded-2xl px-3 py-2 text-sm shadow-sm ${
          isOut ? 'bg-wa-light text-gray-900 rounded-br-sm' : 'bg-white text-gray-900 rounded-bl-sm border border-gray-100'
        }`}
      >
        {/* Content */}
        {message.isDeleted ? (
          <p className="italic text-gray-400 text-xs">Mensaje eliminado</p>
        ) : message.type === 'image' ? (
          <div>
            {message.mediaUrl && (
              <img src={message.mediaUrl} alt="" className="rounded-lg max-w-full mb-1 cursor-pointer" onClick={() => window.open(message.mediaUrl!)} />
            )}
            {message.body && <p>{message.body}</p>}
          </div>
        ) : message.type === 'document' ? (
          <div className="flex items-center gap-2">
            <span className="text-xl">📎</span>
            <span className="text-xs text-blue-600 underline cursor-pointer" onClick={() => message.mediaUrl && window.open(message.mediaUrl)}>
              {message.mediaFilename ?? 'Documento'}
            </span>
          </div>
        ) : message.type === 'audio' ? (
          <div>
            {message.mediaUrl ? (
              <audio controls className="h-8 max-w-full" src={message.mediaUrl} />
            ) : (
              <p className="text-gray-400 text-xs">🎤 Nota de voz</p>
            )}
          </div>
        ) : message.type === 'video' ? (
          <video controls className="rounded-lg max-w-full" src={message.mediaUrl ?? undefined} />
        ) : message.type === 'location' ? (
          <a href={`https://maps.google.com/?q=${message.body}`} target="_blank" rel="noreferrer" className="text-blue-600 underline text-xs">
            📍 Ver en Maps
          </a>
        ) : message.type === 'reaction' ? (
          <p className="text-lg leading-none">{message.body?.replace(' (reacción)', '') ?? '👍'}</p>
        ) : message.type === 'poll' ? (
          <div className="text-xs text-gray-500 italic">📊 {message.body}</div>
        ) : message.type === 'sticker' ? (
          message.mediaUrl ? <img src={message.mediaUrl} alt="" className="w-24 h-24" /> : null
        ) : message.body ? (
          <p className="whitespace-pre-wrap break-words">
            <HighlightedText text={message.body} term={highlight} />
            {message.isEdited && <span className="text-gray-400 text-xs ml-1 italic">editado</span>}
          </p>
        ) : (
          <p className="italic text-gray-300 text-xs">[Mensaje]</p>
        )}

        {/* Timestamp + status */}
        <div className={`flex items-center gap-1 mt-0.5 ${isOut ? 'justify-end' : 'justify-start'}`}>
          <span className="text-gray-400 text-[10px]">{time}</span>
          {isOut && <span className="text-gray-400 text-[10px]">{statusIcon(message.status)}</span>}
        </div>
      </div>
      </div>

      {/* Reaction pills */}
      {hasReactions && (
        <div className={`flex flex-wrap gap-1 mt-0.5 ${isOut ? 'mr-1 justify-end' : 'ml-1 justify-start'}`}>
          {Object.entries(reactionCounts).map(([emoji, count]) => (
            <button
              key={emoji}
              onClick={() => sendReaction(emoji)}
              className={`flex items-center gap-0.5 text-xs rounded-full px-1.5 py-0.5 border shadow-sm ${
                myReaction === emoji ? 'bg-emerald-50 border-emerald-300' : 'bg-white border-gray-200'
              }`}
            >
              <span className="leading-none">{emoji}</span>
              {count > 1 && <span className="text-gray-500 leading-none">{count}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
