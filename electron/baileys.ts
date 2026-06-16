import {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  proto
} from '@whiskeysockets/baileys'
import { BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { rmSync, existsSync, mkdirSync, writeFileSync, unlinkSync } from 'fs'
import { eq, desc } from 'drizzle-orm'
import * as schema from '../src/server/db/schema'
import { userData } from './main'
import { waMessenger } from '../src/server/waMessenger'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'

// ── Per-account session state ─────────────────────────────────────────────────

interface BaileysSession {
  accountId: number
  authDir: string                                    // relative to userData
  sock: ReturnType<typeof makeWASocket> | null
  status: 'disconnected' | 'connecting' | 'connected'
  reconnectAttempts: number
  keepaliveTimer: ReturnType<typeof setInterval> | null
}

const sessions = new Map<number, BaileysSession>()
let activeAccountId = 1

// ── Helpers ───────────────────────────────────────────────────────────────────

function broadcastStatus(win: BrowserWindow) {
  const statuses: Record<number, string> = {}
  for (const [id, s] of sessions) statuses[id] = s.status
  win.webContents.send('wa:status', statuses[activeAccountId] ?? 'disconnected')
}

function broadcastAccounts(db: BetterSQLite3Database<typeof schema>, win: BrowserWindow) {
  const accts = db.select().from(schema.accounts).all()
  win.webContents.send('wa:accounts', accts)
}

// ── IPC setup (called once from startBaileys) ─────────────────────────────────

export function getWAStatus() {
  return sessions.get(activeAccountId)?.status ?? 'disconnected'
}

export async function startBaileys(
  db: BetterSQLite3Database<typeof schema>,
  win: BrowserWindow,
  _port: number
) {
  // ── Bootstrap accounts table ─────────────────────────────────────────────
  // If this is the first launch after the migration, seed account 1 from
  // the old single-account stored JID.
  const existingAccounts = db.select().from(schema.accounts).all()
  if (existingAccounts.length === 0) {
    const [storedJid] = db.select().from(schema.settings)
      .where(eq(schema.settings.key, 'linked_wa_jid')).all()
    db.insert(schema.accounts).values({
      id: 1,
      jid: storedJid?.value ?? null,
      label: 'Mi número',
      authDir: 'baileys_auth',
      isActive: true,
      createdAt: new Date()
    }).run()
  }

  // ── Startup: reconcile contacts table from messages table ─────────────────
  // The contacts.last_message_at / last_message / last_message_direction can
  // fall out of sync with the actual messages stored in the messages table
  // (e.g. when Copilot was offline/zombie, or during history-sync gaps).
  // Always re-derive these fields from the most recent message row.
  db.run(`
    UPDATE contacts
    SET
      last_message = (
        SELECT CASE
          WHEN m.body IS NOT NULL THEN m.body
          WHEN m.type = 'audio' THEN '🎤 Nota de voz'
          WHEN m.type = 'image' THEN '📷 Imagen'
          WHEN m.type = 'video' THEN '🎥 Video'
          WHEN m.type = 'document' THEN '📄 Documento'
          WHEN m.type = 'sticker' THEN '🎭 Sticker'
          WHEN m.type = 'location' THEN '📍 Ubicación'
          WHEN m.type = 'poll' THEN '📊 Encuesta'
          ELSE NULL
        END
        FROM messages m
        WHERE m.contact_id = contacts.id
        ORDER BY m.timestamp DESC
        LIMIT 1
      ),
      last_message_direction = (
        SELECT m.direction FROM messages m
        WHERE m.contact_id = contacts.id
        ORDER BY m.timestamp DESC LIMIT 1
      ),
      last_message_at = (
        SELECT m.timestamp FROM messages m
        WHERE m.contact_id = contacts.id
        ORDER BY m.timestamp DESC LIMIT 1
      )
    WHERE EXISTS (SELECT 1 FROM messages m WHERE m.contact_id = contacts.id)
  ` as any)

  // ── Startup: backfill lastMessageSenderName for group contacts ────────────
  // Resolves sender names from the messages table (populated after the senderJid
  // fix was deployed). Only updates groups that still have a NULL sender name.
  db.run(`
    UPDATE contacts
    SET last_message_sender_name = (
      SELECT COALESCE(m.sender_name,
        (SELECT c2.name FROM contacts c2 WHERE c2.whatsapp_id = m.sender_jid LIMIT 1)
      )
      FROM messages m
      WHERE m.contact_id = contacts.id
        AND (m.sender_name IS NOT NULL OR m.sender_jid IS NOT NULL)
      ORDER BY m.timestamp DESC
      LIMIT 1
    )
    WHERE is_group = 1
      AND last_message_direction = 'in'
      AND last_message_sender_name IS NULL
  ` as any)

  // ── Startup: reconcile unread_count from local message history ─────────────
  // WA doesn't reliably push read receipts, so counts drift over time.
  // Recalculate as: inbound messages since the last outbound message.
  // This is the best approximation we can make from local data alone.
  const recalc = db.run(`
    UPDATE contacts
    SET
      unread_count = (
        SELECT COUNT(*) FROM messages m
        WHERE m.contact_id = contacts.id
          AND m.direction = 'in'
          AND m.timestamp > COALESCE(
            (SELECT MAX(m2.timestamp) FROM messages m2
             WHERE m2.contact_id = contacts.id AND m2.direction = 'out'),
            0
          )
      ),
      updated_at = ${Date.now()}
  ` as any)
  console.log(`[baileys] recalculated unread counts for ${(recalc as any).changes} contacts`)

  // ── Startup: re-open resolved contacts that have unread inbound messages ───
  // After reconciling last_message_at / last_message_direction above, any
  // resolved contact whose most-recent message is inbound and unread should
  // be moved to 'new' — it is NOT resolved if the broker is still waiting.
  // Cutoff: 30 days (avoids resurrecting ancient resolved conversations).
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000
  const reopened = db.run(`
    UPDATE contacts
    SET stage = 'new', stage_changed_at = ${Date.now()}, updated_at = ${Date.now()}
    WHERE stage = 'all_resolved'
      AND unread_count > 0
      AND last_message_direction = 'in'
      AND last_message_at > ${cutoff}
  ` as any)
  if ((reopened as any).changes > 0) {
    console.log(`[baileys] re-opened ${(reopened as any).changes} resolved contacts with unread inbound messages`)
  }

  // ── IPC handlers ─────────────────────────────────────────────────────────

  ipcMain.handle('wa:getStatus', () => getWAStatus())

  ipcMain.handle('wa:getAccounts', () => db.select().from(schema.accounts).all())

  ipcMain.handle('wa:getActiveAccountId', () => activeAccountId)

  ipcMain.handle('wa:switchAccount', (_e, accountId: number) => {
    activeAccountId = accountId
    waMessenger.setActiveAccountId(accountId)
    broadcastStatus(win)
    win.webContents.send('wa:activeAccount', accountId)
  })

  ipcMain.handle('wa:updateAccountLabel', (_e, accountId: number, label: string) => {
    db.update(schema.accounts)
      .set({ label })
      .where(eq(schema.accounts.id, accountId))
      .run()
    broadcastAccounts(db, win)
  })

  ipcMain.handle('wa:addAccount', async () => {
    // Find next available auth dir index
    const allAccounts = db.select().from(schema.accounts).all()
    const nextId = Math.max(0, ...allAccounts.map(a => a.id)) + 1
    const authDir = `baileys_auth_${nextId}`

    const [newAccount] = db.insert(schema.accounts).values({
      jid: null,
      label: `Número ${nextId}`,
      authDir,
      isActive: false,
      createdAt: new Date()
    }).returning().all()

    broadcastAccounts(db, win)

    // Start the session — will emit wa:qr for this accountId
    const session: BaileysSession = {
      accountId: newAccount.id,
      authDir,
      sock: null,
      status: 'disconnected',
      reconnectAttempts: 0,
      keepaliveTimer: null
    }
    sessions.set(newAccount.id, session)
    connectSession(session, db, win)

    return newAccount.id
  })

  ipcMain.handle('wa:removeAccount', async (_e, accountId: number) => {
    const session = sessions.get(accountId)
    if (session) {
      if (session.keepaliveTimer) { clearInterval(session.keepaliveTimer); session.keepaliveTimer = null }
      try { session.sock?.end(undefined) } catch {}
      waMessenger.remove(accountId)
      sessions.delete(accountId)
    }
    // Delete auth dir
    const [account] = db.select().from(schema.accounts)
      .where(eq(schema.accounts.id, accountId)).all()
    if (account) {
      try { rmSync(join(userData, account.authDir), { recursive: true, force: true }) } catch {}
    }
    // Delete account data (FK cascade order)
    const contactIds = db.select({ id: schema.contacts.id }).from(schema.contacts)
      .where(eq(schema.contacts.accountId, accountId)).all().map(c => c.id)
    for (const cid of contactIds) {
      db.delete(schema.reminders).where(eq(schema.reminders.contactId, cid)).run()
      db.delete(schema.messages).where(eq(schema.messages.contactId, cid)).run()
    }
    db.delete(schema.contacts).where(eq(schema.contacts.accountId, accountId)).run()
    db.delete(schema.accounts).where(eq(schema.accounts.id, accountId)).run()
    // Clean avatars for this account's contacts
    // (avatar files are named by contact.id — they'll be orphaned but harmless)
    broadcastAccounts(db, win)
    // Switch to first remaining account if we removed the active one
    if (activeAccountId === accountId) {
      const remaining = db.select().from(schema.accounts).all()
      if (remaining.length > 0) {
        activeAccountId = remaining[0].id
        waMessenger.setActiveAccountId(activeAccountId)
        win.webContents.send('wa:activeAccount', activeAccountId)
      }
    }
    broadcastStatus(win)
    win.webContents.send('wa:historySynced', null)
  })

  ipcMain.handle('wa:resetAuth', async () => {
    const session = sessions.get(activeAccountId)
    if (session) {
      try { session.sock?.end(undefined) } catch {}
      session.sock = null
      session.reconnectAttempts = 0
      session.status = 'disconnected'
    }
    broadcastStatus(win)
    const [account] = db.select().from(schema.accounts)
      .where(eq(schema.accounts.id, activeAccountId)).all()
    if (account) {
      try { rmSync(join(userData, account.authDir), { recursive: true, force: true }) } catch {}
    }
    setTimeout(() => {
      const s = sessions.get(activeAccountId)
      if (s) connectSession(s, db, win)
    }, 500)
  })

  ipcMain.handle('wa:sendMessage', async (_e, jid: string, text: string) => {
    const session = sessions.get(activeAccountId)
    if (!session?.sock) throw new Error('WA not connected')
    const result = await session.sock.sendMessage(jid, { text })
    if (result) await upsertMessage(db, result, activeAccountId)
    // Do NOT emit wa:newMessage here — messages.upsert fires it; emitting twice causes duplicates
    return result?.key?.id
  })

  ipcMain.handle('wa:sendReaction', async (_e, jid: string, whatsappMsgId: string, emoji: string) => {
    const session = sessions.get(activeAccountId)
    if (!session?.sock) throw new Error('WA not connected')

    const [msg] = db.select({ direction: schema.messages.direction, senderJid: schema.messages.senderJid })
      .from(schema.messages)
      .where(eq(schema.messages.whatsappMsgId, whatsappMsgId))
      .all()
    if (!msg) throw new Error('Message not found')

    const fromMe = msg.direction === 'out'
    const key = {
      remoteJid: jid,
      id: whatsappMsgId,
      fromMe,
      ...(jid.endsWith('@g.us') && !fromMe && msg.senderJid ? { participant: msg.senderJid } : {})
    }

    await session.sock.sendMessage(jid, { react: { text: emoji, key } })

    // Persist + broadcast — own reaction may not echo back via messages.reaction
    const reactions = setReaction(db, whatsappMsgId, 'me', emoji)
    win.webContents.send('wa:reactionUpdate', { whatsappMsgId, reactions })
    return reactions
  })

  ipcMain.handle('wa:sendMedia', async (_e, jid: string, mediaPath: string, caption?: string) => {
    const session = sessions.get(activeAccountId)
    if (!session?.sock) throw new Error('WA not connected')
    const sock = session.sock
    const ext = mediaPath.split('.').pop()?.toLowerCase() ?? ''
    if (['jpg','jpeg','png','gif','webp'].includes(ext)) {
      return sock.sendMessage(jid, { image: { url: mediaPath }, caption })
    } else if (['mp4','mov','avi'].includes(ext)) {
      return sock.sendMessage(jid, { video: { url: mediaPath }, caption })
    } else if (['mp3','ogg','wav','m4a','opus'].includes(ext)) {
      return sock.sendMessage(jid, { audio: { url: mediaPath }, ptt: true })
    } else {
      return sock.sendMessage(jid, { document: { url: mediaPath }, fileName: mediaPath.split('/').pop() })
    }
  })

  ipcMain.handle('wa:syncAvatar', async (_e, contactId: number) => {
    const [contact] = db.select().from(schema.contacts)
      .where(eq(schema.contacts.id, contactId)).all()
    if (!contact) return false
    const avatarFile = join(userData, 'avatars', `${contact.id}.jpg`)
    try { if (existsSync(avatarFile)) unlinkSync(avatarFile) } catch {}
    // Use the session for this contact's account
    const session = sessions.get(contact.accountId)
    if (session) await fetchSingleAvatar(contact, session, win)
    return true
  })

  ipcMain.handle('wa:resyncContacts', async () => {
    const session = sessions.get(activeAccountId)
    if (!session?.sock) return false
    try {
      await (session.sock as any).resyncAppState(['critical_block', 'critical_unblock_to_primary', 'contact'])
      console.log('[baileys] resyncAppState(contact) triggered')
      return true
    } catch (e) {
      console.log('[baileys] resyncAppState failed:', (e as Error).message)
      return false
    }
  })

  // ── Start all existing sessions ───────────────────────────────────────────
  const allAccounts = db.select().from(schema.accounts).all()
  for (const account of allAccounts) {
    const session: BaileysSession = {
      accountId: account.id,
      authDir: account.authDir,
      sock: null,
      status: 'disconnected',
      reconnectAttempts: 0,
      keepaliveTimer: null
    }
    sessions.set(account.id, session)
  }

  // Connect all sessions in parallel
  for (const session of sessions.values()) {
    connectSession(session, db, win)
  }
}

// ── Connect one session ───────────────────────────────────────────────────────

async function connectSession(
  session: BaileysSession,
  db: BetterSQLite3Database<typeof schema>,
  win: BrowserWindow
) {
  session.status = 'connecting'
  if (session.accountId === activeAccountId) broadcastStatus(win)

  // fetchLatestBaileysVersion() does an unbounded network call to GitHub — on a
  // restricted/slow network it can hang forever, blocking makeWASocket() and
  // leaving the QR screen stuck on "Connecting...". Race it against a timeout
  // and fall back to the version bundled with the package.
  const { version } = await Promise.race([
    fetchLatestBaileysVersion(),
    new Promise<{ version: [number, number, number] }>((resolve) =>
      setTimeout(() => {
        console.log(`[baileys][account ${session.accountId}] fetchLatestBaileysVersion timed out — using bundled version`)
        resolve({ version: require('@whiskeysockets/baileys/lib/Defaults/baileys-version.json').version })
      }, 5000)
    )
  ])
  const authPath = join(userData, session.authDir)
  if (!existsSync(authPath)) mkdirSync(authPath, { recursive: true })
  const { state, saveCreds } = await useMultiFileAuthState(authPath)

  session.sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, console as any)
    },
    printQRInTerminal: false,
    browser: ['WA Copilot', 'Chrome', '1.0.0'],
    markOnlineOnConnect: false,
    syncFullHistory: true,
    // Don't let a stuck TCP/TLS handshake hang forever — if WhatsApp's
    // servers are unreachable (firewall/VPN/restricted network), fail fast
    // so the close handler below can retry instead of leaving the QR
    // screen stuck on "Connecting..." indefinitely.
    connectTimeoutMs: 20_000,
    // Required for Baileys to re-decrypt messages during history sync
    getMessage: async (key) => {
      if (!key.id) return undefined
      const [stored] = db.select({ body: schema.messages.body, type: schema.messages.type })
        .from(schema.messages)
        .where(eq(schema.messages.whatsappMsgId, key.id))
        .all()
      if (!stored) return undefined
      return { conversation: stored.body ?? undefined }
    }
  })

  session.sock.ev.on('creds.update', saveCreds)

  session.sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    // Log every transition so a stuck "Connecting…" screen is diagnosable from
    // the user's logs (e.g. via `npm run dev` console or app log file).
    if (connection || lastDisconnect) {
      console.log(
        `[baileys][account ${session.accountId}] connection.update — connection=${connection ?? 'undefined'}` +
        (lastDisconnect?.error ? ` error=${(lastDisconnect.error as Error).message}` : '')
      )
    }

    if (qr) {
      console.log(`[baileys][account ${session.accountId}] QR generated`)
      win.webContents.send('wa:qr', { qr, accountId: session.accountId })
      session.status = 'connecting'
      if (session.accountId === activeAccountId) broadcastStatus(win)
    }

    if (connection === 'open') {
      session.reconnectAttempts = 0
      session.status = 'connected'
      if (session.accountId === activeAccountId) broadcastStatus(win)

      // Update stored JID for this account
      const meJid = state.creds.me?.id ?? null
      if (meJid) {
        db.update(schema.accounts)
          .set({ jid: meJid })
          .where(eq(schema.accounts.id, session.accountId))
          .run()
        broadcastAccounts(db, win)
      }

      // Register sender in waMessenger
      const capturedSock = session.sock
      waMessenger.set(session.accountId, async (jid, text) => {
        if (!capturedSock) throw new Error('WA not connected')
        return capturedSock.sendMessage(jid, { text })
      })

      // Force-flush the Baileys event buffer after 5 s.
      // Normally Baileys flushes it when WA sends CB:ib,,offline ("all offline messages delivered").
      // But when WA already considers us connected (zombie state), it skips that signal entirely,
      // leaving the buffer stuck forever and blocking all messages.upsert events.
      setTimeout(() => {
        try {
          const ev = (session.sock as any)?.ev
          if (ev?.isBuffering?.()) {
            ev.flush()
            console.log(`[baileys][account ${session.accountId}] force-flushed event buffer (WA skipped CB:ib,,offline)`)
          }
        } catch (e) {
          console.log(`[baileys][account ${session.accountId}] ev.flush error:`, (e as Error).message)
        }
      }, 5_000)

      // Keepalive: probe the server every 90 s to detect zombie connections.
      // A zombie is a socket that appears "open" but WA stopped pushing messages to it.
      if (session.keepaliveTimer) clearInterval(session.keepaliveTimer)
      session.keepaliveTimer = setInterval(async () => {
        if (!session.sock || session.status !== 'connected') return
        try {
          // fetchBlocklist is lightweight, read-only, and has no visible side-effects
          await (session.sock as any).fetchBlocklist()
          console.log(`[baileys][account ${session.accountId}] keepalive ok`)
        } catch (e) {
          console.log(`[baileys][account ${session.accountId}] keepalive failed — forcing reconnect:`, (e as Error).message)
          clearInterval(session.keepaliveTimer!)
          session.keepaliveTimer = null
          try { session.sock.end(undefined) } catch {}
        }
      }, 90_000)

      setTimeout(() => hydrateContactNames(db, win, session), 3000)
      setTimeout(() => fetchProfilePictures(db, win, session), 6000)
      setTimeout(() => catchUpMissingMessages(session, db, win, catchUpQueue), 10_000)
    }

    if (connection === 'close') {
      // Stop keepalive probe
      if (session.keepaliveTimer) { clearInterval(session.keepaliveTimer); session.keepaliveTimer = null }

      waMessenger.remove(session.accountId)
      const code = (lastDisconnect?.error as any)?.output?.statusCode
      const shouldReconnect = code !== DisconnectReason.loggedOut
      const isQRRotation = code === 515 || (!state.creds.registered && code !== 401)

      console.log(`[baileys][account ${session.accountId}] connection closed — code ${code} shouldReconnect=${shouldReconnect}`)

      if (!shouldReconnect) {
        session.status = 'disconnected'
        if (session.accountId === activeAccountId) broadcastStatus(win)
      } else if (isQRRotation) {
        session.status = 'connecting'
        if (session.accountId === activeAccountId) broadcastStatus(win)
        setTimeout(() => connectSession(session, db, win), 1000)
      } else {
        // Unlimited retries with exponential backoff capped at 60 s
        session.reconnectAttempts++
        const delay = Math.min(5000 * session.reconnectAttempts, 60_000)
        session.sock = null
        session.status = 'connecting'
        if (session.accountId === activeAccountId) broadcastStatus(win)
        console.log(`[baileys][account ${session.accountId}] reconnecting in ${delay}ms (attempt ${session.reconnectAttempts})`)
        setTimeout(() => connectSession(session, db, win), delay)
      }
    }
  })

  session.sock.ev.on('messages.upsert', async ({ messages: msgs, type }) => {
    if (type !== 'notify' && type !== 'append') return
    for (const msg of msgs) {
      if (!msg.key.remoteJid) continue
      const jid = msg.key.remoteJid
      if (jid.endsWith('@broadcast') || jid === 'status@broadcast') continue
      try {
        const { contact: upsertedContact, isNew, isNewMessage } = await upsertMessage(db, msg, session.accountId)
        // Only push to frontend if this message wasn't already in the DB (e.g. from history sync or prior upsert)
        if (isNewMessage) win.webContents.send('wa:newMessage', serializeMsg(msg))
        if (isNew && upsertedContact) {
          win.webContents.send('wa:contactUpserted', upsertedContact)
          fetchSingleAvatar(upsertedContact, session, win)
        }
      } catch (e) {
        console.error('[baileys] live upsertMessage failed:', msg.key.id, (e as Error).message)
      }
    }
  })

  session.sock.ev.on('messages.update', async (updates) => {
    for (const update of updates) {
      win.webContents.send('wa:messageUpdate', update)
      if (update.update?.status != null) {
        await db.update(schema.messages)
          .set({ status: statusFromNumber(update.update.status) })
          .where(eq(schema.messages.whatsappMsgId, update.key.id!))
      }
      if (update.update?.message?.protocolMessage?.type === 14) {
        await db.update(schema.messages)
          .set({ isDeleted: true, body: null })
          .where(eq(schema.messages.whatsappMsgId, update.key.id!))
      }
    }
  })

  session.sock.ev.on('messages.reaction', async (reactions) => {
    for (const { key, reaction } of reactions) {
      if (!key.id) continue
      // reaction.key identifies who sent the reaction (the wrapper message's key).
      // reaction.text === '' means the reaction was removed.
      const reactorKey = reaction.key
      const reactorJid = reactorKey?.fromMe
        ? 'me'
        : (reactorKey?.participant ?? reactorKey?.remoteJid ?? 'unknown')
      const updated = setReaction(db, key.id, reactorJid, reaction.text || null)
      win.webContents.send('wa:reactionUpdate', { whatsappMsgId: key.id, reactions: updated })
    }
  })

  session.sock.ev.on('contacts.upsert', async (baileysContacts) => {
    let updated = false
    for (const bc of baileysContacts) {
      const name = bc.name ?? bc.notify ?? null
      if (!name || !bc.id) continue
      updated = upsertContactName(db, bc.id, name, session.accountId) || updated
    }
    if (updated) win.webContents.send('wa:historySynced', null)
  })

  session.sock.ev.on('contacts.update', (updates) => {
    let updated = false
    for (const upd of updates) {
      const name = upd.notify ?? upd.name ?? null
      if (!name || !upd.id) continue
      updated = upsertContactName(db, upd.id, name, session.accountId) || updated
    }
    if (updated) win.webContents.send('wa:historySynced', null)
  })

  session.sock.ev.on('contacts.set', ({ contacts: baileysContacts }) => {
    let updated = false
    for (const bc of baileysContacts) {
      const name = bc.name ?? bc.notify ?? null
      if (!name || !bc.id) continue
      updated = upsertContactName(db, bc.id, name, session.accountId) || updated
    }
    if (updated) win.webContents.send('wa:historySynced', null)
  })

  // JIDs that need a catch-up history fetch (detected in chats.upsert, fired below)
  const catchUpQueue: string[] = []

  session.sock.ev.on('chats.upsert', async (chats) => {
    const sample = chats.slice(0, 3).map((c: any) => ({ id: c.id, unreadCount: c.unreadCount }))
    console.log(`[baileys] chats.upsert ${chats.length} chats, sample unreadCounts:`, JSON.stringify(sample))
    let anyNew = false
    let anyUnreadSynced = false
    for (const chat of chats) {
      const jid = chat.id
      if (!jid) continue
      if (jid.endsWith('@broadcast') || jid === 'status@broadcast') continue

      const existing = db.select().from(schema.contacts)
        .where(eq(schema.contacts.whatsappId, jid)).all()[0]

      if (!existing) {
        const isGroup = jid.endsWith('@g.us')
        const lastTs = (chat as any).conversationTimestamp
          ? Number((chat as any).conversationTimestamp) * 1000
          : Date.now()
        const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000
        const stage = lastTs < thirtyDaysAgo ? 'all_resolved' : 'new'

        db.insert(schema.contacts).values({
          accountId: session.accountId,
          whatsappId: jid,
          phone: (isGroup || jid.endsWith('@lid')) ? null : jid.split('@')[0],
          name: (chat as any).name ?? null,
          isGroup,
          stage,
          stageChangedAt: new Date(),
          lastMessage: (chat as any).lastMessage?.message
            ? extractBodyFromRaw((chat as any).lastMessage)
            : undefined,
          lastMessageAt: new Date(lastTs),
          lastMessageDirection: 'in',
          unreadCount: (chat as any).unreadCount ?? 0,
          createdAt: new Date(),
          updatedAt: new Date()
        }).run()
        anyNew = true
        // New contact with a recent timestamp — fetch their messages too
        if (lastTs > Date.now() - 30 * 24 * 60 * 60 * 1000) catchUpQueue.push(jid)
      } else {
        const chatTs = (chat as any).conversationTimestamp
          ? Number((chat as any).conversationTimestamp) * 1000
          : null
        const chatName = (chat as any).name ?? null
        const chatLastMsg = (chat as any).lastMessage?.message
          ? extractBodyFromRaw((chat as any).lastMessage)
          : null
        const isNewer = chatTs && (!existing.lastMessageAt || new Date(chatTs) > existing.lastMessageAt)
        const waUnread = (chat as any).unreadCount
        const unreadUpdate = (waUnread != null) ? { unreadCount: Math.max(0, Number(waUnread)) } : {}
        const needsUpdate = (chatName && !existing.name) || isNewer || (chatLastMsg && !existing.lastMessage) || waUnread != null
        if (needsUpdate) {
          db.update(schema.contacts).set({
            ...(chatName && !existing.name ? { name: chatName } : {}),
            ...(isNewer ? { lastMessageAt: new Date(chatTs!) } : {}),
            ...(chatLastMsg && !existing.lastMessage ? { lastMessage: chatLastMsg } : {}),
            ...unreadUpdate,
            updatedAt: new Date()
          }).where(eq(schema.contacts.whatsappId, jid)).run()
          if (waUnread != null) anyUnreadSynced = true
        }

        // Gap detection: WA's timestamp is more than 2 min ahead of our latest stored message.
        // This means messages arrived while we were offline. Queue a catch-up history fetch.
        if (chatTs) {
          const [latestMsg] = db.select({ timestamp: schema.messages.timestamp })
            .from(schema.messages)
            .where(eq(schema.messages.contactId, existing.id))
            .orderBy(desc(schema.messages.timestamp))
            .limit(1)
            .all()
          const ourLatest = latestMsg?.timestamp?.getTime() ?? 0
          if (chatTs - ourLatest > 2 * 60 * 1000) {
            catchUpQueue.push(jid)
          }
        }
      }
    }

    if (anyNew) {
      await hydrateContactNames(db, win, session)
      setTimeout(() => fetchProfilePictures(db, win, session), 2000)
    }
    if (anyNew || anyUnreadSynced) {
      win.webContents.send('wa:historySynced', null)
    }
  })

  // When user reads a chat on their phone or WA Web, WA pushes a chats.update
  // with unreadCount=0. Sync that to our DB so badges stay accurate.
  session.sock.ev.on('chats.update', (updates) => {
    for (const update of updates) {
      const jid = update.id
      if (!jid) continue
      if (update.unreadCount != null) {
        const count = Math.max(0, Number(update.unreadCount))
        db.update(schema.contacts)
          .set({ unreadCount: count, updatedAt: new Date() })
          .where(eq(schema.contacts.whatsappId, jid))
          .run()
        win.webContents.send('wa:contactUpserted',
          db.select().from(schema.contacts).where(eq(schema.contacts.whatsappId, jid)).all()[0] ?? null
        )
      }
    }
  })

  session.sock.ev.on('messaging-history.set', async ({ messages: msgs, contacts: baileysContacts, isLatest }) => {
    console.log(`[baileys][account ${session.accountId}] history sync: ${msgs.length} msgs, ${baileysContacts.length} contacts, isLatest=${isLatest}`)

    let contactsChanged = 0
    for (const bc of baileysContacts) {
      const name = bc.name ?? (bc as any).notify ?? null
      if (!bc.id || !name) continue
      const jid = bc.id
      if (jid.endsWith('@broadcast') || jid === 'status@broadcast') continue
      if (upsertContactName(db, jid, name, session.accountId)) contactsChanged++
    }

    const sorted = [...msgs].sort((a, b) =>
      Number(a.messageTimestamp ?? 0) - Number(b.messageTimestamp ?? 0)
    )
    let saved = 0, skipped = 0
    for (const msg of sorted) {
      if (!msg.key.remoteJid) continue
      const jid = msg.key.remoteJid
      if (jid.endsWith('@broadcast') || jid === 'status@broadcast') continue
      try {
        await upsertMessage(db, msg, session.accountId)
        saved++
      } catch (e) {
        console.error('[baileys] history upsertMessage failed:', msg.key.id, (e as Error).message)
        skipped++
      }
    }
    console.log(`[baileys][account ${session.accountId}] history saved=${saved} skipped=${skipped}`)

    // After all messages are processed, backfill lastMessageSenderName for groups
    // by looking up sender_jid → contact name for messages that now have senderJid stored
    db.run(`
      UPDATE contacts
      SET last_message_sender_name = (
        SELECT COALESCE(m.sender_name,
          (SELECT c2.name FROM contacts c2 WHERE c2.whatsapp_id = m.sender_jid LIMIT 1)
        )
        FROM messages m
        WHERE m.contact_id = contacts.id
          AND (m.sender_name IS NOT NULL OR m.sender_jid IS NOT NULL)
        ORDER BY m.timestamp DESC
        LIMIT 1
      )
      WHERE is_group = 1
        AND last_message_direction = 'in'
        AND last_message_sender_name IS NULL
    ` as any)

    if (msgs.length > 0 || contactsChanged > 0) {
      win.webContents.send('wa:historySynced', null)
    }
  })
}

