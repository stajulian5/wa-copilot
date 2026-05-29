import type { Contact, Message } from '../../server/db/schema'

declare global {
  interface Window {
    __SERVER_PORT__: number
    api: {
      // WhatsApp
      getWAStatus: () => Promise<'disconnected' | 'connecting' | 'connected'>
      sendMessage: (jid: string, text: string) => Promise<string | undefined>
      sendMedia: (jid: string, mediaPath: string, caption?: string) => Promise<unknown>

      // Events (return cleanup function)
      onWAStatus: (cb: (status: string) => void) => () => void
      onNewMessage: (cb: (msg: unknown) => void) => () => void
      onMessageUpdate: (cb: (update: unknown) => void) => () => void
      onQR: (cb: (qr: string) => void) => () => void
      onContactUpserted: (cb: (contact: Contact) => void) => () => void
      onHistorySynced: (cb: () => void) => () => void

      // WhatsApp re-link
      resetWAAuth: () => Promise<void>

      // System
      notify: (title: string, body: string) => Promise<void>
      setBadge: (count: number) => Promise<void>
      getUserDataPath: () => Promise<string>

      // Keychain
      getApiKey: () => Promise<string | null>
      setApiKey: (key: string) => Promise<void>
      deleteApiKey: () => Promise<void>

      // Server port
      serverPort: number
    }
  }
}

export {}
