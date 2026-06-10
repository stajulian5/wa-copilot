import express from 'express'
import { createServer } from 'http'
import { ipcMain } from 'electron'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from './db/schema'
import { contactsRouter } from './routes/contacts'
import { messagesRouter } from './routes/messages'
import { aiRouter } from './routes/ai'
import { sheetsRouter } from './routes/sheets'
import { settingsRouter } from './routes/settings'
import { remindersRouter } from './routes/reminders'
import { googleContactsRouter } from './routes/googleContacts'
import { statsRouter } from './routes/stats'
import { kanbanColumnsRouter } from './routes/kanbanColumns'

import { EventEmitter } from 'events'
export const serverEvents = new EventEmitter()

export async function startServer(db: BetterSQLite3Database<typeof schema>, userDataPath: string): Promise<number> {
  const app = express()
  app.use(express.json({ limit: '10mb' }))
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

  // Serve locally-cached profile pictures
  app.get('/avatars/:contactId', (req, res) => {
    const file = join(userDataPath, 'avatars', `${req.params.contactId}.jpg`)
    if (existsSync(file)) {
      res.setHeader('Content-Type', 'image/jpeg')
      res.setHeader('Cache-Control', 'public, max-age=86400')
      res.end(readFileSync(file))
    } else {
      res.status(404).end()
    }
  })

  // Extension heartbeat — Chrome extension POSTs here on every auto-sync cycle
  // Sync interval: 2 minutes. Grace window: 10 seconds.
  // GET /status returns three-state health so the NavBar can show green/amber/gray.
  const EXT_SYNC_INTERVAL_MS = 2 * 60 * 1000        // expected ping every 2 min
  const EXT_GRACE_MS         = 10 * 1000             // 10 s grace = alert at 2m10s
  const EXT_TIMEOUT_MS       = EXT_SYNC_INTERVAL_MS + EXT_GRACE_MS

  let lastExtensionPing = 0
  app.post('/extension/ping', (_req, res) => {
    lastExtensionPing = Date.now()
    res.json({ ok: true })
  })
  app.get('/status', (_req, res) => {
    const now = Date.now()
    const elapsed = lastExtensionPing ? now - lastExtensionPing : null

    // 'green'  — seen within the expected sync window (≤ 2m10s)
    // 'amber'  — missed one cycle but seen recently (≤ 5 min)
    // 'gray'   — never seen, or timed out (> 5 min)
    let extStatus: 'green' | 'amber' | 'gray' = 'gray'
    if (elapsed !== null) {
      if (elapsed <= EXT_TIMEOUT_MS)       extStatus = 'green'
      else if (elapsed <= 5 * 60 * 1000)  extStatus = 'amber'
    }

    res.json({
      extensionStatus:  extStatus,
      extensionLastSeen: lastExtensionPing || null,
      extensionElapsedMs: elapsed
    })
  })

  app.use('/contacts', contactsRouter)
  app.use('/messages', messagesRouter)
  app.use('/ai', aiRouter)
  app.use('/sheets', sheetsRouter)
  app.use('/settings', settingsRouter)
  app.use('/reminders', remindersRouter)
  app.use('/', googleContactsRouter)
  app.use('/stats', statsRouter)
  app.use('/kanban-columns', kanbanColumnsRouter)

  const server = createServer(app)

  // Use fixed port 3847 so the Chrome extension can always find the server.
  // Falls back to a random port if 3847 is already in use.
  return new Promise((resolve) => {
    const attemptListen = (port: number) => {
      server.once('error', (err: any) => {
        if (err.code === 'EADDRINUSE' && port === 3847) {
          attemptListen(0)  // retry on random port
        }
      })
      server.listen(port, '127.0.0.1', () => {
        const actualPort = (server.address() as any).port as number
        ipcMain.handle('server:port', () => actualPort)
        resolve(actualPort)
      })
    }
    attemptListen(3847)
  })
}
