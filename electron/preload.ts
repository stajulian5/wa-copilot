import { contextBridge, ipcRenderer } from 'electron'

// Inject server port synchronously before any page scripts run
const serverPort = ipcRenderer.sendSync('server:port-sync') as number

// ─── IPC API exposed to the renderer ─────────────────────────────────────────

export const api = {
  // WhatsApp
  getWAStatus: () => ipcRenderer.invoke('wa:getStatus'),
  sendMessage: (jid: string, text: string) => ipcRenderer.invoke('wa:sendMessage', jid, text),
  sendMedia: (jid: string, mediaPath: string, caption?: string) =>
    ipcRenderer.invoke('wa:sendMedia', jid, mediaPath, caption),

  // Events from main → renderer
  onWAStatus: (cb: (status: string) => void) => {
    ipcRenderer.on('wa:status', (_e, status) => cb(status))
    return () => ipcRenderer.removeAllListeners('wa:status')
  },
  onNewMessage: (cb: (msg: unknown) => void) => {
    ipcRenderer.on('wa:newMessage', (_e, msg) => cb(msg))
    return () => ipcRenderer.removeAllListeners('wa:newMessage')
  },
  onMessageUpdate: (cb: (update: unknown) => void) => {
    ipcRenderer.on('wa:messageUpdate', (_e, update) => cb(update))
    return () => ipcRenderer.removeAllListeners('wa:messageUpdate')
  },
  onQR: (cb: (qr: string) => void) => {
    ipcRenderer.on('wa:qr', (_e, qr) => cb(qr))
    return () => ipcRenderer.removeAllListeners('wa:qr')
  },
  onContactUpserted: (cb: (contact: unknown) => void) => {
    ipcRenderer.on('wa:contactUpserted', (_e, contact) => cb(contact))
    return () => ipcRenderer.removeAllListeners('wa:contactUpserted')
  },
  onHistorySynced: (cb: () => void) => {
    ipcRenderer.on('wa:historySynced', () => cb())
    return () => ipcRenderer.removeAllListeners('wa:historySynced')
  },

  // Notifications & badge
  notify: (title: string, body: string) => ipcRenderer.invoke('notify', title, body),
  setBadge: (count: number) => ipcRenderer.invoke('set-badge', count),
  getUserDataPath: () => ipcRenderer.invoke('get-user-data-path'),

  // Settings (Keychain)
  getApiKey: () => ipcRenderer.invoke('keychain:get'),
  setApiKey: (key: string) => ipcRenderer.invoke('keychain:set', key),
  deleteApiKey: () => ipcRenderer.invoke('keychain:delete'),

  // Server port (for HTTP API calls from renderer)
  serverPort
}

contextBridge.exposeInMainWorld('api', api)
