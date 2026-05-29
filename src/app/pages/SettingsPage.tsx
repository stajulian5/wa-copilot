import { useState, useEffect } from 'react'
import { useSettingsStore } from '../stores/settingsStore'
import type { ToneAttribute } from '../stores/settingsStore'

interface Props {
  onBack: () => void
}

const PORT = () => window.api?.serverPort ?? 3847

export function SettingsPage({ onBack }: Props) {
  const { toneOptions, activeTones, toggleTone, monthlyBudgetUsd, setBudget } = useSettingsStore()
  const [apiKey, setApiKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [keySaved, setKeySaved] = useState(false)
  const [usage, setUsage] = useState<{ inputTokens: number; outputTokens: number } | null>(null)
  const [sheetsUrl, setSheetsUrl] = useState('')
  const [sheetsPath, setSheetsPath] = useState('')
  const [sheetsTab, setSheetsTab] = useState('')
  const [lastSync, setLastSync] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [resetting, setResetting] = useState(false)

  useEffect(() => {
    window.api.getApiKey().then((k: string | null) => { if (k) setApiKey(k) })
    fetch(`http://127.0.0.1:${PORT()}/ai/usage`).then(r => r.json()).then(setUsage)
    fetch(`http://127.0.0.1:${PORT()}/settings`).then(r => r.json()).then((s: Record<string, string>) => {
      if (s.sheets_url) setSheetsUrl(s.sheets_url)
      if (s.sheets_service_account_path) setSheetsPath(s.sheets_service_account_path)
      if (s.sheets_tab) setSheetsTab(s.sheets_tab)
    })
    fetch(`http://127.0.0.1:${PORT()}/sheets/status`).then(r => r.json()).then((s: any) => setLastSync(s.lastSync))
  }, [])

  const saveApiKey = async () => {
    await window.api.setApiKey(apiKey)
    setKeySaved(true)
    setTimeout(() => setKeySaved(false), 2000)
  }

  const saveSheets = async () => {
    await Promise.all([
      fetch(`http://127.0.0.1:${PORT()}/settings/sheets_url`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value: sheetsUrl }) }),
      fetch(`http://127.0.0.1:${PORT()}/settings/sheets_service_account_path`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value: sheetsPath }) }),
      fetch(`http://127.0.0.1:${PORT()}/settings/sheets_tab`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value: sheetsTab }) })
    ])
  }

  const runSync = async () => {
    setSyncing(true)
    await saveSheets()
    const r = await fetch(`http://127.0.0.1:${PORT()}/sheets/sync`, { method: 'POST' })
    const data = await r.json()
    setSyncing(false)
    if (data.ok) setLastSync(new Date().toISOString())
    else alert(`Error en sync: ${data.error}`)
  }

  // Cost estimate (Haiku: $0.80/M input, $4.00/M output)
  const costUsd = usage
    ? ((usage.inputTokens / 1_000_000) * 0.8 + (usage.outputTokens / 1_000_000) * 4).toFixed(2)
    : '0.00'
  const budgetPct = Math.min(100, (Number(costUsd) / monthlyBudgetUsd) * 100)

  return (
    <div className="flex flex-col h-screen bg-white">
      <div className="title-bar-drag h-10 bg-gray-50 border-b border-gray-200 flex items-center px-4">
        <button onClick={onBack} className="title-bar-no-drag text-sm text-gray-600 hover:text-gray-900 flex items-center gap-1">
          ← Volver
        </button>
        <span className="ml-4 font-semibold text-sm text-gray-900">Configuración</span>
      </div>

      <div className="flex-1 overflow-y-auto p-6 max-w-2xl mx-auto w-full">

        {/* Anthropic API Key */}
        <section className="mb-8">
          <h2 className="text-sm font-semibold text-gray-900 mb-3">Clave API de Anthropic</h2>
          <div className="flex gap-2">
            <input
              type={showKey ? 'text' : 'password'}
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder="sk-ant-..."
              className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono"
            />
            <button onClick={() => setShowKey(!showKey)} className="px-3 py-2 text-sm border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50">
              {showKey ? 'Ocultar' : 'Ver'}
            </button>
            <button onClick={saveApiKey} className="px-4 py-2 bg-gray-900 text-white text-sm rounded-lg hover:bg-gray-700">
              {keySaved ? '✓ Guardado' : 'Guardar'}
            </button>
          </div>
        </section>

        {/* AI Tone */}
        <section className="mb-8">
          <h2 className="text-sm font-semibold text-gray-900 mb-3">Tono del asistente IA</h2>
          <div className="flex flex-wrap gap-2">
            {toneOptions.map(t => (
              <button
                key={t}
                onClick={() => toggleTone(t)}
                className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                  activeTones.has(t)
                    ? 'bg-gray-900 text-white border-gray-900'
                    : 'bg-white text-gray-600 border-gray-300 hover:border-gray-500'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </section>

        {/* Token Usage */}
        <section className="mb-8">
          <h2 className="text-sm font-semibold text-gray-900 mb-3">Uso de tokens (este mes)</h2>
          <div className="bg-gray-50 rounded-lg p-4">
            <div className="flex justify-between text-sm mb-2">
              <span className="text-gray-600">${costUsd} USD</span>
              <span className="text-gray-400">Presupuesto: ${monthlyBudgetUsd}</span>
            </div>
            <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${budgetPct > 80 ? 'bg-red-500' : budgetPct > 50 ? 'bg-amber-500' : 'bg-green-500'}`}
                style={{ width: `${budgetPct}%` }}
              />
            </div>
            <p className="text-xs text-gray-400 mt-2">
              {usage?.inputTokens?.toLocaleString() ?? 0} tokens entrada · {usage?.outputTokens?.toLocaleString() ?? 0} salida
            </p>
          </div>
        </section>

        {/* Google Sheets */}
        <section className="mb-8">
          <h2 className="text-sm font-semibold text-gray-900 mb-3">Google Sheets (Atlas)</h2>
          <div className="flex flex-col gap-3">
            <input value={sheetsUrl} onChange={e => setSheetsUrl(e.target.value)} placeholder="URL del spreadsheet" className="border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            <input value={sheetsPath} onChange={e => setSheetsPath(e.target.value)} placeholder="Ruta al archivo JSON de Service Account" className="border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono" />
            <input value={sheetsTab} onChange={e => setSheetsTab(e.target.value)} placeholder="Nombre de la pestaña (ej: Brokers)" className="border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            <div className="flex items-center gap-3">
              <button onClick={runSync} disabled={syncing} className="px-4 py-2 bg-gray-900 text-white text-sm rounded-lg hover:bg-gray-700 disabled:opacity-50">
                {syncing ? 'Sincronizando…' : 'Sincronizar ahora'}
              </button>
              {lastSync && (
                <span className="text-xs text-gray-400">
                  Último sync: {new Date(lastSync).toLocaleString('es-MX')}
                </span>
              )}
            </div>
          </div>
        </section>

        {/* WhatsApp re-link */}
        <section className="mb-8 border-t border-gray-100 pt-8">
          <h2 className="text-sm font-semibold text-gray-900 mb-1">Vincular WhatsApp</h2>
          <p className="text-xs text-gray-400 mb-3">
            Desvincula el dispositivo actual y muestra un nuevo código QR. Usa esto para importar todo tu historial de conversaciones o cambiar el número vinculado.
          </p>
          <button
            onClick={async () => {
              if (!confirm('¿Desvincular WhatsApp y mostrar código QR? Se importará todo tu historial de conversaciones al volver a escanear.')) return
              setResetting(true)
              await window.api.resetWAAuth()
              // App will show QR screen automatically
              onBack()
            }}
            disabled={resetting}
            className="px-4 py-2 bg-red-50 text-red-700 border border-red-200 text-sm rounded-lg hover:bg-red-100 disabled:opacity-50"
          >
            {resetting ? 'Desvinculando…' : '🔄 Volver a vincular'}
          </button>
        </section>

      </div>
    </div>
  )
}
