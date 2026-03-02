/**
 * Undo/redo history stack for the text editor.
 *
 * Stores snapshots of content + cursor position.
 * Groups consecutive edits like VS Code:
 *   - Typing letters/digits groups within a time window
 *   - Space, enter, backspace, delete, tab, paste always break the group
 *   - Changing edit type (e.g. typing → backspace) breaks the group
 */

import { log } from "../lib/logger"

const h = log.history

/** A single history entry: content + cursor position */
interface HistoryEntry {
  content: string
  cursorRow: number
  cursorCol: number
}

/** Edit types that control undo grouping */
export type EditType = "char" | "space" | "return" | "backspace" | "delete" | "tab" | "paste"

const MAX_HISTORY = 200

/** Time window for grouping consecutive same-type char edits (ms) */
const GROUP_INTERVAL = 300

/** Edit types that always create a new undo entry (never grouped) */
const BREAK_TYPES: Set<EditType> = new Set(["return", "paste"])

export interface UseHistoryReturn {
  push: (content: string, cursorRow: number, cursorCol: number, editType?: EditType) => void
  undo: () => HistoryEntry | null
  redo: () => HistoryEntry | null
  reset: (content: string, cursorRow: number, cursorCol: number) => void
}

export function useHistory(): UseHistoryReturn {
  let undoStack: HistoryEntry[] = []
  let redoStack: HistoryEntry[] = []
  let lastPushTime = 0
  let lastEditType: EditType | null = null

  const push = (content: string, cursorRow: number, cursorCol: number, editType: EditType = "char") => {
    const now = Date.now()
    const entry: HistoryEntry = { content, cursorRow, cursorCol }

    const timeDelta = now - lastPushTime
    const sameType = editType === lastEditType
    const shouldGroup = undoStack.length > 0 && sameType && timeDelta < GROUP_INTERVAL && !BREAK_TYPES.has(editType)

    if (shouldGroup) {
      undoStack[undoStack.length - 1] = entry
      h.debug({ type: editType, contentLen: content.length, undo: undoStack.length }, "push(grouped)")
    } else {
      undoStack.push(entry)
      if (undoStack.length > MAX_HISTORY) {
        undoStack.shift()
      }
      h.debug({ type: editType, contentLen: content.length, undo: undoStack.length }, "push(new)")
    }

    redoStack = []
    lastPushTime = now
    lastEditType = editType
  }

  const undo = (): HistoryEntry | null => {
    h.info({ undo: undoStack.length, redo: redoStack.length }, "undo called")

    if (undoStack.length <= 1) {
      h.warn({ undo: undoStack.length }, "undo ignored — nothing to undo")
      return null
    }

    const current = undoStack.pop()!
    redoStack.push(current)

    const target = undoStack[undoStack.length - 1]

    // When reaching the baseline (first entry), use cursor position from
    // the entry we just popped — baseline cursor is (0,0) from file open
    // and doesn't reflect where the user actually was.
    if (undoStack.length === 1) {
      const result = { content: target.content, cursorRow: current.cursorRow, cursorCol: current.cursorCol }
      h.info(
        { contentLen: result.content.length, undo: undoStack.length, redo: redoStack.length },
        "undo → restoring (baseline)"
      )
      return result
    }

    h.info({ contentLen: target.content.length, undo: undoStack.length, redo: redoStack.length }, "undo → restoring")
    return target
  }

  const redo = (): HistoryEntry | null => {
    h.info({ undo: undoStack.length, redo: redoStack.length }, "redo called")

    if (redoStack.length === 0) {
      h.warn("redo ignored — nothing to redo")
      return null
    }

    const entry = redoStack.pop()!
    undoStack.push(entry)
    h.info({ contentLen: entry.content.length, undo: undoStack.length, redo: redoStack.length }, "redo → restoring")
    return entry
  }

  const reset = (content: string, cursorRow: number, cursorCol: number) => {
    undoStack = [{ content, cursorRow, cursorCol }]
    redoStack = []
    lastPushTime = 0
    lastEditType = null
    h.info({ contentLen: content.length }, "reset")
  }

  return { push, undo, redo, reset }
}