// ── Catch-up: fetch messages missed while offline ─────────────────────────────
// Runs 10 s after each successful connect. Compares WA's conversation timestamps
// (available in chats.upsert) with our local DB. For any chat that is ahead of
// our DB, requests up to 50 recent messages from WA via fetchMessageHistory.
// The response arrives via messaging-history.set which our existing handler saves.

async function catchUpMissingMessages(
  session: BaileysSession,
  db: BetterSQLite3Database<typeof schema>,
  win: BrowserWindow,
  jids: string[]
) {
  if (!session.sock || session.status !== 'connected' || jids.length === 0) return

  console.log(`[baileys][account ${session.accountId}] catch-up: requesting history for ${jids.length} contacts with gaps`)
  let fetched = 0

  for (const jid of jids) {
    if (!session.sock || session.status !== 'connected') break

    // Find the contact and their latest stored message to use as cursor
    const [contact] = db.select({ id: schema.contacts.id })
      .from(schema.contacts)
      .where(eq(schema.contacts.whatsappId, jid))
      .all()
    if (!contact) continue

    const [latestMsg] = db.select({
      whatsappMsgId: schema.messages.whatsappMsgId,
      direction: schema.messages.direction,
      timestamp: schema.messages.timestamp
    })
      .from(schema.messages)
      .where(eq(schema.messages.contactId, contact.id))
      .orderBy(desc(schema.messages.timestamp))
      .limit(1)
      .all()

    try {
      // Pass empty id so WA returns the most recent messages for this chat.
      // The response arrives via messaging-history.set which our handler saves.
      const cursor = latestMsg
        ? { id: '', remoteJid: jid, fromMe: latestMsg.direction === 'out' }
        : { id: '', remoteJid: jid, fromMe: false }
      const since = latestMsg?.timestamp?.getTime() ?? (Date.now() - 7 * 24 * 60 * 60 * 1000)
      await (session.sock as any).fetchMessageHistory(50, cursor, since)
      fetched++
    } catch {
      // best effort — skip this JID
    }

    // Pace requests to avoid rate-limiting (WA allows ~3-4/s)
    await new Promise(resolve => setTimeout(resolve, 400))
  }

  console.log(`[baileys][account ${session.accountId}] catch-up: sent ${fetched} history requests`)
}

