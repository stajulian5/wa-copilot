import { Router } from 'express'
import { eq, desc, like, or } from 'drizzle-orm'
import * as schema from '../db/schema'
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

// POST /contacts/:id/read — mark all messages as read, zero unread count
contactsRouter.post('/:id/read', (req, res) => {
  db(req)
    .update(schema.contacts)
    .set({ unreadCount: 0, updatedAt: new Date() })
    .where(eq(schema.contacts.id, Number(req.params.id)))
    .run()
  res.json({ ok: true })
})
