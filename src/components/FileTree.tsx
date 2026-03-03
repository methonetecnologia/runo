/**
 * Sidebar file tree with keyboard and mouse navigation.
 *
 * Renders a flat list of files/directories (from flattenTree) with:
 * - Indentation based on depth
 * - File type icons (TS, JS, PY, etc.)
 * - Directory expand/collapse arrows (▸/▾)
 * - Keyboard navigation: j/k or arrows for cursor, Enter to open/toggle,
 *   h/l or arrows to collapse/expand directories
 * - Mouse: click to select/toggle, hover highlight
 * - Buffer cursor scroll: viewport follows cursor with a margin buffer,
 *   only scrolling when the cursor approaches the edges
 *
 * The tree width is computed dynamically via computeTreeWidth() so the
 * scrollbox parent can determine content width for horizontal scrolling.
 */

import { createSignal, createMemo, For, onMount } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import { type FileEntry, flattenTree, buildTreeGuides, getFileIcon, computeTreeWidth } from "../lib/files"

/** Lines from viewport edge before scroll kicks in. */
const SCROLL_MARGIN = 3

interface FileTreeProps {
  /** Nested file tree entries from scanDirectory */
  files: FileEntry[]
  /** Whether the tree panel has keyboard focus */
  focused: boolean
  /** Called when a file is selected (opened) */
  onSelect: (file: FileEntry) => void
  /** Called when a directory is toggled (expand/collapse) */
  onToggle: (file: FileEntry) => void
  /** Called when the tree receives focus (e.g. via mouse click) */
  onFocus: () => void
  /** Reference to the parent scrollbox for cursor-follow scrolling */
  scrollRef?: any
  /** Available viewport height (rows visible in the scrollbox) */
  availableHeight?: number
}

const FileTree = (props: FileTreeProps) => {
  /** Index of the cursor in the flat list (keyboard-navigable) */
  const [cursor, setCursor] = createSignal(0)

  /** Index of the mouse-hovered item (-1 = no hover) */
  const [hovered, setHovered] = createSignal(-1)

  /** Flattened visible entries (only expanded directories show children) */
  const flatFiles = createMemo(() => flattenTree(props.files))

  /** Indentation guide prefixes for each flat entry */
  const guides = createMemo(() => buildTreeGuides(flatFiles()))

  /** Maximum display width needed for all visible entries */
  const maxWidth = createMemo(() => computeTreeWidth(flatFiles()))

  // -- Disable native keyboard scroll on the scrollbox --

  onMount(() => {
    setTimeout(() => {
      if (props.scrollRef) {
        props.scrollRef.handleKeyPress = () => false
      }
    }, 50)
  })

  // -- Buffer cursor scroll --

  /**
   * Scroll the parent scrollbox to keep the cursor visible, using a
   * buffer margin so the viewport only moves when the cursor approaches
   * the edges — identical logic to the code editor's scrollToCursor.
   */
  const scrollToCursor = (cursorIndex: number) => {
    const ref = props.scrollRef
    if (!ref) return

    const totalItems = flatFiles().length
    const viewHeight = props.availableHeight ?? 0
    if (viewHeight <= 0 || totalItems <= viewHeight) return

    const viewTop = ref.scrollTop || 0
    const viewBottom = viewTop + viewHeight - 1

    // Cursor jumped above viewport
    if (cursorIndex < viewTop) {
      ref.scrollTop = Math.max(0, cursorIndex - SCROLL_MARGIN)
    }
    // Cursor jumped below viewport
    else if (cursorIndex > viewBottom) {
      ref.scrollTop = Math.min(totalItems - viewHeight, cursorIndex - viewHeight + 1 + SCROLL_MARGIN)
    }
    // Cursor approaching top edge (within margin)
    else if (cursorIndex < viewTop + SCROLL_MARGIN) {
      ref.scrollTop = Math.max(0, viewTop - 1)
    }
    // Cursor approaching bottom edge (within margin)
    else if (cursorIndex > viewBottom - SCROLL_MARGIN) {
      ref.scrollTop = Math.min(totalItems - viewHeight, viewTop + 1)
    }
  }

  // -- Keyboard navigation --

  useKeyboard((key) => {
    if (!props.focused) return
    const list = flatFiles()

    // Up/Down or k/j = move cursor
    if (key.name === "up" || key.name === "k") {
      const next = Math.max(0, cursor() - 1)
      setCursor(next)
      scrollToCursor(next)
    }
    if (key.name === "down" || key.name === "j") {
      const next = Math.min(list.length - 1, cursor() + 1)
      setCursor(next)
      scrollToCursor(next)
    }

    // Enter = open file or toggle directory
    if (key.name === "return") {
      const entry = list[cursor()]
      if (!entry) return
      if (entry.isDirectory) {
        props.onToggle(entry)
        // After toggle, the list may change — re-scroll in next tick
        setTimeout(() => scrollToCursor(cursor()), 10)
      } else {
        props.onSelect(entry)
      }
    }

    // Right/l = expand collapsed directory
    if (key.name === "right" || key.name === "l") {
      const entry = list[cursor()]
      if (entry && entry.isDirectory && !entry.expanded) {
        props.onToggle(entry)
        setTimeout(() => scrollToCursor(cursor()), 10)
      }
    }

    // Left/h = collapse expanded directory
    if (key.name === "left" || key.name === "h") {
      const entry = list[cursor()]
      if (entry && entry.isDirectory && entry.expanded) {
        props.onToggle(entry)
        setTimeout(() => scrollToCursor(cursor()), 10)
      }
    }
  })

  // -- Render --

  return (
    <box flexDirection="column" width={maxWidth()} onMouseOut={() => setHovered(-1)}>
      <For each={flatFiles()}>
        {(entry, i) => {
          // Guide prefix for indentation lines
          const guide = () => guides()[i()] || ""

          // Visual state helpers
          const selected = () => i() === cursor() && props.focused
          const isHovered = () => i() === hovered()
          const isCursor = () => i() === cursor()

          // Guide line color (subtle, doesn't change with selection)
          const GUIDE_COLOR = "#454545"

          // Foreground color: selected > hovered > directory > file
          const entryFg = () => {
            if (selected()) return "#ffffff"
            if (isHovered()) return "#e8e8e8"
            if (entry.isDirectory) return "#c8a86c"
            return "#d4d4d4"
          }

          // Background color: selected (blue) > hovered/cursor (subtle) > default
          const bg = () => {
            if (selected()) return "#007acc"
            if (isHovered() || isCursor()) return "#2a2d2e"
            return "#252526"
          }

          return (
            <box
              flexDirection="row"
              backgroundColor={bg()}
              width="100%"
              onMouseOver={() => setHovered(i())}
              onMouseOut={() => {
                if (hovered() === i()) setHovered(-1)
              }}
              onMouseDown={() => {
                props.onFocus()
                setCursor(i())
                if (entry.isDirectory) props.onToggle(entry)
                else props.onSelect(entry)
              }}
            >
              {guide() ? (
                <text fg={GUIDE_COLOR} bg={bg()} wrapMode="none">
                  {guide()}
                </text>
              ) : null}
              <text fg={entryFg()} bg={bg()} wrapMode="none">
                {getFileIcon(entry) + entry.name}
              </text>
            </box>
          )
        }}
      </For>
    </box>
  )
}

export default FileTree
