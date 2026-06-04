import { Router } from 'express'
import { eq, desc, lt, and } from 'drizzle-orm'
import * as schema from '../db/schema'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { serverEvents } from '../index'

export const messagesRouter = Router()

const db = (req: any): BetterSQLite3Database<typeof schema> => req.db

// ── POST /messages/sync ───────────────────────────────────────────────────────
// Chrome extension posts messages read from WhatsApp Web's IndexedDB.
// Deduplicates by whatsappMsgId — safe to call repeatedly, never creates
// duplicates regardless of whether Baileys already captured the message.
//
// Body: Array<{
//   id:        string   WA message ID  (e.g. "3EB0AB12345")
//   jid:       string   Chat JID       (e.g. "5215512345678@s.whatsapp.net")
//   body:      string | null
//   timestamp: number   Unix ms
//   fromMe:    boolean
//   type:      string   "chat" | "image" | "audio" | "document" | ...
//   pushName:  string | null  sender display name (groups)
//   isGroup:   boolean
// }>
messagesRouter.post('/sync', (req, res) => {
  const msgs: Array<{
    id: string; jid: string; body: string | null; timestamp: number;
    fromMe: boolean; type: string; pushName: string | null; isGroup: boolean
  }> = req.body ?? []

  if (!Array.isArray(msgs) || msgs.length === 0) {
    return res.json({ saved: 0, skipped: 0, contacts: 0 })
  }

  const d = db(req)
  let saved = 0, skipped = 0, contactsUpdated = new Set<number>()
  const now = new Date()
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000

  for (const msg of msgs) {
    if (!msg.id || !msg.jid) continue
    if (msg.jid.endsWith('@broadcast') || msg.jid === 'status@broadcast') continue

    // ── Find or create contact ──────────────────────────────────────────────
    let [contact] = d.select().from(schema.contacts)
      .where(eq(schema.contacts.whatsappId, msg.jid)).all()

    if (!contact) {
      const isGroup = msg.jid.endsWith('@g.us')
      const stage = msg.timestamp < thirtyDaysAgo ? 'all_resolved' : 'new'
      const [inserted] = d.insert(schema.contacts).values({
        accountId: 1,
        whatsappId: msg.jid,
        phone: (isGroup || msg.jid.endsWith('@lid')) ? null : msg.jid.split('@')[0],
        name: msg.pushName ?? null,
        isGroup,
        stage,
        stageChangedAt: now,
        lastMessage: msg.body,
        lastMessageAt: new Date(msg.timestamp),
        lastMessageDirection: msg.fromMe ? 'out' : 'in',
        unreadCount: msg.fromMe ? 0 : 1,
        createdAt: now, updatedAt: now
      }).returning().all()
      contact = inserted
    }

    if (!contact) continue

    // ── Deduplicate & insert message ────────────────────────────────────────
    const existing = d.select({ id: schema.messages.id })
      .from(schema.messages)
      .where(eq(schema.messages.whatsappMsgId, msg.id))
      .all()

    if (existing.length > 0) { skipped++; continue }

    try {
      d.insert(schema.messages).values({
        contactId: contact.id,
        whatsappMsgId: msg.id,
        direction: msg.fromMe ? 'out' : 'in',
        body: msg.body ?? null,
        type: (msg.type === 'chat' ? 'text' : msg.type) as any,
        timestamp: new Date(msg.timestamp),
        status: msg.fromMe ? 'sent' : null,
        senderName: (msg.isGroup && !msg.fromMe) ? (msg.pushName ?? null) : null,
        isEdited: false, isDeleted: false,
        createdAt: now
      }).run()
      saved++
      contactsUpdated.add(contact.id)

      // Update contact's lastMessage if this message is newer
      if (!contact.lastMessageAt || new Date(msg.timestamp) > contact.lastMessageAt) {
        d.update(schema.contacts).set({
          lastMessage: msg.body,
          lastMessageAt: new Date(msg.timestamp),
          lastMessageDirection: msg.fromMe ? 'out' : 'in',
          unreadCount: msg.fromMe ? contact.unreadCount : (contact.unreadCount ?? 0) + 1,
          updatedAt: now
        }).where(eq(schema.contacts.id, contact.id)).run()
      }
    } catch { skipped++ }
  }

  if (saved > 0) {
    serverEvents.emit('contactsUpdated')   // triggers wa:historySynced in renderer
  }

  res.json({ saved, skipped, contacts: contactsUpdated.size })
})

const PAGE_SIZE = 20

// GET /messages/:contactId?before=<timestamp_ms>
// Returns PAGE_SIZE messages, newest first, optionally before a timestamp
messagesRouter.get('/:contactId', (req, res) => {
  const contactId = Number(req.params.contactId)
  const before = req.query.before ? Number(req.query.before) : undefined

  let query = db(req)
    .select()
    .from(schema.messages)
    .where(
      before
        ? and(
            eq(schema.messages.contactId, contactId),
            lt(schema.messages.timestamp, new Date(before))
          )
        : eq(schema.messages.contactId, contactId)
    )
    .orderBy(desc(schema.messages.timestamp))
    .limit(PAGE_SIZE)

  const rows = query.all()
  // Return in chronological order for the UI
  res.json(rows.reverse())
})
