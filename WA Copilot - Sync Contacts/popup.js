const btn = document.getElementById('btn')
const status = document.getElementById('status')

// ── Contact reading logic ─────────────────────────────────────────────────────
// Injected directly into the WhatsApp Web tab via executeScript.
// Must be fully self-contained — no references to outer variables.
async function readWAContactsForCRM() {
  function readStore(dbName, storeName) {
    return new Promise((resolve) => {
      const req = indexedDB.open(dbName)
      req.onerror = () => resolve([])
      req.onsuccess = (e) => {
        const db = e.target.result
        if (!db.objectStoreNames.contains(storeName)) { db.close(); resolve([]); return }
        const tx = db.transaction(storeName, 'readonly')
        const all = tx.objectStore(storeName).getAll()
        all.onsuccess = () => { db.close(); resolve(all.result) }
        all.onerror  = () => { db.close(); resolve([]) }
      }
    })
  }

  function digitsOnly(s) { return s ? String(s).replace(/\D/g, '') : null }

  function buildLidMap(entries, keyFields, valueFields) {
    const map = {}
    for (const entry of entries) {
      let lid = null
      for (const f of keyFields) { if (entry[f]) { lid = String(entry[f]); break } }
      let val = null
      for (const f of valueFields) { if (entry[f]) { val = entry[f]; break } }
      if (!lid || !val) continue
      const bare = lid.replace(/@lid$/, '')
      map[bare] = val
      map[bare + '@lid'] = val
    }
    return map
  }

  const [contacts, lidNames, lidPns] = await Promise.all([
    readStore('model-storage', 'contact'),
    readStore('model-storage', 'lid-display-name-mapping'),
    readStore('model-storage', 'lid-pn-mapping'),
  ])

  if (contacts.length === 0) {
    return { ok: false, message: 'Store "contact" vacío — ¿está WhatsApp Web cargado y logueado?' }
  }

  const lidNameMap  = buildLidMap(lidNames, ['lid','id','key'], ['displayName','name','pushName','notify'])
  const lidPhoneMap = buildLidMap(lidPns,   ['lid','id','key'], ['pn','phone','phoneNumber','number'])

  const WA_PLACEHOLDERS = new Set([
    'Contacto WA','WhatsApp Contact','WhatsApp-Kontakt',
    'Contact WhatsApp','Contatto WhatsApp','Contato WA',
  ])

  const payload = []
  for (const c of contacts) {
    const id = c.id ?? c.__x_id ?? null
    if (!id) continue
    const isLid  = id.endsWith('@lid')
    const lidNum = isLid ? id.replace('@lid', '') : null

    // Name: phonebook name → WA push name → verified business name → lid mapping
    let name = null
    for (const f of ['name','notify','pushname','pushName','verifiedName','shortName','short']) {
      if (c[f] && !WA_PLACEHOLDERS.has(c[f])) { name = c[f]; break }
    }
    if (!name && isLid) {
      name = lidNameMap[id] ?? lidNameMap[lidNum] ?? null
    }

    // Phone: only for @lid contacts (regular contacts already have phone in JID)
    // 'phoneNumber' is stored as "521...@c.us" — digitsOnly strips the suffix
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
    if (name)          entry.name  = name
    if (resolvedPhone) entry.phone = resolvedPhone
    payload.push(entry)
  }

  return { ok: true, payload }
}

// ── Popup click handler ───────────────────────────────────────────────────────

btn.addEventListener('click', async () => {
  btn.disabled = true
  status.className = ''
  status.textContent = 'Buscando WhatsApp Web…'

  try {
    const [tab] = await chrome.tabs.query({ url: 'https://web.whatsapp.com/*' })

    if (!tab) {
      status.className = 'err'
      status.textContent = 'Abrí web.whatsapp.com en Chrome primero.'
      btn.disabled = false
      return
    }

    status.textContent = 'Leyendo contactos…'

    // Ask the content script (already injected into the WA Web tab) to read IndexedDB.
    // This avoids the executeScript host-permission requirement entirely.
    const result = await new Promise((resolve) => {
      chrome.tabs.sendMessage(tab.id, { action: 'sync' }, (res) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, message: 'Recargá WhatsApp Web e intentá de nuevo.' })
        } else {
          resolve(res ?? { ok: false, message: 'Sin respuesta del contenido.' })
        }
      })
    })

    if (!result) {
      status.className = 'err'
      status.textContent = 'Sin respuesta — recargá WhatsApp Web e intentá de nuevo.'
      btn.disabled = false
      return
    }

    if (!result.ok) {
      status.className = 'err'
      status.textContent = result.message
      btn.disabled = false
      return
    }

    status.textContent = `Enviando ${result.payload.length} contactos al CRM…`

    let serverRes
    try {
      serverRes = await fetch('http://127.0.0.1:3847/contacts/sync-wa-web', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(result.payload)
      })
    } catch (e) {
      status.className = 'err'
      status.textContent = 'No se pudo conectar con Mica CRM. ¿Está abierta la app?'
      btn.disabled = false
      return
    }

    const text = await serverRes.text()
    let data
    try { data = JSON.parse(text) } catch {
      status.className = 'err'
      status.textContent = `Error del servidor (${serverRes.status}): ${text.slice(0, 120)}`
      btn.disabled = false
      return
    }

    if (!data.ok) {
      status.className = 'err'
      status.textContent = `Error: ${data.error ?? 'desconocido'}`
      btn.disabled = false
      return
    }

    // Also sync messages in the background
    status.textContent = `✓ ${data.updated} contactos · sincronizando mensajes…`

    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      if (!tabs[0]?.id) return
      chrome.tabs.sendMessage(tabs[0].id, { action: 'syncMessages' }, (msgRes) => {
        if (chrome.runtime.lastError) return
        if (msgRes?.synced > 0) {
          status.textContent = `✓ ${data.updated} contactos · ${msgRes.synced} mensajes nuevos sincronizados`
        } else {
          status.textContent = `✓ ${data.updated} contactos actualizados · mensajes al día`
        }
      })
    })
  } catch (err) {
    status.className = 'err'
    status.textContent = err.message
  }

  btn.disabled = false
})

// Heartbeat — tell WA Copilot this extension is active
;(async function pingCopilot() {
  try {
    const ports = [3847, 3848, 3849]
    for (const port of ports) {
      try {
        await fetch(`http://127.0.0.1:${port}/extension/ping`, { method: 'POST' })
        break
      } catch {}
    }
  } catch {}
})()
