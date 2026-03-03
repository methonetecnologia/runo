/**
 * Code editor panel with split gutter + code scrollboxes.
 *
 * Cursor is rendered as an inverted-color block character that blinks.
 * No native terminal cursor is used.
 *
 * Syntax highlighting is provided by Shiki (VS Code TextMate grammars).
 * Tokens are resolved asynchronously and cached; while loading or for
 * unknown languages the editor falls back to monochrome #d4d4d4.
 *
 * Logic is split across extracted hooks:
 *   - useCursor: cursor state, blink, click-to-position
 *   - useEditing: character input, backspace, delete, enter, tab, paste
 *   - useScrollSync: gutter↔code scroll sync, scrollbox patching
 *   - useHighlight: Shiki syntax highlighting with debounce
 */

import { createMemo, createEffect, onCleanup, Show, For, batch } from "solid-js"
import { useKeyboard, usePaste, useRenderer } from "@opentui/solid"
import { splitLines, gutterWidth, maxLineLength, expandTabs } from "../lib/files"
import { type ColorToken } from "../lib/highlighter"
import { useCursor } from "../hooks/useCursor"
import { useEditing } from "../hooks/useEditing"
import { useScrollSync } from "../hooks/useScrollSync"
import { useHighlight } from "../hooks/useHighlight"
import { useHistory, type EditType } from "../hooks/useHistory"
import { useSelection } from "../hooks/useSelection"
import { copyToClipboard, pasteFromClipboard } from "../lib/clipboard"
import { log } from "../lib/logger"
import CursorChar from "./CursorChar"

export interface CodeViewerHandle {
  undo: () => void
  redo: () => void
}

interface CodeViewerProps {
  filePath: string | null
  content: string
  focused: boolean
  availableWidth: number
  availableHeight: number
  /** Absolute X column where code text starts in the terminal */
  codeStartX: number
  /** Absolute Y row where the code area starts in the terminal */
  codeStartY: number
  onContentChange?: (newContent: string) => void
  onCursorChange?: (line: number, col: number) => void
  /** Callback to expose imperative handle (undo/redo) */
  onHandle?: (handle: CodeViewerHandle) => void
}

const DEFAULT_FG = "#d4d4d4"
const SELECTION_BG = "#264f78"

/** Render token for a single segment of a line. */
interface RenderToken extends ColorToken {
  cursor?: boolean
  /** Expanded column where this token starts (for selection hit-test). */
  expCol?: number
}

