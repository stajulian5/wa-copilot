import { Router } from 'express'
import { eq } from 'drizzle-orm'
import keytar from 'keytar'
import * as schema from '../db/schema'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { ipcMain } from 'electron'

export const settingsRouter = Router()

const db = (req: any): BetterSQLite3Database<typeof schema> => req.db

const KEYCHAIN_SERVICE = 'MicaCRM'
const KEYCHAIN_ACCOUNT = 'anthropic-api-key'

// IPC handlers for keychain (must be called from main process side)
ipcMain.handle('keychain:get', async () => {
  return keytar.getPassword(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT)
})
ipcMain.handle('keychain:set', async (_e, key: string) => {
  return keytar.setPassword(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT, key)
})
ipcMain.handle('keychain:delete', async () => {
  return keytar.deletePassword(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT)
})

// GET /settings
settingsRouter.get('/', (req, res) => {
  const rows = db(req).select().from(schema.settings).all()
  const map: Record<string, string> = {}
  for (const row of rows) map[row.key] = row.value
  res.json(map)
})

// PUT /settings/:key
settingsRouter.put('/:key', (req, res) => {
  const { key } = req.params
  const { value } = req.body
  if (value === undefined) return res.status(400).json({ error: 'value required' })

  db(req)
    .insert(schema.settings)
    .values({ key, value: String(value) })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value: String(value) } })
    .run()

  res.json({ key, value })
})

// GET /settings/templates
settingsRouter.get('/templates', (req, res) => {
  const rows = db(req).select().from(schema.templates).all()
  res.json(rows)
})

// POST /settings/templates
settingsRouter.post('/templates', (req, res) => {
  const { title, body } = req.body
  if (!title || !body) return res.status(400).json({ error: 'title and body required' })
  const result = db(req)
    .insert(schema.templates)
    .values({ title, body })
    .returning()
    .all()
  res.json(result[0])
})

// DELETE /settings/templates/:id
settingsRouter.delete('/templates/:id', (req, res) => {
  db(req)
    .delete(schema.templates)
    .where(eq(schema.templates.id, Number(req.params.id)))
    .run()
  res.json({ ok: true })
})
