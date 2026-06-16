// Mica CRM — WhatsApp Web contact sync
// Reads from WA Web's IndexedDB and POSTs names/phones to the local CRM server.

// Generic full-store read (used for contacts — small dataset, getAll is fine)
function readStore(dbName, storeName) {
  return new Promise((resolve) => {
    const req = indexedDB.open(dbName)
    req.onerror = () => resolve([])
    req.onsuccess = (e) => {
      const db = e.target.result
      if (!db.objectStoreNames.contains(storeName)) { db.close(); resolve([]); return }
      const tx = db.transaction(storeName, 'readonly')
      const getAll = tx.objectStore(storeName).getAll()
      getAll.onsuccess = () => { db.close(); resolve(getAll.result) }
      getAll.onerror = () => { db.close(); resolve([]) }
    }
  })
}

// Normalise a phone string to digits only
function digitsOnly(s) { return s ? String(s).replace(/\D/g, '') : null }

// Index an array of entries with both "12345" and "12345@lid" as keys
function buildLidMap(entries, keyFields, valueField) {
  const map = {}
  for (const entry of entries) {
    let lid = null
    for (const f of keyFields) { if (entry[f]) { lid = String(entry[f]); break } }
    let val = null
    for (const f of valueField) { if (entry[f]) { val = entry[f]; break } }
    if (!lid || !val) continue
    const bare = lid.replace('@lid', '')
    map[bare] = val
    map[bare + '@lid'] = val
  }
  return map
}

async function readWAContacts() {
  const [contacts, lidNames, lidPns] = await Promise.all([
    readStore('model-storage', 'contact'),
    readStore('model-storage', 'lid-display-name-mapping'),
    readStore('model-storage', 'lid-pn-mapping'),
  ])

  if (contacts.length === 0) {
    throw new Error('Store "contact" vacío — ¿está WhatsApp Web cargado y logueado?')
  }

  return { contacts, lidNames, lidPns }
}

// ── Message sync: read from WA Web's IndexedDB ───────────────────────────────
// WhatsApp Web caches messages in 'model-storage' → 'messages' store.
// We read the last 72 hours and POST to WA Copilot for deduplication & storage.

// How far back to look for messages.
// Background auto-sync (every 2 min): only needs a short window to catch stragglers.
// Manual / first-run sync: wider window to recover more history.
const LOOKBACK_BACKGROUND_DAYS = 7    // 7 days for routine background syncs
const LOOKBACK_MANUAL_DAYS     = 30   // 30 days when triggered from popup / force sync

async function readWAMessages(lookbackDays = LOOKBACK_BACKGROUND_DAYS) {
  const sinceSeconds = Math.floor((Date.now() - lookbackDays * 24 * 60 * 60 * 1000) / 1000)

  // WA Web may use different store names across versions — try all known ones.
  // getAll() loads the full store, then we filter by timestamp in JS.
  let rows = []
  for (const store of ['messages', 'msg', 'message']) {
    const all = await readStore('model-storage', store)
    if (all.length > 0) {
      rows = all.filter(m => (m.t ?? m.timestamp ?? m.msgTimestamp ?? 0) >= sinceSeconds)
      if (rows.length > 0) break
    }
  }

  return rows.map(m => {
    const id = m.id?._serialized ?? m.id ?? m.key?.id ?? null
    const jid = m.id?.remote ?? m.chatId ?? m.key?.remoteJid ?? null
    if (!id || !jid) return null

    const ts = (m.t ?? m.timestamp ?? m.msgTimestamp ?? 0) * 1000
    const body = m.body ?? m.caption ?? m.text ?? null
    const fromMe = m.id?.fromMe ?? m.fromMe ?? false
    const type = m.type ?? 'chat'
    const isGroup = jid.endsWith('@g.us')
    const pushName = m.notifyName ?? m.pushName ?? m.senderName ?? null

    if (['protocol', 'notification', 'notification_template', 'e2e_notification',
         'gp2', 'broadcast', 'call_log'].includes(type)) return null

    return { id, jid, body, timestamp: ts, fromMe, type, pushName, isGroup }
  }).filter(Boolean)
}

