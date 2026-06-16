interface Props {
  version: string
  onUpdate: () => void
  onDismiss: () => void
}

export function UpdateBanner({ version, onUpdate, onDismiss }: Props) {
  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-gray-900 text-white text-sm px-4 py-3 rounded-xl shadow-lg">
      <span>✦ v{version} is ready to install</span>
      <button
        onClick={onUpdate}
        className="bg-white text-gray-900 font-medium px-3 py-1 rounded-lg hover:bg-gray-100 transition-colors"
      >
        Update now
      </button>
      <button
        onClick={onDismiss}
        className="text-gray-400 hover:text-white transition-colors text-lg leading-none"
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  )
}
