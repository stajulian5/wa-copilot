import { Router } from 'express'
import { eq, desc, lt, and } from 'drizzle-orm'
import * as schema from '../db/schema'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'

export const messagesRouter = Router()

const db = (req: any): BetterSQLite3Database<typeof schema> => req.db

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
