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
 *
 * The tree width is computed dynamically via computeTreeWidth() so the
 * scrollbox parent can determine content width for horizontal scrolling.
 */

import { createSignal, createMemo, For } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import { type FileEntry, flattenTree, getFileIcon, computeTreeWidth } from "../lib/files"

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
}

const FileTree = (props: FileTreeProps) => {
  /** Index of the cursor in the flat list (keyboard-navigable) */
  const [cursor, setCursor] = createSignal(0)

  /** Index of the mouse-hovered item (-1 = no hover) */
  const [hovered, setHovered] = createSignal(-1)

  /** Flattened visible entries (only expanded directories show children) */
  const flatFiles = createMemo(() => flattenTree(props.files))

  /** Maximum display width needed for all visible entries */
  const maxWidth = createMemo(() => computeTreeWidth(flatFiles()))

  // -- Keyboard navigation --

  useKeyboard((key) => {
    if (!props.focused) return
    const list = flatFiles()

    // Up/Down or k/j = move cursor
    if (key.name === "up" || key.name === "k") setCursor((c) => Math.max(0, c - 1))
    if (key.name === "down" || key.name === "j") setCursor((c) => Math.min(list.length - 1, c + 1))

    // Enter = open file or toggle directory
    if (key.name === "return") {
      const entry = list[cursor()]
      if (!entry) return
      if (entry.isDirectory) props.onToggle(entry)
      else props.onSelect(entry)
    }

    // Right/l = expand collapsed directory
    if (key.name === "right" || key.name === "l") {
      const entry = list[cursor()]
      if (entry && entry.isDirectory && !entry.expanded) props.onToggle(entry)
    }

    // Left/h = collapse expanded directory
    if (key.name === "left" || key.name === "h") {
      const entry = list[cursor()]
      if (entry && entry.isDirectory && entry.expanded) props.onToggle(entry)
    }
  })

  // -- Render --

  return (
    <box flexDirection="column" width={maxWidth()} onMouseOut={() => setHovered(-1)}>
      <For each={flatFiles()}>
        {(entry, i) => {
          // Build display label: indentation + icon + filename
          const label = "  ".repeat(entry.depth) + getFileIcon(entry) + entry.name

          // Visual state helpers
          const selected = () => i() === cursor() && props.focused
          const isHovered = () => i() === hovered()
          const isCursor = () => i() === cursor()

          // Foreground color: selected > hovered > directory > file
          const fg = () => {
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
            <text
              fg={fg()}
              bg={bg()}
              wrapMode="none"
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
              {label}
            </text>
          )
        }}
      </For>
    </box>
  )
}

export default FileTree
