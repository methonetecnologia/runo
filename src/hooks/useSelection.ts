/**
 * Text selection state management.
 *
 * Uses an anchor/head model: anchor is where the selection started,
 * head is where it currently extends to (follows cursor).
 * Selection is "active" when anchor !== null.
 *
 * The ordered range (start <= end) is derived from anchor/head,
 * so selection can extend in either direction.
 */

import { createSignal, batch } from "solid-js"
import type { Accessor } from "solid-js"

export interface SelectionPos {
  row: number
  col: number
}

export interface SelectionRange {
  start: SelectionPos
  end: SelectionPos
}

export function useSelection() {
  // Anchor: where the selection started (null = no selection)
  const [anchor, setAnchor] = createSignal<SelectionPos | null>(null)
  // Head: where the selection currently extends to (follows cursor)
  const [head, setHead] = createSignal<SelectionPos | null>(null)

  /** Whether there is an active selection */
  const hasSelection: Accessor<boolean> = () => {
    const a = anchor()
    const h = head()
    if (!a || !h) return false
    return a.row !== h.row || a.col !== h.col
  }

  /** Get the ordered selection range (start <= end). Returns null if no selection. */
  const getRange = (): SelectionRange | null => {
    const a = anchor()
    const h = head()
    if (!a || !h) return null
    if (a.row === h.row && a.col === h.col) return null

    const before = a.row < h.row || (a.row === h.row && a.col < h.col)

    return {
      start: before ? a : h,
      end: before ? h : a,
    }
  }

  /** Start a new selection at the given position (typically current cursor). */
  const startSelection = (row: number, col: number) => {
    batch(() => {
      setAnchor({ row, col })
      setHead({ row, col })
    })
  }

  /** Extend selection head to new position. Skip if unchanged. */
  const extendSelection = (row: number, col: number) => {
    const h = head()
    if (h && h.row === row && h.col === col) return
    setHead({ row, col })
  }

  /** Clear any active selection. Skip if already clear. */
  const clearSelection = () => {
    if (!anchor() && !head()) return
    batch(() => {
      setAnchor(null)
      setHead(null)
    })
  }

  /** Get the selected text from lines array. */
  const getSelectedText = (lines: string[]): string => {
    const range = getRange()
    if (!range) return ""

    const { start, end } = range
    if (start.row === end.row) {
      return (lines[start.row] || "").slice(start.col, end.col)
    }

    const result: string[] = []
    result.push((lines[start.row] || "").slice(start.col))
    for (let r = start.row + 1; r < end.row; r++) {
      result.push(lines[r] || "")
    }
    result.push((lines[end.row] || "").slice(0, end.col))
    return result.join("\n")
  }

  /** Check if a given row is within the selection range. */
  const isRowInSelection = (row: number): boolean => {
    const range = getRange()
    if (!range) return false
    return row >= range.start.row && row <= range.end.row
  }

  return {
    anchor,
    head,
    hasSelection,
    getRange,
    startSelection,
    extendSelection,
    clearSelection,
    getSelectedText,
    isRowInSelection,
  }
}