// ── Reactions ─────────────────────────────────────────────────────────────────
// Reactions are stored as a JSON map of reactorJid ('me' for the linked account)
// -> emoji on the target message row. Setting emoji to null/empty removes that
// reactor's entry (mirrors WhatsApp's "tap again to remove" behavior).
// Returns the updated map (or null if empty / message not found).

function setReaction(
  db: BetterSQLite3Database<typeof schema>,
  whatsappMsgId: string,
  reactorJid: string,
  emoji: string | null
): Record<string, string> | null {
  const [row] = db.select({ reactions: schema.messages.reactions })
    .from(schema.messages)
    .where(eq(schema.messages.whatsappMsgId, whatsappMsgId))
    .all()
  if (!row) return null

  let map: Record<string, string> = {}
  try { if (row.reactions) map = JSON.parse(row.reactions) } catch {}

  if (emoji) {
    map[reactorJid] = emoji
  } else {
    delete map[reactorJid]
  }

  const next = Object.keys(map).length > 0 ? JSON.stringify(map) : null
  db.update(schema.messages)
    .set({ reactions: next })
    .where(eq(schema.messages.whatsappMsgId, whatsappMsgId))
    .run()

  return next ? map : null
}

// ── Contact name upsert ───────────────────────────────────────────────────────

