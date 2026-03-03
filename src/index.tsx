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
import { createSignal, createMemo, onMount, Show, ErrorBoundary, batch } from "solid-js"
import { basename } from "path"
import {
  scanDirectory,
  readFileContent,
  writeFileContent,
  toggleDirectory,
  gutterWidth,
  splitLines,
  isBinaryFile,
  type FileEntry,
} from "./lib/files"
import FileTree from "./components/FileTree"
import CodeViewer, { type CodeViewerHandle } from "./components/CodeViewer"
import { type HistoryState } from "./hooks/useHistory"
import TabBar from "./components/TabBar"
import StatusBar from "./components/StatusBar"
import TitleBar from "./components/TitleBar"
import UnsavedModal from "./components/UnsavedModal"
import { enableScrollX } from "./lib/scrollbox"
import { preloadHighlighter } from "./lib/highlighter"
import { parseCli } from "./cli"
import { log } from "./lib/logger"
// @ts-ignore — JSON import for version
import pkg from "../package.json"

/** Handle CLI subcommands (upgrade, --version, --help) before TUI boot */
const cliOptions = await parseCli()

/** Start loading Shiki highlighter eagerly at boot */
preloadHighlighter()

/** Working directory used as project root */
const CWD = process.cwd()

/** If set, IDE opens in single-file mode (no sidebar, no tabs) */
const SINGLE_FILE = cliOptions.singleFile

