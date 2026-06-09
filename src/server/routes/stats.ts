import { Router } from 'express'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from '../db/schema'

export const statsRouter = Router()

const db = (req: any): BetterSQLite3Database<typeof schema> => req.db

statsRouter.get('/', (req, res) => {
  const d = db(req) as any
  const now = Date.now()
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000

  const rows = d.all(`
    SELECT
      (SELECT COUNT(*) FROM contacts
       WHERE last_message_direction = 'in'
         AND unread_count > 0
         AND stage != 'all_resolved') AS unanswered,

      (SELECT COUNT(*) FROM contacts WHERE stage = 'open_conversation') AS open_conversations,

      (SELECT COUNT(*) FROM contacts WHERE stage = 'waiting_for') AS waiting_for,

      (SELECT COUNT(*) FROM contacts
       WHERE stage = 'all_resolved'
         AND stage_changed_at >= ${todayStart.getTime()}) AS resolved_today,

      (SELECT COUNT(*) FROM contacts
       WHERE created_at >= ${todayStart.getTime()}) AS new_today,

      (SELECT CAST(ROUND(AVG(gap), 0) AS INTEGER) FROM (
        SELECT (MIN(m_out.timestamp) - m_in.timestamp) / 60000.0 AS gap
        FROM messages m_in
        JOIN messages m_out ON (
          m_out.contact_id = m_in.contact_id
          AND m_out.direction = 'out'
          AND m_out.timestamp > m_in.timestamp
          AND m_out.timestamp < m_in.timestamp + 86400000
        )
        WHERE m_in.direction = 'in'
          AND m_in.timestamp >= ${weekAgo}
        GROUP BY m_in.id
        HAVING gap > 0
      )) AS avg_response_minutes,

      (SELECT CAST(ROUND((${now} - MIN(last_message_at)) / 60000.0, 0) AS INTEGER)
       FROM contacts
       WHERE last_message_direction = 'in'
         AND unread_count > 0
         AND stage != 'all_resolved') AS oldest_unanswered_minutes
  ` as any)

  res.json(rows[0] ?? {})
})