function upsertContactName(
  db: BetterSQLite3Database<typeof schema>,
  jid: string,
  name: string,
  accountId: number
): boolean {
  const existing = db.select().from(schema.contacts)
    .where(eq(schema.contacts.whatsappId, jid)).all()[0]

  if (existing) {
    const result = db.update(schema.contacts)
      .set({ name, updatedAt: new Date() })
      .where(eq(schema.contacts.whatsappId, jid))
      .run()
    return result.changes > 0
  }

  // Create stub so the name is preserved when messages arrive later
  const isGroup = jid.endsWith('@g.us')
  db.insert(schema.contacts).values({
    accountId,
    whatsappId: jid,
    phone: (isGroup || jid.endsWith('@lid')) ? null : jid.split('@')[0],
    name,
    isGroup,
    stage: 'new',
    stageChangedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date()
  }).run()
  return true
}

// ── Avatar helpers ────────────────────────────────────────────────────────────

async function fetchSingleAvatar(
  contact: typeof schema.contacts.$inferSelect,
  session: BaileysSession,
  win: BrowserWindow
) {
  if (!session.sock) return
  const avatarDir = join(userData, 'avatars')
  if (!existsSync(avatarDir)) mkdirSync(avatarDir, { recursive: true })
  const avatarFile = join(avatarDir, `${contact.id}.jpg`)
  if (existsSync(avatarFile)) return
  try {
    const url = await session.sock.profilePictureUrl(contact.whatsappId, 'image')
    const res = await fetch(url)
    if (res.ok) {
      writeFileSync(avatarFile, Buffer.from(await res.arrayBuffer()))
      win.webContents.send('wa:historySynced', null)
    }
  } catch { /* no picture */ }
}

