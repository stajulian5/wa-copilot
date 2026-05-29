import { useEffect, useState } from 'react'

const PORT = () => window.api?.serverPort ?? 3847

interface Template {
  id: number
  title: string
  body: string
  sortOrder: number
}

interface Props {
  contactName: string
  onSelect: (text: string) => void
  onClose: () => void
}

function interpolate(body: string, name: string): string {
  return body.replace(/\{\{name\}\}/g, name)
}

export function TemplatesPicker({ contactName, onSelect, onClose }: Props) {
  const [templates, setTemplates] = useState<Template[]>([])
  const [query, setQuery] = useState('')

  useEffect(() => {
    fetch(`http://127.0.0.1:${PORT()}/settings/templates`)
      .then(r => r.json())
      .then(setTemplates)
      .catch(() => {})
  }, [])

  const filtered = templates.filter(t =>
    t.title.toLowerCase().includes(query.toLowerCase()) ||
    t.body.toLowerCase().includes(query.toLowerCase())
  )

  return (
    <div className="border-t border-gray-100 bg-white max-h-64 flex flex-col">
      <div className="flex items-center justify-between px-3 pt-2 pb-1">
        <span className="text-xs font-medium text-gray-600">📋 Plantillas</span>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-sm leading-none">×</button>
      </div>

      <div className="px-3 pb-1">
        <input
          autoFocus
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Buscar plantilla…"
          className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 outline-none focus:ring-2 focus:ring-gray-300"
          onKeyDown={e => { if (e.key === 'Escape') onClose() }}
        />
      </div>

      <div className="overflow-y-auto flex-1 pb-1">
        {filtered.length === 0 ? (
          <p className="text-xs text-gray-400 text-center py-4">Sin plantillas</p>
        ) : (
          filtered.map(t => (
            <button
              key={t.id}
              onClick={() => onSelect(interpolate(t.body, contactName))}
              className="w-full text-left px-3 py-2 hover:bg-gray-50 transition-colors"
            >
              <p className="text-xs font-medium text-gray-800">{t.title}</p>
              <p className="text-xs text-gray-400 truncate">{interpolate(t.body, contactName)}</p>
            </button>
          ))
        )}
      </div>
    </div>
  )
}
