import express from 'express'
import { createServer } from 'http'
import { ipcMain } from 'electron'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from './db/schema'
import { contactsRouter } from './routes/contacts'
import { messagesRouter } from './routes/messages'
import { aiRouter } from './routes/ai'
import { sheetsRouter } from './routes/sheets'
import { settingsRouter } from './routes/settings'
import { remindersRouter } from './routes/reminders'

export async function startServer(db: BetterSQLite3Database<typeof schema>): Promise<number> {
  const app = express()
  app.use(express.json())
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    if (req.method === 'OPTIONS') { res.sendStatus(204); return }
    next()
  })

  // Attach db to all requests
  app.use((req, _res, next) => {
    ;(req as any).db = db
    next()
  })

  app.use('/contacts', contactsRouter)
  app.use('/messages', messagesRouter)
  app.use('/ai', aiRouter)
  app.use('/sheets', sheetsRouter)
  app.use('/settings', settingsRouter)
  app.use('/reminders', remindersRouter)

  const server = createServer(app)

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as any).port as number
      // Expose port to renderer via IPC
      ipcMain.handle('server:port', () => port)
      resolve(port)
    })
  })
}
