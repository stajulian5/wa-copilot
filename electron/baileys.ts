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
import { rmSync } from 'fs'
import { eq } from 'drizzle-orm'
import * as schema from '../src/server/db/schema'
import { userData } from './main'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'

const AUTH_DIR = () => join(userData, 'baileys_auth')

let sock: ReturnType<typeof makeWASocket> | null = null
let waStatus: 'disconnected' | 'connecting' | 'connected' = 'disconnected'
let reconnectAttempts = 0
const MAX_RECONNECT = 3

export function getWAStatus() {
  return waStatus
}

function setStatus(win: BrowserWindow, status: typeof waStatus) {
  waStatus = status
  win.webContents.send('wa:status', status)
}

export async function startBaileys(
  db: BetterSQLite3Database<typeof schema>,
  win: BrowserWindow,
  _port: number
) {
  ipcMain.handle('wa:getStatus', () => waStatus)
  ipcMain.handle('wa:resetAuth', async () => {
    // Disconnect existing socket
    try { sock?.end(new Error('manual reset')) } catch {}
    sock = null
    setStatus(win, 'disconnected')
    // Delete auth state so next connect shows QR
    try { rmSync(AUTH_DIR(), { recursive: true, force: true }) } catch {}
    // Reconnect (will show QR)
    setTimeout(() => connect(db, win), 500)
  })
  ipcMain.handle('wa:sendMessage', async (_e, jid: string, text: string) => {
    if (!sock) throw new Error('WA not connected')
    const result = await sock.sendMessage(jid, { text })
    if (result) {
      await upsertMessage(db, result)
      win.webContents.send('wa:newMessage', serializeMsg(result))
    }
    return result?.key?.id
  })
  ipcMain.handle('wa:sendMedia', async (_e, jid: string, mediaPath: string, caption?: string) => {
    if (!sock) throw new Error('WA not connected')
    // Determine media type from extension
    const ext = mediaPath.split('.').pop()?.toLowerCase() ?? ''
    const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp']
    const videoExts = ['mp4', 'mov', 'avi']
    const audioExts = ['mp3', 'ogg', 'wav', 'm4a', 'opus']

    if (imageExts.includes(ext)) {
      return sock.sendMessage(jid, { image: { url: mediaPath }, caption })
    } else if (videoExts.includes(ext)) {
      return sock.sendMessage(jid, { video: { url: mediaPath }, caption })
    } else if (audioExts.includes(ext)) {
      return sock.sendMessage(jid, { audio: { url: mediaPath }, ptt: true })
    } else {
      return sock.sendMessage(jid, { document: { url: mediaPath }, fileName: mediaPath.split('/').pop() })
    }
  })

  await connect(db, win)
}

