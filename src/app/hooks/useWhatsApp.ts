import { useEffect } from 'react'
import { useContactsStore } from '../stores/contactsStore'
import { useMessagesStore } from '../stores/messagesStore'
import type { Contact, Message } from '../../server/db/schema'

const PORT = () => window.api?.serverPort ?? 3847

type WAStatus = 'disconnected' | 'connecting' | 'connected'

export function useWhatsApp(setStatus: (s: WAStatus) => void, onMessage?: () => void) {
  const { upsertContact, setContacts } = useContactsStore()
  const { upsertMessage, updateMessageStatus, markDeleted } = useMessagesStore()

  useEffect(() => {
    const offStatus = window.api.onWAStatus((status: string) => {
      setStatus(status as WAStatus)
    })

    const offMsg = window.api.onNewMessage(async (raw: any) => {
      // Always read current contacts from store (avoids stale closure)
      let contact = useContactsStore.getState().contacts.find((c) => c.whatsappId === raw.jid)

      // If not in store yet (new contact just created in DB), re-fetch all contacts
      if (!contact) {
        try {
          const all: Contact[] = await fetch(`http://127.0.0.1:${PORT()}/contacts`).then(r => r.json())
          setContacts(all)
          contact = all.find((c) => c.whatsappId === raw.jid)
        } catch {}
      }

      if (!contact) return   // genuinely unknown (broadcast, status, etc.)

      // Re-open resolved conversations when an inbound message arrives
      const shouldReopen = !raw.fromMe && contact.stage === 'all_resolved'
      if (shouldReopen) {
        fetch(`http://127.0.0.1:${PORT()}/contacts/${contact.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stage: 'new' })
        }).catch(() => {})
      }

      upsertContact({
        ...contact,
        lastMessage: raw.body ?? contact.lastMessage,
        lastMessageAt: new Date(raw.timestamp),
        lastMessageDirection: raw.fromMe ? 'out' : 'in',
        lastMessageSenderName: contact.isGroup
          ? (raw.fromMe ? 'Tú' : (raw.senderName ?? contact.lastMessageSenderName ?? null))
          : null,
        unreadCount: raw.fromMe ? contact.unreadCount : (contact.unreadCount ?? 0) + 1,
        ...(shouldReopen ? { stage: 'new', stageChangedAt: new Date() } : {})
      })

      upsertMessage(contact.id, {
        id: 0,
        contactId: contact.id,
        whatsappMsgId: raw.id ?? `local_${Date.now()}`,
        direction: raw.fromMe ? 'out' : 'in',
        body: raw.body ?? null,
        type: raw.type ?? 'text',
        timestamp: new Date(raw.timestamp),
        status: raw.fromMe ? 'sent' : null,
        isEdited: false,
        isDeleted: false,
        mediaUrl: null,
        mediaFilename: null,
        mediaMimetype: null,
        mediaSize: null,
        reactionEmoji: null,
        quotedMsgId: null,
        senderName: raw.senderName ?? null,
        senderJid: raw.senderJid ?? null,
        sentByManagerId: null,
        createdAt: new Date()
      } as Message)

      onMessage?.()

      // OS notification for inbound when backgrounded
      if (!raw.fromMe && document.visibilityState === 'hidden') {
        window.api.notify(contact.name ?? contact.phone, raw.body ?? '[media]')
      }
    })

    // New contact appeared (first message from someone not in store)
    const offContactUpserted = window.api.onContactUpserted((contact: Contact) => {
      upsertContact(contact)
    })

    const offUpdate = window.api.onMessageUpdate((update: any) => {
      if (update.update?.status != null) {
        updateMessageStatus(update.key.id, statusLabel(update.update.status))
      }
      if (update.update?.message?.protocolMessage?.type === 14) {
        markDeleted(update.key.id)
      }
    })

    return () => {
      offStatus()
      offMsg()
      offContactUpserted()
      offUpdate()
    }
  }, []) // no dependency on contacts — reads from store directly
}

function statusLabel(n: number): Message['status'] {
  switch (n) {
    case 0: return 'pending'
    case 1: return 'sent'
    case 2: return 'sent'
    case 3: return 'delivered'
    case 4: return 'read'
    default: return 'sent'
  }
}
