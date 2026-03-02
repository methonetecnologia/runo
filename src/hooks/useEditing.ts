/**
 * Text editing operations: character input, backspace, delete, enter, tab.
 *
 * Pure editing logic that operates on lines arrays and delegates
 * cursor positioning back via the provided setters.
 */

import type { Accessor, Setter } from "solid-js"

export interface UseEditingOptions {
  /** Reactive getter for the split lines array */
  lines: () => string[]
  /** Cursor row signal */
  cursorRow: Accessor<number>
  setCursorRow: Setter<number>
  /** Cursor col signal */
  cursorCol: Accessor<number>
  setCursorCol: Setter<number>
  /** Callback to propagate content changes to parent */
  onContentChange?: (newContent: string) => void
}

export function useEditing(opts: UseEditingOptions) {
  const applyEdit = (newLines: string[], newRow: number, newCol: number) => {
    const newContent = newLines.join("\n")
    if (opts.onContentChange) opts.onContentChange(newContent)
    opts.setCursorRow(Math.max(0, Math.min(newRow, newLines.length - 1)))
    opts.setCursorCol(Math.max(0, newCol))
  }

  const insertReturn = () => {
    const ls = opts.lines()
    const row = opts.cursorRow()
    const col = opts.cursorCol()
    const newLines = [...ls]
    const currentLine = newLines[row] || ""
    newLines[row] = currentLine.slice(0, col)
    newLines.splice(row + 1, 0, currentLine.slice(col))
    applyEdit(newLines, row + 1, 0)
  }

  const insertBackspace = () => {
    const ls = opts.lines()
    const row = opts.cursorRow()
    const col = opts.cursorCol()
    const newLines = [...ls]
    if (col > 0) {
      const currentLine = newLines[row] || ""
      newLines[row] = currentLine.slice(0, col - 1) + currentLine.slice(col)
      applyEdit(newLines, row, col - 1)
    } else if (row > 0) {
      const prevLine = newLines[row - 1] || ""
      const currentLine = newLines[row] || ""
      const mergeCol = prevLine.length
      newLines[row - 1] = prevLine + currentLine
      newLines.splice(row, 1)
      applyEdit(newLines, row - 1, mergeCol)
    }
  }

  const insertDelete = () => {
    const ls = opts.lines()
    const row = opts.cursorRow()
    const col = opts.cursorCol()
    const newLines = [...ls]
    const currentLine = newLines[row] || ""
    if (col < currentLine.length) {
      newLines[row] = currentLine.slice(0, col) + currentLine.slice(col + 1)
      applyEdit(newLines, row, col)
    } else if (row < newLines.length - 1) {
      newLines[row] = currentLine + (newLines[row + 1] || "")
      newLines.splice(row + 1, 1)
      applyEdit(newLines, row, col)
    }
  }

  const insertTab = () => {
    const ls = opts.lines()
    const row = opts.cursorRow()
    const col = opts.cursorCol()
    const newLines = [...ls]
    const currentLine = newLines[row] || ""
    const spaces = "  "
    newLines[row] = currentLine.slice(0, col) + spaces + currentLine.slice(col)
    applyEdit(newLines, row, col + spaces.length)
  }

  const insertChar = (char: string) => {
    const ls = opts.lines()
    const row = opts.cursorRow()
    const col = opts.cursorCol()
    const newLines = [...ls]
    const currentLine = newLines[row] || ""
    newLines[row] = currentLine.slice(0, col) + char + currentLine.slice(col)
    applyEdit(newLines, row, col + 1)
  }

  const insertPaste = (pastedText: string) => {
    const ls = opts.lines()
    const row = opts.cursorRow()
    const col = opts.cursorCol()
    const currentLine = ls[row] || ""

    const pastedLines = pastedText.split("\n")
    const newLines = [...ls]

    if (pastedLines.length === 1) {
      newLines[row] = currentLine.slice(0, col) + pastedLines[0] + currentLine.slice(col)
      applyEdit(newLines, row, col + pastedLines[0].length)
    } else {
      const before = currentLine.slice(0, col)
      const after = currentLine.slice(col)

      newLines[row] = before + pastedLines[0]
      const middleLines = pastedLines.slice(1, -1)
      const lastPasted = pastedLines[pastedLines.length - 1]
      newLines.splice(row + 1, 0, ...middleLines, lastPasted + after)

      const finalRow = row + pastedLines.length - 1
      const finalCol = lastPasted.length
      applyEdit(newLines, finalRow, finalCol)
    }
  }

  /**
   * Delete a range of text (for selection deletion).
   * Places cursor at the start of the deleted range.
   */
  const deleteRange = (startRow: number, startCol: number, endRow: number, endCol: number) => {
    const ls = opts.lines()
    const newLines = [...ls]

    if (startRow === endRow) {
      const line = newLines[startRow] || ""
      newLines[startRow] = line.slice(0, startCol) + line.slice(endCol)
    } else {
      const firstLine = newLines[startRow] || ""
      const lastLine = newLines[endRow] || ""
      newLines[startRow] = firstLine.slice(0, startCol) + lastLine.slice(endCol)
      newLines.splice(startRow + 1, endRow - startRow)
    }

    applyEdit(newLines, startRow, startCol)
  }

  /**
   * Replace a range of text with new content (for typing/pasting over selection).
   */
  const replaceRange = (startRow: number, startCol: number, endRow: number, endCol: number, text: string) => {
    const ls = opts.lines()
    const newLines = [...ls]

    const firstLine = newLines[startRow] || ""
    const lastLine = newLines[endRow] || ""
    const before = firstLine.slice(0, startCol)
    const after = lastLine.slice(endCol)

    // Remove selected lines
    newLines.splice(startRow, endRow - startRow + 1)

    // Insert replacement
    const insertLines = text.split("\n")
    if (insertLines.length === 1) {
      newLines.splice(startRow, 0, before + insertLines[0] + after)
      applyEdit(newLines, startRow, startCol + insertLines[0].length)
    } else {
      const first = before + insertLines[0]
      const last = insertLines[insertLines.length - 1] + after
      const middle = insertLines.slice(1, -1)
      newLines.splice(startRow, 0, first, ...middle, last)
      const finalRow = startRow + insertLines.length - 1
      const finalCol = insertLines[insertLines.length - 1].length
      applyEdit(newLines, finalRow, finalCol)
    }
  }

  return {
    applyEdit,
    insertReturn,
    insertBackspace,
    insertDelete,
    insertTab,
    insertChar,
    insertPaste,
    deleteRange,
    replaceRange,
  }
}
