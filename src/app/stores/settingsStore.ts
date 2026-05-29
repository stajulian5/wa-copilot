import { create } from 'zustand'

const TONE_OPTIONS = [
  'Directo', 'Cálido', 'Conciso', 'Formal', 'Casual',
  'Empático', 'Proactivo', 'Enérgico', 'Tranquilizador',
  'Detallado', 'Asertivo', 'Entusiasta'
] as const

export type ToneAttribute = typeof TONE_OPTIONS[number]

interface SettingsState {
  activeTones: Set<ToneAttribute>
  monthlyBudgetUsd: number
  sheetsLastSync: string | null
  toneOptions: readonly ToneAttribute[]

  toggleTone: (t: ToneAttribute) => void
  setBudget: (usd: number) => void
  setSheetsLastSync: (v: string | null) => void
  getTonesString: () => string
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  activeTones: new Set(['Cálido', 'Conciso', 'Proactivo'] as ToneAttribute[]),
  monthlyBudgetUsd: 10,
  sheetsLastSync: null,
  toneOptions: TONE_OPTIONS,

  toggleTone: (t) =>
    set((s) => {
      const next = new Set(s.activeTones)
      next.has(t) ? next.delete(t) : next.add(t)
      return { activeTones: next }
    }),

  setBudget: (usd) => set({ monthlyBudgetUsd: usd }),
  setSheetsLastSync: (v) => set({ sheetsLastSync: v }),

  getTonesString: () => Array.from(get().activeTones).join(', ')
}))
