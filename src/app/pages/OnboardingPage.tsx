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
  const [stuck, setStuck] = useState(false)

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

  // If we're stuck on "Connecting…" with no QR for too long, the WebSocket
  // connection to WhatsApp's servers is likely being blocked (firewall/VPN/
  // restrictive network) — surface troubleshooting tips + a retry button.
  useEffect(() => {
    if (step !== 'qr' || qrDataUrl) {
      setStuck(false)
      return
    }
    const timer = setTimeout(() => setStuck(true), 25_000)
    return () => clearTimeout(timer)
  }, [step, qrDataUrl, waStatus])

  function retryConnection() {
    setStuck(false)
    setQrDataUrl(null)
    setShowExpired(false)
    window.api.resetWAAuth?.()
  }

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
          <StepDot active={step === 'qr'} done={step === 'extension'} label="Link" />
          {isFirstRun && !isRelink && (
            <StepDot active={step === 'extension'} done={false} label="Extension" />
          )}
        </div>
      )}

      <div className="flex-1 flex items-center justify-center py-14 px-4">
        {step === 'welcome'   && <WelcomeStep   onNext={() => setStep('qr')} />}
        {step === 'qr'        && <QRStep qrDataUrl={qrDataUrl} showExpired={showExpired} waStatus={waStatus} isRelink={isRelink} stuck={stuck} onRetry={retryConnection} />}
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
        <img src="/icon.png" alt="WA Copilot" className="w-24 h-24 rounded-[28px] shadow-2xl shadow-green-200" />
        <div>
          <h1 className="text-3xl font-bold text-gray-900 tracking-tight">WA Copilot</h1>
          <p className="text-gray-400 mt-1">Your WhatsApp assistant for client teams</p>
        </div>
      </div>

      {/* Features */}
      <div className="w-full space-y-2.5">
        {[
          { icon: '📋', title: 'Client pipeline', desc: 'Organise your WhatsApp conversations in a visual board.' },
          { icon: '💬', title: 'Integrated chat',       desc: 'Read and reply to messages without leaving WA Copilot.' },
          { icon: '✨', title: 'AI replies', desc: 'Automatic reply suggestions — you decide whether to send them.' },
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
          Start setup →
        </button>
        <p className="text-[11px] text-gray-400">
          All you need is your phone and 2 minutes. No business account required.
        </p>
      </div>
    </div>
  )
}

// ── Step 2: QR Scan ───────────────────────────────────────────────────────────

