import { useState, useEffect } from 'react'
import { useContactsStore } from '../stores/contactsStore'
import type { Account } from '../../server/db/schema'

interface Props {
  waStatus: 'disconnected' | 'connecting' | 'connected'
  searchRef: React.RefObject<HTMLInputElement>
  onOpenSettings: () => void
  accounts: Account[]
  activeAccountId: number
  onSwitchAccount: (id: number) => void
  onAddAccount: () => void
  lastSyncAt: Date | null
}

const statusConfig = {
  connected: { dot: 'bg-green-500', label: 'Conectado' },
  connecting: { dot: 'bg-amber-400 animate-pulse', label: 'Conectando…' },
  disconnected: { dot: 'bg-red-500', label: 'Desconectado' }
}

export function NavBar({
  waStatus, searchRef, onOpenSettings,
  accounts, activeAccountId, onSwitchAccount, onAddAccount, lastSyncAt
}: Props) {
  const { setSearchQuery, searchQuery, contacts } = useContactsStore()
  const status = statusConfig[waStatus]
  const [showAccountMenu, setShowAccountMenu] = useState(false)
  const [, forceUpdate] = useState(0)

  // Re-render every 30 s so the relative time stays fresh
  useEffect(() => {
    const t = setInterval(() => forceUpdate(n => n + 1), 30_000)
    return () => clearInterval(t)
  }, [])

  const activeAccount = accounts.find(a => a.id === activeAccountId)

  // Format JID as readable phone: "5215648924495:29@s.whatsapp.net" → "+52 564 892 4495"
  function formatJidPhone(jid: string | null): string | null {
    if (!jid) return null
    // Strip device-ID suffix (:29) then domain
    let digits = jid.split('@')[0].split(':')[0]
    // Normalize old MX mobile format: 521XXXXXXXXXX → 52XXXXXXXXXX
    if (digits.startsWith('521') && digits.length === 13) digits = '52' + digits.slice(3)
    if (digits.startsWith('52') && digits.length === 12)
      return `+52 ${digits.slice(2, 5)} ${digits.slice(5, 8)} ${digits.slice(8)}`
    return `+${digits}`
  }

  // Use the saved label only if it's a real custom name (not the factory default).
  // Returns "…" while accounts haven't loaded yet.
  function accountLabel(account: typeof activeAccount): string {
    if (!account) return accounts.length === 0 ? '…' : 'Mi número'
    if (account.label && account.label !== 'Mi número') return account.label
    return formatJidPhone(account.jid ?? null) ?? account.label
  }

  // Compute unread per account
  const unreadByAccount = (accountId: number) =>
    contacts.filter(c => c.accountId === accountId).reduce((s, c) => s + (c.unreadCount ?? 0), 0)

  return (
    <div className="title-bar-drag flex items-center gap-3 h-12 px-4 bg-white border-b border-gray-200">
      {/* Traffic lights space */}
      <div className="w-16 title-bar-drag" />

      <span className="font-semibold text-gray-900 text-sm title-bar-no-drag">✈️ WA Copilot</span>

      {/* Search */}
      <div className="title-bar-no-drag flex-1 max-w-xs">
        <input
          ref={searchRef}
          type="text"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="Buscar broker… ⌘K"
          className="w-full bg-gray-100 rounded-lg px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-gray-300"
        />
      </div>

      <div className="flex-1" />

      {/* WA Status + last sync */}
      <div className="title-bar-no-drag flex items-center gap-1.5">
        <div className={`w-2 h-2 rounded-full ${status.dot}`} />
        <span className="text-xs text-gray-500">{status.label}</span>
        {waStatus === 'disconnected' && (
          <button
            onClick={() => window.api.getWAStatus()}
            className="ml-1 text-xs text-blue-600 hover:underline"
          >
            Reconectar
          </button>
        )}
        {lastSyncAt && (
          <span className="text-[10px] text-gray-400 ml-0.5">
            · {formatRelative(lastSyncAt)}
          </span>
        )}
      </div>

      {/* Account switcher pill — always visible; shows "…" while accounts load */}
      <div className="title-bar-no-drag relative">
          <button
            onClick={() => setShowAccountMenu(v => !v)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-gray-100 hover:bg-gray-200 transition-colors text-xs font-medium text-gray-700"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" />
            <span className="whitespace-nowrap">{accountLabel(activeAccount)}</span>
            <span className="text-gray-400">▾</span>
          </button>

          {showAccountMenu && (
            <>
              {/* Backdrop */}
              <div
                className="fixed inset-0 z-30"
                onClick={() => setShowAccountMenu(false)}
              />
              <div className="absolute right-0 top-full mt-1 z-40 bg-white rounded-xl shadow-xl border border-gray-200 py-1 min-w-[220px]">
                {accounts.map(account => {
                  const unread = unreadByAccount(account.id)
                  const isActive = account.id === activeAccountId
                  return (
                    <button
                      key={account.id}
                      onClick={() => {
                        onSwitchAccount(account.id)
                        setShowAccountMenu(false)
                      }}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-50 transition-colors ${
                        isActive ? 'text-gray-900 font-medium' : 'text-gray-600'
                      }`}
                    >
                      {isActive && <span className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" />}
                      {!isActive && <span className="w-1.5 h-1.5 rounded-full bg-gray-300 shrink-0" />}
                      <span className="flex-1 text-left whitespace-nowrap">
                        {accountLabel(account)}
                      </span>
                      {unread > 0 && !isActive && (
                        <span className="bg-green-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center">
                          {unread}
                        </span>
                      )}
                    </button>
                  )
                })}

                <div className="border-t border-gray-100 mt-1 pt-1">
                  <button
                    onClick={() => {
                      onAddAccount()
                      setShowAccountMenu(false)
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
                  >
                    <span className="text-base leading-none">＋</span>
                    Agregar número
                  </button>
                </div>
              </div>
            </>
          )}
      </div>

      {/* Settings */}
      <button
        onClick={onOpenSettings}
        className="title-bar-no-drag p-1.5 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
        title="Configuración ⌘,"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <path d="M8 10.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z"/>
          <path fillRule="evenodd" d="M8 0a1 1 0 01.993.883l.007.117v1.16a6.003 6.003 0 013.122 1.813l1.005-.58a1 1 0 011.366.366l.05.097 1 1.732a1 1 0 01-.317 1.317l-.09.057-1.006.581a5.98 5.98 0 010 3.512l1.006.58a1 1 0 01.366 1.367l-.05.097-1 1.732a1 1 0 01-1.317.366l-.097-.05-1.005-.58A6.003 6.003 0 019 13.84v1.16a1 1 0 01-1.993.117L7 15v-1.16a6.003 6.003 0 01-3.122-1.813l-1.005.58a1 1 0 01-1.366-.366l-.05-.097-1-1.732a1 1 0 01.317-1.317l.09-.057 1.006-.581a5.98 5.98 0 010-3.512l-1.006-.58A1 1 0 01.5 3.54l.05-.097 1-1.732a1 1 0 011.317-.366l.097.05 1.005.58A6.003 6.003 0 017 1.16V0a1 1 0 011-1zm0 2.047v.826a1 1 0 01-.707.957A4.002 4.002 0 005.12 5.952a1 1 0 01-1.219.22l-.716-.414-.5.866.716.413a1 1 0 01.42 1.17A3.98 3.98 0 004 8c0 .446.073.876.207 1.278a1 1 0 01-.42 1.169l-.716.413.5.866.716-.413a1 1 0 011.219.219A4.002 4.002 0 007.293 13.17a1 1 0 01.707.957v.826h1v-.826a1 1 0 01.707-.957A4.002 4.002 0 0010.88 10.05a1 1 0 011.219-.22l.716.414.5-.866-.716-.413a1 1 0 01-.42-1.17c.134-.401.207-.831.207-1.278 0-.446-.073-.876-.207-1.278a1 1 0 01.42-1.169l.716-.413-.5-.866-.716.413a1 1 0 01-1.219-.219A4.002 4.002 0 009.707 2.83a1 1 0 01-.707-.957V1.047H8v1z" clipRule="evenodd"/>
        </svg>
      </button>
    </div>
  )
}

function formatRelative(date: Date): string {
  const diffMs = Date.now() - date.getTime()
  const diffMin = Math.floor(diffMs / 60_000)
  const diffHr  = Math.floor(diffMs / 3_600_000)

  if (diffMin < 1)  return 'justo ahora'
  if (diffMin < 60) return `hace ${diffMin} min`
  if (diffHr  < 24) return `hace ${diffHr} h`

  const hh = date.getHours().toString().padStart(2, '0')
  const mm = date.getMinutes().toString().padStart(2, '0')
  return `ayer ${hh}:${mm}`
}
