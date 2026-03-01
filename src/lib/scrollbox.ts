/**
 * ScrollBox layout workarounds for OpenTUI.
 *
 * The OpenTUI Solid binding creates ScrollBoxRenderable with only { id },
 * without forwarding scrollX/scrollY/scrollbarOptions to the constructor.
 * This causes the internal content element to have maxWidth:"100%", preventing
 * horizontal overflow. Additionally, when content is larger than the viewport,
 * the flexbox layout pushes scrollbars outside the visible area.
 *
 * These helpers patch the scrollbox internals post-mount to fix these issues.
 *
 * Internal ScrollBox structure (for reference):
 *   root (flexDirection: "row")
 *   ├── wrapper (flexDirection: "column", flexGrow: 1)
 *   │   ├── viewport (overflow: "hidden", flexGrow: 1)
 *   │   │   └── content (flexShrink: 0, minWidth/maxWidth depending on scrollX)
 *   │   └── horizontalScrollBar
 *   └── verticalScrollBar
 */

/** Scrollbar visual dimensions (in terminal cells) */
const VERTICAL_BAR_WIDTH = 2
const HORIZONTAL_BAR_HEIGHT = 1

/** Scrollbar colors */
const SCROLLBAR_FG = "#5a5a5a"
const SCROLLBAR_BG = "#2b2b2b"

/**
 * Enables horizontal scrolling on a scrollbox by removing the maxWidth
 * constraint that prevents content from overflowing horizontally.
 *
 * Must be called after the component mounts (post-mount), since the
 * scrollbox internals are only available after the first render.
 *
 * @param scrollRef - Reference to the scrollbox element
 */
export function enableScrollX(scrollRef: any) {
  if (!scrollRef?.content) return

  // Remove the maxWidth:"100%" that prevents horizontal overflow
  scrollRef.content.maxWidth = undefined
  // Ensure content is at least as wide as the viewport
  scrollRef.content.minWidth = "100%"

  // Apply consistent scrollbar styling
  styleScrollbars(scrollRef)
}

/**
 * Constrains the scrollbox internal layout so both scrollbars remain visible.
 *
 * Without this fix, when content is larger than the viewport, the flexbox
 * layout causes:
 * - The wrapper to expand horizontally, pushing the vertical scrollbar off-screen
 * - The viewport to expand vertically, pushing the horizontal scrollbar off-screen
 *
 * The fix applies explicit maxWidth on the wrapper and maxHeight on the viewport,
 * accounting for the space reserved for scrollbars.
 *
 * @param scrollRef - Reference to the scrollbox element
 * @param width - Available width for the entire scrollbox (including scrollbars)
 * @param height - Available height for the entire scrollbox (including scrollbars)
 */
export function constrainScrollbox(scrollRef: any, width: number, height: number) {
  if (!scrollRef) return

  // Set explicit dimensions on the scrollbox root
  scrollRef.width = width
  scrollRef.height = height

  // Constrain wrapper width so the vertical scrollbar stays visible
  if (scrollRef.wrapper) {
    scrollRef.wrapper.maxWidth = Math.max(1, width - VERTICAL_BAR_WIDTH)
  }

  // Constrain viewport height so the horizontal scrollbar stays visible
  if (scrollRef.viewport) {
    scrollRef.viewport.maxHeight = Math.max(1, height - HORIZONTAL_BAR_HEIGHT)
  }
}

/**
 * Applies consistent colors and sizes to both scrollbars.
 *
 * Sets the vertical scrollbar to VERTICAL_BAR_WIDTH chars wide and the
 * horizontal scrollbar to HORIZONTAL_BAR_HEIGHT lines tall.
 * Both use the same foreground/background colors for a unified look.
 *
 * @param scrollRef - Reference to the scrollbox element
 */
export function styleScrollbars(scrollRef: any) {
  if (!scrollRef) return

  if (scrollRef.verticalScrollBar) {
    scrollRef.verticalScrollBar.slider.foregroundColor = SCROLLBAR_FG
    scrollRef.verticalScrollBar.slider.backgroundColor = SCROLLBAR_BG
    scrollRef.verticalScrollBar.slider.width = VERTICAL_BAR_WIDTH
    scrollRef.verticalScrollBar.width = VERTICAL_BAR_WIDTH
  }

  if (scrollRef.horizontalScrollBar) {
    scrollRef.horizontalScrollBar.slider.foregroundColor = SCROLLBAR_FG
    scrollRef.horizontalScrollBar.slider.backgroundColor = SCROLLBAR_BG
    scrollRef.horizontalScrollBar.slider.height = HORIZONTAL_BAR_HEIGHT
    scrollRef.horizontalScrollBar.height = HORIZONTAL_BAR_HEIGHT
  }
}
