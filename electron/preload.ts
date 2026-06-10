import { contextBridge, ipcRenderer } from 'electron'

// Inject server port synchronously before any page scripts run
const serverPort = ipcRenderer.sendSync('server:port-sync') as number

// Many components subscribe to wa:historySynced — raise the limit to avoid warnings
ipcRenderer.setMaxListeners(300)

// ─── IPC API exposed to the renderer ─────────────────────────────────────────

export const api = {
  // WhatsApp — messaging
  getWAStatus: () => ipcRenderer.invoke('wa:getStatus'),
  sendMessage: (jid: string, text: string) => ipcRenderer.invoke('wa:sendMessage', jid, text),
  sendMedia: (jid: string, mediaPath: string, caption?: string) =>
    ipcRenderer.invoke('wa:sendMedia', jid, mediaPath, caption),
  sendReaction: (jid: string, whatsappMsgId: string, emoji: string) =>
    ipcRenderer.invoke('wa:sendReaction', jid, whatsappMsgId, emoji),

  // Events from main → renderer
  onWAStatus: (cb: (status: string) => void) => {
    const h = (_e: any, s: string) => cb(s)
    ipcRenderer.on('wa:status', h)
    return () => ipcRenderer.removeListener('wa:status', h)
  },
  onNewMessage: (cb: (msg: unknown) => void) => {
    const h = (_e: any, m: unknown) => cb(m)
    ipcRenderer.on('wa:newMessage', h)
    return () => ipcRenderer.removeListener('wa:newMessage', h)
  },
  onMessageUpdate: (cb: (update: unknown) => void) => {
    const h = (_e: any, u: unknown) => cb(u)
    ipcRenderer.on('wa:messageUpdate', h)
    return () => ipcRenderer.removeListener('wa:messageUpdate', h)
  },
  onReactionUpdate: (cb: (payload: { whatsappMsgId: string; reactions: Record<string, string> | null }) => void) => {
    const h = (_e: any, payload: { whatsappMsgId: string; reactions: Record<string, string> | null }) => cb(payload)
    ipcRenderer.on('wa:reactionUpdate', h)
    return () => ipcRenderer.removeListener('wa:reactionUpdate', h)
  },
  onQR: (cb: (payload: { qr: string; accountId: number }) => void) => {
    const h = (_e: any, payload: { qr: string; accountId: number }) => cb(payload)
    ipcRenderer.on('wa:qr', h)
    return () => ipcRenderer.removeListener('wa:qr', h)
  },
  onContactUpserted: (cb: (contact: unknown) => void) => {
    const h = (_e: any, c: unknown) => cb(c)
    ipcRenderer.on('wa:contactUpserted', h)
    return () => ipcRenderer.removeListener('wa:contactUpserted', h)
  },
  onHistorySynced: (cb: () => void) => {
    const h = () => cb()
    ipcRenderer.on('wa:historySynced', h)
    return () => ipcRenderer.removeListener('wa:historySynced', h)
  },

  // WhatsApp — account management
  getAccounts: () => ipcRenderer.invoke('wa:getAccounts'),
  getActiveAccountId: () => ipcRenderer.invoke('wa:getActiveAccountId'),
  switchAccount: (accountId: number) => ipcRenderer.invoke('wa:switchAccount', accountId),
  addAccount: () => ipcRenderer.invoke('wa:addAccount'),
  removeAccount: (accountId: number) => ipcRenderer.invoke('wa:removeAccount', accountId),
  updateAccountLabel: (accountId: number, label: string) =>
    ipcRenderer.invoke('wa:updateAccountLabel', accountId, label),

  onAccounts: (cb: (accounts: unknown[]) => void) => {
    const h = (_e: any, accts: unknown[]) => cb(accts)
    ipcRenderer.on('wa:accounts', h)
    return () => ipcRenderer.removeListener('wa:accounts', h)
  },
  onActiveAccount: (cb: (accountId: number) => void) => {
    const h = (_e: any, id: number) => cb(id)
    ipcRenderer.on('wa:activeAccount', h)
    return () => ipcRenderer.removeListener('wa:activeAccount', h)
  },

  // WhatsApp re-link (clears auth + shows QR for active account)
  resetWAAuth: () => ipcRenderer.invoke('wa:resetAuth'),
  // Force re-fetch avatar for a specific contact
  syncAvatar: (contactId: number) => ipcRenderer.invoke('wa:syncAvatar', contactId),
  // Force WhatsApp to re-push the contacts address book
  resyncContacts: () => ipcRenderer.invoke('wa:resyncContacts'),

  // Notifications & badge
  notify: (title: string, body: string) => ipcRenderer.invoke('notify', title, body),
  setBadge: (count: number) => ipcRenderer.invoke('set-badge', count),
  getUserDataPath: () => ipcRenderer.invoke('get-user-data-path'),

  // Settings (Keychain)
  getApiKey: () => ipcRenderer.invoke('keychain:get'),
  setApiKey: (key: string) => ipcRenderer.invoke('keychain:set', key),
  deleteApiKey: () => ipcRenderer.invoke('keychain:delete'),

  // Google Contacts OAuth
  openGoogleAuth: () => ipcRenderer.invoke('google:openAuth'),
  onGoogleAuthComplete: (cb: () => void) => {
    const h = () => cb()
    ipcRenderer.on('google:authComplete', h)
    return () => ipcRenderer.removeListener('google:authComplete', h)
  },

  // Server port (for HTTP API calls from renderer)
  serverPort,

  // Auto-update — fired only when update is fully downloaded and ready to install
  onUpdateReady: (cb: (info: { version: string }) => void) => {
    const h = (_e: any, info: { version: string }) => cb(info)
    ipcRenderer.on('app:updateReady', h)
    return () => ipcRenderer.removeListener('app:updateReady', h)
  },
  restartAndInstall: () => ipcRenderer.invoke('app:restartAndInstall'),
  openReleasePage: (url: string) => ipcRenderer.invoke('app:openReleasePage', url),

  // App version (shown in Settings)
  getAppVersion: (): Promise<string> => ipcRenderer.invoke('app:getVersion'),

  // Chrome extension helpers
  getExtensionPath: () => ipcRenderer.invoke('app:getExtensionPath'),
  openExtensionInFinder: () => ipcRenderer.invoke('app:openExtensionInFinder'),
  openChromeExtensions: () => ipcRenderer.invoke('app:openChromeExtensions'),

  // File picker (#4 send media)
  pickFile: (): Promise<string | null> => ipcRenderer.invoke('app:pickFile'),

  // Force sync — triggers resyncAppState + catch-up history fetch
  forceSync: () => ipcRenderer.invoke('wa:resyncContacts')
}

contextBridge.exposeInMainWorld('api', api)