function QRStep({ qrDataUrl, showExpired, waStatus, isRelink, stuck, onRetry }: {
  qrDataUrl: string | null
  showExpired: boolean
  waStatus: string
  isRelink?: boolean
  stuck?: boolean
  onRetry?: () => void
}) {
  return (
    <div className="flex flex-col items-center gap-5 w-full max-w-sm text-center">

      <div>
        <h2 className="text-xl font-bold text-gray-900">
          {isRelink ? 'Re-link your WhatsApp' : 'Link your WhatsApp'}
        </h2>
        <p className="text-gray-500 text-sm mt-1">
          {isRelink
            ? 'Your session expired. Follow the same steps as the first time.'
            : 'Follow these steps on your phone — only done once.'}
        </p>
      </div>

      {/* Phone steps + QR side by side on wider screens, stacked on narrow */}
      <div className="flex flex-col items-center gap-5 w-full">

        {/* QR code — shown prominently first */}
        <div className="relative w-56 h-56 flex items-center justify-center bg-white rounded-3xl border-2 border-gray-100 shadow-xl">
          {qrDataUrl && !showExpired ? (
            <img src={qrDataUrl} alt="WhatsApp QR code" className="w-48 h-48 rounded-2xl" />
          ) : showExpired ? (
            <div className="flex flex-col items-center gap-2 p-4">
              <span className="text-3xl animate-spin">🔄</span>
              <p className="text-sm font-medium text-gray-600">Code expired</p>
              <p className="text-xs text-gray-400">Generating a new one…</p>
            </div>
          ) : stuck ? (
            <div className="flex flex-col items-center gap-2 p-4">
              <span className="text-3xl">📡</span>
              <p className="text-sm font-medium text-gray-700">Taking longer than usual</p>
              <p className="text-xs text-gray-400 leading-relaxed">
                This can happen on a restricted Wi-Fi, VPN, or firewall that blocks WhatsApp's servers.
                Try a different network (e.g. your phone's hotspot) or check your firewall settings.
              </p>
              <button
                onClick={onRetry}
                className="mt-1 px-4 py-1.5 bg-green-500 hover:bg-green-600 text-white text-xs font-semibold rounded-lg transition-colors"
              >
                Try again
              </button>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3">
              <div className="w-10 h-10 border-[3px] border-gray-100 border-t-green-500 rounded-full animate-spin" />
              <p className="text-sm text-gray-400">
                {waStatus === 'connecting' ? 'Connecting…' : 'Preparing QR code…'}
              </p>
              <p className="text-[10px] text-gray-300">May take up to 15 seconds</p>
            </div>
          )}
        </div>

        {/* Steps */}
        <div className="w-full space-y-2 text-left">
          {[
            { text: 'Open WhatsApp on your phone' },
            { text: 'Toca ⋮ (Android) o Ajustes ⚙️ (iPhone) → "Dispositivos vinculados"' },
            { text: 'Tap "Link a device"' },
            { text: 'Point the camera at the QR code above ↑' },
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
          ? 'Linked! Continuing…'
          : waStatus === 'connecting'
          ? 'Waiting for you to scan the code…'
          : 'No internet connection'}
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
    <div className="flex flex-col items-center gap-5 w-full max-w-sm text-center">

      <div className="flex flex-col items-center gap-3">
        <div className="w-14 h-14 rounded-2xl bg-blue-50 border border-blue-100 flex items-center justify-center">
          <span className="text-3xl">🧩</span>
        </div>
        <div>
          <div className="inline-block bg-amber-50 border border-amber-200 text-amber-700 text-[10px] font-bold px-2 py-0.5 rounded-full mb-2 tracking-wide uppercase">
            Optional — but recommended
          </div>
          <h2 className="text-lg font-bold text-gray-900">Add the Chrome Extension</h2>
          <p className="text-gray-500 text-xs mt-1.5 leading-relaxed max-w-[260px] mx-auto">
            WA Copilot works perfectly without it. The extension adds a <strong className="text-gray-700">backup sync</strong> — if the direct WhatsApp connection ever misses a message, the extension catches it automatically every 2 minutes.
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
            <p className="text-sm font-semibold text-gray-900">Open Chrome's extensions page</p>
            <p className="text-xs text-gray-500 mt-0.5">Click below and Chrome opens to the right page automatically.</p>
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
            <p className="text-sm font-semibold text-gray-900">Activa "Developer mode"</p>
            <p className="text-xs text-gray-500 mt-0.5">
              En la esquina superior derecha de Chrome hay un interruptor llamado
              <strong> "Developer mode"</strong>. Enable it.
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
            <p className="text-sm font-semibold text-gray-900">Load the extension</p>
            <p className="text-xs text-gray-500 mt-0.5">
              Haz clic en <strong>"Cargar descomprimida"</strong> en Chrome, luego abre
              the folder shown below:
            </p>
            <button
              onClick={handleOpenFinder}
              className={`mt-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                openedFinder
                  ? 'bg-green-100 text-green-700'
                  : 'bg-blue-500 hover:bg-blue-600 text-white'
              }`}
            >
              {openedFinder ? '✓ Folder opened in Finder' : '📂 Open extension folder'}
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
              the 🧩 extension icon and click <strong>"Sync contacts"</strong>.
              Names will appear in WA Copilot within seconds.
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
          Done — open my Kanban →
        </button>
        <button
          onClick={onDone}
          className="w-full py-2 text-xs text-gray-500 hover:text-gray-700 transition-colors"
        >
          Skip for now · You can add it later by clicking the "Chrome Ext" badge in the top bar
        </button>
      </div>
    </div>
  )
}
