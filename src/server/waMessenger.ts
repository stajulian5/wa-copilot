/**
 * Shared registry that holds the WhatsApp send function per account.
 * Set by electron/baileys.ts after each socket connects.
 * Used by Express routes that need to send WA messages.
 */
type Sender = (jid: string, text: string) => Promise<unknown>

// accountId → send function
const _senders = new Map<number, Sender>()
let _activeAccountId = 1

export const waMessenger = {
  set(accountId: number, fn: Sender) {
    _senders.set(accountId, fn)
  },
  remove(accountId: number) {
    _senders.delete(accountId)
  },
  setActiveAccountId(id: number) {
    _activeAccountId = id
  },
  async send(jid: string, text: string) {
    const sender = _senders.get(_activeAccountId)
    if (!sender) throw new Error('WhatsApp not connected')
    return sender(jid, text)
  },
  isConnected() {
    return _senders.has(_activeAccountId)
  }
}
