import { useEffect, useState } from 'react'
import QRCode from 'qrcode'

interface Props {
  qr: string
  accountId: number
  onClose: () => void
}

export function AddAccountModal({ qr, accountId, onClose }: Props) {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [showExpired, setShowExpired] = useState(false)

  // Render the initial QR
  useEffect(() => {
    QRCode.toDataURL(qr, { width: 260, margin: 2 }).then(url => {
      setQrDataUrl(url)
      setShowExpired(false)
    })
    const t = setTimeout(() => setShowExpired(true), 60_000)
    return () => clearTimeout(t)
  }, [qr])

  // Listen for refreshed QR codes for this account
  useEffect(() => {
    const off = window.api.onQR(({ qr: newQr, accountId: id }) => {
      if (id !== accountId) return
      setShowExpired(false)
      QRCode.toDataURL(newQr, { width: 260, margin: 2 }).then(setQrDataUrl)
      setTimeout(() => setShowExpired(true), 60_000)
    })
    return off
  }, [accountId])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-2xl shadow-2xl p-8 flex flex-col items-center gap-5 w-[360px]">
        <div className="flex items-center gap-2 self-start w-full justify-between">
          <h2 className="text-base font-semibold text-gray-900">Link new number</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-700 text-xl leading-none"
          >
            ×
          </button>
        </div>

        <p className="text-xs text-gray-500 text-center">
          Open WhatsApp on the second phone → ⋮ → <strong>Linked Devices</strong> → <strong>Link a Device</strong>
        </p>

        <div className="w-64 h-64 flex items-center justify-center bg-gray-50 rounded-xl border border-gray-200">
          {qrDataUrl && !showExpired ? (
            <img src={qrDataUrl} alt="QR WhatsApp" className="w-60 h-60 rounded-lg" />
          ) : showExpired ? (
            <div className="flex flex-col items-center gap-2 text-center p-6">
              <span className="text-2xl">🔄</span>
              <p className="text-xs text-gray-400">Code expired — generating a new one…</p>
            </div>
          ) : (
            <div className="w-8 h-8 border-2 border-gray-300 border-t-gray-900 rounded-full animate-spin" />
          )}
        </div>

        <button
          onClick={onClose}
          className="w-full text-sm text-gray-500 hover:text-gray-800 py-1"
        >
          Cancelar
        </button>
      </div>
    </div>
  )
}
