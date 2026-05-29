import { create } from 'zustand'
import type { Contact } from '../../server/db/schema'

interface ContactsState {
  contacts: Contact[]
  selectedContactId: number | null
  searchQuery: string
  isLoading: boolean

  setContacts: (contacts: Contact[]) => void
  upsertContact: (contact: Contact) => void
  updateContact: (id: number, patch: Partial<Contact>) => void
  setSelectedContactId: (id: number | null) => void
  setSearchQuery: (q: string) => void
  setLoading: (v: boolean) => void

  // Derived
  getByStage: (stage: Contact['stage']) => Contact[]
  getSelected: () => Contact | undefined
}

export const useContactsStore = create<ContactsState>((set, get) => ({
  contacts: [],
  selectedContactId: null,
  searchQuery: '',
  isLoading: false,

  setContacts: (contacts) => set({ contacts }),

  upsertContact: (contact) =>
    set((s) => {
      const idx = s.contacts.findIndex((c) => c.id === contact.id)
      if (idx === -1) return { contacts: [contact, ...s.contacts] }
      const next = [...s.contacts]
      next[idx] = contact
      return { contacts: next }
    }),

  updateContact: (id, patch) =>
    set((s) => ({
      contacts: s.contacts.map((c) => (c.id === id ? { ...c, ...patch } : c))
    })),

  setSelectedContactId: (id) => set({ selectedContactId: id }),
  setSearchQuery: (q) => set({ searchQuery: q }),
  setLoading: (v) => set({ isLoading: v }),

  getByStage: (stage) => {
    const { contacts, searchQuery } = get()
    const q = searchQuery.toLowerCase()
    return contacts
      .filter((c) => c.stage === stage)
      .filter(
        (c) =>
          !q ||
          (c.name ?? '').toLowerCase().includes(q) ||
          c.phone.includes(q)
      )
      .sort((a, b) => {
        const ta = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0
        const tb = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0
        return tb - ta
      })
  },

  getSelected: () => {
    const { contacts, selectedContactId } = get()
    return contacts.find((c) => c.id === selectedContactId)
  }
}))
