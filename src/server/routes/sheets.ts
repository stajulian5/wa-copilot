import { Router } from 'express'
import { eq } from 'drizzle-orm'
import * as schema from '../db/schema'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'

export const sheetsRouter = Router()

const db = (req: any): BetterSQLite3Database<typeof schema> => req.db

function getSetting(db: BetterSQLite3Database<typeof schema>, key: string): string | undefined {
  return db.select().from(schema.settings).where(eq(schema.settings.key, key)).all()[0]?.value
}

// ── Minimal CSV parser (handles Google Sheets export format) ──────────────────
function parseCSV(text: string): string[][] {
  const rows: string[][] = []
  const lines = text.split(/\r?\n/)
  for (const line of lines) {
    if (!line.trim()) continue
    const cells: string[] = []
    let current = ''
    let inQuotes = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === '"' && inQuotes && line[i + 1] === '"') {
        current += '"'; i++           // escaped quote inside quoted field
      } else if (ch === '"') {
        inQuotes = !inQuotes           // toggle quoted-field mode
      } else if (ch === ',' && !inQuotes) {
        cells.push(current); current = ''
      } else {
        current += ch
      }
    }
    cells.push(current)
    rows.push(cells)
  }
  return rows
}

// POST /sheets/sync — reads Atlas sheet via CSV export and updates contacts
// No service account or API key required — sheet just needs to be shared
// as "Anyone with the link can view".
sheetsRouter.post('/sync', async (req, res) => {
  const d = db(req)
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

  if (!sheetUrl) {
    return res.status(400).json({ error: 'Falta la URL del spreadsheet en Configuración' })
  }

  // Extract spreadsheet ID from any Google Sheets URL format
  const match = sheetUrl.match(/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)
  if (!match) return res.status(400).json({ error: 'URL de Google Sheets inválida' })
  const spreadsheetId = match[1]

  // Build CSV export URL — works for sheets shared as "Anyone with the link"
  // gviz/tq endpoint returns CSV without requiring authentication
  const csvUrl = tabName
    ? `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tabName)}`
    : `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv`

  try {
    const response = await fetch(csvUrl)

    if (!response.ok || response.url.includes('accounts.google.com')) {
      return res.status(400).json({
        error: 'No se pudo acceder al spreadsheet. Asegúrate de que está compartido como "Cualquier persona con el enlace puede ver".'
      })
    }

    const text = await response.text()

    // Detect Google login redirect (sheet is private)
    if (text.includes('accounts.google.com') || text.startsWith('<!DOCTYPE')) {
      return res.status(400).json({
        error: 'El spreadsheet está privado. Cámbialo a "Cualquier persona con el enlace puede ver" en Google Sheets.'
      })
    }

    const rows = parseCSV(text)
    const dataRows = rows.slice(headerRow)  // skip header row(s)
    let updated = 0

    // Load all contacts once for matching
    const contacts = d.select().from(schema.contacts).all()

    for (const row of dataRows) {
      const rawPhone = String(row[colPhone] ?? '').replace(/\D/g, '')
      if (!rawPhone) continue

      // Match by last 10 digits of phone number
      const phoneSuffix = rawPhone.slice(-10)
      const contact = contacts.find(c => (c.phone ?? '').replace(/\D/g, '').endsWith(phoneSuffix))
      if (!contact) continue

      const sheetName = String(row[colName] ?? '').trim() || undefined

      d.update(schema.contacts)
        .set({
          // Use sheet name as the contact name when WA hasn't provided one
          ...(!contact.name && sheetName ? { name: sheetName } : {}),
          sheetName,
          kycStatus: String(row[colKyc] ?? '').trim() || undefined,
          contractStatus: String(row[colContract] ?? '').trim() || undefined,
          brokerStatus: String(row[colBroker] ?? '').trim() || undefined,
          opsHistoricas: String(row[colOpsH] ?? '').trim() || undefined,
          rentsHistoricas: String(row[colRentsH] ?? '').trim() || undefined,
          opsActivas: String(row[colOpsA] ?? '').trim() || undefined,
          rents3m: String(row[colRents3m] ?? '').trim() || undefined,
          latestActivityType: String(row[colActivity] ?? '').trim() || undefined,
          updatedAt: new Date()
        })
        .where(eq(schema.contacts.id, contact.id))
        .run()

      updated++
    }

    // Save last sync time
    d.insert(schema.settings)
      .values({ key: 'sheets_last_sync', value: new Date().toISOString() })
      .onConflictDoUpdate({ target: schema.settings.key, set: { value: new Date().toISOString() } })
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
