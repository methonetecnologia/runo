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

import { createMemo, createEffect, Show, For } from "solid-js"
import { useKeyboard, usePaste } from "@opentui/solid"
import { splitLines, gutterWidth, maxLineLength, expandTabs } from "../lib/files"
import { type ColorToken } from "../lib/highlighter"
import { useCursor } from "../hooks/useCursor"
import { useEditing } from "../hooks/useEditing"
import { useScrollSync } from "../hooks/useScrollSync"
import { useHighlight } from "../hooks/useHighlight"
import { useHistory, type EditType } from "../hooks/useHistory"
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
  onContentChange?: (newContent: string) => void
  onCursorChange?: (line: number, col: number) => void
  /** Callback to expose imperative handle (undo/redo) */
  onHandle?: (handle: CodeViewerHandle) => void
}

const DEFAULT_FG = "#d4d4d4"

/** Render token for a single segment of a line. */
interface RenderToken extends ColorToken {
  cursor?: boolean
}

const CodeViewer = (props: CodeViewerProps) => {
  let codeScrollRef: any
  let gutterScrollRef: any

  // -- Derived --
  const lines = createMemo(() => splitLines(props.content))
  const gutterW = createMemo(() => gutterWidth(lines().length))
  const codeWidth = createMemo(() => Math.max(1, props.availableWidth - gutterW() - 1))
  const maxLineLen = createMemo(() => maxLineLength(lines()))

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

  // -- File change: reset cursor + scroll + history --

  /** Track current filePath to detect actual file switches (not content edits). */
  let lastFilePath: string | null = null

  createEffect(() => {
    const fp = props.filePath
    if (fp === lastFilePath) return
    lastFilePath = fp
    cursor.resetCursor()
    history.reset(props.content, 0, 0)
    if (codeScrollRef) {
      codeScrollRef.scrollTop = 0
      codeScrollRef.scrollLeft = 0
    }
    if (gutterScrollRef) {
      gutterScrollRef.scrollTop = 0
    }
  })

  // -- Keyboard --

  useKeyboard((key) => {
    if (!props.focused || !props.filePath) return

    const ls = lines()
    const row = cursor.cursorRow()
    const col = cursor.cursorCol()

    cursor.resetBlink()

    // Shift+Left/Right = horizontal scroll
    if (key.shift && !key.ctrl && (key.name === "left" || key.name === "right")) {
      if (codeScrollRef) {
        const delta = key.name === "right" ? 3 : -3
        codeScrollRef.scrollBy({ x: delta, y: 0 })
      }
      return
    }

    // Shift+Up/Down = vertical scroll (only if content exceeds viewport)
    if (key.shift && !key.ctrl && (key.name === "up" || key.name === "down")) {
      if (codeScrollRef && ls.length > props.availableHeight - 1) {
        const delta = key.name === "down" ? 3 : -3
        codeScrollRef.scrollBy({ x: 0, y: delta })
        scroll.syncGutterScroll()
      }
      return
    }

    // Navigation
    if (key.name === "up") {
      if (row > 0) {
        const newRow = row - 1
        const maxCol = ls[newRow] ? ls[newRow].length : 0
        cursor.setCursorRow(newRow)
        cursor.setCursorCol(Math.min(col, maxCol))
        scroll.scrollToCursor()
      }
      return
    }

    if (key.name === "down") {
      if (row < ls.length - 1) {
        const newRow = row + 1
        const maxCol = ls[newRow] ? ls[newRow].length : 0
        cursor.setCursorRow(newRow)
        cursor.setCursorCol(Math.min(col, maxCol))
        scroll.scrollToCursor()
      }
      return
    }

    if (key.name === "left") {
      if (col > 0) {
        cursor.setCursorCol(col - 1)
      } else if (row > 0) {
        cursor.setCursorRow(row - 1)
        cursor.setCursorCol(ls[row - 1] ? ls[row - 1].length : 0)
      }
      scroll.scrollToCursor()
      return
    }

    if (key.name === "right") {
      const lineLen = ls[row] ? ls[row].length : 0
      if (col < lineLen) {
        cursor.setCursorCol(col + 1)
      } else if (row < ls.length - 1) {
        cursor.setCursorRow(row + 1)
        cursor.setCursorCol(0)
      }
      scroll.scrollToCursor()
      return
    }

    if (key.name === "home") {
      cursor.setCursorCol(0)
      scroll.scrollToCursor()
      return
    }

    if (key.name === "end") {
      cursor.setCursorCol(ls[row] ? ls[row].length : 0)
      scroll.scrollToCursor()
      return
    }

    if (key.name === "pageup") {
      const pageSize = Math.max(1, props.availableHeight - 2)
      const newRow = Math.max(0, row - pageSize)
      const maxCol = ls[newRow] ? ls[newRow].length : 0
      cursor.setCursorRow(newRow)
      cursor.setCursorCol(Math.min(col, maxCol))
      scroll.scrollToCursor()
      return
    }

    if (key.name === "pagedown") {
      const pageSize = Math.max(1, props.availableHeight - 2)
      const newRow = Math.min(ls.length - 1, row + pageSize)
      const maxCol = ls[newRow] ? ls[newRow].length : 0
      cursor.setCursorRow(newRow)
      cursor.setCursorCol(Math.min(col, maxCol))
      scroll.scrollToCursor()
      return
    }

    // Undo: Ctrl+Z
    if (key.ctrl && !key.shift && key.name === "z") {
      log.editor.info("Ctrl+Z pressed")
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
      const entry = history.redo()
      if (entry) {
        applySnapshot(entry)
      } else {
        log.editor.warn("Redo → nothing to redo")
      }
      return
    }

    // Editing
    if (key.name === "return") {
      editing.insertReturn()
      pushHistory("return")
      setTimeout(scroll.scrollToCursor, 10)
      return
    }

    if (key.name === "backspace") {
      editing.insertBackspace()
      pushHistory("backspace")
      setTimeout(scroll.scrollToCursor, 10)
      return
    }

    if (key.name === "delete") {
      editing.insertDelete()
      pushHistory("delete")
      setTimeout(scroll.scrollToCursor, 10)
      return
    }

    if (key.name === "tab") {
      editing.insertTab()
      pushHistory("tab")
      setTimeout(scroll.scrollToCursor, 10)
      return
    }

    // Character input
    if (key.sequence && key.sequence.length === 1 && key.sequence >= " " && !key.ctrl && !key.meta) {
      editing.insertChar(key.sequence)
      pushHistory(key.sequence === " " ? "space" : "char")
      setTimeout(scroll.scrollToCursor, 10)
      return
    }
  })

  // -- Paste handling --

  usePaste((event) => {
    if (!props.focused || !props.filePath) return
    const pastedText = typeof event === "string" ? event : (event.text ?? String(event))
    if (!pastedText) return
    editing.insertPaste(pastedText)
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
    const tokens = getLineTokens(lineIndex, rawLine)
    if (!active) return tokens

    const cursorExpPos = expandTabs(rawLine.slice(0, col)).length
    const cursorChLen = col < rawLine.length ? expandTabs(rawLine[col]).length : 1
    const { before, cursorToken, after } = splitTokensAtCursor(tokens, cursorExpPos, cursorChLen)

    const result: RenderToken[] = []
    for (const t of before) result.push(t)
    result.push({ ...cursorToken, cursor: true })
    for (const t of after) result.push(t)

    if (after.length === 0 && cursorToken.content !== " ") {
      result.push({ content: " ", color: DEFAULT_FG })
    }
    return result
  }

  // -- Render --

  return (
    <box flexDirection="column" flexGrow={1} height="100%" backgroundColor="#1e1e1e">
      <Show
        when={props.filePath}
        fallback={
          <box
            flexDirection="column"
            flexGrow={1}
            justifyContent="center"
            alignItems="center"
            backgroundColor="#1e1e1e"
          >
            <text fg="#555555">No file open</text>
            <text fg="#3c3c3c" marginTop={1}>
              Select a file from the sidebar
            </text>
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

                  const renderTokens = createMemo(() => {
                    const raw = lines()[i()] || ""
                    const active = isActive()
                    const col = active ? cursor.cursorCol() : 0
                    return buildLineTokens(i(), raw, active, col)
                  })

                  const activeBg = createMemo(() => lineBg())

                  return (
                    <box
                      flexDirection="row"
                      width="100%"
                      backgroundColor={lineBg()}
                      onMouseDown={(e: any) => cursor.handleLineClick(i(), e)}
                    >
                      <For each={renderTokens()}>
                        {(token: RenderToken) =>
                          token.cursor ? (
                            <CursorChar token={token} bg={activeBg()} cursorVisible={cursor.cursorVisible} />
                          ) : (
                            <text fg={token.color} bg={lineBg()} wrapMode="none">
                              {token.content}
                            </text>
                          )
                        }
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
