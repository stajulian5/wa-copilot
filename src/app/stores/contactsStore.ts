import { create } from 'zustand'
import { arrayMove } from '@dnd-kit/sortable'
import type { Contact } from '../../server/db/schema'

// ── Persisted column order ────────────────────────────────────────────────────

const STORAGE_KEY = 'kanban_order_v1'

function loadOrder(): Record<string, number[]> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch { return {} }
}

function saveOrder(order: Record<string, number[]>) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(order)) } catch {}
}

// ─────────────────────────────────────────────────────────────────────────────

interface ContactsState {
  contacts: Contact[]
  selectedContactId: number | null
  searchQuery: string
  isLoading: boolean
  /** Currently viewed account — only its contacts appear in the Kanban */
  activeAccountId: number
  /** Maps stage key → ordered array of contact IDs (persisted to localStorage) */
  stageOrder: Record<string, number[]>

  setContacts: (contacts: Contact[]) => void
  upsertContact: (contact: Contact) => void
  updateContact: (id: number, patch: Partial<Contact>) => void
  setSelectedContactId: (id: number | null) => void
  setSearchQuery: (q: string) => void
  setLoading: (v: boolean) => void
  setActiveAccountId: (id: number) => void

  /** Reorder two contacts within the same stage */
  reorderContacts: (stage: Contact['stage'], activeId: number, overId: number) => void
  /** Move a contact to a new stage, optionally inserting before overId */
  moveToStage: (contactId: number, newStage: Contact['stage'], overId?: number) => void

  // Derived
  getByStage: (stage: Contact['stage']) => Contact[]
  getSelected: () => Contact | undefined
}

export const useContactsStore = create<ContactsState>((set, get) => ({
  contacts: [],
  selectedContactId: null,
  searchQuery: '',
  isLoading: false,
  activeAccountId: 1,
  stageOrder: loadOrder(),

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
  setActiveAccountId: (id) => set({ activeAccountId: id }),

  reorderContacts: (stage, activeId, overId) => {
    const { contacts, stageOrder } = get()
    // Build the current order for this stage (custom order if set, else by recency)
    const stageContacts = contacts.filter(c => c.stage === stage)
      .sort((a, b) => {
        const ta = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0
        const tb = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0
        return tb - ta
      })
    const currentOrder = stageOrder[stage] ?? stageContacts.map(c => c.id)
    const oldIndex = currentOrder.indexOf(activeId)
    const newIndex = currentOrder.indexOf(overId)
    if (oldIndex === -1 || newIndex === -1) return
    const newOrder = arrayMove(currentOrder, oldIndex, newIndex)
    const next = { ...stageOrder, [stage]: newOrder }
    saveOrder(next)
    set({ stageOrder: next })
  },

  moveToStage: (contactId, newStage, overId?) => {
    const { contacts, stageOrder } = get()
    const contact = contacts.find(c => c.id === contactId)
    if (!contact) return
    const oldStage = contact.stage

    // Remove from old stage order
    const oldOrder = stageOrder[oldStage] ??
      contacts.filter(c => c.stage === oldStage).map(c => c.id)
    const newOldOrder = oldOrder.filter(id => id !== contactId)

    // Build new stage order
    const newStageContacts = contacts.filter(c => c.stage === newStage)
      .sort((a, b) => {
        const ta = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0
        const tb = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0
        return tb - ta
      })
    let newStageOrder = (stageOrder[newStage] ?? newStageContacts.map(c => c.id))
      .filter(id => id !== contactId) // ensure not already present
    if (overId !== undefined) {
      const insertIdx = newStageOrder.indexOf(overId)
      if (insertIdx !== -1) {
        newStageOrder = [
          ...newStageOrder.slice(0, insertIdx),
          contactId,
          ...newStageOrder.slice(insertIdx)
        ]
      } else {
        newStageOrder = [contactId, ...newStageOrder]
      }
    } else {
      // Dropped on empty column: prepend
      newStageOrder = [contactId, ...newStageOrder]
    }

    const next = { ...stageOrder, [oldStage]: newOldOrder, [newStage]: newStageOrder }
    saveOrder(next)
    set({ stageOrder: next })
  },

  getByStage: (stage) => {
    const { contacts, searchQuery, stageOrder, activeAccountId } = get()
    const q = searchQuery.toLowerCase()
    const stageContacts = contacts
      .filter((c) => c.accountId === activeAccountId)
      .filter((c) => c.stage === stage)
      .filter(
        (c) =>
          !q ||
          (c.name ?? '').toLowerCase().includes(q) ||
          (c.phone ?? '').includes(q)
      )

    // When searching, always sort by recency (user expects search results sorted)
    if (q) {
      return stageContacts.sort((a, b) => {
        const ta = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0
        const tb = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0
        return tb - ta
      })
    }

    const order = stageOrder[stage]
    if (!order || order.length === 0) {
      // No custom order yet: sort by recency
      return stageContacts.sort((a, b) => {
        const ta = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0
        const tb = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0
        return tb - ta
      })
    }

    // Apply custom order. Contacts not yet in the order array go to the bottom sorted by recency.
    const orderMap = new Map(order.map((id, idx) => [id, idx]))
    return stageContacts.sort((a, b) => {
      const ia = orderMap.has(a.id) ? orderMap.get(a.id)! : Infinity
      const ib = orderMap.has(b.id) ? orderMap.get(b.id)! : Infinity
      if (ia !== ib) return ia - ib
      // Both unordered: sort by recency
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