/** Block binary files in single-file mode */
if (SINGLE_FILE && isBinaryFile(SINGLE_FILE)) {
  console.error(`Error: "${SINGLE_FILE}" is a binary file and cannot be opened in Runo.`)
  process.exit(1)
}

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

  /** Whether the sidebar is visible (toggled via Ctrl+B or View > Toggle Sidebar) */
  const [sidebarVisible, setSidebarVisible] = createSignal(!singleFileMode)

  /** Current sidebar width in columns (user-resizable via drag handle) */
  const [sidebarWidth, setSidebarWidth] = createSignal(30)

  /** Whether the user is actively dragging the resize handle */
  const [isDragging, setIsDragging] = createSignal(false)

  /** Whether the mouse is hovering over the resize handle */
  const [dragHover, setDragHover] = createSignal(false)

  /** Set of file paths with unsaved changes */
  const [dirtyFiles, setDirtyFiles] = createSignal<Set<string>>(new Set())

  /** Per-tab cache — preserves unsaved content, cursor position, scroll offset, and undo/redo history */
  interface TabCache {
    content: string
    cursorRow: number
    cursorCol: number
    scrollTop: number
    scrollLeft: number
    historyState: HistoryState | null
  }
  const [tabCache, setTabCache] = createSignal<Map<string, TabCache>>(new Map())

  /** Pending close action waiting for user confirmation via UnsavedModal */
  type PendingAction = { type: "closeTab"; path: string } | { type: "quit" } | null
  const [pendingAction, setPendingAction] = createSignal<PendingAction>(null)

  /** Current cursor position (1-based) */
  const [cursorLine, setCursorLine] = createSignal(1)
  const [cursorCol, setCursorCol] = createSignal(1)

  // -- Derived --

  /** Total line count for the open file (used by status bar) */
  const lineCount = createMemo(() => {
    if (!openFile()) return 0
    return fileContent().split("\n").length
  })

  /** Cached cursor/scroll state for the currently active file (used as initial props for CodeViewer) */
  const activeTabCache = createMemo(() => tabCache().get(openFile() ?? "") ?? null)

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
  /** Save the current tab's full state (content, cursor, scroll, history) into the cache */
  const saveCurrentTabState = () => {
    const currentPath = openFile()
    if (!currentPath) return
    const handle = editorHandle()
    const scrollPos = handle?.getScrollPosition() ?? { scrollTop: 0, scrollLeft: 0 }
    const cursorPos = handle?.getCursorPosition() ?? { row: 0, col: 0 }
    const historyState = handle?.getHistoryState() ?? null
    const cache = new Map(tabCache())
    cache.set(currentPath, {
      content: fileContent(),
      cursorRow: cursorPos.row,
      cursorCol: cursorPos.col,
      scrollTop: scrollPos.scrollTop,
      scrollLeft: scrollPos.scrollLeft,
      historyState,
    })
    setTabCache(cache)
  }

  const handleOpenFile = (entry: FileEntry) => {
    if (entry.isDirectory) return
    if (entry.path === openFile()) return
    log.app.info({ path: entry.path }, "openFile")

    // Save current tab state before switching
    saveCurrentTabState()

    // Use cached content if available (preserves unsaved edits), otherwise read from disk
    const cached = tabCache().get(entry.path)
    const content = cached !== undefined ? cached.content : readFileContent(entry.path)

    batch(() => {
      setOpenFile(entry.path)
      setFileContent(content)
      setActivePanel("editor")

      const currentTabs = tabs()
      const existing = currentTabs.find((t) => t.path === entry.path)

      if (existing) return

      // Replace existing preview tab with new preview, or add new preview
      const previewIndex = currentTabs.findIndex((t) => t.mode === "preview")
      if (previewIndex !== -1) {
        const updated = [...currentTabs]
        updated[previewIndex] = { path: entry.path, name: basename(entry.path), mode: "preview" }
        setTabs(updated)
      } else {
        setTabs([...currentTabs, { path: entry.path, name: basename(entry.path), mode: "preview" }])
      }
    })
  }

  /**
   * Pins the currently active tab (e.g. when user edits content or double-clicks).
   * A pinned tab won't be replaced by the next file click.
   */
  const pinTab = (path: string) => {
    setTabs(tabs().map((t) => (t.path === path ? { ...t, mode: "pinned" as const } : t)))
  }

  /**
   * Force-closes a tab by path (no dirty check). Cleans up cache.
   * If closing the active tab, switch to the nearest neighbor.
   */
  const forceCloseTab = (path: string) => {
    const currentTabs = tabs()
    const index = currentTabs.findIndex((t) => t.path === path)
    if (index === -1) return

    const newTabs = currentTabs.filter((t) => t.path !== path)

    batch(() => {
      setTabs(newTabs)

      // Clean up dirty state and cache for this file
      const updatedDirty = new Set(dirtyFiles())
      updatedDirty.delete(path)
      setDirtyFiles(updatedDirty)

      const cache = new Map(tabCache())
      cache.delete(path)
      setTabCache(cache)

      // If we closed the active tab, switch to a neighbor or clear
      if (openFile() === path) {
        if (newTabs.length === 0) {
          setOpenFile(null)
          setFileContent("")
        } else {
          const nextIndex = Math.min(index, newTabs.length - 1)
          const nextTab = newTabs[nextIndex]
          // Load from cache if available, otherwise from disk
          const cached = cache.get(nextTab.path)
          const content = cached !== undefined ? cached.content : readFileContent(nextTab.path)
          setOpenFile(nextTab.path)
          setFileContent(content)
        }
      }
    })
  }

  /**
   * Request to close a tab. If the file has unsaved changes, shows the
   * confirmation modal instead of closing immediately.
   */
  const requestCloseTab = (path: string) => {
    if (dirtyFiles().has(path)) {
      setPendingAction({ type: "closeTab", path })
    } else {
      forceCloseTab(path)
    }
  }

  /**
   * Request to exit the editor. If any files have unsaved changes,
   * shows the confirmation modal.
   */
  const requestExit = () => {
    if (dirtyFiles().size > 0) {
      setPendingAction({ type: "quit" })
    } else {
      renderer.destroy()
    }
  }

  /**
   * Switches to a tab by path (clicking on a tab in the tab bar).
   * Saves current content to cache before switching, loads from cache if available.
   */
  const switchTab = (path: string) => {
    if (openFile() === path) return
    log.app.info({ path }, "switchTab")

    // Save current tab state before switching
    saveCurrentTabState()

    // Load from cache if available, otherwise from disk
    const cached = tabCache().get(path)
    const content = cached !== undefined ? cached.content : readFileContent(path)

    batch(() => {
      setOpenFile(path)
      setFileContent(content)
      setActivePanel("editor")
    })
  }

  const handleContentChange = (newContent: string) => {
    log.app.debug({ contentLen: newContent.length }, "handleContentChange")
    setFileContent(newContent)
    const path = openFile()
    if (path) {
      const updated = new Set(dirtyFiles())
      updated.add(path)
      setDirtyFiles(updated)

      // Update content in tab cache (keep existing cursor/scroll/history or use defaults)
      const cache = new Map(tabCache())
      const existing = cache.get(path)
      cache.set(path, {
        content: newContent,
        cursorRow: existing?.cursorRow ?? 0,
        cursorCol: existing?.cursorCol ?? 0,
        scrollTop: existing?.scrollTop ?? 0,
        scrollLeft: existing?.scrollLeft ?? 0,
        historyState: existing?.historyState ?? null,
      })
      setTabCache(cache)

      // Auto-pin the tab when editing
      pinTab(path)
    }
  }

  /** Save a specific file path (uses cached content if not the active file) */
  const saveFilePath = (path: string): boolean => {
    log.app.info({ path }, "saveFile")
    const cached = tabCache().get(path)
    const content = path === openFile() ? fileContent() : cached?.content
    if (content === undefined) return false
    const success = writeFileContent(path, content)
    if (success) {
      const updatedDirty = new Set(dirtyFiles())
      updatedDirty.delete(path)
      setDirtyFiles(updatedDirty)

      const cache = new Map(tabCache())
      cache.delete(path)
      setTabCache(cache)
    }
    return success
  }

  /** Save the currently open file */
  const saveFile = () => {
    const path = openFile()
    if (!path) return
    saveFilePath(path)
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
    // Disable native OpenTUI text selection globally — only the CodeViewer's
    // custom selection system should allow selecting text.
    if ((renderer as any).startSelection) {
      ;(renderer as any).startSelection = () => {}
    }

    // Post-mount patch: enable horizontal scrolling on sidebar (skip in single-file mode)
    if (!singleFileMode) {
      setTimeout(() => enableScrollX(sidebarScrollRef), 50)
    }
  })

  // -- Tab navigation helpers (used by keyboard shortcuts and TitleBar menus) --

  const switchToNextTab = () => {
    const t = tabs()
    if (t.length > 1) {
      const idx = t.findIndex((tab) => tab.path === openFile())
      const next = t[(idx + 1) % t.length]
      if (next) switchTab(next.path)
    }
  }

  const switchToPrevTab = () => {
    const t = tabs()
    if (t.length > 1) {
      const idx = t.findIndex((tab) => tab.path === openFile())
      const prev = t[(idx - 1 + t.length) % t.length]
      if (prev) switchTab(prev.path)
    }
  }

  const toggleSidebar = () => {
    setSidebarVisible((v) => {
      if (v) {
        // Hiding sidebar — move focus to editor
        setActivePanel("editor")
        return false
      }
      // Showing sidebar — move focus to tree
      setActivePanel("tree")
      return true
    })
  }

  // -- Keyboard shortcuts --

  useKeyboard((key) => {
    // Close About modal on Escape
    if (key.name === "escape" && showAbout()) {
      setShowAbout(false)
      return
    }

    // Block all other shortcuts while About or UnsavedModal is open
    if (showAbout()) return
    if (pendingAction() !== null) return

    // Ctrl+B = switch focus between tree and editor (disabled in single-file mode)
    if (key.ctrl && key.name === "b" && !singleFileMode) {
      toggleSidebar()
    }

    // Ctrl+Q = exit (with unsaved changes check)
    if (key.ctrl && key.name === "q") {
      requestExit()
    }

    // Ctrl+S = save current file
    if (key.ctrl && key.name === "s") {
      saveFile()
    }

    // Ctrl+W = close active tab
    if (key.ctrl && key.name === "w") {
      const active = openFile()
      if (active) requestCloseTab(active)
    }

    // Ctrl+PageDown = next tab
    if (key.ctrl && key.name === "pagedown") {
      switchToNextTab()
    }

    // Ctrl+PageUp = previous tab
    if (key.ctrl && key.name === "pageup") {
      switchToPrevTab()
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

  // -- CodeViewer imperative handle (undo/redo) --
  const [editorHandle, setEditorHandle] = createSignal<CodeViewerHandle | null>(null)

  // -- About modal state --
  const [showAbout, setShowAbout] = createSignal(false)

  const AboutModal = () => {
    const w = 40
    const h = 9
    const left = () => Math.max(0, Math.floor((dimensions().width - w) / 2))
    const top = () => Math.max(0, Math.floor((dimensions().height - h) / 2))

    return (
      <Show when={showAbout()}>
        {/* Backdrop */}
        <box
          position="absolute"
          left={0}
          top={0}
          width="100%"
          height="100%"
          zIndex={199}
          onMouseDown={() => setShowAbout(false)}
        />
        {/* Modal */}
        <box
          position="absolute"
          left={left()}
          top={top()}
          width={w}
          height={h}
          zIndex={200}
          flexDirection="column"
          backgroundColor="#252526"
          border
          borderStyle="single"
          borderColor="#007acc"
          alignItems="center"
          justifyContent="center"
        >
          <text fg="#007acc" attributes={1}>
            Runo
          </text>
          <text fg="#cccccc" marginTop={1}>
            Terminal Code Editor
          </text>
          <text fg="#999999" marginTop={1}>
            Version {pkg.version}
          </text>
          <text fg="#666666" marginTop={1}>
            Press Escape to close
          </text>
        </box>
      </Show>
    )
  }

  // -- Unsaved changes modal --

  /** Build the modal message based on the pending action */
  const unsavedModalMessage = () => {
    const action = pendingAction()
    if (!action) return ""
    if (action.type === "closeTab") {
      return `"${basename(action.path)}" has unsaved changes.`
    }
    // quit — count all dirty files
    const count = dirtyFiles().size
    if (count === 1) {
      const path = [...dirtyFiles()][0]
      return `"${basename(path)}" has unsaved changes.`
    }
    return `${count} files have unsaved changes.`
  }

  /** Save handler for the modal */
  const handleModalSave = () => {
    const action = pendingAction()
    if (!action) return
    setPendingAction(null)

    if (action.type === "closeTab") {
      saveFilePath(action.path)
      forceCloseTab(action.path)
    } else {
      // quit — save all dirty files
      for (const path of dirtyFiles()) {
        saveFilePath(path)
      }
      renderer.destroy()
    }
  }

  /** Discard handler for the modal */
  const handleModalDiscard = () => {
    const action = pendingAction()
    if (!action) return
    setPendingAction(null)

    if (action.type === "closeTab") {
      forceCloseTab(action.path)
    } else {
      // quit — discard all, just exit
      renderer.destroy()
    }
  }

  /** Cancel handler for the modal */
  const handleModalCancel = () => {
    setPendingAction(null)
  }

  // -- Render --

  // Single-file mode: no sidebar, no tabs — just title bar + editor + status bar
  if (singleFileMode) {
    return (
      <box flexDirection="column" width="100%" height="100%" backgroundColor="#1e1e1e">
        <TitleBar
          titlePath={SINGLE_FILE!}
          termWidth={dimensions().width}
          termHeight={dimensions().height}
          onExit={requestExit}
          onSave={saveFile}
          onUndo={() => {
            const h = editorHandle()
            if (h) h.undo()
          }}
          onRedo={() => {
            const h = editorHandle()
            if (h) h.redo()
          }}
          onAbout={() => setShowAbout(true)}
          singleFileMode={true}
        />

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
              codeStartY={1}
              onContentChange={handleContentChange}
              onCursorChange={(ln, col) => {
                setCursorLine(ln)
                setCursorCol(col)
              }}
              onHandle={setEditorHandle}
              initialCursorRow={activeTabCache()?.cursorRow}
              initialCursorCol={activeTabCache()?.cursorCol}
              initialScrollTop={activeTabCache()?.scrollTop}
              initialScrollLeft={activeTabCache()?.scrollLeft}
              initialHistoryState={activeTabCache()?.historyState}
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

        <AboutModal />
        <UnsavedModal
          open={pendingAction() !== null}
          message={unsavedModalMessage()}
          onSave={handleModalSave}
          onDiscard={handleModalDiscard}
          onCancel={handleModalCancel}
        />
      </box>
    )
  }

  // Full IDE mode: sidebar + tabs + editor
  return (
    <box flexDirection="column" width="100%" height="100%" backgroundColor="#1e1e1e">
      <TitleBar
        titlePath={CWD}
        termWidth={dimensions().width}
        termHeight={dimensions().height}
        onExit={requestExit}
        onSave={saveFile}
        onCloseTab={() => {
          const active = openFile()
          if (active) requestCloseTab(active)
        }}
        onToggleSidebar={toggleSidebar}
        onNextTab={switchToNextTab}
        onPrevTab={switchToPrevTab}
        onUndo={() => {
          const h = editorHandle()
          if (h) h.undo()
        }}
        onRedo={() => {
          const h = editorHandle()
          if (h) h.redo()
        }}
        onAbout={() => setShowAbout(true)}
      />

      {/* Main area: sidebar + resize handle + editor */}
      <box flexDirection="row" flexGrow={1} width="100%">
        {/* Sidebar: explorer header + scrollable file tree */}
        <box
          flexDirection="column"
          width={sidebarVisible() ? clampedSidebarWidth() : 0}
          height="100%"
          backgroundColor="#252526"
          onMouseDown={() => setActivePanel("tree")}
        >
          <Show when={sidebarVisible()}>
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
                  scrollRef={sidebarScrollRef}
                  availableHeight={dimensions().height - 3}
                />
              </scrollbox>
            </ErrorBoundary>
          </Show>
        </box>

        {/* Resize handle: 1-column draggable border between sidebar and editor */}
        <box
          width={sidebarVisible() ? 1 : 0}
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
            onClose={requestCloseTab}
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
              codeStartY={2}
              onContentChange={handleContentChange}
              onCursorChange={(ln, col) => {
                setCursorLine(ln)
                setCursorCol(col)
              }}
              onHandle={setEditorHandle}
              initialCursorRow={activeTabCache()?.cursorRow}
              initialCursorCol={activeTabCache()?.cursorCol}
              initialScrollTop={activeTabCache()?.scrollTop}
              initialScrollLeft={activeTabCache()?.scrollLeft}
              initialHistoryState={activeTabCache()?.historyState}
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

      <AboutModal />
      <UnsavedModal
        open={pendingAction() !== null}
        message={unsavedModalMessage()}
        onSave={handleModalSave}
        onDiscard={handleModalDiscard}
        onCancel={handleModalCancel}
      />
    </box>
  )
}

/** Render with OpenTUI runtime options */
render(App, {
  targetFps: 30,
  exitOnCtrlC: false,
  useMouse: true,
  enableMouseMovement: true,
  consoleOptions: {
    sizePercent: 0,
  },
})
