import { useContactsStore } from '../stores/contactsStore'

interface Props {
  waStatus: 'disconnected' | 'connecting' | 'connected'
  searchRef: React.RefObject<HTMLInputElement>
  onOpenSettings: () => void
}

const statusConfig = {
  connected: { dot: 'bg-green-500', label: 'Conectado' },
  connecting: { dot: 'bg-amber-400 animate-pulse', label: 'Conectando…' },
  disconnected: { dot: 'bg-red-500', label: 'Desconectado' }
}

export function NavBar({ waStatus, searchRef, onOpenSettings }: Props) {
  const { setSearchQuery, searchQuery } = useContactsStore()
  const status = statusConfig[waStatus]

  return (
    <div className="title-bar-drag flex items-center gap-3 h-12 px-4 bg-white border-b border-gray-200">
      {/* Traffic lights space */}
      <div className="w-16 title-bar-drag" />

      <span className="font-semibold text-gray-900 text-sm title-bar-no-drag">✈️ Copilot</span>

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

      {/* WA Status */}
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
