import {
  useCallback, useEffect, useMemo, useRef, useState,
  type ClipboardEvent, type KeyboardEvent, type ReactNode,
} from 'react'
import { fmt, fmtPct, parseAmount } from '../lib/format'

export type GridRowKind = 'input' | 'section' | 'subtotal' | 'computed' | 'pct'

export interface GridRow {
  key: string
  label: ReactNode
  /** Editable 12-month values. Omit/null for non-editable rows. */
  values?: number[] | null
  /** Display-only 12-month values for computed/subtotal/pct rows. */
  display?: number[] | null
  kind?: GridRowKind
  readOnly?: boolean
  indent?: number
  /** Values for the leading context (history) columns. */
  context?: (number | null)[]
  /** Basis for fill tools, normally FY2026 actual months. */
  fillBasis?: number[]
}

export interface CellUpdate {
  rowKey: string
  monthIdx: number
  value: number
}

interface Props {
  rows: GridRow[]
  monthHeaders: string[]
  /** Headers for leading context columns (e.g. "FY25 Total", "FY26 Total"). */
  contextHeaders?: string[]
  readOnly?: boolean
  /** Index of the last month of fillBasis that contains actuals (0-11). */
  latestActualIdx?: number
  onChange?: (updates: CellUpdate[]) => void
  labelHeader?: string
  /** Extra toolbar content rendered to the right of fill tools. */
  toolbarExtra?: ReactNode
}

interface Sel {
  anchor: { r: number; c: number }
  focus: { r: number; c: number }
}

const rowStyles: Record<GridRowKind, string> = {
  input: '',
  section: 'bg-sky-50 font-semibold text-sky-900',
  subtotal: 'bg-slate-100 font-semibold',
  computed: 'bg-slate-50 text-slate-700',
  pct: 'bg-slate-50 text-slate-500 italic',
}

// sticky label cells need a solid background so scrolling content doesn't show through
const labelStyles: Record<GridRowKind, string> = {
  input: 'bg-white',
  section: 'bg-sky-50',
  subtotal: 'bg-slate-100',
  computed: 'bg-slate-50',
  pct: 'bg-slate-50',
}