const CodeViewer = (props: CodeViewerProps) => {
  let codeScrollRef: any
  let gutterScrollRef: any

  // -- Derived --
  const lines = createMemo(() => splitLines(props.content))
  const gutterW = createMemo(() => gutterWidth(lines().length))
  const codeWidth = createMemo(() => Math.max(1, props.availableWidth - gutterW() - 1))
  const maxLineLen = createMemo(() => maxLineLength(lines()))

  /** Whether current content is a binary-file placeholder (read-only) */
  const isBinary = createMemo(() => props.content.startsWith("[Binary file"))

  // -- Hooks --

  const cursor = useCursor({
    lines,
    focused: () => props.focused,
    codeStartX: () => props.codeStartX,
    codeScrollRef: () => codeScrollRef,
    onCursorChange: props.onCursorChange,
  })

  const editing = useEditing({
    lines,
    cursorRow: cursor.cursorRow,
    setCursorRow: cursor.setCursorRow,
    cursorCol: cursor.cursorCol,
    setCursorCol: cursor.setCursorCol,
    onContentChange: props.onContentChange,
  })

  const scroll = useScrollSync({
    lines,
    cursorRow: cursor.cursorRow,
    cursorCol: cursor.cursorCol,
    codeWidth,
    availableHeight: () => props.availableHeight,
    filePath: () => props.filePath,
    codeScrollRef: () => codeScrollRef,
    gutterScrollRef: () => gutterScrollRef,
  })

  const { highlightTokens } = useHighlight({
    content: () => props.content,
    filePath: () => props.filePath,
    lineCount: () => lines().length,
  })

  const selection = useSelection()
  const renderer = useRenderer()

  // Cache selection range as a single memo so individual line memos
  // only depend on this one signal instead of anchor()+head() separately.
  const selRange = createMemo(() => selection.getRange())

  const history = useHistory()

  /** Track whether we're applying an undo/redo to skip re-pushing to history. */
  let isUndoRedo = false

  /**
   * Push current state to history (call after every edit).
   * Must be called after the edit is applied, so cursor is already updated.
   * We read props.content which will reflect the new value on next tick,
   * but cursor row/col are already set synchronously by useEditing.
   */
  const pushHistory = (editType: EditType = "char") => {
    if (isUndoRedo) {
      log.editor.debug("pushHistory skipped (isUndoRedo=true)")
      return
    }
    // Schedule push on next microtask so props.content has the new value
    queueMicrotask(() => {
      log.editor.debug({ contentLen: props.content.length, type: editType }, "pushHistory")
      history.push(props.content, cursor.cursorRow(), cursor.cursorCol(), editType)
    })
  }

  /** Apply an undo/redo snapshot: restore content + cursor. */
  const applySnapshot = (entry: { content: string; cursorRow: number; cursorCol: number }) => {
    log.editor.info({ contentLen: entry.content.length, row: entry.cursorRow, col: entry.cursorCol }, "applySnapshot")
    isUndoRedo = true
    if (props.onContentChange) props.onContentChange(entry.content)
    cursor.setCursorRow(entry.cursorRow)
    cursor.setCursorCol(entry.cursorCol)
    setTimeout(() => {
      isUndoRedo = false
      scroll.scrollToCursor()
    }, 10)
  }

  // Expose undo/redo to parent via handle callback (reactive so it re-fires on remount)
  createEffect(() => {
    if (props.onHandle) {
      props.onHandle({
        undo: () => {
          const e = history.undo()
          if (e) applySnapshot(e)
        },
        redo: () => {
          const e = history.redo()
          if (e) applySnapshot(e)
        },
      })
    }
  })

  // -- Selection helpers --

  /** Delete the current selection and return true, or return false if no selection. */
  const deleteSelectionIfActive = (): boolean => {
    const range = selection.getRange()
    if (!range) return false
    editing.deleteRange(range.start.row, range.start.col, range.end.row, range.end.col)
    selection.clearSelection()
    return true
  }

  /** Get selected text for copy/cut */
  const getSelectedText = (): string => {
    return selection.getSelectedText(lines())
  }

  // -- Mouse drag state --
  let isDragging = false
  let isGutterDragging = false
  /** The line where the gutter click started (for multi-line gutter selection). */
  let gutterAnchorRow = 0

  // -- File change: reset cursor + scroll + history --

  /** Track current filePath to detect actual file switches (not content edits). */
  let lastFilePath: string | null = null

  createEffect(() => {
    const fp = props.filePath
    if (fp === lastFilePath) return
    lastFilePath = fp
    cursor.resetCursor()
    selection.clearSelection()
    history.reset(props.content, 0, 0)
    if (codeScrollRef) {
      codeScrollRef.scrollTop = 0
      codeScrollRef.scrollLeft = 0
    }
    if (gutterScrollRef) {
      gutterScrollRef.scrollTop = 0
    }
  })

  // -- Mouse drag handling --
  // We intercept raw stdin mouse data via renderer.addInputHandler because
  // the scrollbox blocks native selection (selectable=false) which prevents
  // the OpenTUI captured-renderable drag flow from working on child elements.

  /** Compute document (row, col) from global mouse terminal coordinates. */
  const globalMouseToPos = (globalX: number, globalY: number) => {
    const codeRef = codeScrollRef
    if (!codeRef) return { row: 0, col: 0 }

    const scrollTop = codeRef.scrollTop || 0
    const scrollLeft = codeRef.scrollLeft || 0
    const relY = globalY - props.codeStartY + scrollTop
    const row = Math.max(0, Math.min(Math.floor(relY), lines().length - 1))

    const localExpandedCol = globalX - props.codeStartX + scrollLeft
    const rawLine = lines()[row] || ""
    let expanded = 0
    let col = rawLine.length
    for (let i = 0; i < rawLine.length; i++) {
      if (rawLine[i] === "\t") expanded += 4
      else expanded += 1
      if (expanded > Math.max(0, localExpandedCol)) {
        col = i
        break
      }
    }
    return { row, col }
  }

  // Intercept ONLY drag mouse events by replacing the stdinListener.
  // mouseDown and mouseUp are NOT consumed — OpenTUI handles them normally
  // (focus, hover, etc). We just read them to track isDragging state.
  // Only drag events during an active selection are consumed.

  const rAny = renderer as any
  const origStdinListener = rAny.stdinListener
  const SGR_MOUSE_RE = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/g

  const wrappedStdinListener = (data: Buffer) => {
    if (!rAny._useMouse || !props.focused) {
      origStdinListener(data)
      return
    }

    const str = data.toString()
    if (str.indexOf("\x1b[<") === -1) {
      origStdinListener(data)
      return
    }

    // Scan for drag events we need to consume
    const consumed: Set<number> = new Set()
    SGR_MOUSE_RE.lastIndex = 0
    let match
    while ((match = SGR_MOUSE_RE.exec(str)) !== null) {
      const btn = parseInt(match[1], 10)
      const x = parseInt(match[2], 10) - 1
      const y = parseInt(match[3], 10) - 1
      const release = match[4] === "m"

      const isLeftDrag = (btn & 0x03) === 0 && (btn & 32) !== 0 && !release
      const isLeftRelease = (btn & 0x03) === 0 && release

      if ((isDragging || isGutterDragging) && isLeftDrag) {
        if (isGutterDragging) {
          // Gutter drag: extend selection by full lines
          const relY = y - props.codeStartY + (codeScrollRef?.scrollTop || 0)
          const dragRow = Math.max(0, Math.min(Math.floor(relY), lines().length - 1))
          const ls = lines()

          if (dragRow >= gutterAnchorRow) {
            // Dragging downward: select from start of anchor line to end of drag line
            selection.startSelection(gutterAnchorRow, 0)
            if (dragRow + 1 < ls.length) {
              selection.extendSelection(dragRow + 1, 0)
            } else {
              selection.extendSelection(dragRow, ls[dragRow]?.length ?? 0)
            }
            batch(() => {
              cursor.setCursorRow(dragRow)
              cursor.setCursorCol(ls[dragRow]?.length ?? 0)
            })
          } else {
            // Dragging upward: select from end of anchor line to start of drag line
            if (gutterAnchorRow + 1 < ls.length) {
              selection.startSelection(gutterAnchorRow + 1, 0)
            } else {
              selection.startSelection(gutterAnchorRow, ls[gutterAnchorRow]?.length ?? 0)
            }
            selection.extendSelection(dragRow, 0)
            batch(() => {
              cursor.setCursorRow(dragRow)
              cursor.setCursorCol(0)
            })
          }
        } else {
          // Code area drag: extend selection by character position
          const pos = globalMouseToPos(x, y)
          batch(() => {
            cursor.setCursorRow(pos.row)
            cursor.setCursorCol(pos.col)
          })
          selection.extendSelection(pos.row, pos.col)
        }
        cursor.resetBlink()
        consumed.add(match.index)
      } else if ((isDragging || isGutterDragging) && isLeftRelease) {
        isDragging = false
        isGutterDragging = false
        if (!selection.hasSelection()) {
          selection.clearSelection()
        }
      }
    }

    if (consumed.size === 0) {
      origStdinListener(data)
      return
    }

    // Strip consumed drag sequences, forward everything else
    let filtered = ""
    SGR_MOUSE_RE.lastIndex = 0
    let lastEnd = 0
    while ((match = SGR_MOUSE_RE.exec(str)) !== null) {
      if (consumed.has(match.index)) {
        filtered += str.slice(lastEnd, match.index)
        lastEnd = match.index + match[0].length
      }
    }
    filtered += str.slice(lastEnd)

    if (filtered.length > 0) {
      origStdinListener(Buffer.from(filtered))
    }
  }

  rAny.stdin.removeListener("data", origStdinListener)
  rAny.stdin.on("data", wrappedStdinListener)
  rAny.stdinListener = wrappedStdinListener

  onCleanup(() => {
    rAny.stdin.removeListener("data", wrappedStdinListener)
    rAny.stdin.on("data", origStdinListener)
    rAny.stdinListener = origStdinListener
  })

  // -- Keyboard --

  /**
   * Helper: move cursor and optionally extend selection.
   * If extending, starts selection from current cursor pos if not already active.
   */
  const moveCursor = (newRow: number, newCol: number, extending: boolean) => {
    if (extending) {
      if (!selection.hasSelection() && !selection.anchor()) {
        selection.startSelection(cursor.cursorRow(), cursor.cursorCol())
      }
    } else {
      selection.clearSelection()
    }

    batch(() => {
      cursor.setCursorRow(newRow)
      cursor.setCursorCol(newCol)
    })

    if (extending) {
      selection.extendSelection(newRow, newCol)
    }

    scroll.scrollToCursor()
  }

  useKeyboard((key) => {
    if (!props.focused || !props.filePath || isBinary()) return

    const ls = lines()
    const row = cursor.cursorRow()
    const col = cursor.cursorCol()

    cursor.resetBlink()

    // Ctrl+A = Select all
    if (key.ctrl && key.name === "a") {
      const lastRow = ls.length - 1
      const lastCol = ls[lastRow] ? ls[lastRow].length : 0
      selection.startSelection(0, 0)
      selection.extendSelection(lastRow, lastCol)
      batch(() => {
        cursor.setCursorRow(lastRow)
        cursor.setCursorCol(lastCol)
      })
      scroll.scrollToCursor()
      return
    }

    // Ctrl+C = Copy
    if (key.ctrl && key.name === "c") {
      const text = getSelectedText()
      if (text) {
        copyToClipboard(text).then((ok) => {
          if (!ok) renderer.copyToClipboardOSC52(text)
        })
        log.editor.info({ len: text.length }, "Copied to clipboard")
      }
      return
    }

    // Ctrl+X = Cut
    if (key.ctrl && key.name === "x") {
      const text = getSelectedText()
      if (text) {
        copyToClipboard(text).then((ok) => {
          if (!ok) renderer.copyToClipboardOSC52(text)
        })
        deleteSelectionIfActive()
        pushHistory("delete")
        setTimeout(scroll.scrollToCursor, 10)
        log.editor.info({ len: text.length }, "Cut to clipboard")
      }
      return
    }

    // Ctrl+V = Paste from system clipboard
    if (key.ctrl && key.name === "v") {
      pasteFromClipboard().then((text) => {
        if (!text) return
        if (selection.hasSelection()) {
          const range = selection.getRange()!
          selection.clearSelection()
          editing.replaceRange(range.start.row, range.start.col, range.end.row, range.end.col, text)
        } else {
          editing.insertPaste(text)
        }
        pushHistory("paste")
        cursor.resetBlink()
        setTimeout(scroll.scrollToCursor, 10)
      })
      return
    }

    // Navigation with Shift = selection
    const extending = key.shift && !key.ctrl

    if (key.name === "up") {
      if (row > 0) {
        const newRow = row - 1
        const maxCol = ls[newRow] ? ls[newRow].length : 0
        moveCursor(newRow, Math.min(col, maxCol), extending)
      }
      return
    }

    if (key.name === "down") {
      if (row < ls.length - 1) {
        const newRow = row + 1
        const maxCol = ls[newRow] ? ls[newRow].length : 0
        moveCursor(newRow, Math.min(col, maxCol), extending)
      }
      return
    }

    if (key.name === "left") {
      if (!extending && selection.hasSelection()) {
        // Move to start of selection
        const range = selection.getRange()
        if (range) {
          moveCursor(range.start.row, range.start.col, false)
          return
        }
      }
      if (col > 0) {
        moveCursor(row, col - 1, extending)
      } else if (row > 0) {
        moveCursor(row - 1, ls[row - 1] ? ls[row - 1].length : 0, extending)
      }
      return
    }

    if (key.name === "right") {
      if (!extending && selection.hasSelection()) {
        // Move to end of selection
        const range = selection.getRange()
        if (range) {
          moveCursor(range.end.row, range.end.col, false)
          return
        }
      }
      const lineLen = ls[row] ? ls[row].length : 0
      if (col < lineLen) {
        moveCursor(row, col + 1, extending)
      } else if (row < ls.length - 1) {
        moveCursor(row + 1, 0, extending)
      }
      return
    }

    if (key.name === "home") {
      moveCursor(row, 0, extending)
      return
    }

    if (key.name === "end") {
      moveCursor(row, ls[row] ? ls[row].length : 0, extending)
      return
    }

    if (key.name === "pageup") {
      const pageSize = Math.max(1, props.availableHeight - 2)
      const newRow = Math.max(0, row - pageSize)
      const maxCol = ls[newRow] ? ls[newRow].length : 0
      moveCursor(newRow, Math.min(col, maxCol), extending)
      return
    }

    if (key.name === "pagedown") {
      const pageSize = Math.max(1, props.availableHeight - 2)
      const newRow = Math.min(ls.length - 1, row + pageSize)
      const maxCol = ls[newRow] ? ls[newRow].length : 0
      moveCursor(newRow, Math.min(col, maxCol), extending)
      return
    }

    // Undo: Ctrl+Z
    if (key.ctrl && !key.shift && key.name === "z") {
      log.editor.info("Ctrl+Z pressed")
      selection.clearSelection()
      const entry = history.undo()
      if (entry) {
        applySnapshot(entry)
      } else {
        log.editor.warn("Ctrl+Z → nothing to undo")
      }
      return
    }

    // Redo: Ctrl+Y or Ctrl+Shift+Z
    if ((key.ctrl && key.name === "y") || (key.ctrl && key.shift && key.name === "z")) {
      log.editor.info("Ctrl+Y/Ctrl+Shift+Z pressed")
      selection.clearSelection()
      const entry = history.redo()
      if (entry) {
        applySnapshot(entry)
      } else {
        log.editor.warn("Redo → nothing to redo")
      }
      return
    }

    // Editing — all selection-aware

    if (key.name === "return") {
      deleteSelectionIfActive()
      editing.insertReturn()
      pushHistory("return")
      setTimeout(scroll.scrollToCursor, 10)
      return
    }

    if (key.name === "backspace") {
      if (deleteSelectionIfActive()) {
        pushHistory("backspace")
        setTimeout(scroll.scrollToCursor, 10)
        return
      }
      editing.insertBackspace()
      pushHistory("backspace")
      setTimeout(scroll.scrollToCursor, 10)
      return
    }

    if (key.name === "delete") {
      if (deleteSelectionIfActive()) {
        pushHistory("delete")
        setTimeout(scroll.scrollToCursor, 10)
        return
      }
      editing.insertDelete()
      pushHistory("delete")
      setTimeout(scroll.scrollToCursor, 10)
      return
    }

    if (key.name === "tab") {
      deleteSelectionIfActive()
      editing.insertTab()
      pushHistory("tab")
      setTimeout(scroll.scrollToCursor, 10)
      return
    }

    // Character input
    if (key.sequence && key.sequence.length === 1 && key.sequence >= " " && !key.ctrl && !key.meta) {
      if (selection.hasSelection()) {
        const range = selection.getRange()!
        selection.clearSelection()
        editing.replaceRange(range.start.row, range.start.col, range.end.row, range.end.col, key.sequence)
      } else {
        editing.insertChar(key.sequence)
      }
      pushHistory(key.sequence === " " ? "space" : "char")
      setTimeout(scroll.scrollToCursor, 10)
      return
    }
  })

  // -- Paste handling --

  usePaste((event) => {
    if (!props.focused || !props.filePath || isBinary()) return
    const pastedText = typeof event === "string" ? event : (event.text ?? String(event))
    if (!pastedText) return

    if (selection.hasSelection()) {
      const range = selection.getRange()!
      selection.clearSelection()
      editing.replaceRange(range.start.row, range.start.col, range.end.row, range.end.col, pastedText)
    } else {
      editing.insertPaste(pastedText)
    }
    pushHistory("paste")
    cursor.resetBlink()
    setTimeout(scroll.scrollToCursor, 10)
  })

  // =====================================================================
  //  Token helpers for rendering
  // =====================================================================

  const expandTokenTabs = (token: ColorToken, tabSize = 4): ColorToken => {
    if (token.content.indexOf("\t") === -1) return token
    return { content: token.content.replace(/\t/g, " ".repeat(tabSize)), color: token.color }
  }

  const getLineTokens = (lineIndex: number, rawLine: string): ColorToken[] => {
    const ht = highlightTokens()
    if (ht && ht.length === lines().length && ht[lineIndex] && ht[lineIndex].length > 0) {
      const tokens: ColorToken[] = []
      for (const t of ht[lineIndex]) {
        tokens.push(expandTokenTabs(t))
      }
      return tokens
    }
    return [{ content: expandTabs(rawLine) || " ", color: DEFAULT_FG }]
  }

  const splitTokensAtCursor = (
    tokens: ColorToken[],
    cursorExpPos: number,
    cursorChLen: number
  ): { before: ColorToken[]; cursorToken: ColorToken; after: ColorToken[] } => {
    const before: ColorToken[] = []
    const after: ColorToken[] = []
    let cursorToken: ColorToken = { content: " ", color: DEFAULT_FG }
    let pos = 0
    let found = false

    for (const t of tokens) {
      const tEnd = pos + t.content.length
      if (!found) {
        if (cursorExpPos >= tEnd) {
          before.push(t)
        } else if (cursorExpPos >= pos) {
          const offset = cursorExpPos - pos
          if (offset > 0) {
            before.push({ content: t.content.slice(0, offset), color: t.color })
          }
          cursorToken = {
            content: t.content.slice(offset, offset + cursorChLen) || " ",
            color: t.color,
          }
          const remaining = t.content.slice(offset + cursorChLen)
          if (remaining) {
            after.push({ content: remaining, color: t.color })
          }
          found = true
        }
      } else {
        after.push(t)
      }
      pos = tEnd
    }

    if (!found) {
      cursorToken = { content: " ", color: DEFAULT_FG }
    }

    return { before, cursorToken, after }
  }

  const buildLineTokens = (lineIndex: number, rawLine: string, active: boolean, col: number): RenderToken[] => {
    let tokens: RenderToken[] = getLineTokens(lineIndex, rawLine)

    if (active) {
      const cursorExpPos = expandTabs(rawLine.slice(0, col)).length
      const cursorChLen = col < rawLine.length ? expandTabs(rawLine[col]).length : 1
      const { before, cursorToken, after } = splitTokensAtCursor(tokens, cursorExpPos, cursorChLen)

      tokens = []
      for (const t of before) tokens.push(t)
      tokens.push({ ...cursorToken, cursor: true })
      for (const t of after) tokens.push(t)

      if (after.length === 0 && cursorToken.content !== " ") {
        tokens.push({ content: " ", color: DEFAULT_FG })
      }
    }

    // Stamp each token with its expanded column offset (for selection bg)
    let expPos = 0
    for (const t of tokens) {
      t.expCol = expPos
      expPos += t.content.length
    }

    return tokens
  }

  // -- Render --

  return (
    <box flexDirection="column" flexGrow={1} height="100%" backgroundColor="#1e1e1e">
      <Show
        when={props.filePath && !isBinary()}
        fallback={
          <box
            flexDirection="column"
            flexGrow={1}
            justifyContent="center"
            alignItems="center"
            backgroundColor="#1e1e1e"
          >
            <Show
              when={isBinary()}
              fallback={
                <>
                  <text fg="#555555">No file open</text>
                  <text fg="#3c3c3c" marginTop={1}>
                    Select a file from the sidebar
                  </text>
                </>
              }
            >
              <text fg="#f44747">Binary file — cannot be displayed</text>
              <text fg="#3c3c3c" marginTop={1}>
                This file is not a text file and cannot be opened in the editor
              </text>
            </Show>
          </box>
        }
      >
        <box flexDirection="row" flexGrow={1} width="100%">
          {/* Gutter */}
          <scrollbox ref={gutterScrollRef} width={gutterW() + 1} height="100%" scrollY={true}>
            <box flexDirection="column">
              <For each={lines()}>
                {(_, i) => {
                  const num = () => String(i() + 1).padStart(gutterW(), " ") + " "
                  const isCurrentLine = () => i() === cursor.cursorRow()
                  return (
                    <text
                      fg={isCurrentLine() ? "#c6c6c6" : "#858585"}
                      bg={isCurrentLine() ? "#2a2d2e" : "#1e1e1e"}
                      wrapMode="none"
                      onMouseDown={() => {
                        const row = i()
                        const ls = lines()

                        // Select the entire line
                        gutterAnchorRow = row
                        isGutterDragging = true

                        const endCol = ls[row]?.length ?? 0
                        selection.startSelection(row, 0)
                        if (row + 1 < ls.length) {
                          selection.extendSelection(row + 1, 0)
                        } else {
                          selection.extendSelection(row, endCol)
                        }
                        batch(() => {
                          cursor.setCursorRow(row)
                          cursor.setCursorCol(endCol)
                        })
                        cursor.resetBlink()
                      }}
                    >
                      {num()}
                    </text>
                  )
                }}
              </For>
            </box>
          </scrollbox>

          {/* Code area */}
          <scrollbox
            ref={codeScrollRef}
            width={codeWidth()}
            height={props.availableHeight}
            focused={props.focused}
            scrollX={true}
            scrollY={true}
          >
            <box flexDirection="column" width={Math.max(maxLineLen() + 2, 1)}>
              <For each={lines()}>
                {(_, i) => {
                  const isActive = () => i() === cursor.cursorRow() && props.focused
                  const lineBg = () => (isActive() ? "#2a2d2e" : "#1e1e1e")

                  // Token memo: depends on line content, cursor, highlights — NOT selection
                  const renderTokens = createMemo(() => {
                    const raw = lines()[i()] || ""
                    const active = isActive()
                    const col = active ? cursor.cursorCol() : 0
                    return buildLineTokens(i(), raw, active, col)
                  })

                  const activeBg = createMemo(() => lineBg())

                  /**
                   * Compute the selection column range for this line.
                   * Returns null if this line is not in the selection.
                   * Only depends on selRange — does NOT cause token recalculation.
                   */
                  const lineSelCols = createMemo((): { start: number; end: number } | null => {
                    const sr = selRange()
                    if (!sr) return null
                    const row = i()
                    if (row < sr.start.row || row > sr.end.row) return null
                    const raw = lines()[row] || ""
                    const start = row === sr.start.row ? expandTabs(raw.slice(0, sr.start.col)).length : 0
                    const end =
                      row === sr.end.row ? expandTabs(raw.slice(0, sr.end.col)).length : expandTabs(raw).length + 1
                    if (start >= end) return null
                    return { start, end }
                  })

                  return (
                    <box
                      flexDirection="row"
                      width="100%"
                      backgroundColor={lineBg()}
                      onMouseDown={(e: any) => {
                        const shift = e?.modifiers?.shift ?? false
                        const pos = cursor.mouseToPos(i(), e)

                        if (shift) {
                          if (!selection.anchor()) {
                            selection.startSelection(cursor.cursorRow(), cursor.cursorCol())
                          }
                          batch(() => {
                            cursor.setCursorRow(pos.row)
                            cursor.setCursorCol(pos.col)
                          })
                          selection.extendSelection(pos.row, pos.col)
                        } else {
                          selection.clearSelection()
                          cursor.handleLineClick(i(), e)
                          isDragging = true
                          selection.startSelection(pos.row, pos.col)
                        }
                        cursor.resetBlink()
                      }}
                    >
                      <For each={renderTokens()}>
                        {(token: RenderToken) => {
                          // Reactive bg: depends on lineSelCols (selection) not on token memo
                          const isSelected = () => {
                            const sel = lineSelCols()
                            if (!sel) return false
                            const tStart = token.expCol ?? 0
                            const tEnd = tStart + token.content.length
                            // Token overlaps selection if it starts before sel.end and ends after sel.start
                            return tStart < sel.end && tEnd > sel.start
                          }
                          const tokenBg = () => (isSelected() ? SELECTION_BG : lineBg())

                          return token.cursor ? (
                            <CursorChar
                              token={token}
                              bg={isSelected() ? SELECTION_BG : activeBg()}
                              cursorVisible={cursor.cursorVisible}
                            />
                          ) : (
                            <text fg={token.color} bg={tokenBg()} wrapMode="none">
                              {token.content}
                            </text>
                          )
                        }}
                      </For>
                    </box>
                  )
                }}
              </For>
            </box>
          </scrollbox>
        </box>
      </Show>
    </box>
  )
}

export default CodeViewer
