import { useEffect, useState } from 'react'
import QRCode from 'qrcode'

interface Props {
  waStatus: 'disconnected' | 'connecting' | 'connected'
  initialQr: string | null
  onQRReceived: (qr: string) => void
  /** Called when user finishes the full onboarding flow (including extension step) */
  onComplete: () => void
  /** If true, skip the welcome + extension steps (re-link flow, not first-time) */
  isRelink?: boolean
}

type Step = 'welcome' | 'qr' | 'extension' | 'done'

const FIRST_RUN_KEY = 'onboarding_complete_v1'

export function OnboardingPage({ waStatus, initialQr, onQRReceived, onComplete, isRelink }: Props) {
  const isFirstRun = !localStorage.getItem(FIRST_RUN_KEY)
  const [step, setStep] = useState<Step>(
    isRelink || !isFirstRun ? 'qr' : 'welcome'
  )
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [showExpired, setShowExpired] = useState(false)
  const [extensionPath, setExtensionPath] = useState<string>('')

  // Render QR from parent-passed initial value
  useEffect(() => {
    if (initialQr) {
      QRCode.toDataURL(initialQr, { width: 260, margin: 2, color: { dark: '#111827', light: '#ffffff' } })
        .then(url => { setQrDataUrl(url); setShowExpired(false) })
    }
  }, [initialQr])

  // Subscribe to new QR codes
  useEffect(() => {
    const off = window.api.onQR(({ qr }) => {
      onQRReceived(qr)
      setShowExpired(false)
      QRCode.toDataURL(qr, { width: 260, margin: 2, color: { dark: '#111827', light: '#ffffff' } }).then(setQrDataUrl)
      setTimeout(() => setShowExpired(true), 60_000)
    })
    return off
  }, [])

  // When WA connects → advance to extension step (first run) or complete
  useEffect(() => {
    if (waStatus === 'connected') {
      if (!isRelink && isFirstRun) {
        setStep('extension')
      } else {
        onComplete()
      }
    }
  }, [waStatus])

  // Get the chrome extension path for display
  useEffect(() => {
    window.api.getUserDataPath?.().then((p: string) => {
      // extension lives next to the app binary
      setExtensionPath(p.replace(/\/Application Support\/.*/, '/dev/mica-crm/chrome-extension'))
    }).catch(() => {})
  }, [])

  function finishOnboarding() {
    localStorage.setItem(FIRST_RUN_KEY, 'true')
    onComplete()
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-screen bg-white select-none">
      {/* macOS title bar drag region */}
      <div className="title-bar-drag fixed top-0 left-0 right-0 h-10 z-10" />

      {/* Progress dots — shown from QR step onwards */}
      {step !== 'welcome' && (
        <div className="fixed top-3 left-1/2 -translate-x-1/2 flex gap-1.5 z-20">
          {(['qr', 'extension', 'done'] as Step[]).map((s, i) => (
            <div
              key={s}
              className={`w-1.5 h-1.5 rounded-full transition-all ${
                step === s ? 'bg-gray-900 w-4' : i < ['qr','extension','done'].indexOf(step) ? 'bg-gray-400' : 'bg-gray-200'
              }`}
            />
          ))}
        </div>
      )}

      <div className="flex-1 flex items-center justify-center pt-10 pb-6">
        {step === 'welcome' && <WelcomeStep onNext={() => setStep('qr')} />}
        {step === 'qr'      && (
          <QRStep
            qrDataUrl={qrDataUrl}
            showExpired={showExpired}
            waStatus={waStatus}
            isRelink={isRelink}
          />
        )}
        {step === 'extension' && (
          <ExtensionStep
            extensionPath={extensionPath}
            onDone={finishOnboarding}
          />
        )}
      </div>
    </div>
  )
}

// ── Step 1: Welcome ───────────────────────────────────────────────────────────