async function fetchProfilePictures(
  db: BetterSQLite3Database<typeof schema>,
  win: BrowserWindow,
  session: BaileysSession
) {
  if (!session.sock) return
  const avatarDir = join(userData, 'avatars')
  if (!existsSync(avatarDir)) mkdirSync(avatarDir, { recursive: true })

  const contacts = db.select().from(schema.contacts)
    .where(eq(schema.contacts.accountId, session.accountId)).all()
  let fetched = 0

  for (const contact of contacts) {
    const avatarFile = join(avatarDir, `${contact.id}.jpg`)
    if (existsSync(avatarFile)) continue
    if (fetched > 0) await new Promise(r => setTimeout(r, 600))
    try {
      const url = await session.sock.profilePictureUrl(contact.whatsappId, 'image')
      const res = await fetch(url)
      if (res.ok) {
        writeFileSync(avatarFile, Buffer.from(await res.arrayBuffer()))
        fetched++
      }
    } catch { /* no picture */ }
  }

  if (fetched > 0) win.webContents.send('wa:historySynced', null)
}

// ── Hydrate group names ───────────────────────────────────────────────────────

async function hydrateContactNames(
  db: BetterSQLite3Database<typeof schema>,
  win: BrowserWindow,
  session: BaileysSession
) {
  if (!session.sock) return
  const contacts = db.select().from(schema.contacts)
    .where(eq(schema.contacts.accountId, session.accountId)).all()
  let updated = false

  for (const contact of contacts) {
    if (contact.name) continue
    try {
      if (contact.whatsappId.endsWith('@g.us')) {
        const meta = await session.sock.groupMetadata(contact.whatsappId)
        if (meta?.subject) {
          db.update(schema.contacts)
            .set({ name: meta.subject, updatedAt: new Date() })
            .where(eq(schema.contacts.whatsappId, contact.whatsappId))
            .run()
          updated = true
        }
      }
    } catch (e) {
      // Group may not be accessible
    }
  }

  if (updated) win.webContents.send('wa:historySynced', null)
}

