/**
 * Code editor panel with split gutter + code scrollboxes.
 *
 * Layout: two side-by-side scrollboxes sharing vertical scroll position.
 *
 *   ┌─────┬──────────────────────┬──┐
 *   │ 1   │ import { foo } from  │▓▓│  <- vertical scrollbar
 *   │ 2   │ const bar = 42       │▓▓│
 *   │ 3   │                      │▓▓│
 *   ├─────┼──────────────────────┴──┤
 *   │     │ ████████                │  <- horizontal scrollbar
 *   └─────┴─────────────────────────┘
 *   gutter   code scrollbox
 *
 * The gutter (line numbers) scrolls vertically in sync with the code
 * but does NOT scroll horizontally, keeping line numbers always visible.
 * Both gutter scrollbars are hidden — only the code scrollbox shows them.
 *
 * Scroll sync is achieved by hooking into the code scrollbox's
 * verticalScrollBar._onChange callback and mirroring scrollTop to the gutter.
 *
 * Props `availableWidth` and `availableHeight` must be passed from the parent
 * because OpenTUI's flexbox doesn't provide pixel-exact dimensions needed
 * for constrainScrollbox() to keep scrollbars within the visible area.
 */

import { createMemo, createEffect, Show, For, onMount } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import { enableScrollX, constrainScrollbox, styleScrollbars } from "../lib/scrollbox"
import { splitLines, gutterWidth, maxLineLength, expandTabs } from "../lib/files"

interface CodeViewerProps {
  /** Path of the currently open file (null = no file) */
  filePath: string | null
  /** Raw text content of the file */
  content: string
  /** Whether this panel has keyboard focus */
  focused: boolean
  /** Pixel-exact width available for the code scrollbox (terminal cols) */
  availableWidth: number
  /** Pixel-exact height available for the code scrollbox (terminal rows) */
  availableHeight: number
}

const CodeViewer = (props: CodeViewerProps) => {
  /**
   * Refs to scrollbox elements — assigned post-mount by OpenTUI's ref={} prop.
   * Typed as `any` because OpenTUI's ScrollBoxRenderable type is not exported.
   */
  let codeScrollRef: any
  let gutterScrollRef: any

  // -- Derived values (recompute when content changes) --

  /** Lines of the file content */
  const lines = createMemo(() => splitLines(props.content))

  /** Width of the gutter column (based on digit count of total lines) */
  const gutterW = createMemo(() => gutterWidth(lines().length))

  /** Available width for the code scrollbox (total minus gutter minus 1px separator) */
  const codeWidth = createMemo(() => Math.max(1, props.availableWidth - gutterW() - 1))

  /** Longest line length after tab expansion (determines content width) */
  const maxLineLen = createMemo(() => maxLineLength(lines()))

  // -- Scroll sync --

  /**
   * Copies the code scrollbox's vertical scroll position to the gutter.
   * Called whenever the code scrollbox's vertical scrollbar changes position.
   */
  const syncGutterScroll = () => {
    if (!gutterScrollRef || !codeScrollRef) return
    gutterScrollRef.scrollTop = codeScrollRef.scrollTop
  }

  /**
   * Resets scroll position when switching files.
   * The bare `props.filePath` expression is intentional — Solid.js tracks
   * it as a reactive dependency so this effect re-runs on file change.
   */
  createEffect(() => {
    props.filePath
    if (codeScrollRef) {
      codeScrollRef.scrollTop = 0
      codeScrollRef.scrollLeft = 0
    }
    if (gutterScrollRef) {
      gutterScrollRef.scrollTop = 0
    }
  })

  // -- Keyboard --

  /** Shift+Left/Right = horizontal scroll in the code area */
  useKeyboard((key) => {
    if (!props.focused || !codeScrollRef) return
    if (key.shift && (key.name === "left" || key.name === "right")) {
      const delta = key.name === "right" ? 3 : -3
      codeScrollRef.scrollBy({ x: delta, y: 0 })
    }
  })

  // -- Scrollbox patching --

  /**
   * Patches the code scrollbox internals post-mount:
   * 1. enableScrollX: removes maxWidth:"100%" that blocks horizontal overflow
   * 2. constrainScrollbox: sets explicit maxWidth/maxHeight so scrollbars stay visible
   * 3. Hooks verticalScrollBar._onChange to sync gutter scroll
   */
  const setupCodeScroll = () => {
    if (!codeScrollRef) return
    enableScrollX(codeScrollRef)
    constrainScrollbox(codeScrollRef, codeWidth(), props.availableHeight)
    if (codeScrollRef.verticalScrollBar) {
      const origOnChange = codeScrollRef.verticalScrollBar._onChange
      codeScrollRef.verticalScrollBar._onChange = (pos: number) => {
        origOnChange?.(pos)
        syncGutterScroll()
      }
    }
  }

  /** Initial setup after first render */
  onMount(() =>
    setTimeout(() => {
      setupCodeScroll()
      // Hide gutter scrollbars (gutter syncs via code scrollbar)
      if (gutterScrollRef) {
        styleScrollbars(gutterScrollRef)
        if (gutterScrollRef.verticalScrollBar) gutterScrollRef.verticalScrollBar.visible = false
        if (gutterScrollRef.horizontalScrollBar) gutterScrollRef.horizontalScrollBar.visible = false
      }
    }, 50)
  )

  /** Re-patch when file changes (scrollbox may reset internally) */
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

  /** Update scrollbox constraints on resize or sidebar drag */
  createEffect(() => {
    const w = codeWidth()
    const h = props.availableHeight
    if (codeScrollRef) constrainScrollbox(codeScrollRef, w, h)
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
          {/* Gutter: line numbers, vertical scroll synced to code, scrollbars hidden */}
          <scrollbox ref={gutterScrollRef} width={gutterW() + 1} height="100%" scrollY={true}>
            <box flexDirection="column">
              <For each={lines()}>
                {(_, i) => {
                  const num = () => String(i() + 1).padStart(gutterW(), " ") + " "
                  return (
                    <text fg="#858585" bg="#1e1e1e" wrapMode="none">
                      {num()}
                    </text>
                  )
                }}
              </For>
            </box>
          </scrollbox>

          {/* Code area: horizontal + vertical scroll, both scrollbars visible */}
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
                {(line) => {
                  const code = () => expandTabs(line)
                  return (
                    <text fg="#d4d4d4" bg="#1e1e1e" wrapMode="none">
                      {code()}
                    </text>
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
