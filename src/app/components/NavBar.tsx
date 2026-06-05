import { useState, useEffect, useCallback, useRef } from 'react'
import { useContactsStore } from '../stores/contactsStore'
import type { Account } from '../../server/db/schema'

const PORT = () => window.api?.serverPort ?? 3847

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

export function NavBar({
  waStatus, searchRef, onOpenSettings,
  accounts, activeAccountId, onSwitchAccount, onAddAccount, lastSyncAt
}: Props) {
  const { setSearchQuery, searchQuery, contacts, setContacts } = useContactsStore()
  const [showAccountMenu, setShowAccountMenu] = useState(false)
  const [showExtPopover, setShowExtPopover] = useState(false)
  const [, forceUpdate] = useState(0)
  const [syncing, setSyncing] = useState(false)
  const [extStatus, setExtStatus] = useState<'green' | 'amber' | 'gray'>('gray')
  const [extLastSeen, setExtLastSeen] = useState<number | null>(null)
  const extRef = useRef<HTMLDivElement>(null)

  // Re-render every 15 s so relative timestamps stay fresh
  useEffect(() => {
    const t = setInterval(() => forceUpdate(n => n + 1), 15_000)
    return () => clearInterval(t)
  }, [])

  // Poll extension status every 15 s
  useEffect(() => {
    const check = async () => {
      try {
        const r = await fetch(`http://127.0.0.1:${PORT()}/status`)
        const d = await r.json()
        setExtStatus(d.extensionStatus ?? 'gray')
        setExtLastSeen(d.extensionLastSeen ?? null)
      } catch {
        setExtStatus('gray')
        setExtLastSeen(null)
      }
    }
    check()
    const t = setInterval(check, 15_000)
    return () => clearInterval(t)
  }, [])

  // Close ext popover on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (extRef.current && !extRef.current.contains(e.target as Node)) {
        setShowExtPopover(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Force sync
  const handleForceSync = useCallback(async () => {
    if (syncing) return
    setSyncing(true)
    try {
      await window.api.forceSync()
      const all = await fetch(`http://127.0.0.1:${PORT()}/contacts`).then(r => r.json())
      setContacts(all)
    } catch {}
    setTimeout(() => setSyncing(false), 1500)
  }, [syncing])

  const activeAccount = accounts.find(a => a.id === activeAccountId)

  function formatJidPhone(jid: string | null): string | null {
    if (!jid) return null
    let digits = jid.split('@')[0].split(':')[0]
    if (digits.startsWith('521') && digits.length === 13) digits = '52' + digits.slice(3)
    if (digits.startsWith('52') && digits.length === 12)
      return `+52 ${digits.slice(2, 5)} ${digits.slice(5, 8)} ${digits.slice(8)}`
    return `+${digits}`
  }

  function accountLabel(account: typeof activeAccount): string {
    if (!account) return accounts.length === 0 ? '…' : 'My number'
    if (account.label && account.label !== 'My number') return account.label
    return formatJidPhone(account.jid ?? null) ?? account.label
  }

  const unreadByAccount = (accountId: number) =>
    contacts.filter(c => c.accountId === accountId).reduce((s, c) => s + (c.unreadCount ?? 0), 0)

  // WA badge config
  const waBadge = {
    connected:    { dot: 'bg-green-500',               text: 'text-green-700', bg: 'bg-green-50 border-green-200',  label: 'Connected' },
    connecting:   { dot: 'bg-amber-400 animate-pulse', text: 'text-amber-700', bg: 'bg-amber-50 border-amber-200',  label: 'Connecting…' },
    disconnected: { dot: 'bg-red-500',                 text: 'text-red-700',   bg: 'bg-red-50 border-red-200',      label: 'Disconnected' },
  }[waStatus]

  // Ext badge config
  const extBadge = {
    green: { dot: 'bg-green-500',               text: 'text-green-700', bg: 'bg-green-50 border-green-200',  label: 'Active' },
    amber: { dot: 'bg-amber-400 animate-pulse', text: 'text-amber-700', bg: 'bg-amber-50 border-amber-200',  label: 'Delayed' },
    gray:  { dot: 'bg-gray-300',               text: 'text-gray-500',  bg: 'bg-gray-50 border-gray-200',    label: 'Not connected' },
  }[extStatus]

  function handleExtClick() {
    if (extStatus === 'gray') {
      setShowExtPopover(v => !v)
    } else {
      // Green/amber — just show the popover with status info
      setShowExtPopover(v => !v)
    }
  }

  return (
    <div className="title-bar-drag flex items-center gap-2 h-12 px-4 bg-white border-b border-gray-200">
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
          placeholder="Search… ⌘K"
          className="w-full bg-gray-100 rounded-lg px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-gray-300"
        />
      </div>

      <div className="flex-1" />

      {/* ── Badge 1: WhatsApp Direct (Baileys) ── */}
      <div className="title-bar-no-drag">
        <button
          onClick={waStatus === 'disconnected' ? () => window.api.getWAStatus() : undefined}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-medium transition-all ${waBadge.bg} ${waBadge.text} ${waStatus === 'disconnected' ? 'cursor-pointer hover:opacity-80' : 'cursor-default'}`}
          title={
            waStatus === 'connected'
              ? `WhatsApp connected directly via QR${lastSyncAt ? ` · last sync ${formatRelative(lastSyncAt)}` : ''}`
              : waStatus === 'connecting'
              ? 'Connecting to WhatsApp…'
              : 'Disconnected from WhatsApp — click to reconnect'
          }
        >
          {/* WhatsApp phone icon */}
          <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" className="shrink-0">
            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
            <path d="M12 2C6.477 2 2 6.477 2 12c0 1.82.487 3.53 1.338 5.007L2 22l5.109-1.322A9.954 9.954 0 0012 22c5.523 0 10-4.477 10-10S17.523 2 12 2z"/>
          </svg>
          <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${waBadge.dot}`} />
          <span>WhatsApp</span>
          <span className="opacity-60">{waBadge.label}</span>
          {waStatus === 'disconnected' && <span className="ml-0.5 opacity-80">· Tap to reconnect</span>}
        </button>
      </div>

      {/* ── Badge 2: Chrome Extension ── */}
      <div className="title-bar-no-drag relative" ref={extRef}>
        <button
          onClick={handleExtClick}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-medium transition-all hover:opacity-80 ${extBadge.bg} ${extBadge.text}`}
        >
          {/* Puzzle piece icon */}
          <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" className="shrink-0">
            <path d="M20.5 11H19V7a2 2 0 00-2-2h-4V3.5a2.5 2.5 0 00-5 0V5H4a2 2 0 00-2 2v3.8h1.5c1.5 0 2.7 1.2 2.7 2.7S5 16.2 3.5 16.2H2V20a2 2 0 002 2h3.8v-1.5c0-1.5 1.2-2.7 2.7-2.7 1.5 0 2.7 1.2 2.7 2.7V22H17a2 2 0 002-2v-4h1.5a2.5 2.5 0 000-5z"/>
          </svg>
          <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${extBadge.dot}`} />
          <span>Chrome Ext</span>
          <span className="opacity-60">{extBadge.label}</span>
          {extStatus === 'gray' && <span className="ml-0.5 opacity-60">↗</span>}
        </button>

        {/* Popover */}
        {showExtPopover && (
          <div className="absolute right-0 top-full mt-2 z-50 w-72 bg-white rounded-2xl shadow-xl border border-gray-200 overflow-hidden">
            {extStatus === 'green' || extStatus === 'amber' ? (
              /* Active / delayed state */
              <div className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className={`w-2 h-2 rounded-full ${extBadge.dot}`} />
                  <span className="text-sm font-semibold text-gray-900">
                    {extStatus === 'green' ? 'Extension running' : 'Extension delayed'}
                  </span>
                </div>
                <p className="text-xs text-gray-500 leading-relaxed">
                  {extStatus === 'green'
                    ? `Syncing messages from WhatsApp Web every 2 minutes as a backup to the direct connection.${extLastSeen ? ` Last sync: ${formatRelative(new Date(extLastSeen))}.` : ''}`
                    : 'Last sync was over 2 minutes ago. Is WhatsApp Web open in Chrome? The extension only runs while that tab is active.'}
                </p>
              </div>
            ) : (
              /* Not connected — show install guide */
              <>
                <div className="px-4 pt-4 pb-3 border-b border-gray-100">
                  <p className="text-sm font-semibold text-gray-900 mb-1">Connect the Chrome Extension</p>
                  <p className="text-xs text-gray-500 leading-relaxed">
                    Keeps your messages complete. When the direct WhatsApp connection has a gap, the extension catches anything missed — syncing silently every 2 minutes in the background.
                  </p>
                </div>

                <div className="p-4 space-y-3">
                  {[
                    { n: '1', title: 'Open WhatsApp Web in Chrome', desc: 'Go to web.whatsapp.com and make sure you\'re logged in.' },
                    { n: '2', title: 'Open Chrome\'s extension page', action: true, actionLabel: 'Open Extensions →', onAction: () => { window.api.openChromeExtensions?.(); } },
                    { n: '3', title: 'Enable Developer Mode', desc: 'Toggle "Developer mode" in the top-right corner. It\'s safe — nothing changes on your computer.' },
                    { n: '4', title: 'Load the extension folder', desc: 'Click "Load unpacked" and select this folder:', showFolder: true },
                  ].map(step => (
                    <div key={step.n} className="flex gap-2.5 items-start">
                      <span className="w-5 h-5 rounded-full bg-gray-900 text-white text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                        {step.n}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-gray-800">{step.title}</p>
                        {step.desc && <p className="text-[11px] text-gray-500 mt-0.5 leading-relaxed">{step.desc}</p>}
                        {step.action && (
                          <button
                            onClick={step.onAction}
                            className="mt-1 text-[11px] font-semibold text-blue-600 hover:text-blue-700"
                          >
                            {step.actionLabel}
                          </button>
                        )}
                        {step.showFolder && (
                          <button
                            onClick={() => window.api.openExtensionInFinder?.()}
                            className="mt-1.5 flex items-center gap-1.5 text-[11px] bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-1.5 text-gray-600 hover:bg-gray-100 transition-colors w-full text-left"
                          >
                            <span>📂</span>
                            <span className="font-medium">Open extension folder in Finder</span>
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="px-4 pb-4">
                  <p className="text-[10px] text-gray-400 text-center">
                    WA Copilot works without the extension — this just adds reliability.
                  </p>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* ── Force sync button ── */}
      <button
        onClick={handleForceSync}
        disabled={syncing}
        title="Force sync ⌘R"
        className="title-bar-no-drag p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-40"
      >
        <svg
          width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
          strokeLinecap="round" strokeLinejoin="round"
          className={syncing ? 'animate-spin' : ''}
        >
          <path d="M21 12a9 9 0 01-9 9M3 12a9 9 0 019-9M21 12c0-1.3-.28-2.54-.77-3.66M3 12c0 1.3.28 2.54.77 3.66"/>
          <path d="M17 3.34A9 9 0 0121 12M7 20.66A9 9 0 013 12"/>
        </svg>
      </button>

      {/* Account switcher */}
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
            <div className="fixed inset-0 z-30" onClick={() => setShowAccountMenu(false)} />
            <div className="absolute right-0 top-full mt-1 z-40 bg-white rounded-xl shadow-xl border border-gray-200 py-1 min-w-[220px]">
              {accounts.map(account => {
                const unread = unreadByAccount(account.id)
                const isActive = account.id === activeAccountId
                return (
                  <button
                    key={account.id}
                    onClick={() => { onSwitchAccount(account.id); setShowAccountMenu(false) }}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-50 transition-colors ${isActive ? 'text-gray-900 font-medium' : 'text-gray-600'}`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isActive ? 'bg-green-500' : 'bg-gray-300'}`} />
                    <span className="flex-1 text-left whitespace-nowrap">{accountLabel(account)}</span>
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
                  onClick={() => { onAddAccount(); setShowAccountMenu(false) }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
                >
                  <span className="text-base leading-none">＋</span>
                  Add number
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
        title="Settings ⌘,"
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
  const diffMs  = Date.now() - date.getTime()
  const diffMin = Math.floor(diffMs / 60_000)
  const diffHr  = Math.floor(diffMs / 3_600_000)
  if (diffMin < 1)  return 'just now'
  if (diffMin < 60) return `${diffMin} min ago`
  if (diffHr  < 24) return `${diffHr} h ago`
  const hh = date.getHours().toString().padStart(2, '0')
  const mm = date.getMinutes().toString().padStart(2, '0')
  return `yesterday ${hh}:${mm}`
}
