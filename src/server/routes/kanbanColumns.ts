import { Router } from 'express'
import { eq, asc } from 'drizzle-orm'
import * as schema from '../db/schema'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'

export const kanbanColumnsRouter = Router()

const db = (req: any): BetterSQLite3Database<typeof schema> => req.db

// Slugify a label into a stable, unique `key`
function slugify(label: string): string {
  const base = label
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // strip accents
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return base || 'column'
}

// GET /kanban-columns — all columns ordered by sortOrder
kanbanColumnsRouter.get('/', (req, res) => {
  const rows = db(req)
    .select()
    .from(schema.kanbanColumns)
    .orderBy(asc(schema.kanbanColumns.sortOrder))
    .all()
  res.json(rows)
})

// POST /kanban-columns — create a new column
kanbanColumnsRouter.post('/', (req, res) => {
  const { label } = req.body
  if (!label || !String(label).trim()) return res.status(400).json({ error: 'label required' })

  const existing = db(req).select().from(schema.kanbanColumns).all()

  // Generate a unique key from the label
  let key = slugify(label)
  let suffix = 1
  const existingKeys = new Set(existing.map(c => c.key))
  let candidate = key
  while (existingKeys.has(candidate)) {
    suffix++
    candidate = `${key}_${suffix}`
  }
  key = candidate

  const maxOrder = existing.reduce((m, c) => Math.max(m, c.sortOrder), -1)

  const result = db(req)
    .insert(schema.kanbanColumns)
    .values({ key, label: String(label).trim(), sortOrder: maxOrder + 1 })
    .returning()
    .all()
  res.json(result[0])
})

// PATCH /kanban-columns/:id — rename and/or reorder a column
kanbanColumnsRouter.patch('/:id', (req, res) => {
  const id = Number(req.params.id)
  const { label, sortOrder } = req.body
  const patch: Partial<schema.InsertKanbanColumn> = {}
  if (label != null) {
    if (!String(label).trim()) return res.status(400).json({ error: 'label cannot be empty' })
    patch.label = String(label).trim()
  }
  if (sortOrder != null) patch.sortOrder = Number(sortOrder)
  if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'nothing to update' })

  const result = db(req)
    .update(schema.kanbanColumns)
    .set(patch)
    .where(eq(schema.kanbanColumns.id, id))
    .returning()
    .all()
  if (!result[0]) return res.status(404).json({ error: 'Column not found' })
  res.json(result[0])
})

// POST /kanban-columns/reorder — bulk-update sortOrder from an ordered array of ids
kanbanColumnsRouter.post('/reorder', (req, res) => {
  const { order } = req.body as { order: number[] }
  if (!Array.isArray(order)) return res.status(400).json({ error: 'order must be an array of column ids' })

  const database = db(req)
  order.forEach((id, idx) => {
    database.update(schema.kanbanColumns)
      .set({ sortOrder: idx })
      .where(eq(schema.kanbanColumns.id, Number(id)))
      .run()
  })

  const rows = database.select().from(schema.kanbanColumns).orderBy(asc(schema.kanbanColumns.sortOrder)).all()
  res.json(rows)
})

// DELETE /kanban-columns/:id — only allowed if no contacts are in this column
kanbanColumnsRouter.delete('/:id', (req, res) => {
  const id = Number(req.params.id)
  const [column] = db(req).select().from(schema.kanbanColumns).where(eq(schema.kanbanColumns.id, id)).all()
  if (!column) return res.status(404).json({ error: 'Column not found' })

  const conversations = db(req)
    .select()
    .from(schema.contacts)
    .where(eq(schema.contacts.stage, column.key))
    .all()

  if (conversations.length > 0) {
    return res.status(409).json({
      error: 'COLUMN_NOT_EMPTY',
      message: 'This column has to be emptied before it can be deleted.'
    })
  }

  db(req).delete(schema.kanbanColumns).where(eq(schema.kanbanColumns.id, id)).run()
  res.json({ ok: true })
})
