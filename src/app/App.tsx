import { useEffect, useState } from 'react'
import { OnboardingPage } from './pages/OnboardingPage'
import { KanbanPage } from './pages/KanbanPage'
import { SettingsPage } from './pages/SettingsPage'
import { useContactsStore } from './stores/contactsStore'
import { useRemindersStore } from './stores/remindersStore'
import { useWhatsApp } from './hooks/useWhatsApp'
import { useSnooze } from './hooks/useSnooze'

type Page = 'kanban' | 'settings'

export default function App() {
  const [waStatus, setWaStatus] = useState<'disconnected' | 'connecting' | 'connected'>('connecting')
  const [pendingQR, setPendingQR] = useState(false)  // true when WA sends a QR code
  const [page, setPage] = useState<Page>('kanban')
  const { setContacts } = useContactsStore()
  const { setReminders } = useRemindersStore()

  // Bootstrap: get initial WA status, contacts, and reminders
  useEffect(() => {
    const port = getPort()
    const fetchContacts = () =>
      fetch(`http://127.0.0.1:${port}/contacts`)
        .then((r) => r.json())
        .then(setContacts)
        .catch(console.error)

    window.api.getWAStatus().then((s: any) => setWaStatus(s))

    // Listen for QR code events — show onboarding whenever WA sends a QR
    const offQR = window.api.onQR(() => setPendingQR(true))
    fetchContacts()
    fetch(`http://127.0.0.1:${port}/reminders`)
      .then((r) => r.json())
      .then(setReminders)
      .catch(console.error)

    // Re-fetch contacts after history sync batches finish
    const offHistory = window.api.onHistorySynced(fetchContacts)
    return () => { offHistory(); offQR() }
  }, [])

  useWhatsApp((s) => {
    setWaStatus(s)
    if (s === 'connected') setPendingQR(false)  // clear QR once connected
  })
  useSnooze()

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey && e.key === ',') {
        e.preventDefault()
        setPage('settings')
      }
      if (e.key === 'Escape' && page === 'settings') {
        setPage('kanban')
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [page])

  // Show onboarding if no contacts loaded OR if WA is asking us to scan a QR
  const contacts = useContactsStore((s) => s.contacts)
  const showOnboarding = pendingQR || (waStatus !== 'connected' && contacts.length === 0)

  if (showOnboarding) {
    return <OnboardingPage waStatus={waStatus} />
  }

  if (page === 'settings') {
    return <SettingsPage onBack={() => setPage('kanban')} />
  }

  return <KanbanPage waStatus={waStatus} onOpenSettings={() => setPage('settings')} />
}

function getPort(): number {
  return window.api?.serverPort ?? 3847
}
