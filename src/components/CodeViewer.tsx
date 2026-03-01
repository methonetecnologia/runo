/**
 * Code editor panel with split gutter + code scrollboxes.
 *
 * Cursor is rendered as an inverted-color block character that blinks.
 * No native terminal cursor is used.
 *
 * Syntax highlighting is provided by Shiki (VS Code TextMate grammars).
 * Tokens are resolved asynchronously and cached; while loading or for
 * unknown languages the editor falls back to monochrome #d4d4d4.
 */

import { createMemo, createEffect, createSignal, Show, For, onMount, onCleanup } from "solid-js"
import { useKeyboard, useRenderer } from "@opentui/solid"
import { enableScrollX, constrainScrollbox, styleScrollbars } from "../lib/scrollbox"
import { splitLines, gutterWidth, maxLineLength, expandTabs, getFileExtension, extToShikiLang } from "../lib/files"
import { highlightCode, type ColorToken } from "../lib/highlighter"

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

const CodeViewer = (props: CodeViewerProps) => {
  const renderer = useRenderer()

  let codeScrollRef: any
  let gutterScrollRef: any

  // -- Cursor state --
  const [cursorRow, setCursorRow] = createSignal(0)
  const [cursorCol, setCursorCol] = createSignal(0)
  const [cursorVisible, setCursorVisible] = createSignal(true)

  // -- Syntax highlight tokens --
  const [highlightTokens, setHighlightTokens] = createSignal<ColorToken[][] | null>(null)

  // -- Blink --
  let blinkTimer: ReturnType<typeof setInterval>

  const resetBlink = () => {
    clearInterval(blinkTimer)
    setCursorVisible(true)
    blinkTimer = setInterval(() => setCursorVisible((v) => !v), 530)
  }

  onMount(() => {
    // Hide native terminal cursor
    renderer.setCursorPosition(0, 0, false)
    resetBlink()
  })

  onCleanup(() => clearInterval(blinkTimer))

  // -- Derived --
  const lines = createMemo(() => splitLines(props.content))
  const gutterW = createMemo(() => gutterWidth(lines().length))
  const codeWidth = createMemo(() => Math.max(1, props.availableWidth - gutterW() - 1))
  const maxLineLen = createMemo(() => maxLineLength(lines()))

  // -- Syntax highlighting effect (debounced) --
  let hlTimer: ReturnType<typeof setTimeout> | null = null
  /** Track which highlight request is latest to discard stale results. */
  let hlGeneration = 0

  createEffect(() => {
    const content = props.content
    const filePath = props.filePath

    if (hlTimer) clearTimeout(hlTimer)

    if (!filePath) {
      setHighlightTokens(null)
      return
    }

    const ext = getFileExtension(filePath)
    const lang = extToShikiLang(ext)
    if (!lang || lang === "plaintext") {
      setHighlightTokens(null)
      return
    }

    const gen = ++hlGeneration

    // Invalidate stale tokens immediately so line colours don't desync
    // while the async highlighter catches up.
    setHighlightTokens(null)

    // Debounce: 100ms after last content change to avoid thrashing during fast typing
    hlTimer = setTimeout(() => {
      highlightCode(content, lang).then((tokens) => {
        // Only apply if this is still the latest request
        if (gen === hlGeneration) {
          setHighlightTokens(tokens)
        }
      })
    }, 100)
  })

  // -- Editing helpers --
  const applyEdit = (newLines: string[], newRow: number, newCol: number) => {
    const newContent = newLines.join("\n")
    if (props.onContentChange) props.onContentChange(newContent)
    setCursorRow(Math.max(0, Math.min(newRow, newLines.length - 1)))
    setCursorCol(Math.max(0, newCol))
  }

  // -- Scroll sync --

  /** Sync gutter vertical scroll to match the code area. */
  const syncGutterScroll = () => {
    if (!gutterScrollRef || !codeScrollRef) return
    const viewHeight = props.availableHeight - 1
    if (lines().length <= viewHeight && codeScrollRef.scrollTop > 0) {
      codeScrollRef.scrollTop = 0
    }
    const codeBar = codeScrollRef.verticalScrollBar
    const gutterBar = gutterScrollRef.verticalScrollBar
    if (codeBar && gutterBar) {
      gutterBar.scrollSize = codeBar.scrollSize
      gutterBar.viewportSize = codeBar.viewportSize
      gutterBar.scrollPosition = codeBar.scrollPosition
    } else {
      gutterScrollRef.scrollTop = codeScrollRef.scrollTop
    }
  }

  /** Buffer zone (lines/cols from viewport edge before scroll kicks in). */
  const SCROLL_MARGIN_Y = 3
  const SCROLL_MARGIN_X = 5

  /** Scroll viewport to keep cursor visible (only when near edges). */
  const scrollToCursor = () => {
    if (!codeScrollRef) return
    const row = cursorRow()
    const col = cursorCol()
    const line = lines()[row] || ""
    const expandedCol = expandTabs(line.slice(0, col)).length
    const totalLines = lines().length
    const viewHeight = props.availableHeight - 1

    // --- Vertical ---
    if (totalLines > viewHeight) {
      const viewTop = codeScrollRef.scrollTop || 0
      const viewBottom = viewTop + viewHeight - 1

      if (row < viewTop) {
        codeScrollRef.scrollTop = Math.max(0, row - SCROLL_MARGIN_Y)
      } else if (row > viewBottom) {
        codeScrollRef.scrollTop = Math.min(totalLines - viewHeight, row - viewHeight + 1 + SCROLL_MARGIN_Y)
      } else if (row < viewTop + SCROLL_MARGIN_Y) {
        codeScrollRef.scrollTop = Math.max(0, viewTop - 1)
      } else if (row > viewBottom - SCROLL_MARGIN_Y) {
        codeScrollRef.scrollTop = Math.min(totalLines - viewHeight, viewTop + 1)
      }
    } else if (codeScrollRef.scrollTop !== 0) {
      codeScrollRef.scrollTop = 0
    }
    syncGutterScroll()

    // --- Horizontal ---
    const viewWidth = codeWidth() - 2
    const lineLen = expandTabs(line).length
    if (lineLen > viewWidth) {
      const viewLeft = codeScrollRef.scrollLeft || 0
      const viewRight = viewLeft + viewWidth - 1

      if (expandedCol < viewLeft) {
        codeScrollRef.scrollLeft = Math.max(0, expandedCol - SCROLL_MARGIN_X)
      } else if (expandedCol > viewRight) {
        codeScrollRef.scrollLeft = expandedCol - viewWidth + 1 + SCROLL_MARGIN_X
      } else if (expandedCol < viewLeft + SCROLL_MARGIN_X) {
        codeScrollRef.scrollLeft = Math.max(0, viewLeft - 1)
      } else if (expandedCol > viewRight - SCROLL_MARGIN_X) {
        codeScrollRef.scrollLeft = viewLeft + 1
      }
    } else if (codeScrollRef.scrollLeft !== 0) {
      codeScrollRef.scrollLeft = 0
    }
  }

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

  /** Handle click on a line. e.x is global (absolute terminal column). */
  const handleLineClick = (lineIndex: number, e: any) => {
    resetBlink()
    renderer.clearSelection()

    const ls = lines()
    const row = Math.max(0, Math.min(lineIndex, ls.length - 1))
    const rawLine = ls[row] || ""

    const globalX = e?.x ?? 0
    const scrollLeft = codeScrollRef?.scrollLeft || 0
    const localExpandedCol = globalX - props.codeStartX + scrollLeft
    const col = expandedColToRawCol(rawLine, Math.max(0, localExpandedCol))

    setCursorRow(row)
    setCursorCol(col)
  }

  // -- Effects --

  createEffect(() => {
    props.filePath
    setCursorRow(0)
    setCursorCol(0)
    resetBlink()
    if (codeScrollRef) {
      codeScrollRef.scrollTop = 0
      codeScrollRef.scrollLeft = 0
    }
    if (gutterScrollRef) {
      gutterScrollRef.scrollTop = 0
    }
  })

  createEffect(() => {
    if (props.onCursorChange) {
      props.onCursorChange(cursorRow() + 1, cursorCol() + 1)
    }
  })

  // Keep native cursor hidden
  createEffect(() => {
    props.focused
    renderer.setCursorPosition(0, 0, false)
  })

  // -- Keyboard --

  useKeyboard((key) => {
    if (!props.focused || !props.filePath) return

    const ls = lines()
    const row = cursorRow()
    const col = cursorCol()

    resetBlink()

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
        syncGutterScroll()
      }
      return
    }

    // Navigation
    if (key.name === "up") {
      if (row > 0) {
        const newRow = row - 1
        const maxCol = ls[newRow] ? ls[newRow].length : 0
        setCursorRow(newRow)
        setCursorCol(Math.min(col, maxCol))
        scrollToCursor()
      }
      return
    }

    if (key.name === "down") {
      if (row < ls.length - 1) {
        const newRow = row + 1
        const maxCol = ls[newRow] ? ls[newRow].length : 0
        setCursorRow(newRow)
        setCursorCol(Math.min(col, maxCol))
        scrollToCursor()
      }
      return
    }

    if (key.name === "left") {
      if (col > 0) {
        setCursorCol(col - 1)
      } else if (row > 0) {
        setCursorRow(row - 1)
        setCursorCol(ls[row - 1] ? ls[row - 1].length : 0)
      }
      scrollToCursor()
      return
    }

    if (key.name === "right") {
      const lineLen = ls[row] ? ls[row].length : 0
      if (col < lineLen) {
        setCursorCol(col + 1)
      } else if (row < ls.length - 1) {
        setCursorRow(row + 1)
        setCursorCol(0)
      }
      scrollToCursor()
      return
    }

    if (key.name === "home") {
      setCursorCol(0)
      scrollToCursor()
      return
    }

    if (key.name === "end") {
      setCursorCol(ls[row] ? ls[row].length : 0)
      scrollToCursor()
      return
    }

    if (key.name === "pageup") {
      const pageSize = Math.max(1, props.availableHeight - 2)
      const newRow = Math.max(0, row - pageSize)
      const maxCol = ls[newRow] ? ls[newRow].length : 0
      setCursorRow(newRow)
      setCursorCol(Math.min(col, maxCol))
      scrollToCursor()
      return
    }

    if (key.name === "pagedown") {
      const pageSize = Math.max(1, props.availableHeight - 2)
      const newRow = Math.min(ls.length - 1, row + pageSize)
      const maxCol = ls[newRow] ? ls[newRow].length : 0
      setCursorRow(newRow)
      setCursorCol(Math.min(col, maxCol))
      scrollToCursor()
      return
    }

    // Editing
    if (key.name === "return") {
      const newLines = [...ls]
      const currentLine = newLines[row] || ""
      newLines[row] = currentLine.slice(0, col)
      newLines.splice(row + 1, 0, currentLine.slice(col))
      applyEdit(newLines, row + 1, 0)
      setTimeout(scrollToCursor, 10)
      return
    }

    if (key.name === "backspace") {
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
      setTimeout(scrollToCursor, 10)
      return
    }

    if (key.name === "delete") {
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
      setTimeout(scrollToCursor, 10)
      return
    }

    if (key.name === "tab") {
      const newLines = [...ls]
      const currentLine = newLines[row] || ""
      const spaces = "  "
      newLines[row] = currentLine.slice(0, col) + spaces + currentLine.slice(col)
      applyEdit(newLines, row, col + spaces.length)
      setTimeout(scrollToCursor, 10)
      return
    }

    // Character input
    if (key.sequence && key.sequence.length === 1 && key.sequence >= " " && !key.ctrl && !key.meta) {
      const newLines = [...ls]
      const currentLine = newLines[row] || ""
      newLines[row] = currentLine.slice(0, col) + key.sequence + currentLine.slice(col)
      applyEdit(newLines, row, col + 1)
      setTimeout(scrollToCursor, 10)
      return
    }
  })

  // -- Scrollbox patching --

  const setupCodeScroll = () => {
    if (!codeScrollRef) return
    enableScrollX(codeScrollRef)
    constrainScrollbox(codeScrollRef, codeWidth(), props.availableHeight)
    codeScrollRef.handleKeyPress = () => false
    codeScrollRef.selectable = false
    codeScrollRef.shouldStartSelection = () => false
    if (codeScrollRef.viewport) {
      codeScrollRef.viewport.selectable = false
      codeScrollRef.viewport.shouldStartSelection = () => false
    }
    const origStartSelection = renderer.startSelection?.bind(renderer)
    if (origStartSelection) {
      renderer.startSelection = (renderable: any, x: number, y: number) => {
        let node = renderable
        while (node) {
          if (node === codeScrollRef) return
          node = node.parent
        }
        origStartSelection(renderable, x, y)
      }
    }
    if (codeScrollRef.verticalScrollBar) {
      const origOnChange = codeScrollRef.verticalScrollBar._onChange
      codeScrollRef.verticalScrollBar._onChange = (pos: number) => {
        origOnChange?.(pos)
        syncGutterScroll()
      }
    }
    const origScrollBy = codeScrollRef.scrollBy?.bind(codeScrollRef)
    if (origScrollBy) {
      codeScrollRef.scrollBy = (opts: any) => {
        const viewH = props.availableHeight - 1
        if (opts?.y && lines().length <= viewH) opts.y = 0
        origScrollBy(opts)
        syncGutterScroll()
      }
    }
    const origMouseScroll = codeScrollRef.onMouseScroll?.bind(codeScrollRef)
    codeScrollRef.onMouseScroll = (e: any) => {
      const viewH = props.availableHeight - 1
      if (lines().length <= viewH) {
        codeScrollRef.scrollTop = 0
      }
      origMouseScroll?.(e)
      syncGutterScroll()
    }
  }

  onMount(() =>
    setTimeout(() => {
      setupCodeScroll()
      if (gutterScrollRef) {
        styleScrollbars(gutterScrollRef)
        if (gutterScrollRef.verticalScrollBar) gutterScrollRef.verticalScrollBar.visible = false
        if (gutterScrollRef.horizontalScrollBar) gutterScrollRef.horizontalScrollBar.visible = false
      }
    }, 50)
  )

  createEffect(() => {
    props.filePath
    setTimeout(() => {
      setupCodeScroll()
      if (gutterScrollRef) {
        if (gutterScrollRef.verticalScrollBar) gutterScrollRef.verticalScrollBar.visible = false
        if (gutterScrollRef.horizontalScrollBar) gutterScrollRef.horizontalScrollBar.visible = false
      }
    }, 50)
  })

  createEffect(() => {
    const w = codeWidth()
    const h = props.availableHeight
    if (codeScrollRef) constrainScrollbox(codeScrollRef, w, h)
  })

  // Guard: reset scroll and hide scrollbars when content fits on screen
  createEffect(() => {
    const totalLines = lines().length
    const viewHeight = props.availableHeight - 1
    const fits = totalLines <= viewHeight
    if (codeScrollRef) {
      if (fits) codeScrollRef.scrollTop = 0
      if (codeScrollRef.verticalScrollBar) {
        codeScrollRef.verticalScrollBar.visible = !fits
      }
    }
    if (gutterScrollRef) {
      if (fits) gutterScrollRef.scrollTop = 0
    }
  })

  // =====================================================================
  //  Helpers: expand tokens with tab replacement for rendering
  // =====================================================================

  /**
   * Expand a single Shiki token, replacing tabs with spaces.
   * Returns one or more ColorTokens (tabs may split a token).
   */
  const expandTokenTabs = (token: ColorToken, tabSize = 4): ColorToken => {
    if (token.content.indexOf("\t") === -1) return token
    return { content: token.content.replace(/\t/g, " ".repeat(tabSize)), color: token.color }
  }

  /**
   * Get expanded (tab-replaced) tokens for a given line index.
   * Falls back to a single default-colored token when no highlight data.
   */
  const getLineTokens = (lineIndex: number, rawLine: string): ColorToken[] => {
    const ht = highlightTokens()
    // Only use cached tokens when they match the current line count,
    // otherwise the async highlight result belongs to a stale version.
    if (ht && ht.length === lines().length && ht[lineIndex] && ht[lineIndex].length > 0) {
      const tokens: ColorToken[] = []
      for (const t of ht[lineIndex]) {
        tokens.push(expandTokenTabs(t))
      }
      return tokens
    }
    // Fallback: plain monochrome — always return at least one token so the
    // <box> row keeps its height (empty [] would collapse to 0-height).
    return [{ content: expandTabs(rawLine) || " ", color: DEFAULT_FG }]
  }

  /**
   * Split tokens at a given *expanded* column position for cursor rendering.
   *
   * Returns { before: ColorToken[], cursorToken: ColorToken, after: ColorToken[] }
   * where cursorToken is the single character (or space at EOL) under the cursor.
   */
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
          // Entire token is before cursor
          before.push(t)
        } else if (cursorExpPos >= pos) {
          // Cursor falls inside this token
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

    // Cursor past end of all tokens (EOL)
    if (!found) {
      cursorToken = { content: " ", color: DEFAULT_FG }
    }

    return { before, cursorToken, after }
  }

  /**
   * Render token for a single segment of a line.
   * `cursor` marks the token that sits under the cursor (blink-aware).
   */
  interface RenderToken extends ColorToken {
    cursor?: boolean
  }

  /**
   * Build the render-token array for a line.
   * Active line → tokens are split around the cursor position.
   * Inactive line → plain highlight tokens.
   */
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

    // Trailing space so the cursor at EOL has somewhere to sit
    if (after.length === 0 && cursorToken.content !== " ") {
      result.push({ content: " ", color: DEFAULT_FG })
    }
    return result
  }

  /** Cursor-blink character — isolated component so only it reacts to blink. */
  const CursorChar = (p: { token: ColorToken; bg: string }) => {
    const cFg = () => (cursorVisible() ? "#1e1e1e" : p.token.color)
    const cBg = () => (cursorVisible() ? p.token.color : p.bg)
    return (
      <text fg={cFg()} bg={cBg()} wrapMode="none">
        {p.token.content}
      </text>
    )
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
                  const isCurrentLine = () => i() === cursorRow()
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
                  const isActive = () => i() === cursorRow() && props.focused
                  const lineBg = () => (isActive() ? "#2a2d2e" : "#1e1e1e")

                  // Memo: recompute tokens only when line content, active state, or cursor col change
                  // cursorVisible is NOT read here — blink is handled by <CursorChar> component
                  const renderTokens = createMemo(() => {
                    const raw = lines()[i()] || ""
                    const active = isActive()
                    const col = active ? cursorCol() : 0
                    return buildLineTokens(i(), raw, active, col)
                  })

                  // Stable bg value for CursorChar (avoids reading isActive inside CursorChar)
                  const activeBg = createMemo(() => lineBg())

                  return (
                    <box
                      flexDirection="row"
                      width="100%"
                      backgroundColor={lineBg()}
                      onMouseDown={(e: any) => handleLineClick(i(), e)}
                    >
                      <For each={renderTokens()}>
                        {(token: RenderToken) =>
                          token.cursor ? (
                            <CursorChar token={token} bg={activeBg()} />
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
