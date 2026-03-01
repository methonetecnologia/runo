/**
 * Code editor panel with split gutter + code scrollboxes.
 *
 * Cursor is rendered as an inverted-color block character that blinks.
 * No native terminal cursor is used.
 */

import { createMemo, createEffect, createSignal, Show, For, onMount, onCleanup } from "solid-js"
import { useKeyboard, useRenderer } from "@opentui/solid"
import { enableScrollX, constrainScrollbox, styleScrollbars } from "../lib/scrollbox"
import { splitLines, gutterWidth, maxLineLength, expandTabs } from "../lib/files"

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

const CodeViewer = (props: CodeViewerProps) => {
  const renderer = useRenderer()

  let codeScrollRef: any
  let gutterScrollRef: any

  // -- Cursor state --
  const [cursorRow, setCursorRow] = createSignal(0)
  const [cursorCol, setCursorCol] = createSignal(0)
  const [cursorVisible, setCursorVisible] = createSignal(true)

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
    // Mirror scrollbar properties so the gutter clamps identically to the code
    // (the code viewport is 1 row shorter due to the horizontal scrollbar).
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
        // Cursor scrolled above viewport — bring it into view with margin
        codeScrollRef.scrollTop = Math.max(0, row - SCROLL_MARGIN_Y)
      } else if (row > viewBottom) {
        // Cursor scrolled below viewport — bring it into view with margin
        codeScrollRef.scrollTop = Math.min(
          totalLines - viewHeight,
          row - viewHeight + 1 + SCROLL_MARGIN_Y
        )
      } else if (row < viewTop + SCROLL_MARGIN_Y) {
        // Cursor inside viewport but within top margin — nudge scroll up by 1
        codeScrollRef.scrollTop = Math.max(0, viewTop - 1)
      } else if (row > viewBottom - SCROLL_MARGIN_Y) {
        // Cursor inside viewport but within bottom margin — nudge scroll down by 1
        codeScrollRef.scrollTop = Math.min(totalLines - viewHeight, viewTop + 1)
      }
      // else: cursor is in the safe zone — do NOT touch scrollTop
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
    // Clear any text selection the renderer may have started
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
    // Disable native keyboard scroll (we control scroll via scrollToCursor)
    codeScrollRef.handleKeyPress = () => false
    // Disable text selection inside the code area
    codeScrollRef.selectable = false
    codeScrollRef.shouldStartSelection = () => false
    if (codeScrollRef.viewport) {
      codeScrollRef.viewport.selectable = false
      codeScrollRef.viewport.shouldStartSelection = () => false
    }
    // Ignore text selections originating from the code area
    const origStartSelection = renderer.startSelection?.bind(renderer)
    if (origStartSelection) {
      renderer.startSelection = (renderable: any, x: number, y: number) => {
        // Walk up from renderable to see if it's inside our code scrollbox
        let node = renderable
        while (node) {
          if (node === codeScrollRef) return // Swallow selection
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
    // Intercept scrollBy to prevent scrolling when content fits
    const origScrollBy = codeScrollRef.scrollBy?.bind(codeScrollRef)
    if (origScrollBy) {
      codeScrollRef.scrollBy = (opts: any) => {
        const viewH = props.availableHeight - 1
        if (opts?.y && lines().length <= viewH) opts.y = 0
        origScrollBy(opts)
        syncGutterScroll()
      }
    }
    // Intercept mouse wheel scroll
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
                {(line, i) => {
                  const isActive = () => i() === cursorRow() && props.focused
                  const lineBg = () => isActive() ? "#2a2d2e" : "#1e1e1e"
                  const col = () => cursorCol()
                  const rawLine = () => lines()[i()] || ""

                  return (
                    <Show
                      when={isActive()}
                      fallback={
                        <text
                          fg="#d4d4d4"
                          bg={lineBg()}
                          wrapMode="none"
                          onMouseDown={(e: any) => handleLineClick(i(), e)}
                        >
                          {expandTabs(line)}
                        </text>
                      }
                    >
                      {(() => {
                        const rl = rawLine()
                        const expanded = expandTabs(rl)
                        const cCol = col()
                        const bg = lineBg()

                        const cursorExpPos = expandTabs(rl.slice(0, cCol)).length
                        const cursorCh = cCol < rl.length
                          ? expanded.slice(cursorExpPos, cursorExpPos + expandTabs(rl[cCol]).length)
                          : " "
                        const cursorExpEnd = cursorExpPos + cursorCh.length
                        const beforeCursor = expanded.slice(0, cursorExpPos)
                        const afterCursor = expanded.slice(cursorExpEnd)

                        const blink = cursorVisible()
                        const cFg = blink ? "#1e1e1e" : "#d4d4d4"
                        const cBg = blink ? "#d4d4d4" : bg

                        return (
                          <box
                            flexDirection="row"
                            width="100%"
                            onMouseDown={(e: any) => handleLineClick(i(), e)}
                          >
                            <text fg="#d4d4d4" bg={bg} wrapMode="none">{beforeCursor}</text>
                            <text fg={cFg} bg={cBg} wrapMode="none">{cursorCh}</text>
                            <text fg="#d4d4d4" bg={bg} wrapMode="none">{afterCursor || " "}</text>
                          </box>
                        )
                      })()}
                    </Show>
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