// ── Message upsert ────────────────────────────────────────────────────────────

async function upsertMessage(
  db: BetterSQLite3Database<typeof schema>,
  msg: proto.IWebMessageInfo,
  accountId: number
): Promise<{ contact: typeof schema.contacts.$inferSelect | null; isNew: boolean }> {
  const jid = msg.key.remoteJid!
  const isOutgoing = msg.key.fromMe ?? false
  const timestamp = Number(msg.messageTimestamp ?? 0) * 1000
  const body = extractBody(msg)
  const type = extractType(msg)
  const pushName = (msg as any).pushName as string | undefined | null

  // Extract sender JID and name from group messages
  const isGroup = jid.endsWith('@g.us')
  const senderJid = (isGroup && !isOutgoing) ? (msg.key.participant ?? null) : null

  if (senderJid && pushName) {
    // Store the sender's name in the contacts table so we can resolve it later
    upsertContactName(db, senderJid, pushName, accountId)
  }

  // Resolve sender name: prefer pushName (live messages), fall back to contacts table (history sync)
  let senderName: string | null = null
  if (isGroup && !isOutgoing) {
    if (pushName) {
      senderName = pushName
    } else if (senderJid) {
      const [senderContact] = db.select({ name: schema.contacts.name })
        .from(schema.contacts)
        .where(eq(schema.contacts.whatsappId, senderJid))
        .all()
      senderName = senderContact?.name ?? null
    }
  }

  let [contact] = db.select().from(schema.contacts)
    .where(eq(schema.contacts.whatsappId, jid)).all()
  let isNew = false

  if (!contact) {
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000
    const stage = timestamp < thirtyDaysAgo ? 'all_resolved' : 'new'

    const [inserted] = db.insert(schema.contacts).values({
      accountId,
      whatsappId: jid,
      phone: (isGroup || jid.endsWith('@lid')) ? null : jid.split('@')[0],
      name: pushName ?? null,
      isGroup,
      stage,
      stageChangedAt: new Date(),
      lastMessage: body,
      lastMessageAt: new Date(timestamp),
      lastMessageDirection: isOutgoing ? 'out' : 'in',
      lastMessageSenderName: isGroup ? (isOutgoing ? 'Tú' : senderName) : null,
      unreadCount: isOutgoing ? 0 : 1,
      createdAt: new Date(),
      updatedAt: new Date()
    }).returning().all()
    contact = inserted
    isNew = true
  } else {
    const unreadDelta = isOutgoing ? 0 : 1
    const nameUpdate = (!contact.name && pushName) ? { name: pushName } : {}
    // Inbound message on a resolved contact → move it back to New automatically
    const reopenUpdate = (!isOutgoing && contact.stage === 'all_resolved')
      ? { stage: 'new' as const, stageChangedAt: new Date() }
      : {}
    db.update(schema.contacts)
      .set({
        ...nameUpdate,
        ...reopenUpdate,
        lastMessage: body,
        lastMessageAt: new Date(timestamp),
        lastMessageDirection: isOutgoing ? 'out' : 'in',
        lastMessageSenderName: isGroup ? (isOutgoing ? 'Tú' : senderName) : null,
        unreadCount: (contact.unreadCount ?? 0) + unreadDelta,
        updatedAt: new Date()
      })
      .where(eq(schema.contacts.whatsappId, jid))
      .run()
  }

  let isNewMessage = false
  try {
    db.insert(schema.messages).values({
      contactId: contact!.id,
      whatsappMsgId: msg.key.id!,
      direction: isOutgoing ? 'out' : 'in',
      body,
      type,
      timestamp: new Date(timestamp),
      status: isOutgoing ? statusFromNumber(msg.status ?? 0) : undefined,
      senderName,
      senderJid,
      createdAt: new Date()
    }).run()
    isNewMessage = true
  } catch { /* duplicate — message already in DB, skip */ }

  return { contact: contact ?? null, isNew, isNewMessage }
}