export default function MonthGrid({
  rows, monthHeaders, contextHeaders = [], readOnly = false,
  latestActualIdx = 11, onChange, labelHeader = '', toolbarExtra,
}: Props) {
  const [sel, setSel] = useState<Sel | null>(null)
  const [editing, setEditing] = useState<{ r: number; c: number; text: string } | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)

  const editableRows = useMemo(
    () => rows.map((row, i) => ({ row, i })).filter(({ row }) => row.values && !row.readOnly && !readOnly),
    [rows, readOnly],
  )
  const isEditable = useCallback(
    (r: number) => !readOnly && !!rows[r]?.values && !rows[r]?.readOnly,
    [rows, readOnly],
  )

  const selRect = useMemo(() => {
    if (!sel) return null
    return {
      r1: Math.min(sel.anchor.r, sel.focus.r),
      r2: Math.max(sel.anchor.r, sel.focus.r),
      c1: Math.min(sel.anchor.c, sel.focus.c),
      c2: Math.max(sel.anchor.c, sel.focus.c),
    }
  }, [sel])

  const inSel = useCallback(
    (r: number, c: number) =>
      !!selRect && r >= selRect.r1 && r <= selRect.r2 && c >= selRect.c1 && c <= selRect.c2,
    [selRect],
  )

  function commitEdit(move?: { dr: number; dc: number }) {
    if (!editing) return
    const v = parseAmount(editing.text)
    if (v !== null && onChange) {
      onChange([{ rowKey: rows[editing.r].key, monthIdx: editing.c, value: v }])
    }
    const { r, c } = editing
    setEditing(null)
    if (move) moveFocus(r, c, move.dr, move.dc)
    containerRef.current?.focus()
  }

  function moveFocus(r: number, c: number, dr: number, dc: number) {
    let nr = r + dr
    const nc = Math.min(11, Math.max(0, c + dc))
    // skip non-editable rows vertically
    while (nr >= 0 && nr < rows.length && !isEditable(nr)) nr += dr || 1
    if (nr < 0 || nr >= rows.length) nr = r
    setSel({ anchor: { r: nr, c: nc }, focus: { r: nr, c: nc } })
  }

  function startEdit(r: number, c: number, initial?: string) {
    if (!isEditable(r)) return
    const cur = rows[r].values![c]
    setEditing({ r, c, text: initial ?? (cur === 0 ? '' : String(cur)) })
  }

  // ----- clipboard -----
  function onCopy(e: ClipboardEvent) {
    if (!selRect || editing) return
    e.preventDefault()
    const lines: string[] = []
    for (let r = selRect.r1; r <= selRect.r2; r++) {
      if (!rows[r].values && !rows[r].display) continue
      const vals = rows[r].values ?? rows[r].display!
      const cells: string[] = []
      for (let c = selRect.c1; c <= selRect.c2; c++) cells.push(String(vals[c] ?? 0))
      lines.push(cells.join('\t'))
    }
    e.clipboardData.setData('text/plain', lines.join('\n'))
  }

  function onPaste(e: ClipboardEvent) {
    if (!sel || editing || readOnly) return
    e.preventDefault()
    const text = e.clipboardData.getData('text/plain')
    if (!text) return
    const matrix = text
      .replace(/\r/g, '')
      .split('\n')
      .filter((l, i, a) => !(i === a.length - 1 && l === ''))
      .map((l) => l.split('\t').map((cell) => parseAmount(cell)))
    const start = { r: Math.min(sel.anchor.r, sel.focus.r), c: Math.min(sel.anchor.c, sel.focus.c) }
    const updates: CellUpdate[] = []
    // single value pasted into a larger selection fills the whole selection
    if (matrix.length === 1 && matrix[0].length === 1 && selRect &&
        (selRect.r2 > selRect.r1 || selRect.c2 > selRect.c1)) {
      const v = matrix[0][0]
      if (v !== null) {
        for (let r = selRect.r1; r <= selRect.r2; r++) {
          if (!isEditable(r)) continue
          for (let c = selRect.c1; c <= selRect.c2; c++) updates.push({ rowKey: rows[r].key, monthIdx: c, value: v })
        }
      }
    } else {
      let r = start.r
      for (const line of matrix) {
        while (r < rows.length && !isEditable(r)) r++
        if (r >= rows.length) break
        line.forEach((v, j) => {
          const c = start.c + j
          if (v !== null && c <= 11) updates.push({ rowKey: rows[r].key, monthIdx: c, value: v })
        })
        r++
      }
    }
    if (updates.length && onChange) onChange(updates)
  }

  // ----- keyboard -----
  function onKeyDown(e: KeyboardEvent) {
    if (editing) return
    if (!sel) return
    const { r, c } = sel.focus
    const nav: Record<string, [number, number]> = {
      ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1],
      Tab: [0, e.shiftKey ? -1 : 1], Enter: [1, 0],
    }
    if (nav[e.key]) {
      e.preventDefault()
      const [dr, dc] = nav[e.key]
      if (e.shiftKey && e.key.startsWith('Arrow')) {
        const nr = Math.min(rows.length - 1, Math.max(0, r + dr))
        const nc = Math.min(11, Math.max(0, c + dc))
        setSel({ anchor: sel.anchor, focus: { r: nr, c: nc } })
      } else {
        moveFocus(r, c, dr, dc)
      }
      return
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      if (!selRect || !onChange || readOnly) return
      const updates: CellUpdate[] = []
      for (let rr = selRect.r1; rr <= selRect.r2; rr++) {
        if (!isEditable(rr)) continue
        for (let cc = selRect.c1; cc <= selRect.c2; cc++) updates.push({ rowKey: rows[rr].key, monthIdx: cc, value: 0 })
      }
      if (updates.length) onChange(updates)
      return
    }
    if (e.key === 'F2') {
      e.preventDefault()
      startEdit(r, c)
      return
    }
    // start typing a number
    if (/^[-\d.,(]$/.test(e.key) && !e.ctrlKey && !e.metaKey) {
      e.preventDefault()
      startEdit(r, c, e.key)
    }
  }

  // ----- fill tools -----
  const hasSelection = !!selRect && editableRows.some(({ i }) => i >= selRect.r1 && i <= selRect.r2)

  function applyFill(maker: (row: GridRow) => number[] | null) {
    if (!selRect || !onChange) return
    const updates: CellUpdate[] = []
    for (let r = selRect.r1; r <= selRect.r2; r++) {
      if (!isEditable(r)) continue
      const vals = maker(rows[r])
      if (!vals) continue
      vals.forEach((v, c) => updates.push({ rowKey: rows[r].key, monthIdx: c, value: Math.round(v * 100) / 100 }))
    }
    if (updates.length) onChange(updates)
    containerRef.current?.focus()
  }

  const fillActions = [
    {
      label: 'Avg of actuals',
      title: 'Fill all 12 months with the average of last year’s actual months',
      run: () =>
        applyFill((row) => {
          const b = row.fillBasis
          if (!b) return null
          const n = latestActualIdx + 1
          const avg = b.slice(0, n).reduce((s, v) => s + v, 0) / n
          return Array(12).fill(avg)
        }),
    },
    {
      label: 'Latest month',
      title: 'Fill all 12 months with the most recent actual month',
      run: () => applyFill((row) => (row.fillBasis ? Array(12).fill(row.fillBasis[latestActualIdx]) : null)),
    },
    {
      label: 'Copy actuals',
      title: 'Copy last year’s actual months into the budget',
      run: () => applyFill((row) => row.fillBasis ?? null),
    },
    {
      label: '% increase',
      title: 'Last year’s actuals plus a percentage',
      run: () => {
        const s = window.prompt('Percentage increase on last year’s actuals (e.g. 6 or -5):')
        if (s === null) return
        const pct = Number(s)
        if (!isFinite(pct)) return
        applyFill((row) => row.fillBasis?.map((v) => v * (1 + pct / 100)) ?? null)
      },
    },
    {
      label: 'Set amount',
      title: 'Fill all 12 months with a specific amount',
      run: () => {
        const s = window.prompt('Amount per month:')
        if (s === null) return
        const v = parseAmount(s)
        if (v === null) return
        applyFill(() => Array(12).fill(v))
      },
    },
    {
      label: 'Spread annual',
      title: 'Spread an annual total evenly over 12 months',
      run: () => {
        const s = window.prompt('Annual total to spread over 12 months:')
        if (s === null) return
        const v = parseAmount(s)
        if (v === null) return
        applyFill(() => Array(12).fill(v / 12))
      },
    },
  ]

  // deselect when rows identity changes drastically
  useEffect(() => {
    setSel(null)
    setEditing(null)
  }, [rows.length])

  useEffect(() => {
    const up = () => (dragging.current = false)
    window.addEventListener('mouseup', up)
    return () => window.removeEventListener('mouseup', up)
  }, [])

  const nCtx = contextHeaders.length

  return (
    <div>
      {!readOnly && (
        <div className="mb-2 flex flex-wrap items-center gap-1">
          <span className="mr-1 text-xs font-medium uppercase tracking-wide text-slate-400">Fill selected:</span>
          {fillActions.map((a) => (
            <button
              key={a.label}
              title={a.title}
              disabled={!hasSelection}
              onClick={a.run}
              className="rounded border border-slate-300 bg-white px-2 py-1 text-xs hover:bg-sky-50 disabled:opacity-40"
            >
              {a.label}
            </button>
          ))}
          <span className="ml-2 text-xs text-slate-400">Ctrl+C / Ctrl+V to copy &amp; paste (incl. from Excel)</span>
          {toolbarExtra && <span className="ml-auto">{toolbarExtra}</span>}
        </div>
      )}
      <div
        ref={containerRef}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onCopy={onCopy}
        onPaste={onPaste}
        className="max-h-[70vh] overflow-auto rounded-lg border border-slate-300 bg-white outline-none focus:ring-2 focus:ring-sky-300"
      >
        <table className="w-full border-collapse text-xs">
          <thead className="sticky top-0 z-10">
            <tr className="bg-sky-950 text-white">
              <th className="sticky left-0 z-20 min-w-56 bg-sky-950 px-2 py-1.5 text-left font-medium">{labelHeader}</th>
              {contextHeaders.map((h) => (
                <th key={h} className="min-w-20 px-2 py-1.5 text-right font-medium text-sky-300">{h}</th>
              ))}
              {monthHeaders.map((h) => (
                <th key={h} className="min-w-20 px-2 py-1.5 text-right font-medium">{h}</th>
              ))}
              <th className="min-w-24 px-2 py-1.5 text-right font-medium">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => {
              const kind = row.kind ?? 'input'
              const vals = row.values ?? row.display ?? null
              const total = vals ? vals.reduce((s, v) => s + v, 0) : null
              const fmtCell = kind === 'pct' ? fmtPct : fmt
              return (
                <tr key={row.key} className={`border-t border-slate-100 ${rowStyles[kind]}`}>
                  <td
                    className={`sticky left-0 z-[5] whitespace-nowrap border-r border-slate-200 px-2 py-1 ${labelStyles[kind]}`}
                    style={{ paddingLeft: `${8 + (row.indent ?? 0) * 14}px` }}
                  >
                    {row.label}
                  </td>
                  {Array.from({ length: nCtx }).map((_, ci) => (
                    <td key={ci} className="num-cell px-2 py-1 text-slate-400">
                      {row.context?.[ci] != null ? fmtCell(row.context[ci]) : ''}
                    </td>
                  ))}
                  {kind === 'section' ? (
                    <td colSpan={13} className="px-2 py-1" />
                  ) : (
                    <>
                      {Array.from({ length: 12 }).map((_, c) => {
                        const editable = isEditable(r)
                        const isEditingCell = editing && editing.r === r && editing.c === c
                        const focused = sel && sel.focus.r === r && sel.focus.c === c
                        return (
                          <td
                            key={c}
                            className={`num-cell border-l border-slate-100 px-2 py-1 ${
                              editable ? 'cursor-cell' : 'text-slate-500'
                            } ${inSel(r, c) && editable ? 'bg-sky-100' : ''} ${
                              focused && editable ? 'ring-2 ring-inset ring-sky-500' : ''
                            }`}
                            onMouseDown={(e) => {
                              if (!editable) return
                              if (editing) commitEdit()
                              dragging.current = true
                              if (e.shiftKey && sel) setSel({ anchor: sel.anchor, focus: { r, c } })
                              else setSel({ anchor: { r, c }, focus: { r, c } })
                              containerRef.current?.focus()
                              e.preventDefault()
                            }}
                            onMouseOver={() => {
                              if (dragging.current && sel && editable) setSel({ anchor: sel.anchor, focus: { r, c } })
                            }}
                            onDoubleClick={() => startEdit(r, c)}
                          >
                            {isEditingCell ? (
                              <input
                                autoFocus
                                value={editing.text}
                                onChange={(e) => setEditing({ ...editing, text: e.target.value })}
                                onBlur={() => commitEdit()}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') { e.preventDefault(); commitEdit({ dr: 1, dc: 0 }) }
                                  else if (e.key === 'Tab') { e.preventDefault(); commitEdit({ dr: 0, dc: e.shiftKey ? -1 : 1 }) }
                                  else if (e.key === 'Escape') { setEditing(null); containerRef.current?.focus() }
                                  e.stopPropagation()
                                }}
                                className="w-full bg-white text-right outline-none"
                              />
                            ) : vals ? (
                              fmtCell(vals[c])
                            ) : (
                              ''
                            )}
                          </td>
                        )
                      })}
                      <td className="num-cell border-l border-slate-200 px-2 py-1 font-medium">
                        {total != null && kind !== 'pct' ? fmt(total) : ''}
                      </td>
                    </>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
