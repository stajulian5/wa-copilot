import { create } from 'zustand'
import type { KanbanColumnRow } from '../../server/db/schema'

const PORT = () => window.api?.serverPort ?? 3847

interface KanbanColumnsState {
  columns: KanbanColumnRow[]
  setColumns: (cols: KanbanColumnRow[]) => void
  fetchColumns: () => Promise<void>
}

export const useKanbanColumnsStore = create<KanbanColumnsState>((set) => ({
  columns: [],
  setColumns: (columns) => set({ columns }),
  fetchColumns: async () => {
    const res = await fetch(`http://127.0.0.1:${PORT()}/kanban-columns`)
    const cols: KanbanColumnRow[] = await res.json()
    set({ columns: cols })
  }
}))
