import { Router } from 'express'
import { google } from 'googleapis'
import { eq } from 'drizzle-orm'
import { readFileSync } from 'fs'
import * as schema from '../db/schema'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'

export const sheetsRouter = Router()

const db = (req: any): BetterSQLite3Database<typeof schema> => req.db

function getSetting(db: BetterSQLite3Database<typeof schema>, key: string): string | undefined {
  return db.select().from(schema.settings).where(eq(schema.settings.key, key)).all()[0]?.value
}

// POST /sheets/sync — reads Atlas sheet and updates contacts
sheetsRouter.post('/sync', async (req, res) => {
  const d = db(req)
  const serviceAccountPath = getSetting(d, 'sheets_service_account_path')
  const sheetUrl = getSetting(d, 'sheets_url')
  const tabName = getSetting(d, 'sheets_tab')
  const headerRow = Number(getSetting(d, 'sheets_header_row') ?? '1')

  // Column indices (0-based) from settings
  const colPhone = Number(getSetting(d, 'col_phone') ?? '0')
  const colName = Number(getSetting(d, 'col_name') ?? '1')
  const colKyc = Number(getSetting(d, 'col_kyc') ?? '2')
  const colContract = Number(getSetting(d, 'col_contract') ?? '3')
  const colBroker = Number(getSetting(d, 'col_broker') ?? '4')
  const colOpsH = Number(getSetting(d, 'col_ops_historicas') ?? '5')
  const colRentsH = Number(getSetting(d, 'col_rents_historicas') ?? '6')
  const colOpsA = Number(getSetting(d, 'col_ops_activas') ?? '7')
  const colRents3m = Number(getSetting(d, 'col_rents_3m') ?? '8')
  const colActivity = Number(getSetting(d, 'col_latest_activity') ?? '9')

  if (!serviceAccountPath || !sheetUrl) {
    return res.status(400).json({ error: 'Google Sheets not configured' })
  }

  // Extract spreadsheet ID from URL
  const match = sheetUrl.match(/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)
  if (!match) return res.status(400).json({ error: 'Invalid sheet URL' })
  const spreadsheetId = match[1]

  try {
    const keyFile = JSON.parse(readFileSync(serviceAccountPath, 'utf-8'))
    const auth = new google.auth.GoogleAuth({
      credentials: keyFile,
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
    })

    const sheets = google.sheets({ version: 'v4', auth })
    const range = tabName ? `${tabName}!A:Z` : 'A:Z'
    const response = await sheets.spreadsheets.values.get({ spreadsheetId, range })
    const rows = response.data.values ?? []

    // Skip header rows
    const dataRows = rows.slice(headerRow)
    let updated = 0

    for (const row of dataRows) {
      const rawPhone = String(row[colPhone] ?? '').replace(/\D/g, '')
      if (!rawPhone) continue

      // Try to match contact by phone suffix (last 10 digits)
      const phoneSuffix = rawPhone.slice(-10)
      const contacts = d.select().from(schema.contacts).all()
      const contact = contacts.find((c) => c.phone.replace(/\D/g, '').endsWith(phoneSuffix))
      if (!contact) continue

      d.update(schema.contacts)
        .set({
          sheetName: String(row[colName] ?? '') || undefined,
          kycStatus: String(row[colKyc] ?? '') || undefined,
          contractStatus: String(row[colContract] ?? '') || undefined,
          brokerStatus: String(row[colBroker] ?? '') || undefined,
          opsHistoricas: String(row[colOpsH] ?? '') || undefined,
          rentsHistoricas: String(row[colRentsH] ?? '') || undefined,
          opsActivas: String(row[colOpsA] ?? '') || undefined,
          rents3m: String(row[colRents3m] ?? '') || undefined,
          latestActivityType: String(row[colActivity] ?? '') || undefined,
          updatedAt: new Date()
        })
        .where(eq(schema.contacts.id, contact.id))
        .run()

      updated++
    }

    // Save last sync time
    d.insert(schema.settings)
      .values({ key: 'sheets_last_sync', value: new Date().toISOString() })
      .onConflictDoUpdate({
        target: schema.settings.key,
        set: { value: new Date().toISOString() }
      })
      .run()

    res.json({ ok: true, updated, total: dataRows.length })
  } catch (err: any) {
    console.error('Sheets sync error:', err)
    res.status(500).json({ error: err.message ?? 'Sync failed' })
  }
})

// GET /sheets/status
sheetsRouter.get('/status', (req, res) => {
  const lastSync = getSetting(db(req), 'sheets_last_sync')
  res.json({ lastSync })
})
