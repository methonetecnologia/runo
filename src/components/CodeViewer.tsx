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
 *   - useEditing: character input, backspace, delete, enter, tab
 *   - useScrollSync: gutter↔code scroll sync, scrollbox patching
 *   - useHighlight: Shiki syntax highlighting with debounce
 */

import { createMemo, createEffect, Show, For } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import { splitLines, gutterWidth, maxLineLength, expandTabs } from "../lib/files"
import { type ColorToken } from "../lib/highlighter"
import { useCursor } from "../hooks/useCursor"
import { useEditing } from "../hooks/useEditing"
import { useScrollSync } from "../hooks/useScrollSync"
import { useHighlight } from "../hooks/useHighlight"
import CursorChar from "./CursorChar"

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

  // -- File change: reset cursor + scroll --

  createEffect(() => {
    props.filePath
    cursor.resetCursor()
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

    // Editing
    if (key.name === "return") {
      editing.insertReturn()
      setTimeout(scroll.scrollToCursor, 10)
      return
    }

    if (key.name === "backspace") {
      editing.insertBackspace()
      setTimeout(scroll.scrollToCursor, 10)
      return
    }

    if (key.name === "delete") {
      editing.insertDelete()
      setTimeout(scroll.scrollToCursor, 10)
      return
    }

    if (key.name === "tab") {
      editing.insertTab()
      setTimeout(scroll.scrollToCursor, 10)
      return
    }

    // Character input
    if (key.sequence && key.sequence.length === 1 && key.sequence >= " " && !key.ctrl && !key.meta) {
      editing.insertChar(key.sequence)
      setTimeout(scroll.scrollToCursor, 10)
      return
    }
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
