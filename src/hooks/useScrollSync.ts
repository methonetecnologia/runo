/**
 * Scroll synchronization between gutter and code scrollboxes.
 *
 * Handles vertical sync, cursor-follow scrolling, and scrollbox
 * patching for the code editor layout.
 */

import { createEffect, onMount } from "solid-js"
import { enableScrollX, constrainScrollbox, styleScrollbars } from "../lib/scrollbox"
import { expandTabs } from "../lib/files"

/** Buffer zone (lines/cols from viewport edge before scroll kicks in). */
const SCROLL_MARGIN_Y = 3
const SCROLL_MARGIN_X = 5

export interface UseScrollSyncOptions {
  /** Reactive getter for the split lines array */
  lines: () => string[]
  /** Reactive getter for cursor row */
  cursorRow: () => number
  /** Reactive getter for cursor col */
  cursorCol: () => number
  /** Reactive getter for code area width */
  codeWidth: () => number
  /** Reactive getter for available height */
  availableHeight: () => number
  /** Reactive getter for file path (triggers reset on change) */
  filePath: () => string | null
  /** Ref getter for the code scrollbox */
  codeScrollRef: () => any
  /** Ref getter for the gutter scrollbox */
  gutterScrollRef: () => any
}

export function useScrollSync(opts: UseScrollSyncOptions) {
  /** Sync gutter vertical scroll to match the code area. */
  const syncGutterScroll = () => {
    const codeRef = opts.codeScrollRef()
    const gutterRef = opts.gutterScrollRef()
    if (!gutterRef || !codeRef) return
    const viewHeight = opts.availableHeight() - 1
    if (opts.lines().length <= viewHeight && codeRef.scrollTop > 0) {
      codeRef.scrollTop = 0
    }
    const codeBar = codeRef.verticalScrollBar
    const gutterBar = gutterRef.verticalScrollBar
    if (codeBar && gutterBar) {
      gutterBar.scrollSize = codeBar.scrollSize
      gutterBar.viewportSize = codeBar.viewportSize
      gutterBar.scrollPosition = codeBar.scrollPosition
    } else {
      gutterRef.scrollTop = codeRef.scrollTop
    }
  }

  /** Scroll viewport to keep cursor visible (only when near edges). */
  const scrollToCursor = () => {
    const codeRef = opts.codeScrollRef()
    if (!codeRef) return
    const row = opts.cursorRow()
    const col = opts.cursorCol()
    const line = opts.lines()[row] || ""
    const expandedCol = expandTabs(line.slice(0, col)).length
    const totalLines = opts.lines().length
    const viewHeight = opts.availableHeight() - 1

    // --- Vertical ---
    if (totalLines > viewHeight) {
      const viewTop = codeRef.scrollTop || 0
      const viewBottom = viewTop + viewHeight - 1

      if (row < viewTop) {
        codeRef.scrollTop = Math.max(0, row - SCROLL_MARGIN_Y)
      } else if (row > viewBottom) {
        codeRef.scrollTop = Math.min(totalLines - viewHeight, row - viewHeight + 1 + SCROLL_MARGIN_Y)
      } else if (row < viewTop + SCROLL_MARGIN_Y) {
        codeRef.scrollTop = Math.max(0, viewTop - 1)
      } else if (row > viewBottom - SCROLL_MARGIN_Y) {
        codeRef.scrollTop = Math.min(totalLines - viewHeight, viewTop + 1)
      }
    } else if (codeRef.scrollTop !== 0) {
      codeRef.scrollTop = 0
    }
    syncGutterScroll()

    // --- Horizontal ---
    const viewWidth = opts.codeWidth() - 2
    const lineLen = expandTabs(line).length
    if (lineLen > viewWidth) {
      const viewLeft = codeRef.scrollLeft || 0
      const viewRight = viewLeft + viewWidth - 1

      if (expandedCol < viewLeft) {
        codeRef.scrollLeft = Math.max(0, expandedCol - SCROLL_MARGIN_X)
      } else if (expandedCol > viewRight) {
        codeRef.scrollLeft = expandedCol - viewWidth + 1 + SCROLL_MARGIN_X
      } else if (expandedCol < viewLeft + SCROLL_MARGIN_X) {
        codeRef.scrollLeft = Math.max(0, viewLeft - 1)
      } else if (expandedCol > viewRight - SCROLL_MARGIN_X) {
        codeRef.scrollLeft = viewLeft + 1
      }
    } else if (codeRef.scrollLeft !== 0) {
      codeRef.scrollLeft = 0
    }
  }

  // -- Scrollbox patching --

  const setupCodeScroll = () => {
    const codeRef = opts.codeScrollRef()
    if (!codeRef) return
    enableScrollX(codeRef)
    constrainScrollbox(codeRef, opts.codeWidth(), opts.availableHeight())
    codeRef.handleKeyPress = () => false
    codeRef.selectable = false
    codeRef.shouldStartSelection = () => false
    if (codeRef.viewport) {
      codeRef.viewport.selectable = false
      codeRef.viewport.shouldStartSelection = () => false
    }
    // Note: renderer.startSelection is globally disabled in App onMount.
    // No per-scrollbox patching needed here.
    if (codeRef.verticalScrollBar) {
      const origOnChange = codeRef.verticalScrollBar._onChange
      codeRef.verticalScrollBar._onChange = (pos: number) => {
        origOnChange?.(pos)
        syncGutterScroll()
      }
    }
    const origScrollBy = codeRef.scrollBy?.bind(codeRef)
    if (origScrollBy) {
      codeRef.scrollBy = (scrollOpts: any) => {
        const viewH = opts.availableHeight() - 1
        if (scrollOpts?.y && opts.lines().length <= viewH) scrollOpts.y = 0
        origScrollBy(scrollOpts)
        syncGutterScroll()
      }
    }
    const origMouseScroll = codeRef.onMouseScroll?.bind(codeRef)
    codeRef.onMouseScroll = (e: any) => {
      const viewH = opts.availableHeight() - 1
      if (opts.lines().length <= viewH) {
        codeRef.scrollTop = 0
      }
      origMouseScroll?.(e)
      syncGutterScroll()
    }
  }

  const setupGutterScroll = () => {
    const gutterRef = opts.gutterScrollRef()
    if (!gutterRef) return
    styleScrollbars(gutterRef)
    if (gutterRef.verticalScrollBar) gutterRef.verticalScrollBar.visible = false
    if (gutterRef.horizontalScrollBar) gutterRef.horizontalScrollBar.visible = false
  }

  // Initial setup after mount
  onMount(() =>
    setTimeout(() => {
      setupCodeScroll()
      setupGutterScroll()
    }, 50)
  )

  // Re-setup on file change
  createEffect(() => {
    opts.filePath()
    setTimeout(() => {
      setupCodeScroll()
      const gutterRef = opts.gutterScrollRef()
      if (gutterRef) {
        if (gutterRef.verticalScrollBar) gutterRef.verticalScrollBar.visible = false
        if (gutterRef.horizontalScrollBar) gutterRef.horizontalScrollBar.visible = false
      }
    }, 50)
  })

  // Re-constrain on resize
  createEffect(() => {
    const w = opts.codeWidth()
    const h = opts.availableHeight()
    const codeRef = opts.codeScrollRef()
    if (codeRef) constrainScrollbox(codeRef, w, h)
  })

  // Guard: reset scroll and hide scrollbars when content fits on screen
  createEffect(() => {
    const totalLines = opts.lines().length
    const viewHeight = opts.availableHeight() - 1
    const fits = totalLines <= viewHeight
    const codeRef = opts.codeScrollRef()
    if (codeRef) {
      if (fits) codeRef.scrollTop = 0
      if (codeRef.verticalScrollBar) {
        codeRef.verticalScrollBar.visible = !fits
      }
    }
    const gutterRef = opts.gutterScrollRef()
    if (gutterRef) {
      if (fits) gutterRef.scrollTop = 0
    }
  })

  return {
    syncGutterScroll,
    scrollToCursor,
  }
}
