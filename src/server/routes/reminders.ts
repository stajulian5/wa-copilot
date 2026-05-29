import { Router } from 'express'
import { eq, and, lte } from 'drizzle-orm'
import * as schema from '../db/schema'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'

export const remindersRouter = Router()

const db = (req: any): BetterSQLite3Database<typeof schema> => req.db

// GET /reminders — all undone reminders
remindersRouter.get('/', (req, res) => {
  const rows = db(req)
    .select()
    .from(schema.reminders)
    .where(eq(schema.reminders.isDone, false))
    .all()
  res.json(rows)
})

// GET /reminders/due — reminders due now or earlier
remindersRouter.get('/due', (req, res) => {
  const rows = db(req)
    .select()
    .from(schema.reminders)
    .where(and(eq(schema.reminders.isDone, false), lte(schema.reminders.dueAt, new Date())))
    .all()
  res.json(rows)
})

// POST /reminders
remindersRouter.post('/', (req, res) => {
  const { contactId, dueAt, note } = req.body
  if (!contactId || !dueAt) return res.status(400).json({ error: 'contactId and dueAt required' })

  const result = db(req)
    .insert(schema.reminders)
    .values({ contactId: Number(contactId), dueAt: new Date(dueAt), note: note ?? null })
    .returning()
    .all()
  res.json(result[0])
})

// PATCH /reminders/:id/done
remindersRouter.patch('/:id/done', (req, res) => {
  db(req)
    .update(schema.reminders)
    .set({ isDone: true })
    .where(eq(schema.reminders.id, Number(req.params.id)))
    .run()
  res.json({ ok: true })
})

// DELETE /reminders/:id
remindersRouter.delete('/:id', (req, res) => {
  db(req)
    .delete(schema.reminders)
    .where(eq(schema.reminders.id, Number(req.params.id)))
    .run()
  res.json({ ok: true })
})
