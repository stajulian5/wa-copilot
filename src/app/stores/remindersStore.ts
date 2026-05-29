import { create } from 'zustand'
import type { Reminder } from '../../server/db/schema'

interface RemindersState {
  reminders: Reminder[]
  setReminders: (r: Reminder[]) => void
  addReminder: (r: Reminder) => void
  markDone: (id: number) => void
  getForContact: (contactId: number) => Reminder[]
  getDueToday: () => Reminder[]
}

export const useRemindersStore = create<RemindersState>((set, get) => ({
  reminders: [],

  setReminders: (reminders) => set({ reminders }),

  addReminder: (r) => set((s) => ({ reminders: [...s.reminders, r] })),

  markDone: (id) =>
    set((s) => ({
      reminders: s.reminders.map((r) => (r.id === id ? { ...r, isDone: true } : r))
    })),

  getForContact: (contactId) =>
    get().reminders.filter((r) => r.contactId === contactId && !r.isDone),

  getDueToday: () => {
    const now = Date.now()
    const endOfDay = new Date()
    endOfDay.setHours(23, 59, 59, 999)
    return get().reminders.filter(
      (r) => !r.isDone && new Date(r.dueAt).getTime() <= endOfDay.getTime()
    )
  }
}))
