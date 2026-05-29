import { useEffect, useRef } from 'react'
import { useRemindersStore } from '../stores/remindersStore'
import { useContactsStore } from '../stores/contactsStore'
import type { Reminder } from '../../server/db/schema'

// Polls active reminders every 30 seconds and fires when due
export function useSnooze() {
  const { reminders, markDone } = useRemindersStore()
  const { contacts, setSelectedContactId } = useContactsStore()
  const firedRef = useRef<Set<number>>(new Set())

  useEffect(() => {
    const check = () => {
      const now = Date.now()
      for (const reminder of reminders) {
        if (reminder.isDone) continue
        if (firedRef.current.has(reminder.id)) continue
        if (new Date(reminder.dueAt).getTime() > now) continue

        firedRef.current.add(reminder.id)
        fireReminder(reminder, contacts, setSelectedContactId, markDone)
      }
    }

    check()
    const interval = setInterval(check, 30_000)
    return () => clearInterval(interval)
  }, [reminders, contacts])
}

function fireReminder(
  reminder: Reminder,
  contacts: any[],
  setSelectedContactId: (id: number) => void,
  markDone: (id: number) => void
) {
  const contact = contacts.find((c) => c.id === reminder.contactId)
  const name = contact?.name ?? contact?.phone ?? 'Contacto'
  const note = reminder.note ?? 'Recordatorio'

  // OS notification
  window.api.notify(name, note)

  // In-app toast
  showSnoozeToast(name, note, () => {
    setSelectedContactId(reminder.contactId)
    markDone(reminder.id)
  }, () => {
    markDone(reminder.id)
  })
}

function showSnoozeToast(
  name: string,
  note: string,
  onOpen: () => void,
  onDismiss: () => void
) {
  const toast = document.createElement('div')
  toast.style.cssText = `
    position: fixed; bottom: 24px; right: 24px; z-index: 9999;
    background: white; border-radius: 12px; padding: 16px 20px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.16); max-width: 320px;
    font-family: -apple-system, sans-serif; border: 1px solid #e5e7eb;
  `
  toast.innerHTML = `
    <div style="font-weight:600;margin-bottom:4px;font-size:14px;">🔔 ${name}</div>
    <div style="color:#6b7280;font-size:13px;margin-bottom:12px;">${note}</div>
    <div style="display:flex;gap:8px;">
      <button id="snooze-open" style="flex:1;padding:6px 12px;background:#111827;color:white;border:none;border-radius:6px;cursor:pointer;font-size:13px;">
        Abrir chat
      </button>
      <button id="snooze-dismiss" style="flex:1;padding:6px 12px;background:#f3f4f6;color:#374151;border:none;border-radius:6px;cursor:pointer;font-size:13px;">
        Descartar
      </button>
    </div>
  `

  document.body.appendChild(toast)

  const remove = () => document.body.removeChild(toast)

  toast.querySelector('#snooze-open')!.addEventListener('click', () => { remove(); onOpen() })
  toast.querySelector('#snooze-dismiss')!.addEventListener('click', () => { remove(); onDismiss() })

  // Auto-dismiss after 30 s
  setTimeout(() => { if (document.body.contains(toast)) { remove(); onDismiss() } }, 30_000)
}
