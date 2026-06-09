import { create } from 'zustand'
import type { Message } from '../../server/db/schema'

interface MessagesState {
  // contactId -> messages (chronological)
  byContact: Record<number, Message[]>
  loadingFor: number | null

  setMessages: (contactId: number, msgs: Message[]) => void
  prependMessages: (contactId: number, msgs: Message[]) => void
  upsertMessage: (contactId: number, msg: Message) => void
  updateMessageStatus: (whatsappMsgId: string, status: Message['status']) => void
  markDeleted: (whatsappMsgId: string) => void
  resolveOptimistic: (tempId: string, realId: string) => void
  setLoading: (contactId: number | null) => void
}

export const useMessagesStore = create<MessagesState>((set) => ({
  byContact: {},
  loadingFor: null,

  setMessages: (contactId, msgs) =>
    set((s) => ({ byContact: { ...s.byContact, [contactId]: msgs } })),

  prependMessages: (contactId, msgs) =>
    set((s) => ({
      byContact: {
        ...s.byContact,
        [contactId]: [...msgs, ...(s.byContact[contactId] ?? [])]
      }
    })),

  upsertMessage: (contactId, msg) =>
    set((s) => {
      const existing = s.byContact[contactId] ?? []
      const idx = existing.findIndex((m) => m.whatsappMsgId === msg.whatsappMsgId)
      if (idx === -1) return { byContact: { ...s.byContact, [contactId]: [...existing, msg] } }
      const next = [...existing]
      next[idx] = msg
      return { byContact: { ...s.byContact, [contactId]: next } }
    }),

  updateMessageStatus: (whatsappMsgId, status) =>
    set((s) => {
      const next = { ...s.byContact }
      for (const [cid, msgs] of Object.entries(next)) {
        const idx = msgs.findIndex((m) => m.whatsappMsgId === whatsappMsgId)
        if (idx !== -1) {
          const updated = [...msgs]
          updated[idx] = { ...updated[idx], status }
          next[Number(cid)] = updated
        }
      }
      return { byContact: next }
    }),

  markDeleted: (whatsappMsgId) =>
    set((s) => {
      const next = { ...s.byContact }
      for (const [cid, msgs] of Object.entries(next)) {
        const idx = msgs.findIndex((m) => m.whatsappMsgId === whatsappMsgId)
        if (idx !== -1) {
          const updated = [...msgs]
          updated[idx] = { ...updated[idx], isDeleted: true, body: null }
          next[Number(cid)] = updated
        }
      }
      return { byContact: next }
    }),

  resolveOptimistic: (tempId, realId) =>
    set((s) => {
      const next = { ...s.byContact }
      for (const [cid, msgs] of Object.entries(next)) {
        const idx = msgs.findIndex((m) => m.whatsappMsgId === tempId)
        if (idx !== -1) {
          const updated = [...msgs]
          updated[idx] = { ...updated[idx], whatsappMsgId: realId, status: 'sent' }
          next[Number(cid)] = updated
          break
        }
      }
      return { byContact: next }
    }),

  setLoading: (contactId) => set({ loadingFor: contactId })
}))
