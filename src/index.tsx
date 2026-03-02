/**
 * Main application entry point.
 *
 * Renders the full IDE layout: title bar, sidebar (file tree), resize handle,
 * editor area (tab bar + code viewer), and status bar.
 *
 * Layout (top to bottom):
 *   ┌──────────────────────────────────┐
 *   │ Title Bar (1 row)                │
 *   ├────────┬─┬───────────────────────┤
 *   │Sidebar │▏│ Tab Bar (1 row)       │
 *   │(tree)  │▏│ Code Viewer (rest)    │
 *   ├────────┴─┴───────────────────────┤
 *   │ Status Bar (1 row)               │
 *   └──────────────────────────────────┘
 */

import { render, useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/solid"
import { createSignal, createMemo, onMount, ErrorBoundary } from "solid-js"
import { basename } from "path"
import {
  scanDirectory,
  readFileContent,
  writeFileContent,
  toggleDirectory,
  gutterWidth,
  splitLines,
  type FileEntry,
} from "./lib/files"
import FileTree from "./components/FileTree"
import CodeViewer from "./components/CodeViewer"
import TabBar from "./components/TabBar"
import StatusBar from "./components/StatusBar"
import { enableScrollX } from "./lib/scrollbox"
import { preloadHighlighter } from "./lib/highlighter"
import { parseCli } from "./cli"

/** Handle CLI subcommands (upgrade, --version, --help) before TUI boot */
const cliOptions = await parseCli()

/** Start loading Shiki highlighter eagerly at boot */
preloadHighlighter()

/** Working directory used as project root */
const CWD = process.cwd()

/** If set, IDE opens in single-file mode (no sidebar, no tabs) */
const SINGLE_FILE = cliOptions.singleFile

/** Sidebar width constraints (in terminal columns) */
const MIN_SIDEBAR = 15
const MAX_SIDEBAR = 60

/** Represents an open file tab */
interface Tab {
  path: string
  name: string
  /** preview = temporary tab (italic, replaced on next file click) */
  /** pinned = persistent tab (normal text, stays open) */
  mode: "preview" | "pinned"
}

const App = () => {
  const renderer = useRenderer()
  const dimensions = useTerminalDimensions()

  /** Whether app is in single-file mode (no sidebar, no tabs) */
  const singleFileMode = SINGLE_FILE !== null

  // -- State --

  /** File tree entries (recursive structure from scanDirectory) — unused in single-file mode */
  const [files, setFiles] = createSignal(singleFileMode ? [] : scanDirectory(CWD))

  /** Which panel has keyboard focus */
  const [activePanel, setActivePanel] = createSignal<"tree" | "editor">(singleFileMode ? "editor" : "tree")

  /** Currently displayed file path (null = no file open) */
  const [openFile, setOpenFile] = createSignal<string | null>(SINGLE_FILE)

  /** Raw text content of the open file */
  const [fileContent, setFileContent] = createSignal(SINGLE_FILE ? readFileContent(SINGLE_FILE) : "")

  /** Open tabs (one per opened file) */
  const [tabs, setTabs] = createSignal<Tab[]>(
    SINGLE_FILE ? [{ path: SINGLE_FILE, name: basename(SINGLE_FILE), mode: "pinned" }] : []
  )

  /** Current sidebar width in columns (user-resizable via drag handle) */
  const [sidebarWidth, setSidebarWidth] = createSignal(30)

  /** Whether the user is actively dragging the resize handle */
  const [isDragging, setIsDragging] = createSignal(false)

  /** Whether the mouse is hovering over the resize handle */
  const [dragHover, setDragHover] = createSignal(false)

  /** Set of file paths with unsaved changes */
  const [dirtyFiles, setDirtyFiles] = createSignal<Set<string>>(new Set())

  /** Current cursor position (1-based) */
  const [cursorLine, setCursorLine] = createSignal(1)
  const [cursorCol, setCursorCol] = createSignal(1)

  // -- Derived --

  /** Total line count for the open file (used by status bar) */
  const lineCount = createMemo(() => {
    if (!openFile()) return 0
    return fileContent().split("\n").length
  })

  /** Sidebar width clamped to terminal bounds (prevents overflow) */
  const clampedSidebarWidth = createMemo(() => {
    const w = sidebarWidth()
    const termW = dimensions().width
    const max = Math.min(MAX_SIDEBAR, Math.floor(termW * 0.6))
    if (w < MIN_SIDEBAR) return MIN_SIDEBAR
    if (w > max) return max
    return w
  })

  // -- Handlers --

  /**
   * Toggles a directory's expanded/collapsed state.
   * Uses the pure toggleDirectory() from lib/files.ts for immutable updates.
   */
  const handleToggleDir = (target: FileEntry) => {
    setFiles(toggleDirectory(files(), target.path))
  }

  /**
   * Opens a file with VSCode-style preview tab logic:
   * - Single click opens as "preview" (italic tab, replaced by next preview)
   * - Double click or editing pins the tab (stays open)
   * - If the file is already open (pinned or preview), just switch to it
   */
  const handleOpenFile = (entry: FileEntry) => {
    const content = readFileContent(entry.path)
    setOpenFile(entry.path)
    setFileContent(content)
    setActivePanel("editor")

    const currentTabs = tabs()
    const existing = currentTabs.find((t) => t.path === entry.path)

    if (existing) {
      // Already open — just switch to it (don't change mode)
      return
    }

    // Replace existing preview tab with new preview, or add new preview
    const previewIndex = currentTabs.findIndex((t) => t.mode === "preview")
    if (previewIndex !== -1) {
      // Replace the old preview tab
      const updated = [...currentTabs]
      updated[previewIndex] = { path: entry.path, name: basename(entry.path), mode: "preview" }
      setTabs(updated)
    } else {
      // No preview tab exists — add a new one
      setTabs([...currentTabs, { path: entry.path, name: basename(entry.path), mode: "preview" }])
    }
  }

  /**
   * Pins the currently active tab (e.g. when user edits content or double-clicks).
   * A pinned tab won't be replaced by the next file click.
   */
  const pinTab = (path: string) => {
    setTabs(tabs().map((t) => (t.path === path ? { ...t, mode: "pinned" as const } : t)))
  }

  /**
   * Closes a tab by path. If closing the active tab, switch to the nearest neighbor.
   */
  const closeTab = (path: string) => {
    const currentTabs = tabs()
    const index = currentTabs.findIndex((t) => t.path === path)
    if (index === -1) return

    const newTabs = currentTabs.filter((t) => t.path !== path)
    setTabs(newTabs)

    // If we closed the active tab, switch to a neighbor or clear
    if (openFile() === path) {
      if (newTabs.length === 0) {
        setOpenFile(null)
        setFileContent("")
      } else {
        // Prefer the tab at the same index, or the last one
        const nextIndex = Math.min(index, newTabs.length - 1)
        const nextTab = newTabs[nextIndex]
        const content = readFileContent(nextTab.path)
        setOpenFile(nextTab.path)
        setFileContent(content)
      }
    }
  }

  /**
   * Switches to a tab by path (clicking on a tab in the tab bar).
   */
  const switchTab = (path: string) => {
    if (openFile() === path) return
    const content = readFileContent(path)
    setOpenFile(path)
    setFileContent(content)
    setActivePanel("editor")
  }

  const handleContentChange = (newContent: string) => {
    setFileContent(newContent)
    const path = openFile()
    if (path) {
      const updated = new Set(dirtyFiles())
      updated.add(path)
      setDirtyFiles(updated)
      // Auto-pin the tab when editing
      pinTab(path)
    }
  }

  const saveFile = () => {
    const path = openFile()
    if (!path) return
    const success = writeFileContent(path, fileContent())
    if (success) {
      const updated = new Set(dirtyFiles())
      updated.delete(path)
      setDirtyFiles(updated)
    }
  }

  /** Whether the current file has unsaved changes */
  const isCurrentFileDirty = () => {
    const path = openFile()
    if (!path) return false
    return dirtyFiles().has(path)
  }

  // -- Scrollbox setup --

  /** Ref to the sidebar scrollbox (assigned post-mount via ref={} prop) */
  let sidebarScrollRef: any

  onMount(() => {
    // Post-mount patch: enable horizontal scrolling on sidebar (skip in single-file mode)
    if (!singleFileMode) {
      setTimeout(() => enableScrollX(sidebarScrollRef), 50)
    }
  })

  // -- Keyboard shortcuts --

  useKeyboard((key) => {
    // Tab = switch focus between tree and editor (disabled in single-file mode)
    if (key.name === "tab" && !singleFileMode) {
      setActivePanel((p) => (p === "tree" ? "editor" : "tree"))
    }

    // Ctrl+C = exit
    if (key.ctrl && key.name === "c") {
      renderer.destroy()
    }

    // Ctrl+S = save current file
    if (key.ctrl && key.name === "s") {
      saveFile()
    }

    // Ctrl+W = close active tab
    if (key.ctrl && key.name === "w") {
      const active = openFile()
      if (active) closeTab(active)
    }

    // Shift+Arrow = horizontal/vertical scroll on sidebar when focused
    if (activePanel() === "tree" && sidebarScrollRef && key.shift) {
      if (key.name === "left" || key.name === "right") {
        const delta = key.name === "right" ? 3 : -3
        sidebarScrollRef.scrollBy({ x: delta, y: 0 })
      }
      if (key.name === "up" || key.name === "down") {
        const delta = key.name === "down" ? 3 : -3
        sidebarScrollRef.scrollBy({ x: delta, y: 0 })
      }
    }
  })

  // -- Drag handle color (visual feedback for resize border) --

  const borderHandleColor = () => {
    if (isDragging()) return "#007acc"
    if (dragHover()) return "#4d9fd6"
    return "#3c3c3c"
  }

  // -- Render --

  // Single-file mode: no sidebar, no tabs — just title bar + editor + status bar
  if (singleFileMode) {
    return (
      <box flexDirection="column" width="100%" height="100%" backgroundColor="#1e1e1e">
        {/* Title bar: file path + terminal dimensions */}
        <box width="100%" height={1} backgroundColor="#323233">
          <text fg="#cccccc" bg="#323233" attributes={1}>
            {` ${basename(SINGLE_FILE!)} - ${SINGLE_FILE!} `}
          </text>
          <box flexGrow={1} backgroundColor="#323233" />
          <text fg="#666666" bg="#323233">
            {` ${dimensions().width}x${dimensions().height} `}
          </text>
        </box>

        {/* Editor at full width */}
        <box flexDirection="column" flexGrow={1} width="100%" height="100%">
          <ErrorBoundary
            fallback={(err: Error) => (
              <box flexGrow={1} justifyContent="center" alignItems="center" backgroundColor="#1e1e1e">
                <text fg="#f44747">Editor error: {err.message}</text>
              </box>
            )}
          >
            <CodeViewer
              filePath={openFile()}
              content={fileContent()}
              focused={true}
              availableWidth={dimensions().width}
              availableHeight={dimensions().height - 2}
              codeStartX={gutterWidth(splitLines(fileContent()).length) + 1}
              onContentChange={handleContentChange}
              onCursorChange={(ln, col) => {
                setCursorLine(ln)
                setCursorCol(col)
              }}
            />
          </ErrorBoundary>
        </box>

        {/* Status bar */}
        <StatusBar
          filePath={openFile()}
          panel={"editor"}
          lineCount={lineCount()}
          cursorLine={cursorLine()}
          cursorCol={cursorCol()}
          isDirty={isCurrentFileDirty()}
        />
      </box>
    )
  }

  // Full IDE mode: sidebar + tabs + editor
  return (
    <box flexDirection="column" width="100%" height="100%" backgroundColor="#1e1e1e">
      {/* Title bar: project path + terminal dimensions */}
      <box width="100%" height={1} backgroundColor="#323233">
        <text fg="#cccccc" bg="#323233" attributes={1}>
          {` Runo - ${CWD} `}
        </text>
        <box flexGrow={1} backgroundColor="#323233" />
        <text fg="#666666" bg="#323233">
          {` ${dimensions().width}x${dimensions().height} `}
        </text>
      </box>

      {/* Main area: sidebar + resize handle + editor */}
      <box flexDirection="row" flexGrow={1} width="100%">
        {/* Sidebar: explorer header + scrollable file tree */}
        <box
          flexDirection="column"
          width={clampedSidebarWidth()}
          height="100%"
          backgroundColor="#252526"
          onMouseDown={() => setActivePanel("tree")}
        >
          <box width="100%" height={1} backgroundColor="#252526">
            <text fg="#bbbbbb" bg="#252526" attributes={1}>
              {" EXPLORER"}
            </text>
          </box>
          <ErrorBoundary
            fallback={(err: Error) => (
              <box flexGrow={1} backgroundColor="#252526">
                <text fg="#f44747">Tree error: {err.message}</text>
              </box>
            )}
          >
            <scrollbox
              ref={sidebarScrollRef}
              flexGrow={1}
              width="100%"
              focused={activePanel() === "tree"}
              scrollX={true}
              scrollY={true}
            >
              <FileTree
                files={files()}
                focused={activePanel() === "tree"}
                onSelect={handleOpenFile}
                onToggle={handleToggleDir}
                onFocus={() => setActivePanel("tree")}
              />
            </scrollbox>
          </ErrorBoundary>
        </box>

        {/* Resize handle: 1-column draggable border between sidebar and editor */}
        <box
          width={1}
          height="100%"
          backgroundColor={borderHandleColor()}
          onMouseOver={() => setDragHover(true)}
          onMouseOut={() => {
            setDragHover(false)
          }}
          onMouseDown={() => {
            setIsDragging(true)
          }}
          onMouseUp={() => {
            setIsDragging(false)
          }}
          onMouseDrag={(e: any) => {
            setIsDragging(true)
            const newWidth = e.x
            if (newWidth >= MIN_SIDEBAR && newWidth <= MAX_SIDEBAR) {
              setSidebarWidth(newWidth)
            }
          }}
          onMouseDragEnd={() => {
            setIsDragging(false)
          }}
        />

        {/* Editor area: tab bar + code viewer */}
        <box flexDirection="column" flexGrow={1} height="100%" onMouseDown={() => setActivePanel("editor")}>
          <TabBar
            tabs={tabs()}
            activeTab={openFile()}
            dirtyFiles={dirtyFiles()}
            onSelect={switchTab}
            onClose={closeTab}
            onPin={pinTab}
          />
          <ErrorBoundary
            fallback={(err: Error) => (
              <box flexGrow={1} justifyContent="center" alignItems="center" backgroundColor="#1e1e1e">
                <text fg="#f44747">Editor error: {err.message}</text>
              </box>
            )}
          >
            <CodeViewer
              filePath={openFile()}
              content={fileContent()}
              focused={activePanel() === "editor"}
              availableWidth={dimensions().width - clampedSidebarWidth() - 1}
              availableHeight={dimensions().height - 3}
              codeStartX={clampedSidebarWidth() + 1 + gutterWidth(splitLines(fileContent()).length) + 1}
              onContentChange={handleContentChange}
              onCursorChange={(ln, col) => {
                setCursorLine(ln)
                setCursorCol(col)
              }}
            />
          </ErrorBoundary>
        </box>
      </box>

      {/* Status bar */}
      <StatusBar
        filePath={openFile()}
        panel={activePanel()}
        lineCount={lineCount()}
        cursorLine={cursorLine()}
        cursorCol={cursorCol()}
        isDirty={isCurrentFileDirty()}
      />
    </box>
  )
}

/** Render with OpenTUI runtime options */
render(App, {
  targetFps: 30,
  exitOnCtrlC: true,
  useMouse: true,
  enableMouseMovement: true,
  consoleOptions: {
    sizePercent: 0,
  },
})