function WelcomeStep({ onNext }: { onNext: () => void }) {
  return (
    <div className="flex flex-col items-center gap-8 max-w-sm w-full px-6 text-center animate-fade-in">
      <div className="flex flex-col items-center gap-3">
        <div className="w-20 h-20 rounded-3xl bg-green-500 flex items-center justify-center shadow-xl shadow-green-200">
          <span className="text-4xl">✈️</span>
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">WhatsApp Copilot</h1>
          <p className="text-gray-500 mt-1 text-sm">Tu CRM de WhatsApp para KAMs</p>
        </div>
      </div>

      <div className="w-full flex flex-col gap-3 text-left">
        {[
          { icon: '📋', title: 'Kanban de brokers', desc: 'Organiza tus conversaciones en columnas: Nuevo, Activo, Esperando, Resuelto.' },
          { icon: '💬', title: 'Chat dentro del app', desc: 'Lee y responde mensajes de WhatsApp sin salir de Copilot.' },
          { icon: '✨', title: 'Sugerencias con IA', desc: 'Claude redacta respuestas en un toque — tú decides si enviarlas.' },
        ].map(f => (
          <div key={f.title} className="flex gap-3 p-3 rounded-xl bg-gray-50">
            <span className="text-xl mt-0.5 shrink-0">{f.icon}</span>
            <div>
              <p className="text-sm font-semibold text-gray-900">{f.title}</p>
              <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{f.desc}</p>
            </div>
          </div>
        ))}
      </div>

      <button
        onClick={onNext}
        className="w-full py-3 bg-green-500 hover:bg-green-600 active:bg-green-700 text-white font-semibold rounded-xl transition-colors shadow-md shadow-green-200"
      >
        Comenzar →
      </button>

      <p className="text-[11px] text-gray-400">
        Funciona con tu número de WhatsApp personal — no requiere cuenta de empresa.
      </p>
    </div>
  )
}

// ── Step 2: QR Scan ───────────────────────────────────────────────────────────

function QRStep({
  qrDataUrl, showExpired, waStatus, isRelink
}: {
  qrDataUrl: string | null
  showExpired: boolean
  waStatus: string
  isRelink?: boolean
}) {
  return (
    <div className="flex flex-col items-center gap-6 max-w-md w-full px-6 text-center">
      <div>
        <h2 className="text-xl font-bold text-gray-900">
          {isRelink ? 'Vincular de nuevo' : 'Vincula tu WhatsApp'}
        </h2>
        <p className="text-gray-500 text-sm mt-1">
          Abre WhatsApp en tu teléfono y sigue estos pasos
        </p>
      </div>

      {/* Phone instructions */}
      <div className="w-full flex flex-col gap-2 text-left">
        {[
          { n: '1', text: 'Toca los tres puntos ⋮ (Android) o el ícono de Ajustes ⚙️ (iPhone)' },
          { n: '2', text: 'Selecciona "Dispositivos vinculados"' },
          { n: '3', text: 'Toca "Vincular dispositivo"' },
          { n: '4', text: 'Apunta la cámara al código QR de abajo' },
        ].map(s => (
          <div key={s.n} className="flex items-start gap-3">
            <span className="w-5 h-5 rounded-full bg-green-500 text-white text-[11px] font-bold flex items-center justify-center shrink-0 mt-0.5">
              {s.n}
            </span>
            <p className="text-sm text-gray-600 leading-relaxed">{s.text}</p>
          </div>
        ))}
      </div>

      {/* QR box */}
      <div className="relative w-64 h-64 flex items-center justify-center bg-white rounded-2xl border-2 border-gray-100 shadow-lg">
        {qrDataUrl && !showExpired ? (
          <img src={qrDataUrl} alt="QR WhatsApp" className="w-56 h-56 rounded-lg" />
        ) : showExpired ? (
          <div className="flex flex-col items-center gap-2 text-center p-6">
            <span className="text-3xl">🔄</span>
            <p className="text-sm text-gray-500 font-medium">Código expirado</p>
            <p className="text-xs text-gray-400">Generando uno nuevo…</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-gray-200 border-t-green-500 rounded-full animate-spin" />
            <p className="text-sm text-gray-400">
              {waStatus === 'connecting' ? 'Conectando a WhatsApp…' : 'Generando código QR…'}
            </p>
          </div>
        )}
      </div>

      <p className="text-xs text-gray-400 flex items-center gap-1.5">
        <span className={`w-1.5 h-1.5 rounded-full ${
          waStatus === 'connected' ? 'bg-green-500' :
          waStatus === 'connecting' ? 'bg-amber-400 animate-pulse' : 'bg-red-500'
        }`} />
        {waStatus === 'connected' ? '¡Vinculado con éxito! Continuando…' :
         waStatus === 'connecting' ? 'Conectando…' : 'Sin conexión'}
      </p>
    </div>
  )
}