// ── Serialisation helpers ─────────────────────────────────────────────────────

function extractBodyFromRaw(raw: any): string | undefined {
  const m = raw?.message
  if (!m) return undefined
  return (
    m.conversation ??
    m.extendedTextMessage?.text ??
    (m.imageMessage   ? (m.imageMessage.caption   || '📷 Imagen')      : undefined) ??
    (m.videoMessage   ? (m.videoMessage.caption   || '🎥 Video')        : undefined) ??
    (m.audioMessage   ? (m.audioMessage.ptt       ? '🎤 Nota de voz' : '🎵 Audio') : undefined) ??
    (m.documentMessage ? (m.documentMessage.fileName || '📄 Documento') : undefined) ??
    (m.stickerMessage ? '🎭 Sticker'   : undefined) ??
    (m.locationMessage ? '📍 Ubicación' : undefined) ??
    (m.reactionMessage ? `${m.reactionMessage.text ?? '👍'} (reacción)` : undefined)
  )
}

// Unwrap common Baileys message containers so nested content is accessible.
// Messages sent from a phone (not web) arrive wrapped in deviceSentMessage;
// disappearing messages in ephemeralMessage; etc.
function unwrapMessage(m: any): any {
  if (!m) return m
  return (
    m.deviceSentMessage?.message ??
    m.ephemeralMessage?.message ??
    m.viewOnceMessage?.message ??
    m.viewOnceMessageV2?.message?.viewOnceMessage?.message ??
    m.documentWithCaptionMessage?.message ??
    m.editedMessage?.message?.protocolMessage?.editedMessage ??
    m
  )
}

