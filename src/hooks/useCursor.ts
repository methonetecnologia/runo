/**
 * Cursor state management: position, blink timer, click-to-position.
 *
 * Provides reactive signals for cursor row/col and a blink toggle,
 * plus helpers to position the cursor from mouse clicks.
 */

import { createSignal, onMount, onCleanup, createEffect } from "solid-js"
import { useRenderer } from "@opentui/solid"

export interface UseCursorOptions {
  /** Reactive getter for the split lines array */
  lines: () => string[]
  /** Reactive getter for focused state */
  focused: () => boolean
  /** Absolute X column where code text starts in the terminal */
  codeStartX: () => number
  /** Ref getter for the code scrollbox (for scrollLeft) */
  codeScrollRef: () => any
  /** Optional callback when cursor changes (1-based) */
  onCursorChange?: (line: number, col: number) => void
}

export function useCursor(opts: UseCursorOptions) {
  const renderer = useRenderer()

  const [cursorRow, setCursorRow] = createSignal(0)
  const [cursorCol, setCursorCol] = createSignal(0)
  const [cursorVisible, setCursorVisible] = createSignal(true)

  let blinkTimer: ReturnType<typeof setInterval>

  const resetBlink = () => {
    clearInterval(blinkTimer)
    setCursorVisible(true)
    blinkTimer = setInterval(() => setCursorVisible((v) => !v), 530)
  }

  onMount(() => {
    renderer.setCursorPosition(0, 0, false)
    resetBlink()
  })

  onCleanup(() => clearInterval(blinkTimer))

  // Keep native cursor hidden on focus change
  createEffect(() => {
    opts.focused()
    renderer.setCursorPosition(0, 0, false)
  })

  // Notify parent of cursor changes (1-based)
  createEffect(() => {
    if (opts.onCursorChange) {
      opts.onCursorChange(cursorRow() + 1, cursorCol() + 1)
    }
  })

  // -- Click to position cursor --

  const expandedColToRawCol = (rawLine: string, targetExpandedCol: number): number => {
    let expanded = 0
    for (let i = 0; i < rawLine.length; i++) {
      if (rawLine[i] === "\t") {
        expanded += 4
      } else {
        expanded += 1
      }
      if (expanded > targetExpandedCol) return i
    }
    return rawLine.length
  }

  /** Convert a mouse event to a (row, col) position in the document. */
  const mouseToPos = (lineIndex: number, e: any): { row: number; col: number } => {
    const ls = opts.lines()
    const row = Math.max(0, Math.min(lineIndex, ls.length - 1))
    const rawLine = ls[row] || ""
    const globalX = e?.x ?? 0
    const scrollLeft = opts.codeScrollRef()?.scrollLeft || 0
    const localExpandedCol = globalX - opts.codeStartX() + scrollLeft
    const col = expandedColToRawCol(rawLine, Math.max(0, localExpandedCol))
    return { row, col }
  }

  const handleLineClick = (lineIndex: number, e: any) => {
    resetBlink()
    renderer.clearSelection()

    const pos = mouseToPos(lineIndex, e)
    setCursorRow(pos.row)
    setCursorCol(pos.col)
  }

  /** Reset cursor to (0,0) — call when switching files */
  const resetCursor = () => {
    setCursorRow(0)
    setCursorCol(0)
    resetBlink()
  }

  return {
    cursorRow,
    setCursorRow,
    cursorCol,
    setCursorCol,
    cursorVisible,
    resetBlink,
    resetCursor,
    handleLineClick,
    mouseToPos,
  }
}
