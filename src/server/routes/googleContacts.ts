import { Router } from 'express'
import { eq } from 'drizzle-orm'
import { OAuth2Client } from 'google-auth-library'
import { google } from 'googleapis'
import * as schema from '../db/schema'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { googleAuthEvents } from '../googleAuth'

export const googleContactsRouter = Router()

const db = (req: any): BetterSQLite3Database<typeof schema> => req.db

function getSetting(d: BetterSQLite3Database<typeof schema>, key: string): string | undefined {
  return d.select().from(schema.settings).where(eq(schema.settings.key, key)).all()[0]?.value
}

function saveSetting(d: BetterSQLite3Database<typeof schema>, key: string, value: string) {
  d.insert(schema.settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value } })
    .run()
}

function makeClient(clientId: string, clientSecret: string, port: number): OAuth2Client {
  return new OAuth2Client(clientId, clientSecret, `http://127.0.0.1:${port}/oauth/google/callback`)
}

// GET /oauth/google/start — returns the Google consent URL
googleContactsRouter.get('/oauth/google/start', (req, res) => {
  const d = db(req)
  const clientId = getSetting(d, 'google_client_id')
  const clientSecret = getSetting(d, 'google_client_secret')

  if (!clientId || !clientSecret) {
    return res.status(400).json({ error: 'Falta el Client ID o Client Secret de Google en Configuración' })
  }

  const port = (req.socket.localPort ?? 3847)
  const client = makeClient(clientId, clientSecret, port)

  const url = client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/contacts.readonly'],
    prompt: 'consent'   // force refresh_token even if already authorized
  })

  res.json({ url })
})

// GET /oauth/google/callback — Google redirects here after user authorizes
googleContactsRouter.get('/oauth/google/callback', async (req, res) => {
  const { code, error } = req.query
  const d = db(req)

  if (error) {
    return res.status(400).send(`<html><body style="font-family:sans-serif;text-align:center;padding:60px"><h2>❌ Acceso denegado</h2><p>Cerrá esta ventana e intentá de nuevo.</p></body></html>`)
  }

  const clientId = getSetting(d, 'google_client_id')
  const clientSecret = getSetting(d, 'google_client_secret')

  if (!code || !clientId || !clientSecret) {
    return res.status(400).send('Error: faltan credenciales')
  }

  const port = (req.socket.localPort ?? 3847)
  const client = makeClient(clientId, clientSecret, port)

  try {
    const { tokens } = await client.getToken(String(code))

    if (tokens.refresh_token) saveSetting(d, 'google_refresh_token', tokens.refresh_token)
    if (tokens.access_token) saveSetting(d, 'google_access_token', tokens.access_token)
    if (tokens.expiry_date) saveSetting(d, 'google_token_expiry', String(tokens.expiry_date))

    googleAuthEvents.emit('connected')

    res.send('<html><body style="font-family:sans-serif;text-align:center;padding:60px"><h2>✅ Google Contacts conectado</h2><p>Podés cerrar esta ventana y volver a la app.</p></body></html>')
  } catch (err: any) {
    console.error('[Google OAuth] token exchange failed:', err.message)
    res.status(500).send('<html><body style="font-family:sans-serif;text-align:center;padding:60px"><h2>❌ Error al autenticar</h2><p>' + err.message + '</p></body></html>')
  }
})

// GET /google-contacts/status
googleContactsRouter.get('/google-contacts/status', (req, res) => {
  const d = db(req)
  const connected = !!getSetting(d, 'google_refresh_token')
  const lastSync = getSetting(d, 'google_contacts_last_sync') ?? null
  res.json({ connected, lastSync })
})

// POST /google-contacts/sync — fetch all Google contacts, match by phone, fill missing names
googleContactsRouter.post('/google-contacts/sync', async (req, res) => {
  const d = db(req)
  const clientId = getSetting(d, 'google_client_id')
  const clientSecret = getSetting(d, 'google_client_secret')
  const refreshToken = getSetting(d, 'google_refresh_token')

  if (!refreshToken || !clientId || !clientSecret) {
    return res.status(400).json({ error: 'Google Contacts no está conectado' })
  }

  const port = (req.socket.localPort ?? 3847)
  const client = makeClient(clientId, clientSecret, port)
  client.setCredentials({ refresh_token: refreshToken })

  const people = google.people({ version: 'v1', auth: client })

  try {
    // Build phone → name map from all Google contacts (paginated)
    const phoneToName = new Map<string, string>()
    let pageToken: string | undefined

    do {
      const r = await people.people.connections.list({
        resourceName: 'people/me',
        pageSize: 1000,
        personFields: 'names,phoneNumbers',
        pageToken
      })

      for (const person of r.data.connections ?? []) {
        const name = person.names?.[0]?.displayName
        if (!name) continue
        for (const ph of person.phoneNumbers ?? []) {
          const digits = (ph.value ?? '').replace(/\D/g, '')
          if (digits.length >= 8) {
            phoneToName.set(digits, name)
            // Also index by last 10 digits for country-code-agnostic matching
            if (digits.length > 10) phoneToName.set(digits.slice(-10), name)
          }
        }
      }

      pageToken = r.data.nextPageToken ?? undefined
    } while (pageToken)

    // Match contacts that have no name yet
    const contacts = d.select().from(schema.contacts).all()
    let updated = 0

    for (const contact of contacts) {
      if (contact.name) continue   // WA already provided a name
      const digits = (contact.phone ?? '').replace(/\D/g, '')
      if (!digits) continue

      const name = phoneToName.get(digits) ?? phoneToName.get(digits.slice(-10))
      if (!name) continue

      d.update(schema.contacts)
        .set({ name, updatedAt: new Date() })
        .where(eq(schema.contacts.id, contact.id))
        .run()
      updated++
    }

    saveSetting(d, 'google_contacts_last_sync', new Date().toISOString())
    res.json({ ok: true, updated, total: contacts.length, googleContacts: phoneToName.size })
  } catch (err: any) {
    console.error('[Google Contacts] sync error:', err.message)
    res.status(500).json({ error: err.message ?? 'Sync failed' })
  }
})

// DELETE /google-contacts/disconnect
googleContactsRouter.delete('/google-contacts/disconnect', (req, res) => {
  const d = db(req)
  for (const key of ['google_refresh_token', 'google_access_token', 'google_token_expiry', 'google_contacts_last_sync']) {
    d.delete(schema.settings).where(eq(schema.settings.key, key)).run()
  }
  res.json({ ok: true })
})
