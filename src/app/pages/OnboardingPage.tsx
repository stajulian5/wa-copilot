import { useEffect, useState } from 'react'
import QRCode from 'qrcode'

interface Props {
  waStatus: 'disconnected' | 'connecting' | 'connected'
  initialQr: string | null
  onQRReceived: (qr: string) => void
  onComplete: () => void
  isRelink?: boolean
}

type Step = 'welcome' | 'qr' | 'extension'
const FIRST_RUN_KEY = 'onboarding_complete_v1'

export function OnboardingPage({ waStatus, initialQr, onQRReceived, onComplete, isRelink }: Props) {
  const isFirstRun = !localStorage.getItem(FIRST_RUN_KEY)
  const [step, setStep] = useState<Step>(isRelink || !isFirstRun ? 'qr' : 'welcome')
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [showExpired, setShowExpired] = useState(false)
  const [extensionPath, setExtensionPath] = useState<string>('')

  useEffect(() => {
    if (initialQr) renderQR(initialQr)
  }, [initialQr])

  useEffect(() => {
    const off = window.api.onQR(({ qr }) => {
      onQRReceived(qr)
      renderQR(qr)
      setTimeout(() => setShowExpired(true), 60_000)
    })
    return off
  }, [])

  useEffect(() => {
    if (waStatus === 'connected') {
      if (!isRelink && isFirstRun) {
        setStep('extension')
      } else {
        onComplete()
      }
    }
  }, [waStatus])

  useEffect(() => {
    window.api.getExtensionPath?.().then(setExtensionPath).catch(() => {})
  }, [])

  function renderQR(raw: string) {
    setShowExpired(false)
    QRCode.toDataURL(raw, {
      width: 240, margin: 2,
      color: { dark: '#111827', light: '#ffffff' }
    }).then(setQrDataUrl)
  }

  function finishOnboarding() {
    localStorage.setItem(FIRST_RUN_KEY, 'true')
    onComplete()
  }

  return (
    <div className="flex flex-col h-screen bg-white select-none overflow-y-auto">
      <div className="title-bar-drag fixed top-0 left-0 right-0 h-10 z-10" />

      {/* Step indicator — only during QR + extension */}
      {step !== 'welcome' && (
        <div className="fixed top-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1.5">
          <StepDot active={step === 'qr'} done={step === 'extension'} label="Vincular" />
          {isFirstRun && !isRelink && (
            <StepDot active={step === 'extension'} done={false} label="Extensión" />
          )}
        </div>
      )}

      <div className="flex-1 flex items-center justify-center py-14 px-4">
        {step === 'welcome'   && <WelcomeStep   onNext={() => setStep('qr')} />}
        {step === 'qr'        && <QRStep qrDataUrl={qrDataUrl} showExpired={showExpired} waStatus={waStatus} isRelink={isRelink} />}
        {step === 'extension' && <ExtensionStep extensionPath={extensionPath} onDone={finishOnboarding} />}
      </div>
    </div>
  )
}

// ── Shared step-dot component ─────────────────────────────────────────────────

function StepDot({ active, done, label }: { active: boolean; done: boolean; label: string }) {
  return (
    <div className="flex items-center gap-1">
      <div className={`h-1.5 rounded-full transition-all duration-300 ${
        active ? 'w-6 bg-green-500' : done ? 'w-1.5 bg-green-300' : 'w-1.5 bg-gray-200'
      }`} />
      <span className={`text-[10px] transition-colors ${active ? 'text-gray-600' : 'text-gray-300'}`}>
        {label}
      </span>
    </div>
  )
}

// ── Step 1: Welcome ───────────────────────────────────────────────────────────

