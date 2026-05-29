interface Props {
  suggestion: string | null
  loading: boolean
  onEdit: (text: string) => void
  onSend: (text: string) => void
  onDismiss: () => void
}

export function AISuggestion({ suggestion, loading, onEdit, onSend, onDismiss }: Props) {
  return (
    <div className="border-t border-yellow-100 bg-yellow-50 px-3 py-2">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-medium text-yellow-700">✨ Sugerencia IA</span>
        <button onClick={onDismiss} className="text-yellow-400 hover:text-yellow-600 text-sm leading-none">×</button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-1">
          <div className="flex gap-1">
            {[0, 1, 2].map(i => (
              <div
                key={i}
                className="w-1.5 h-1.5 bg-yellow-400 rounded-full animate-bounce"
                style={{ animationDelay: `${i * 0.15}s` }}
              />
            ))}
          </div>
          <span className="text-xs text-yellow-600">Generando…</span>
        </div>
      ) : suggestion ? (
        <>
          <p className="text-sm text-gray-800 mb-2 whitespace-pre-wrap leading-snug">{suggestion}</p>
          <div className="flex gap-2">
            <button
              onClick={() => onEdit(suggestion)}
              className="flex-1 py-1 text-xs border border-yellow-300 text-yellow-700 rounded-lg hover:bg-yellow-100 transition-colors"
            >
              Editar
            </button>
            <button
              onClick={() => onSend(suggestion)}
              className="flex-1 py-1 text-xs bg-yellow-500 text-white rounded-lg hover:bg-yellow-600 transition-colors"
            >
              Enviar ⌘↵
            </button>
          </div>
        </>
      ) : (
        <p className="text-xs text-yellow-600">No se pudo generar una sugerencia.</p>
      )}
    </div>
  )
}
