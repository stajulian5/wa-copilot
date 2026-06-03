import { useEffect, useState } from 'react'
import QRCode from 'qrcode'

interface Props {
  waStatus: 'disconnected' | 'connecting' | 'connected'
  initialQr: string | null
  onQRReceived: (qr: string) => void
}

export function OnboardingPage({ waStatus, initialQr, onQRReceived }: Props) {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [showExpired, setShowExpired] = useState(false)

  // If a QR was already captured before this component mounted, render it immediately
  useEffect(() => {
    if (initialQr) {
      QRCode.toDataURL(initialQr, { width: 280, margin: 2 }).then(url => {
        setQrDataUrl(url)
        setShowExpired(false)
      })
    }
  }, [initialQr])

  useEffect(() => {
    const off = window.api.onQR(({ qr }) => {
      onQRReceived(qr)
      setShowExpired(false)
      QRCode.toDataURL(qr, { width: 280, margin: 2 }).then(setQrDataUrl)
      // QR codes expire after 60s
      setTimeout(() => setShowExpired(true), 60_000)
    })
    return off
  }, [])

  return (
    <div className="flex flex-col items-center justify-center h-screen bg-white">
      {/* macOS title bar drag area */}
      <div className="title-bar-drag fixed top-0 left-0 right-0 h-10" />

      <div className="flex flex-col items-center gap-6 mt-10">
        <div className="flex items-center gap-2">
          <span className="text-4xl">✈️</span>
          <span className="text-2xl font-semibold text-gray-900">WhatsApp Copilot</span>
        </div>

        <div className="text-center">
          <p className="text-gray-600 text-sm">
            Abre WhatsApp en tu teléfono → toca ⋮ → <strong>Dispositivos vinculados</strong> → <strong>Vincular dispositivo</strong>
          </p>
        </div>

        <div className="relative w-72 h-72 flex items-center justify-center bg-gray-50 rounded-2xl border border-gray-200">
          {qrDataUrl && !showExpired ? (
            <img src={qrDataUrl} alt="QR WhatsApp" className="w-64 h-64 rounded-lg" />
          ) : showExpired ? (
            <div className="flex flex-col items-center gap-2 text-center p-6">
              <span className="text-3xl">🔄</span>
              <p className="text-sm text-gray-500">El código expiró</p>
              <p className="text-xs text-gray-400">Espera un momento, generando uno nuevo…</p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3">
              <div className="w-8 h-8 border-2 border-gray-300 border-t-gray-900 rounded-full animate-spin" />
              <p className="text-sm text-gray-400">
                {waStatus === 'connecting' ? 'Conectando…' : 'Esperando código QR…'}
              </p>
            </div>
          )}
        </div>

        <p className="text-xs text-gray-400">
          Estado: {waStatus === 'connecting' ? '⏳ Conectando' : waStatus === 'connected' ? '✅ Conectado' : '❌ Desconectado'}
        </p>
      </div>
    </div>
  )
}