async function connect(db: BetterSQLite3Database<typeof schema>, win: BrowserWindow) {
  setStatus(win, 'connecting')
  const { version } = await fetchLatestBaileysVersion()
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR())

  sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, console as any)
    },
    printQRInTerminal: false,
    browser: ['WhatsApp Copilot', 'Chrome', '1.0.0'],
    markOnlineOnConnect: false,
    syncFullHistory: true          // pull historical messages on connect
  })

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      win.webContents.send('wa:qr', qr)
      setStatus(win, 'connecting')
    }

    if (connection === 'open') {
      reconnectAttempts = 0
      setStatus(win, 'connected')
      // Hydrate group names and contact names after connection
      setTimeout(() => hydrateContactNames(db, win), 3000)
    }

    if (connection === 'close') {
      const code = (lastDisconnect?.error as any)?.output?.statusCode
      const shouldReconnect = code !== DisconnectReason.loggedOut

      if (shouldReconnect && reconnectAttempts < MAX_RECONNECT) {
        reconnectAttempts++
        setStatus(win, 'connecting')
        setTimeout(() => connect(db, win), 5000 * reconnectAttempts)
      } else if (reconnectAttempts >= MAX_RECONNECT) {
        setStatus(win, 'disconnected')
      } else {
        // Logged out — clear auth state
        setStatus(win, 'disconnected')
      }
    }
  })

  sock.ev.on('messages.upsert', async ({ messages: msgs, type }) => {
    if (type !== 'notify' && type !== 'append') return

    for (const msg of msgs) {
      if (!msg.key.remoteJid) continue
      const jid = msg.key.remoteJid

      // Skip broadcasts and status
      if (jid.endsWith('@broadcast') || jid === 'status@broadcast') continue

      const { contact: upsertedContact, isNew } = await upsertMessage(db, msg)
      win.webContents.send('wa:newMessage', serializeMsg(msg))
      if (isNew && upsertedContact) {
        win.webContents.send('wa:contactUpserted', upsertedContact)
      }
    }
  })

  sock.ev.on('messages.update', async (updates) => {
    for (const update of updates) {
      win.webContents.send('wa:messageUpdate', update)

      if (update.update?.status != null) {
        await db
          .update(schema.messages)
          .set({ status: statusFromNumber(update.update.status) })
          .where(eq(schema.messages.whatsappMsgId, update.key.id!))
      }

      if (update.update?.message?.protocolMessage?.type === 14) {
        // Message deletion
        await db
          .update(schema.messages)
          .set({ isDeleted: true, body: null })
          .where(eq(schema.messages.whatsappMsgId, update.key.id!))
      }
    }
  })

  sock.ev.on('messages.reaction', async (reactions) => {
    for (const { key, reaction } of reactions) {
      win.webContents.send('wa:messageUpdate', { key, reaction })
    }
  })

  // ── Contact names from phone book ──────────────────────────────────────────
  sock.ev.on('contacts.upsert', async (baileysContacts) => {
    let updated = false
    for (const bc of baileysContacts) {
      const name = bc.name ?? (bc as any).notify ?? null
      console.log(`[baileys] contacts.upsert: ${bc.id} → name=${name}`)
      if (!name) continue
      const result = db.update(schema.contacts)
        .set({ name, updatedAt: new Date() })
        .where(eq(schema.contacts.whatsappId, bc.id))
        .run()
      if (result.changes > 0) updated = true
    }
    if (updated) win.webContents.send('wa:historySynced', null)
  })

  // ── Chat list: create contacts for all WA conversations ───────────────────
  sock.ev.on('chats.upsert', async (chats) => {
    console.log(`[baileys] chats.upsert: ${chats.length} chats`)
    let anyNew = false
    for (const chat of chats) {
      const jid = chat.id
      if (!jid) continue
      // Skip broadcasts and status
      if (jid.endsWith('@broadcast') || jid === 'status@broadcast') continue

      const existing = db.select().from(schema.contacts).where(eq(schema.contacts.whatsappId, jid)).all()[0]
      if (!existing) {
        // Create a stub contact from chat metadata
        const isGroup = jid.endsWith('@g.us')
        const lastTs = (chat as any).conversationTimestamp
          ? Number((chat as any).conversationTimestamp) * 1000
          : Date.now()
        const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
        const stage = lastTs < sevenDaysAgo ? 'all_resolved' : 'new'
        const name = (chat as any).name ?? null

        db.insert(schema.contacts).values({
          whatsappId: jid,
          phone: isGroup ? jid.split('@')[0] : jid.split('@')[0],
          name,
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
      } else {
        // Update unread count and last message time if chat has more recent data
        const chatTs = (chat as any).conversationTimestamp
          ? Number((chat as any).conversationTimestamp) * 1000
          : null
        const chatName = (chat as any).name ?? null
        if (chatTs || (chatName && !existing.name)) {
          db.update(schema.contacts).set({
            ...(chatName && !existing.name ? { name: chatName } : {}),
            ...(chatTs && (!existing.lastMessageAt || new Date(chatTs) > existing.lastMessageAt) ? { lastMessageAt: new Date(chatTs) } : {}),
            updatedAt: new Date()
          }).where(eq(schema.contacts.whatsappId, jid)).run()
        }
      }
    }

    if (anyNew) {
      // For new group contacts, fetch their names
      await hydrateContactNames(db, win)
      win.webContents.send('wa:historySynced', null)
    }
  })

  // ── Historical messages (syncFullHistory) ──────────────────────────────────
  sock.ev.on('messaging-history.set', async ({ messages: msgs, contacts: baileysContacts, isLatest }) => {
    console.log(`[baileys] history sync: ${msgs.length} messages, ${baileysContacts.length} contacts, isLatest=${isLatest}`)

    // Persist contact names first
    for (const bc of baileysContacts) {
      const name = bc.name ?? (bc as any).notify ?? null
      if (!bc.id) continue
      const existing = db.select().from(schema.contacts).where(eq(schema.contacts.whatsappId, bc.id)).all()[0]
      if (existing) {
        if (name && !existing.name) {
          db.update(schema.contacts).set({ name, updatedAt: new Date() }).where(eq(schema.contacts.whatsappId, bc.id)).run()
        }
      }
    }

    // Persist historical messages (oldest first so contacts are created in chronological order)
    const sorted = [...msgs].sort((a, b) => Number(a.messageTimestamp ?? 0) - Number(b.messageTimestamp ?? 0))
    for (const msg of sorted) {
      if (!msg.key.remoteJid) continue
      const jid = msg.key.remoteJid
      if (jid.endsWith('@broadcast') || jid === 'status@broadcast') continue
      await upsertMessage(db, msg)
    }

    // Notify renderer to re-fetch contacts after history batch
    if (msgs.length > 0) {
      win.webContents.send('wa:historySynced', null)
    }
  })
}

// ── Hydrate names for existing contacts after connection ───────────────────────
async function hydrateContactNames(
  db: BetterSQLite3Database<typeof schema>,
  win: BrowserWindow
) {
  if (!sock) return
  const contacts = db.select().from(schema.contacts).all()
  let updated = false

  for (const contact of contacts) {
    const jid = contact.whatsappId
    if (contact.name) continue // already have a name

    try {
      if (jid.endsWith('@g.us')) {
        // Fetch group subject
        const meta = await sock.groupMetadata(jid)
        if (meta?.subject) {
          db.update(schema.contacts)
            .set({ name: meta.subject, updatedAt: new Date() })
            .where(eq(schema.contacts.whatsappId, jid))
            .run()
          updated = true
          console.log(`[baileys] hydrated group name: ${jid} → ${meta.subject}`)
        }
      }
      // For @s.whatsapp.net / @lid: names come via pushName on next message
      // We can try fetchStatus but it only returns status text, not the contact name
    } catch (e) {
      console.log(`[baileys] hydrateContactNames failed for ${jid}:`, (e as Error).message)
    }
  }

  if (updated) {
    win.webContents.send('wa:historySynced', null)
  }
}

async function upsertMessage(
  db: BetterSQLite3Database<typeof schema>,
  msg: proto.IWebMessageInfo
): Promise<{ contact: typeof schema.contacts.$inferSelect | null; isNew: boolean }> {
  const jid = msg.key.remoteJid!
  const isOutgoing = msg.key.fromMe ?? false
  const timestamp = Number(msg.messageTimestamp ?? 0) * 1000
  const body = extractBody(msg)
  const type = extractType(msg)

  // Ensure contact exists
  let [contact] = db.select().from(schema.contacts).where(eq(schema.contacts.whatsappId, jid)).all()
  let isNew = false

  const pushName = (msg as any).pushName as string | undefined | null

  if (!contact) {
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
    const stage = timestamp < sevenDaysAgo ? 'all_resolved' : 'new'
    const isGroup = jid.endsWith('@g.us')

    const [inserted] = db.insert(schema.contacts).values({
      whatsappId: jid,
      phone: jid.split('@')[0],
      name: pushName ?? null,
      isGroup,
      stage,
      stageChangedAt: new Date(),
      lastMessage: body,
      lastMessageAt: new Date(timestamp),
      lastMessageDirection: isOutgoing ? 'out' : 'in',
      unreadCount: isOutgoing ? 0 : 1,
      createdAt: new Date(),
      updatedAt: new Date()
    }).returning().all()
    contact = inserted
    isNew = true
  } else {
    const unreadDelta = isOutgoing ? 0 : 1
    // Update name from pushName if we don't have one yet
    const nameUpdate = (!contact.name && pushName) ? { name: pushName } : {}
    db.update(schema.contacts)
      .set({
        ...nameUpdate,
        lastMessage: body,
        lastMessageAt: new Date(timestamp),
        lastMessageDirection: isOutgoing ? 'out' : 'in',
        unreadCount: (contact.unreadCount ?? 0) + unreadDelta,
        updatedAt: new Date()
      })
      .where(eq(schema.contacts.whatsappId, jid))
      .run()
  }

  // Insert message (ignore duplicates)
  try {
    db.insert(schema.messages).values({
      contactId: contact!.id,
      whatsappMsgId: msg.key.id!,
      direction: isOutgoing ? 'out' : 'in',
      body,
      type,
      timestamp: new Date(timestamp),
      status: isOutgoing ? statusFromNumber(msg.status ?? 0) : undefined,
      createdAt: new Date()
    }).run()
  } catch {
    // Duplicate — ignore
  }

  return { contact: contact ?? null, isNew }
}

function extractBodyFromRaw(raw: any): string | undefined {
  const m = raw?.message
  if (!m) return undefined
  return (
    m.conversation ??
    m.extendedTextMessage?.text ??
    m.imageMessage?.caption ??
    m.videoMessage?.caption ??
    m.documentMessage?.fileName ??
    (m.audioMessage ? '[Voice note]' : undefined) ??
    (m.stickerMessage ? '[Sticker]' : undefined)
  )
}

function extractBody(msg: proto.IWebMessageInfo): string | undefined {
  const m = msg.message
  if (!m) return undefined
  return (
    m.conversation ??
    m.extendedTextMessage?.text ??
    m.imageMessage?.caption ??
    m.videoMessage?.caption ??
    m.documentMessage?.fileName ??
    (m.audioMessage ? '[Voice note]' : undefined) ??
    (m.stickerMessage ? '[Sticker]' : undefined)
  )
}

function extractType(msg: proto.IWebMessageInfo): schema.InsertMessage['type'] {
  const m = msg.message
  if (!m) return 'unknown'
  if (m.conversation || m.extendedTextMessage) return 'text'
  if (m.imageMessage) return 'image'
  if (m.audioMessage) return 'audio'
  if (m.videoMessage) return 'video'
  if (m.documentMessage) return 'document'
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
  return {
    id: msg.key.id,
    jid: msg.key.remoteJid,
    fromMe: msg.key.fromMe,
    body: extractBody(msg),
    type: extractType(msg),
    timestamp: Number(msg.messageTimestamp ?? 0) * 1000,
    status: msg.status
  }
}
