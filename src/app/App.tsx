import { useEffect, useState } from 'react'
import { OnboardingPage } from './pages/OnboardingPage'
import { KanbanPage } from './pages/KanbanPage'
import { SettingsPage } from './pages/SettingsPage'
import { AddAccountModal } from './components/AddAccountModal'
import { useContactsStore } from './stores/contactsStore'
import { useRemindersStore } from './stores/remindersStore'
import { useWhatsApp } from './hooks/useWhatsApp'
import { useSnooze } from './hooks/useSnooze'
import type { Account } from '../server/db/schema'

type Page = 'kanban' | 'settings' | 'linking'

export default function App() {
  const [waStatus, setWaStatus] = useState<'disconnected' | 'connecting' | 'connected'>('connecting')
  const [page, setPage] = useState<Page>('kanban')
  // For initial link (account 1, no JID yet): full-screen QR
  const [onboardingQR, setOnboardingQR] = useState<string | null>(null)
  // For adding a second account: modal overlay QR
  const [addAccountQR, setAddAccountQR] = useState<{ qr: string; accountId: number } | null>(null)

  const [accounts, setAccounts] = useState<Account[]>([])
  const [lastSyncAt, setLastSyncAt] = useState<Date | null>(null)
  const [updateInfo, setUpdateInfo] = useState<{ version: string } | null>(null)

  const { setContacts, setActiveAccountId } = useContactsStore()
  const { setReminders } = useRemindersStore()

  useEffect(() => {
    const port = getPort()
    const fetchContacts = () =>
      fetch(`http://127.0.0.1:${port}/contacts`)
        .then((r) => r.json())
        .then(setContacts)
        .catch(console.error)

    // Initial data fetch
    window.api.getWAStatus().then((s: any) => setWaStatus(s))
    fetchContacts()
    fetch(`http://127.0.0.1:${port}/reminders`)
      .then((r) => r.json())
      .then(setReminders)
      .catch(console.error)

    // Load accounts + active account id
    window.api.getAccounts().then(setAccounts).catch(console.error)
    window.api.getActiveAccountId().then((id) => setActiveAccountId(id)).catch(console.error)

    // QR events — route based on whether this is initial linking or add-account
    const offQR = window.api.onQR(({ qr, accountId }) => {
      // Find if this account already has a JID (i.e. is a known account that just needs re-link)
      const acct = accounts.find(a => a.id === accountId)
      const isNewAccount = !acct?.jid  // placeholder account (no JID yet) = add-account flow
      const isActiveAccount = accountId === useContactsStore.getState().activeAccountId

      if (isNewAccount && acct && acct.id !== 1) {
        // Second+ account being added: show modal overlay
        setAddAccountQR({ qr, accountId })
      } else {
        // Account 1 initial link or re-link: full-screen onboarding
        setOnboardingQR(qr)
        setPage(p => p === 'kanban' || p === 'settings' ? p : 'linking')
        if (isActiveAccount) {
          setPage('linking')
        }
      }
    })

    // Account list updates (add/remove/JID assigned)
    const offAccounts = window.api.onAccounts((accts) => {
      setAccounts(accts)
      // If the add-account QR modal is open and the new account now has a JID, close it
      setAddAccountQR(prev => {
        if (!prev) return null
        const account = accts.find(a => a.id === prev.accountId)
        return account?.jid ? null : prev  // close modal once JID is assigned
      })
    })

    // Active account switched from main process
    const offActiveAccount = window.api.onActiveAccount((id) => {
      setActiveAccountId(id)
    })

    const offUpdate = window.api.onUpdateReady((info) => setUpdateInfo(info))

    const offHistory = window.api.onHistorySynced(() => {
      fetchContacts()
      setLastSyncAt(new Date())
    })

    return () => { offUpdate(); offHistory(); offQR(); offAccounts(); offActiveAccount() }
  }, [])

  useWhatsApp(
    (s) => {
      setWaStatus(s)
      // Navigation away from onboarding is now handled inside OnboardingPage itself
      // (via the onComplete prop). We only need to handle the settings→kanban case here.
      if (s === 'connected' && page !== 'linking') {
        setOnboardingQR(null)
      }
    },
    () => setLastSyncAt(new Date())
  )
  useSnooze()

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

  const contacts = useContactsStore((s) => s.contacts)
  const activeAccountId = useContactsStore((s) => s.activeAccountId)

  // ── #1 Dock badge — total unread across all contacts ─────────────────────
  useEffect(() => {
    const total = contacts.reduce((sum, c) => sum + (c.unreadCount ?? 0), 0)
    window.api.setBadge(total)
  }, [contacts])

  // Show full-screen QR when: explicitly linking, or first-time (no contacts + not connected)
  if (page === 'linking' || (waStatus !== 'connected' && contacts.length === 0)) {
    return (
      <OnboardingPage
        waStatus={waStatus}
        initialQr={onboardingQR}
        onQRReceived={setOnboardingQR}
        isRelink={page === 'linking'}
        onComplete={() => {
          setOnboardingQR(null)
          setPage('kanban')
        }}
      />
    )
  }

  if (page === 'settings') {
    return (
      <SettingsPage
        onBack={() => setPage('kanban')}
        onStartRelink={async () => {
          try {
            // Race the IPC call against a 5 s timeout so navigation always fires
            // even if the main-process handler hangs (e.g. socket in bad state).
            await Promise.race([
              window.api.resetWAAuth(),
              new Promise<void>(resolve => setTimeout(resolve, 5_000))
            ])
          } finally {
            setOnboardingQR(null)
            setPage('linking')
          }
        }}
      />
    )
  }

  return (
    <>
      {/* Modal overlay for adding a second WA number */}
      {addAccountQR && (
        <AddAccountModal
          qr={addAccountQR.qr}
          accountId={addAccountQR.accountId}
          onClose={async () => {
            await window.api.removeAccount(addAccountQR.accountId)
            setAddAccountQR(null)
          }}
        />
      )}


      <KanbanPage
        waStatus={waStatus}
        accounts={accounts}
        activeAccountId={activeAccountId}
        lastSyncAt={lastSyncAt}
        onOpenSettings={() => setPage('settings')}
        onSwitchAccount={async (id) => {
          await window.api.switchAccount(id)
          setActiveAccountId(id)
        }}
        onAddAccount={async () => {
          await window.api.addAccount()
          // QR will arrive via onQR event → sets addAccountQR
        }}
      />
    </>
  )
}

function getPort(): number {
  return window.api?.serverPort ?? 3847
}
