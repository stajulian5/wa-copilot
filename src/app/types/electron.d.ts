import type { Contact, Message, Account } from '../../server/db/schema'

declare global {
  interface Window {
    __SERVER_PORT__: number
    api: {
      // WhatsApp — messaging
      getWAStatus: () => Promise<'disconnected' | 'connecting' | 'connected'>
      sendMessage: (jid: string, text: string) => Promise<string | undefined>
      sendMedia: (jid: string, mediaPath: string, caption?: string) => Promise<unknown>

      // Events (return cleanup function)
      onWAStatus: (cb: (status: string) => void) => () => void
      onNewMessage: (cb: (msg: unknown) => void) => () => void
      onMessageUpdate: (cb: (update: unknown) => void) => () => void
      onQR: (cb: (payload: { qr: string; accountId: number }) => void) => () => void
      onContactUpserted: (cb: (contact: Contact) => void) => () => void
      onHistorySynced: (cb: () => void) => () => void

      // WhatsApp — account management
      getAccounts: () => Promise<Account[]>
      getActiveAccountId: () => Promise<number>
      switchAccount: (accountId: number) => Promise<void>
      addAccount: () => Promise<number>
      removeAccount: (accountId: number) => Promise<void>
      updateAccountLabel: (accountId: number, label: string) => Promise<void>
      onAccounts: (cb: (accounts: Account[]) => void) => () => void
      onActiveAccount: (cb: (accountId: number) => void) => () => void

      // WhatsApp re-link
      resetWAAuth: () => Promise<void>
      syncAvatar: (contactId: number) => Promise<boolean>
      resyncContacts: () => Promise<boolean>

      // System
      notify: (title: string, body: string) => Promise<void>
      setBadge: (count: number) => Promise<void>
      getUserDataPath: () => Promise<string>

      // Keychain
      getApiKey: () => Promise<string | null>
      setApiKey: (key: string) => Promise<void>
      deleteApiKey: () => Promise<void>

      // Google Contacts OAuth
      openGoogleAuth: () => Promise<void>
      onGoogleAuthComplete: (cb: () => void) => () => void

      // Server port
      serverPort: number

      // Auto-update
      onUpdateAvailable: (cb: (info: { version: string; url: string }) => void) => () => void
      openReleasePage: (url: string) => Promise<void>

      // Chrome extension helpers
      getExtensionPath: () => Promise<string>
      openExtensionInFinder: () => Promise<void>
      openChromeExtensions: () => Promise<void>

      // File picker
      pickFile: () => Promise<string | null>
    }
  }
}

export {}