// ── Step 3: Chrome Extension ──────────────────────────────────────────────────

function ExtensionStep({ extensionPath, onDone }: { extensionPath: string; onDone: () => void }) {
  const [copied, setCopied] = useState(false)

  function copyPath() {
    navigator.clipboard.writeText(extensionPath)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function openChromeExtensions() {
    window.api.openReleasePage?.('https://github.com/stajulian5/wa-copilot#chrome-extension')
  }

  return (
    <div className="flex flex-col items-center gap-6 max-w-md w-full px-6 text-center">
      <div className="w-16 h-16 rounded-2xl bg-blue-500 flex items-center justify-center shadow-lg shadow-blue-200">
        <span className="text-3xl">🧩</span>
      </div>

      <div>
        <h2 className="text-xl font-bold text-gray-900">Instala la extensión de Chrome</h2>
        <p className="text-gray-500 text-sm mt-1 leading-relaxed">
          La extensión lee los nombres de tus contactos desde WhatsApp Web y los sincroniza
          con Copilot. <strong className="text-gray-700">Solo necesitas hacerlo una vez.</strong>
        </p>
      </div>

      {/* Steps */}
      <div className="w-full flex flex-col gap-3 text-left">
        <div className="flex gap-3 items-start p-3 rounded-xl bg-gray-50">
          <span className="w-6 h-6 rounded-full bg-blue-500 text-white text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">1</span>
          <div className="flex-1">
            <p className="text-sm font-medium text-gray-900">Abre la pantalla de extensiones en Chrome</p>
            <p className="text-xs text-gray-500 mt-0.5">Escribe <code className="bg-gray-200 px-1 rounded text-[11px]">chrome://extensions</code> en la barra de dirección y presiona Enter.</p>
          </div>
        </div>

        <div className="flex gap-3 items-start p-3 rounded-xl bg-gray-50">
          <span className="w-6 h-6 rounded-full bg-blue-500 text-white text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">2</span>
          <div className="flex-1">
            <p className="text-sm font-medium text-gray-900">Activa el Modo Desarrollador</p>
            <p className="text-xs text-gray-500 mt-0.5">Busca el interruptor "Modo de desarrollador" en la esquina superior derecha y actívalo.</p>
          </div>
        </div>

        <div className="flex gap-3 items-start p-3 rounded-xl bg-gray-50">
          <span className="w-6 h-6 rounded-full bg-blue-500 text-white text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">3</span>
          <div className="flex-1">
            <p className="text-sm font-medium text-gray-900">Carga la extensión sin empaquetar</p>
            <p className="text-xs text-gray-500 mt-0.5">Haz clic en "Cargar descomprimida" y selecciona esta carpeta:</p>
            {extensionPath && (
              <button
                onClick={copyPath}
                className="mt-1.5 flex items-center gap-1.5 text-[11px] bg-white border border-gray-200 rounded-lg px-2 py-1.5 font-mono text-gray-600 hover:bg-gray-50 transition-colors w-full text-left"
              >
                <span className="flex-1 truncate">{extensionPath}</span>
                <span className="shrink-0 text-blue-500">{copied ? '✓' : '⎘'}</span>
              </button>
            )}
          </div>
        </div>

        <div className="flex gap-3 items-start p-3 rounded-xl bg-gray-50">
          <span className="w-6 h-6 rounded-full bg-blue-500 text-white text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">4</span>
          <div className="flex-1">
            <p className="text-sm font-medium text-gray-900">Usa la extensión en WhatsApp Web</p>
            <p className="text-xs text-gray-500 mt-0.5">Abre <strong>web.whatsapp.com</strong> en Chrome, haz clic en el ícono de la extensión 🧩 y presiona <strong>"Sincronizar contactos"</strong>.</p>
          </div>
        </div>
      </div>

      <div className="w-full flex flex-col gap-2">
        <button
          onClick={onDone}
          className="w-full py-3 bg-green-500 hover:bg-green-600 text-white font-semibold rounded-xl transition-colors shadow-md shadow-green-200"
        >
          ¡Listo, ir al Kanban →
        </button>
        <button
          onClick={onDone}
          className="text-xs text-gray-400 hover:text-gray-600 transition-colors py-1"
        >
          Omitir por ahora (puedo instalarlo después)
        </button>
      </div>
    </div>
  )
}