function extractBody(msg: proto.IWebMessageInfo): string | undefined {
  const raw = msg.message
  if (!raw) return undefined
  const m = unwrapMessage(raw)
  return (
    m.conversation ??
    m.extendedTextMessage?.text ??
    (m.imageMessage    ? (m.imageMessage.caption    || '📷 Imagen')      : undefined) ??
    (m.videoMessage    ? (m.videoMessage.caption    || '🎥 Video')        : undefined) ??
    (m.audioMessage    ? (m.audioMessage.ptt        ? '🎤 Nota de voz' : '🎵 Audio') : undefined) ??
    (m.documentMessage || m.documentWithCaptionMessage
      ? (m.documentMessage?.fileName
          ?? m.documentWithCaptionMessage?.message?.documentMessage?.fileName
          ?? '📄 Documento')
      : undefined) ??
    (m.stickerMessage   ? '🎭 Sticker'   : undefined) ??
    (m.locationMessage  ? '📍 Ubicación'  : undefined) ??
    (m.pollCreationMessage ? `📊 ${m.pollCreationMessage.name ?? 'Encuesta'}` : undefined) ??
    (m.contactMessage   ? `👤 ${m.contactMessage.displayName ?? 'Contacto'}` : undefined) ??
    (m.contactsArrayMessage ? `👥 ${m.contactsArrayMessage.contacts?.length ?? ''} contactos` : undefined) ??
    (m.reactionMessage ? `${m.reactionMessage.text ?? '👍'} (reacción)` : undefined)
  )
}

function extractType(msg: proto.IWebMessageInfo): schema.InsertMessage['type'] {
  const raw = msg.message
  if (!raw) return 'unknown'
  const m = unwrapMessage(raw)
  if (m.conversation || m.extendedTextMessage) return 'text'
  if (m.imageMessage) return 'image'
  if (m.audioMessage) return 'audio'
  if (m.videoMessage) return 'video'
  if (m.documentMessage || m.documentWithCaptionMessage) return 'document'
  if (m.stickerMessage) return 'sticker'
  if (m.locationMessage) return 'location'
  if (m.pollCreationMessage) return 'poll'
  if (m.reactionMessage) return 'reaction'
  return 'unknown'
}

function statusFromNumber(status: number): schema.InsertMessage['status'] {
  switch (status) {
    case 0: return 'pending'
    case 1: return 'sent'
    case 2: return 'sent'
    case 3: return 'delivered'
    case 4: return 'read'
    default: return 'sent'
  }
}

function serializeMsg(msg: proto.IWebMessageInfo) {
  const isGroup = msg.key.remoteJid?.endsWith('@g.us') ?? false
  const pushName = (msg as any).pushName as string | undefined | null
  return {
    id: msg.key.id,
    jid: msg.key.remoteJid,
    fromMe: msg.key.fromMe,
    body: extractBody(msg),
    type: extractType(msg),
    timestamp: Number(msg.messageTimestamp ?? 0) * 1000,
    status: msg.status,
    senderName: isGroup && !msg.key.fromMe ? (pushName ?? null) : null,
    senderJid: isGroup && !msg.key.fromMe ? (msg.key.participant ?? null) : null,
  }
}