// lookbackDays: pass LOOKBACK_BACKGROUND_DAYS for routine sync,
//               LOOKBACK_MANUAL_DAYS for popup / force sync
async function postMessagesToServer(port, lookbackDays = LOOKBACK_BACKGROUND_DAYS) {
  try {
    const messages = await readWAMessages(lookbackDays)
    if (messages.length === 0) return { synced: 0 }

    const res = await fetch(`http://127.0.0.1:${port}/messages/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(messages)
    })
    const data = await res.json()
    console.log(`[WA Copilot] message sync (${lookbackDays}d): ${data.saved} new, ${data.skipped} already known`)
    return { synced: data.saved }
  } catch (err) {
    console.warn('[WA Copilot] message sync failed:', err.message)
    return { synced: 0 }
  }
}

// ── Contact sync: build payload and POST to server ───────────────────────────
async function postContactsToServer(port) {
  try {
    const { contacts, lidNames, lidPns } = await readWAContacts()

    const lidNameMap = buildLidMap(lidNames, ['lid','id','key'], ['displayName','name','pushName','notify'])
    const lidPhoneMap = buildLidMap(lidPns,   ['lid','id','key'], ['pn','phone','phoneNumber','number'])
    const WA_PLACEHOLDERS = new Set([
      'Contacto WA','WhatsApp Contact','WhatsApp-Kontakt',
      'Contact WhatsApp','Contatto WhatsApp','Contato WA',
    ])

    const payload = []
    for (const c of contacts) {
      const id = c.id ?? c.__x_id ?? null
      if (!id) continue
      const isLid = id.endsWith('@lid')
      const lidNum = isLid ? id.replace('@lid', '') : null

      let name = null
      for (const f of ['name','notify','pushname','pushName','verifiedName','shortName','short']) {
        if (c[f] && !WA_PLACEHOLDERS.has(c[f])) { name = c[f]; break }
      }
      if (!name && isLid) name = lidNameMap[id] ?? lidNameMap[lidNum] ?? null

      let resolvedPhone = null
      if (isLid) {
        const direct = c.pn ?? c.phone ?? c.phoneNumber ?? c.number ?? null
        const d = digitsOnly(direct)
        if (d && d.length >= 8 && d.length <= 15) resolvedPhone = d
        if (!resolvedPhone) {
          const mapped = lidPhoneMap[id] ?? lidPhoneMap[lidNum] ?? null
          const m = digitsOnly(mapped)
          if (m && m.length >= 8 && m.length <= 15) resolvedPhone = m
        }
      }

      if (!name && !resolvedPhone) continue
      const entry = { id }
      if (name) entry.name = name
      if (resolvedPhone) entry.phone = resolvedPhone
      payload.push(entry)
    }

    if (payload.length === 0) return

    const res = await fetch(`http://127.0.0.1:${port}/contacts/sync-wa-web`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
    const data = await res.json()
    console.log(`[WA Copilot] contact sync: ${data.updated ?? 0} updated`)
  } catch (err) {
    console.warn('[WA Copilot] contact sync failed:', err.message)
  }
}

// ── Background auto-sync every 2 minutes ─────────────────────────────────────
// Runs silently while WhatsApp Web tab is open. Ensures any message that
// Baileys missed (zombie gap, offline batch overflow) gets captured via
// this backup channel.
let _syncPort = 3847
let _syncInterval = null

async function findCopilotPort() {
  for (const port of [3847, 3848, 3849, 3850]) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/status`)
      if (r.ok) { _syncPort = port; return port }
    } catch {}
  }
  return null
}

async function runBackgroundSync() {
  const port = await findCopilotPort()
  if (!port) return   // WA Copilot not running — skip silently
  fetch(`http://127.0.0.1:${port}/extension/ping`, { method: 'POST' }).catch(() => {})
  await postContactsToServer(port)
  await postMessagesToServer(port)
}

// Start background sync
findCopilotPort().then(port => {
  if (!port) return
  runBackgroundSync()
  _syncInterval = setInterval(runBackgroundSync, 2 * 60 * 1000)  // every 2 min
})

// ── Message listener from popup ───────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === 'fullSync') {
    ;(async () => {
      const port = await findCopilotPort()
      if (!port) { sendResponse({ ok: false, message: 'WA Copilot no está abierto.' }); return }
      await postContactsToServer(port)
      const { synced } = await postMessagesToServer(port, LOOKBACK_MANUAL_DAYS)
      // Re-read updated count from last contact sync (best-effort)
      sendResponse({ ok: true, contacts: '✓', messages: synced })
    })()
    return true
  }

  if (msg.action === 'syncMessages') {
    // Popup-triggered sync uses the wider 30-day window for deeper recovery
    ;(async () => {
      const port = await findCopilotPort()
      if (!port) { sendResponse({ ok: false, message: 'WA Copilot not running' }); return }
      const result = await postMessagesToServer(port, LOOKBACK_MANUAL_DAYS)
      sendResponse({ ok: true, synced: result.synced })
    })()
    return true
  }

  if (msg.action !== 'sync') return

  ;(async () => {
    try {
      const { contacts, lidNames, lidPns } = await readWAContacts()

      // Debug: log a sample lid-pn-mapping entry so we can see the real structure
      if (lidPns.length > 0) {
        console.log('[MicaCRM] lid-pn-mapping sample:', JSON.stringify(lidPns[0]))
      } else {
        console.log('[MicaCRM] lid-pn-mapping is EMPTY or missing')
      }
      if (lidNames.length > 0) {
        console.log('[MicaCRM] lid-display-name-mapping sample:', JSON.stringify(lidNames[0]))
      }

      // Build LID → display name map (tries all likely key/value field names)
      const lidNameMap = buildLidMap(
        lidNames,
        ['lid', 'id', 'key'],
        ['displayName', 'name', 'pushName', 'notify']
      )

      // Build LID → phone map (tries all likely key/value field names)
      const lidPhoneMap = buildLidMap(
        lidPns,
        ['lid', 'id', 'key'],
        ['pn', 'phone', 'phoneNumber', 'number']
      )

      // WA's own placeholder names for unsaved contacts — not real names
      const WA_PLACEHOLDERS = new Set([
        'Contacto WA', 'WhatsApp Contact', 'WhatsApp-Kontakt',
        'Contact WhatsApp', 'Contatto WhatsApp', 'Contato WA',
      ])

      // Debug: log a sample @lid contact to see all its fields
      const sampleLid = contacts.find(c => (c.id ?? c.__x_id ?? '').endsWith('@lid'))
      if (sampleLid) {
        console.log('[MicaCRM] sample @lid contact entry:', JSON.stringify(sampleLid))
      }

      const payload = []
      for (const c of contacts) {
        const id = c.id ?? c.__x_id ?? null
        if (!id) continue
        const isLid = id.endsWith('@lid')
        const lidNum = isLid ? id.replace('@lid', '') : null

        // ── Name resolution ───────────────────────────────────────────────────
        let name = null
        // 1. Phone-book name, WA push name, verified business name
        // Note: WA Web uses 'pushname' (lowercase n), 'shortName', 'notify'
        for (const f of ['name', 'notify', 'pushname', 'pushName', 'verifiedName', 'shortName', 'short']) {
          if (c[f] && !WA_PLACEHOLDERS.has(c[f])) { name = c[f]; break }
        }
        // 2. lid-display-name-mapping
        if (!name && isLid) {
          name = lidNameMap[id] ?? lidNameMap[lidNum] ?? null
        }

        // ── Phone resolution ──────────────────────────────────────────────────
        let resolvedPhone = null
        if (isLid) {
          // 1. pn field directly on the contact entry (WA Web often stores it here)
          const directPn = c.pn ?? c.phone ?? c.phoneNumber ?? c.number ?? null
          const directDigits = digitsOnly(directPn)
          if (directDigits && directDigits.length >= 8 && directDigits.length <= 15) {
            resolvedPhone = directDigits
          }
          // 2. lid-pn-mapping store
          if (!resolvedPhone) {
            const mapped = lidPhoneMap[id] ?? lidPhoneMap[lidNum] ?? null
            const mappedDigits = digitsOnly(mapped)
            if (mappedDigits && mappedDigits.length >= 8 && mappedDigits.length <= 15) {
              resolvedPhone = mappedDigits
            }
          }
        }

        // Skip if we have neither a name nor a resolved phone
        if (!name && !resolvedPhone) continue

        const entry = { id }
        if (name) entry.name = name
        if (resolvedPhone) entry.phone = resolvedPhone
        payload.push(entry)
      }

      if (payload.length === 0) {
        sendResponse({ ok: false, message: 'No se encontraron contactos con nombre o teléfono.' })
        return
      }

      console.log(`[MicaCRM] payload: ${payload.length} entries, ` +
        `${payload.filter(e => e.phone).length} with resolved phone`)

      sendResponse({ ok: true, payload })
    } catch (err) {
      sendResponse({ ok: false, message: err.message })
    }
  })()

  return true // keep channel open for async response
})
