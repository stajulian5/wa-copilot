import { useEffect, useState } from 'react'
import { useContactsStore } from '../stores/contactsStore'

interface TeamMember {
  name: string
  phone: string
}

interface Props {
  contactId: number
  onClose: () => void
}

const PORT = () => window.api?.serverPort ?? 3847

export function EscalateModal({ contactId, onClose }: Props) {
  const contact = useContactsStore(s => s.contacts.find(c => c.id === contactId))

  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([])
  const [selectedPhone, setSelectedPhone] = useState('')
  const [summary, setSummary] = useState('')
  const [summaryLoading, setSummaryLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Load team members from settings
  useEffect(() => {
    fetch(`http://127.0.0.1:${PORT()}/settings`)
      .then(r => r.json())
      .then((s: Record<string, string>) => {
        try {
          const members: TeamMember[] = JSON.parse(s.team_members ?? '[]')
          setTeamMembers(members)
          if (members.length > 0) setSelectedPhone(members[0].phone)
        } catch {}
      })
  }, [])

  // Generate AI summary on open
  useEffect(() => {
    setSummaryLoading(true)
    fetch(`http://127.0.0.1:${PORT()}/ai/summarize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contactId })
    })
      .then(r => r.json())
      .then(data => {
        if (data.summary) setSummary(data.summary)
        else if (data.error === 'NO_API_KEY') setSummary('[Sin clave API — escribe el resumen manualmente]')
        else setSummary('')
      })
      .catch(() => setSummary(''))
      .finally(() => setSummaryLoading(false))
  }, [contactId])

  const send = async () => {
    if (!selectedPhone || !summary.trim()) return
    setSending(true)
    setError(null)
    try {
      const r = await fetch(`http://127.0.0.1:${PORT()}/contacts/${contactId}/escalate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipientPhone: selectedPhone, summary: summary.trim() })
      })
      const data = await r.json()
      if (data.ok) {
        setSent(true)
        setTimeout(onClose, 1500)
      } else {
        setError(data.error === 'WA_DISCONNECTED' ? 'WhatsApp no está conectado' : (data.error ?? 'Error al enviar'))
      }
    } catch {
      setError('Error de red')
    } finally {
      setSending(false)
    }
  }

  const contactName = contact?.name ?? contact?.phone ?? 'Contacto'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white rounded-2xl shadow-2xl w-[480px] max-h-[85vh] flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <h2 className="font-semibold text-gray-900">Escalar conversación</h2>
            <p className="text-xs text-gray-400 mt-0.5">{contactName}</p>
          </div>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-700 rounded-lg">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-4">

          {/* Recipient picker */}
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5 block">
              Enviar a
            </label>
            {teamMembers.length === 0 ? (
              <p className="text-sm text-amber-600 bg-amber-50 rounded-lg px-3 py-2">
                No hay integrantes del equipo configurados.{' '}
                <span className="font-medium">Ve a Configuración → Equipo</span> para agregar personas.
              </p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {teamMembers.map(m => (
                  <button
                    key={m.phone}
                    onClick={() => setSelectedPhone(m.phone)}
                    className={`flex items-center gap-2.5 px-3 py-2 rounded-xl border text-sm transition-colors text-left ${
                      selectedPhone === m.phone
                        ? 'border-gray-900 bg-gray-900 text-white'
                        : 'border-gray-200 text-gray-700 hover:border-gray-400'
                    }`}
                  >
                    <span className="font-medium flex-1">{m.name}</span>
                    <span className={`text-xs ${selectedPhone === m.phone ? 'text-gray-300' : 'text-gray-400'}`}>
                      +{m.phone}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Summary */}
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5 block">
              Resumen (editable)
            </label>
            {summaryLoading ? (
              <div className="rounded-xl border border-gray-200 p-3 h-28 flex items-center justify-center">
                <span className="text-sm text-gray-400 animate-pulse">Generando resumen con IA…</span>
              </div>
            ) : (
              <textarea
                value={summary}
                onChange={e => setSummary(e.target.value)}
                rows={5}
                className="selectable w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm text-gray-700 resize-none outline-none focus:ring-2 focus:ring-gray-300"
                placeholder="Escribe un resumen de la situación…"
              />
            )}
          </div>

          {/* Preview of what will be sent */}
          {summary && !summaryLoading && (
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5 block">
                Vista previa del mensaje
              </label>
              <div className="bg-gray-50 rounded-xl p-3 text-xs text-gray-600 whitespace-pre-wrap font-mono leading-relaxed border border-gray-100">
                {buildPreview(contactName, contact?.stage ?? 'new', contact?.property ?? null, summary)}
              </div>
            </div>
          )}

          {error && (
            <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-100">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 rounded-lg">
            Cancelar
          </button>
          <button
            onClick={send}
            disabled={!selectedPhone || !summary.trim() || sending || sent || summaryLoading}
            className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-xl hover:bg-gray-700 disabled:opacity-40 transition-all"
          >
            {sent ? '✓ Enviado' : sending ? 'Enviando…' : '📤 Enviar por WhatsApp'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const STAGE_LABELS: Record<string, string> = {
  new: '🆕 New',
  open_conversation: '💬 Open Conversation',
  waiting_for: '⏳ Waiting For',
  all_resolved: '✅ All Resolved'
}

function buildPreview(name: string, stage: string, property: string | null, summary: string): string {
  const lines = [
    '🔔 *Conversación escalada*',
    '',
    `*Contacto:* ${name}`,
    `*Etapa:* ${STAGE_LABELS[stage] ?? stage}`,
    property ? `*Propiedad:* ${property}` : null,
    '',
    summary,
    '',
    '_— Enviado desde WhatsApp Copilot_'
  ].filter(l => l !== null)
  return lines.join('\n')
}
