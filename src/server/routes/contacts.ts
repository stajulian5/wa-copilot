import { Router } from 'express'
import { eq, desc, like, or } from 'drizzle-orm'
import * as schema from '../db/schema'
import { waMessenger } from '../waMessenger'
import { serverEvents } from '../index'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'

export const contactsRouter = Router()

const db = (req: any): BetterSQLite3Database<typeof schema> => req.db

// GET /contacts — all contacts sorted by lastMessageAt desc
contactsRouter.get('/', (req, res) => {
  const contacts = db(req)
    .select()
    .from(schema.contacts)
    .orderBy(desc(schema.contacts.lastMessageAt))
    .all()
  res.json(contacts)
})

// GET /contacts/search?q=
contactsRouter.get('/search', (req, res) => {
  const q = `%${req.query.q ?? ''}%`
  const results = db(req)
    .select()
    .from(schema.contacts)
    .where(or(like(schema.contacts.name, q), like(schema.contacts.phone, q)))
    .orderBy(desc(schema.contacts.lastMessageAt))
    .all()
  res.json(results)
})

// GET /contacts/:id
contactsRouter.get('/:id', (req, res) => {
  const [contact] = db(req)
    .select()
    .from(schema.contacts)
    .where(eq(schema.contacts.id, Number(req.params.id)))
    .all()
  if (!contact) return res.status(404).json({ error: 'Not found' })
  res.json(contact)
})

// PATCH /contacts/:id
contactsRouter.patch('/:id', (req, res) => {
  const allowed = ['name', 'stage', 'property', 'notes', 'kycStatus', 'contractStatus']
  const updates: Record<string, unknown> = { updatedAt: new Date() }
  for (const key of allowed) {
    if (key in req.body) updates[key] = req.body[key]
  }
  if ('stage' in req.body) updates.stageChangedAt = new Date()

  db(req)
    .update(schema.contacts)
    .set(updates as any)
    .where(eq(schema.contacts.id, Number(req.params.id)))
    .run()

  const [updated] = db(req)
    .select()
    .from(schema.contacts)
    .where(eq(schema.contacts.id, Number(req.params.id)))
    .all()
  res.json(updated)
})

// POST /contacts/:id/escalate — send AI summary to a team member via WhatsApp
// Body: { recipientPhone: string, summary: string }
contactsRouter.post('/:id/escalate', async (req, res) => {
  const contactId = Number(req.params.id)
  const { recipientPhone, summary } = req.body
  if (!recipientPhone || !summary) return res.status(400).json({ error: 'recipientPhone and summary required' })

  const [contact] = db(req).select().from(schema.contacts)
    .where(eq(schema.contacts.id, contactId)).all()
  if (!contact) return res.status(404).json({ error: 'Contact not found' })

  if (!waMessenger.isConnected()) return res.status(503).json({ error: 'WA_DISCONNECTED' })

  const stageLabels: Record<string, string> = {
    new: '🆕 New',
    open_conversation: '💬 Open Conversation',
    waiting_for: '⏳ Waiting For',
    all_resolved: '✅ All Resolved'
  }

  const contactName = contact.name ?? contact.phone ?? 'Contacto desconocido'
  const lines = [
    `🔔 *Conversación escalada*`,
    ``,
    `*Contacto:* ${contactName}`,
    `*Etapa:* ${stageLabels[contact.stage] ?? contact.stage}`,
    contact.property ? `*Propiedad:* ${contact.property}` : null,
    ``,
    summary,
    ``,
    `_— Enviado desde WA Copilot_`
  ].filter(l => l !== null).join('\n')

  try {
    const jid = `${recipientPhone}@s.whatsapp.net`
    await waMessenger.send(jid, lines)
    res.json({ ok: true })
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? 'Send failed' })
  }
})

// POST /contacts/sync-wa-web — called by Chrome extension
// WA's generic placeholder names — treat these as "no name"
const WA_PLACEHOLDER_NAMES = new Set([
  'Contacto WA', 'WhatsApp Contact', 'WhatsApp-Kontakt',
  'Contact WhatsApp', 'Contatto WhatsApp', 'Contato WA',
])

// Body: [{ id: "JID", name?: string, phone?: string }]
contactsRouter.post('/sync-wa-web', (req, res) => {
  const d = db(req)
  const entries: { id: string; name?: string; phone?: string }[] = Array.isArray(req.body) ? req.body : []

  // Build lookup maps
  const nameByJid = new Map<string, string>()   // JID → display name
  const phoneByJid = new Map<string, string>()  // JID → resolved phone digits (for @lid)
  const nameByPhone = new Map<string, string>() // phone digits → name

  for (const e of entries) {
    if (!e.id) continue
    const hasRealName = e.name && !WA_PLACEHOLDER_NAMES.has(e.name)
    if (hasRealName) {
      nameByJid.set(e.id, e.name!)
    }
    if (e.phone) {
      const digits = e.phone.replace(/\D/g, '')
      if (digits.length >= 8) {
        // Store resolved phone for @lid contacts (even if no name)
        if (e.id.endsWith('@lid')) phoneByJid.set(e.id, digits)
        // Also allow name-by-phone matching for regular contacts
        if (hasRealName) {
          nameByPhone.set(digits, e.name!)
          nameByPhone.set(digits.slice(-10), e.name!)
        }
      }
    }
  }

  const contacts = d.select().from(schema.contacts).all()
  let updated = 0

  for (const contact of contacts) {
    const hasRealName = contact.name && !WA_PLACEHOLDER_NAMES.has(contact.name)
    const updates: Record<string, unknown> = {}

    // Update name if missing or placeholder
    if (!hasRealName) {
      const name = nameByJid.get(contact.whatsappId)
        ?? nameByPhone.get((contact.phone ?? '').replace(/\D/g, ''))
        ?? nameByPhone.get((contact.phone ?? '').replace(/\D/g, '').slice(-10))
      if (name) updates.name = name
    }

    // For @lid contacts: write the resolved real phone if we don't have one yet
    if (contact.whatsappId.endsWith('@lid') && !contact.phone) {
      const resolvedPhone = phoneByJid.get(contact.whatsappId)
      if (resolvedPhone) updates.phone = resolvedPhone
    }

    if (Object.keys(updates).length === 0) continue

    updates.updatedAt = new Date()
    d.update(schema.contacts)
      .set(updates as any)
      .where(eq(schema.contacts.id, contact.id))
      .run()
    updated++
  }

  // Tell the renderer to reload its contact list
  if (updated > 0) serverEvents.emit('contactsUpdated')

  res.json({ ok: true, updated, total: nameByJid.size })
})

// POST /contacts/:id/read — mark all messages as read, zero unread count
contactsRouter.post('/:id/read', (req, res) => {
  db(req)
    .update(schema.contacts)
    .set({ unreadCount: 0, updatedAt: new Date() })
    .where(eq(schema.contacts.id, Number(req.params.id)))
    .run()
  res.json({ ok: true })
})
