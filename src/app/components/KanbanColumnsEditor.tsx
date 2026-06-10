import { useEffect, useState } from 'react'
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors, DragEndEvent
} from '@dnd-kit/core'
import {
  SortableContext, verticalListSortingStrategy, useSortable, arrayMove
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useContactsStore } from '../stores/contactsStore'
import { useKanbanColumnsStore } from '../stores/kanbanColumnsStore'
import type { KanbanColumnRow } from '../../server/db/schema'

const PORT = () => window.api?.serverPort ?? 3847

// Local editable row — `id` is negative & temporary for not-yet-saved new columns
interface EditableColumn {
  id: number
  key: string
  label: string
  isNew: boolean
}

let nextTempId = -1

function SortableRow({
  col, count, error, onLabelChange, onDelete
}: {
  col: EditableColumn
  count: number
  error?: string
  onLabelChange: (id: number, label: string) => void
  onDelete: (id: number) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: col.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1
  }

  return (
    <div ref={setNodeRef} style={style}>
      <div className="flex items-center gap-2 bg-gray-50 rounded-xl px-3 py-2">
        <button
          {...attributes}
          {...listeners}
          title="Drag to reorder"
          className="cursor-grab active:cursor-grabbing text-gray-400 hover:text-gray-600 px-1 leading-none touch-none"
        >
          ⠿
        </button>
        <input
          value={col.label}
          onChange={e => onLabelChange(col.id, e.target.value)}
          className="flex-1 bg-white border border-gray-200 rounded-lg px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-gray-300"
        />
        <button
          onClick={() => onDelete(col.id)}
          className="text-gray-400 hover:text-red-500 text-lg leading-none ml-1"
          title="Delete column"
        >
          ×
        </button>
      </div>
      {error && (
        <p className="text-xs text-red-500 mt-1 ml-2">{error}</p>
      )}
    </div>
  )
}

export function KanbanColumnsEditor() {
  const { columns, setColumns, fetchColumns } = useKanbanColumnsStore()
  const contacts = useContactsStore(s => s.contacts)

  const [rows, setRows] = useState<EditableColumn[]>([])
  const [newLabel, setNewLabel] = useState('')
  const [errors, setErrors] = useState<Record<number, string>>({})
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => { fetchColumns() }, [])

  useEffect(() => {
    setRows(columns.map(c => ({ id: c.id, key: c.key, label: c.label, isNew: false })))
  }, [columns])

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const countInColumn = (key: string) => contacts.filter(c => c.stage === key).length

  const handleLabelChange = (id: number, label: string) => {
    setRows(prev => prev.map(r => r.id === id ? { ...r, label } : r))
  }

  const handleDelete = (id: number) => {
    const row = rows.find(r => r.id === id)
    if (!row) return
    if (!row.isNew && countInColumn(row.key) > 0) {
      setErrors(prev => ({ ...prev, [id]: 'This column has to be emptied before it can be deleted.' }))
      return
    }
    setErrors(prev => {
      const next = { ...prev }
      delete next[id]
      return next
    })
    setRows(prev => prev.filter(r => r.id !== id))
  }

  const handleAdd = () => {
    if (!newLabel.trim()) return
    setRows(prev => [...prev, { id: nextTempId--, key: '', label: newLabel.trim(), isNew: true }])
    setNewLabel('')
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    setRows(prev => {
      const oldIndex = prev.findIndex(r => r.id === active.id)
      const newIndex = prev.findIndex(r => r.id === over.id)
      return arrayMove(prev, oldIndex, newIndex)
    })
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const port = PORT()
      // 1. Create new columns
      const idMap = new Map<number, number>() // tempId -> realId
      for (const row of rows) {
        if (row.isNew) {
          const res = await fetch(`http://127.0.0.1:${port}/kanban-columns`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ label: row.label })
          })
          const created = await res.json()
          idMap.set(row.id, created.id)
        }
      }

      // 2. Rename existing columns whose label changed
      for (const row of rows) {
        if (!row.isNew) {
          const original = columns.find(c => c.id === row.id)
          if (original && original.label !== row.label) {
            await fetch(`http://127.0.0.1:${port}/kanban-columns/${row.id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ label: row.label })
            })
          }
        }
      }

      // 3. Delete removed columns
      const currentIds = new Set(rows.filter(r => !r.isNew).map(r => r.id))
      for (const original of columns) {
        if (!currentIds.has(original.id)) {
          await fetch(`http://127.0.0.1:${port}/kanban-columns/${original.id}`, { method: 'DELETE' })
        }
      }

      // 4. Reorder using final (real) ids
      const order = rows.map(r => r.isNew ? idMap.get(r.id)! : r.id)
      const res = await fetch(`http://127.0.0.1:${port}/kanban-columns/reorder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order })
      })
      const updated: KanbanColumnRow[] = await res.json()
      setColumns(updated)
      setErrors({})
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="mb-8 border-t border-gray-100 pt-8">
      <h2 className="text-sm font-semibold text-gray-900 mb-1">Kanban Columns</h2>
      <p className="text-xs text-gray-400 mb-3">
        Add, rename, delete, and reorder the columns of your pipeline. Drag <span className="font-mono">⠿</span> to reposition. Columns with conversations can only be renamed.
      </p>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={rows.map(r => r.id)} strategy={verticalListSortingStrategy}>
          <div className="flex flex-col gap-1.5 mb-3">
            {rows.map(row => (
              <SortableRow
                key={row.id}
                col={row}
                count={row.isNew ? 0 : countInColumn(row.key)}
                error={errors[row.id]}
                onLabelChange={handleLabelChange}
                onDelete={handleDelete}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {/* Add new column */}
      <div className="flex gap-2 mb-3">
        <input
          value={newLabel}
          onChange={e => setNewLabel(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleAdd() }}
          placeholder="New column name"
          className="flex-1 border border-gray-200 rounded-lg px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-gray-300"
        />
        <button
          onClick={handleAdd}
          disabled={!newLabel.trim()}
          className="px-3 py-1.5 bg-gray-100 text-gray-700 text-sm rounded-lg disabled:opacity-40 hover:bg-gray-200"
        >
          + Add
        </button>
      </div>

      {/* Save */}
      <button
        onClick={handleSave}
        disabled={saving || rows.length === 0}
        className="px-4 py-2 bg-gray-900 text-white text-sm rounded-lg hover:bg-gray-700 disabled:opacity-50"
      >
        {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save'}
      </button>
    </section>
  )
}
