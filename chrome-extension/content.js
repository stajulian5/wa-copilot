// Mica CRM — WhatsApp Web contact sync
// Reads from WA Web's IndexedDB and POSTs names/phones to the local CRM server.

function readStore(dbName, storeName) {
  return new Promise((resolve) => {
    const req = indexedDB.open(dbName)
    req.onerror = () => resolve([])   // soft-fail: missing DB is non-fatal
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

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
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
