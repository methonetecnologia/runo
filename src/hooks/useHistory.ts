/**
 * Undo/redo history stack for the text editor.
 *
 * Stores snapshots of content + cursor position.
 * Consecutive character inserts within a short window are grouped
 * into a single undo entry to avoid one-char-at-a-time undo.
 */

/** A single history entry: content + cursor position */
interface HistoryEntry {
  content: string
  cursorRow: number
  cursorCol: number
}

const MAX_HISTORY = 200

/** Grouping window: consecutive edits within this interval (ms) are merged */
const GROUP_INTERVAL = 400

export interface UseHistoryReturn {
  /** Push a new state onto the undo stack. Call after every edit. */
  push: (content: string, cursorRow: number, cursorCol: number) => void
  /** Undo: returns previous state or null if at bottom of stack */
  undo: () => HistoryEntry | null
  /** Redo: returns next state or null if at top of stack */
  redo: () => HistoryEntry | null
  /** Reset history (e.g. when switching files) */
  reset: (content: string, cursorRow: number, cursorCol: number) => void
}

export function useHistory(): UseHistoryReturn {
  let undoStack: HistoryEntry[] = []
  let redoStack: HistoryEntry[] = []
  let lastPushTime = 0

  const push = (content: string, cursorRow: number, cursorCol: number) => {
    const now = Date.now()
    const entry: HistoryEntry = { content, cursorRow, cursorCol }

    // Group rapid consecutive edits into one entry
    if (undoStack.length > 0 && now - lastPushTime < GROUP_INTERVAL) {
      // Replace top entry instead of pushing a new one
      undoStack[undoStack.length - 1] = entry
    } else {
      undoStack.push(entry)
      if (undoStack.length > MAX_HISTORY) {
        undoStack.shift()
      }
    }

    // Any new edit clears the redo stack
    redoStack = []
    lastPushTime = now
  }

  const undo = (): HistoryEntry | null => {
    if (undoStack.length === 0) return null

    // Pop current state → push to redo
    const current = undoStack.pop()!
    redoStack.push(current)

    // Return the previous state (now top of undo stack)
    if (undoStack.length === 0) return null
    return undoStack[undoStack.length - 1]
  }

  const redo = (): HistoryEntry | null => {
    if (redoStack.length === 0) return null

    const entry = redoStack.pop()!
    undoStack.push(entry)
    return entry
  }

  const reset = (content: string, cursorRow: number, cursorCol: number) => {
    undoStack = [{ content, cursorRow, cursorCol }]
    redoStack = []
    lastPushTime = 0
  }

  return { push, undo, redo, reset }
}