function WelcomeStep({ onNext }: { onNext: () => void }) {
  return (
    <div className="flex flex-col items-center gap-8 max-w-sm w-full text-center">

      {/* Logo */}
      <div className="flex flex-col items-center gap-4">
        <div className="w-24 h-24 rounded-[28px] bg-gradient-to-br from-green-400 to-green-600 flex items-center justify-center shadow-2xl shadow-green-200">
          <span className="text-5xl">✈️</span>
        </div>
        <div>
          <h1 className="text-3xl font-bold text-gray-900 tracking-tight">WA Copilot</h1>
          <p className="text-gray-400 mt-1">Tu asistente de WhatsApp para brokers</p>
        </div>
      </div>

      {/* Features */}
      <div className="w-full space-y-2.5">
        {[
          { icon: '📋', title: 'Pipeline de brokers', desc: 'Organiza tus conversaciones de WhatsApp en un tablero visual.' },
          { icon: '💬', title: 'Chat integrado',       desc: 'Lee y responde mensajes sin salir del Copilot.' },
          { icon: '✨', title: 'Respuestas con IA',    desc: 'Sugerencias automáticas de respuesta — tú decides si enviarlas.' },
        ].map(f => (
          <div key={f.title} className="flex gap-3 p-3.5 rounded-2xl bg-gray-50 text-left">
            <span className="text-2xl shrink-0">{f.icon}</span>
            <div>
              <p className="text-sm font-semibold text-gray-900">{f.title}</p>
              <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{f.desc}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="w-full space-y-2">
        <button
          onClick={onNext}
          className="w-full py-3.5 bg-green-500 hover:bg-green-600 active:scale-[0.98] text-white font-semibold rounded-2xl transition-all shadow-lg shadow-green-200 text-base"
        >
          Comenzar configuración →
        </button>
        <p className="text-[11px] text-gray-400">
          Solo necesitas tu teléfono y 2 minutos. Sin cuentas de empresa.
        </p>
      </div>
    </div>
  )
}

// ── Step 2: QR Scan ───────────────────────────────────────────────────────────

function QRStep({ qrDataUrl, showExpired, waStatus, isRelink }: {
  qrDataUrl: string | null
  showExpired: boolean
  waStatus: string
  isRelink?: boolean
}) {
  return (
    <div className="flex flex-col items-center gap-5 w-full max-w-sm text-center">

      <div>
        <h2 className="text-xl font-bold text-gray-900">
          {isRelink ? 'Vuelve a vincular tu WhatsApp' : 'Vincula tu WhatsApp'}
        </h2>
        <p className="text-gray-500 text-sm mt-1">
          {isRelink
            ? 'Tu sesión expiró. Sigue los mismos pasos de la primera vez.'
            : 'Sigue estos pasos en tu teléfono — solo se hace una vez.'}
        </p>
      </div>

      {/* Phone steps + QR side by side on wider screens, stacked on narrow */}
      <div className="flex flex-col items-center gap-5 w-full">

        {/* QR code — shown prominently first */}
        <div className="relative w-56 h-56 flex items-center justify-center bg-white rounded-3xl border-2 border-gray-100 shadow-xl">
          {qrDataUrl && !showExpired ? (
            <img src={qrDataUrl} alt="Código QR de WhatsApp" className="w-48 h-48 rounded-2xl" />
          ) : showExpired ? (
            <div className="flex flex-col items-center gap-2 p-4">
              <span className="text-3xl animate-spin">🔄</span>
              <p className="text-sm font-medium text-gray-600">Código expirado</p>
              <p className="text-xs text-gray-400">Generando uno nuevo…</p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3">
              <div className="w-10 h-10 border-[3px] border-gray-100 border-t-green-500 rounded-full animate-spin" />
              <p className="text-sm text-gray-400">
                {waStatus === 'connecting' ? 'Conectando…' : 'Preparando código QR…'}
              </p>
              <p className="text-[10px] text-gray-300">Puede tardar hasta 15 segundos</p>
            </div>
          )}
        </div>

        {/* Steps */}
        <div className="w-full space-y-2 text-left">
          {[
            { text: 'Abre WhatsApp en tu teléfono' },
            { text: 'Toca ⋮ (Android) o Ajustes ⚙️ (iPhone) → "Dispositivos vinculados"' },
            { text: 'Toca "Vincular dispositivo"' },
            { text: 'Apunta la cámara al código QR de arriba ↑' },
          ].map((s, i) => (
            <div key={i} className="flex items-start gap-3">
              <span className="w-5 h-5 rounded-full bg-green-500 text-white text-[11px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                {i + 1}
              </span>
              <p className="text-sm text-gray-600 leading-snug">{s.text}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Status */}
      <div className={`flex items-center gap-2 text-sm px-4 py-2 rounded-full transition-all ${
        waStatus === 'connected'
          ? 'bg-green-50 text-green-700'
          : waStatus === 'connecting'
          ? 'bg-amber-50 text-amber-700'
          : 'bg-red-50 text-red-600'
      }`}>
        <span className={`w-2 h-2 rounded-full ${
          waStatus === 'connected' ? 'bg-green-500' :
          waStatus === 'connecting' ? 'bg-amber-400 animate-pulse' : 'bg-red-500'
        }`} />
        {waStatus === 'connected'
          ? '¡Vinculado! Continuando…'
          : waStatus === 'connecting'
          ? 'Esperando que escanees el código…'
          : 'Sin conexión a internet'}
      </div>
    </div>
  )
}

// ── Step 3: Chrome Extension ──────────────────────────────────────────────────

function ExtensionStep({ extensionPath, onDone }: { extensionPath: string; onDone: () => void }) {
  const [openedFinder, setOpenedFinder] = useState(false)
  const [openedChrome, setOpenedChrome] = useState(false)

  function handleOpenFinder() {
    window.api.openExtensionInFinder?.()
    setOpenedFinder(true)
  }

  function handleOpenChrome() {
    window.api.openChromeExtensions?.()
    setOpenedChrome(true)
  }

  return (
    <div className="flex flex-col items-center gap-6 w-full max-w-sm text-center">

      <div className="flex flex-col items-center gap-3">
        <div className="w-16 h-16 rounded-2xl bg-blue-50 border border-blue-100 flex items-center justify-center">
          <span className="text-4xl">🧩</span>
        </div>
        <div>
          <h2 className="text-xl font-bold text-gray-900">Un último paso</h2>
          <p className="text-gray-500 text-sm mt-1 leading-relaxed">
            La extensión de Chrome hace que los <strong className="text-gray-700">nombres de tus brokers</strong> aparezcan
            en el Copilot. Solo lo haces una vez.
          </p>
        </div>
      </div>

      {/* Steps */}
      <div className="w-full space-y-3">

        {/* Step 1 — Open Chrome */}
        <div className={`flex gap-3 items-start p-3.5 rounded-2xl border transition-all ${
          openedChrome ? 'border-green-200 bg-green-50' : 'border-gray-100 bg-gray-50'
        }`}>
          <span className={`w-6 h-6 rounded-full text-white text-xs font-bold flex items-center justify-center shrink-0 mt-0.5 ${
            openedChrome ? 'bg-green-500' : 'bg-blue-500'
          }`}>
            {openedChrome ? '✓' : '1'}
          </span>
          <div className="flex-1 text-left">
            <p className="text-sm font-semibold text-gray-900">Abre la página de extensiones en Chrome</p>
            <p className="text-xs text-gray-500 mt-0.5">Haz clic abajo y Chrome se abre solo en la página correcta.</p>
            <button
              onClick={handleOpenChrome}
              className={`mt-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                openedChrome
                  ? 'bg-green-100 text-green-700'
                  : 'bg-blue-500 hover:bg-blue-600 text-white'
              }`}
            >
              {openedChrome ? '✓ Chrome abierto' : '🌐 Abrir Chrome → Extensiones'}
            </button>
          </div>
        </div>

        {/* Step 2 — Developer mode explanation */}
        <div className="flex gap-3 items-start p-3.5 rounded-2xl border border-gray-100 bg-gray-50">
          <span className="w-6 h-6 rounded-full bg-blue-500 text-white text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">2</span>
          <div className="flex-1 text-left">
            <p className="text-sm font-semibold text-gray-900">Activa "Modo desarrollador"</p>
            <p className="text-xs text-gray-500 mt-0.5">
              En la esquina superior derecha de Chrome hay un interruptor llamado
              <strong> "Modo desarrollador"</strong>. Actívalo.
              <span className="text-green-600 font-medium"> Es seguro — no cambia nada en tu computadora.</span>
            </p>
          </div>
        </div>

        {/* Step 3 — Open Finder + load */}
        <div className={`flex gap-3 items-start p-3.5 rounded-2xl border transition-all ${
          openedFinder ? 'border-green-200 bg-green-50' : 'border-gray-100 bg-gray-50'
        }`}>
          <span className={`w-6 h-6 rounded-full text-white text-xs font-bold flex items-center justify-center shrink-0 mt-0.5 ${
            openedFinder ? 'bg-green-500' : 'bg-blue-500'
          }`}>
            {openedFinder ? '✓' : '3'}
          </span>
          <div className="flex-1 text-left">
            <p className="text-sm font-semibold text-gray-900">Carga la extensión</p>
            <p className="text-xs text-gray-500 mt-0.5">
              Haz clic en <strong>"Cargar descomprimida"</strong> en Chrome, luego abre
              la carpeta que aparece aquí abajo:
            </p>
            <button
              onClick={handleOpenFinder}
              className={`mt-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                openedFinder
                  ? 'bg-green-100 text-green-700'
                  : 'bg-blue-500 hover:bg-blue-600 text-white'
              }`}
            >
              {openedFinder ? '✓ Carpeta abierta en Finder' : '📂 Abrir carpeta de la extensión'}
            </button>
          </div>
        </div>

        {/* Step 4 — Use it */}
        <div className="flex gap-3 items-start p-3.5 rounded-2xl border border-gray-100 bg-gray-50">
          <span className="w-6 h-6 rounded-full bg-blue-500 text-white text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">4</span>
          <div className="flex-1 text-left">
            <p className="text-sm font-semibold text-gray-900">Sincroniza los contactos</p>
            <p className="text-xs text-gray-500 mt-0.5">
              Abre <strong>web.whatsapp.com</strong> en Chrome, haz clic en
              el ícono 🧩 de la extensión y presiona <strong>"Sincronizar contactos"</strong>.
              Los nombres aparecerán en Copilot en segundos.
            </p>
          </div>
        </div>
      </div>

      {/* CTAs */}
      <div className="w-full space-y-2">
        <button
          onClick={onDone}
          className="w-full py-3 bg-green-500 hover:bg-green-600 active:scale-[0.98] text-white font-semibold rounded-2xl transition-all shadow-lg shadow-green-200"
        >
          Listo, abrir el Kanban →
        </button>
        <button
          onClick={onDone}
          className="w-full py-2 text-xs text-gray-400 hover:text-gray-600 transition-colors"
        >
          Omitir por ahora — puedo instalarlo en cualquier momento desde Configuración
        </button>
      </div>
    </div>
  )
}
