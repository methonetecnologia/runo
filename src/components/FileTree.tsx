import { createSignal, createMemo, For } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import { type FileEntry, flattenTree } from "../lib/files"

interface FileTreeProps {
  files: FileEntry[]
  focused: boolean
  onSelect: (file: FileEntry) => void
  onToggle: (file: FileEntry) => void
  onFocus: () => void
}

const FileTree = (props: FileTreeProps) => {
  const [cursor, setCursor] = createSignal(0)
  const [hovered, setHovered] = createSignal(-1)

  const flatFiles = createMemo(() => flattenTree(props.files))

  const maxWidth = createMemo(() => {
    let max = 0
    for (const entry of flatFiles()) {
      const len = "  ".repeat(entry.depth).length + entry.name.length + 4
      if (len > max) max = len
    }
    return max + 1
  })

  useKeyboard((key) => {
    if (!props.focused) return
    const list = flatFiles()
    if (key.name === "up" || key.name === "k") setCursor((c) => Math.max(0, c - 1))
    if (key.name === "down" || key.name === "j") setCursor((c) => Math.min(list.length - 1, c + 1))
    if (key.name === "return") {
      const entry = list[cursor()]
      if (!entry) return
      if (entry.isDirectory) props.onToggle(entry)
      else props.onSelect(entry)
    }
    if (key.name === "right" || key.name === "l") {
      const entry = list[cursor()]
      if (entry && entry.isDirectory && !entry.expanded) props.onToggle(entry)
    }
    if (key.name === "left" || key.name === "h") {
      const entry = list[cursor()]
      if (entry && entry.isDirectory && entry.expanded) props.onToggle(entry)
    }
  })

  const getIcon = (entry: FileEntry): string => {
    if (entry.isDirectory) return entry.expanded ? "▾ " : "▸ "
    const ext = entry.name.split(".").pop() || ""
    const icons: Record<string, string> = {
      ts: "TS", tsx: "TX", js: "JS", jsx: "JX",
      json: "{}", md: "MD", css: "CS", html: "<>",
      py: "PY", rs: "RS", go: "GO", toml: "TM",
      php: "PH", sh: "SH", sql: "SQ",
    }
    return (icons[ext] || "··") + " "
  }

  return (
    <box flexDirection="column" width={maxWidth()} onMouseOut={() => setHovered(-1)}>
      <For each={flatFiles()}>
        {(entry, i) => {
          const label = "  ".repeat(entry.depth) + getIcon(entry) + entry.name
          const selected = () => i() === cursor() && props.focused
          const isHovered = () => i() === hovered()
          const isCursor = () => i() === cursor()

          const fg = () => {
            if (selected()) return "#ffffff"
            if (isHovered()) return "#e8e8e8"
            if (entry.isDirectory) return "#c8a86c"
            return "#d4d4d4"
          }

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
              onMouseOut={() => { if (hovered() === i()) setHovered(-1) }}
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
