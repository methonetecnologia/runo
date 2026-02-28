import { render, useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/solid"
import { createSignal, createMemo, onMount } from "solid-js"
import { basename } from "path"
import { scanDirectory, readFileContent, FileEntry } from "./lib/files"
import FileTree from "./components/FileTree"
import CodeViewer from "./components/CodeViewer"
import TabBar from "./components/TabBar"
import StatusBar from "./components/StatusBar"
import { enableScrollX } from "./lib/scrollbox"

const CWD = process.cwd()

const MIN_SIDEBAR = 15
const MAX_SIDEBAR = 60

interface Tab {
  path: string
  name: string
}

const App = () => {
  const renderer = useRenderer()
  const dimensions = useTerminalDimensions()

  // State
  const [files, setFiles] = createSignal(scanDirectory(CWD))
  const [activePanel, setActivePanel] = createSignal<"tree" | "editor">("tree")
  const [openFile, setOpenFile] = createSignal<string | null>(null)
  const [fileContent, setFileContent] = createSignal("")
  const [tabs, setTabs] = createSignal<Tab[]>([])
  const [sidebarWidth, setSidebarWidth] = createSignal(30)
  const [isDragging, setIsDragging] = createSignal(false)
  const [dragHover, setDragHover] = createSignal(false)

  const lineCount = createMemo(() => {
    if (!openFile()) return 0
    return fileContent().split("\n").length
  })

  // Clamp sidebar width to terminal bounds
  const clampedSidebarWidth = createMemo(() => {
    const w = sidebarWidth()
    const termW = dimensions().width
    const max = Math.min(MAX_SIDEBAR, Math.floor(termW * 0.6))
    if (w < MIN_SIDEBAR) return MIN_SIDEBAR
    if (w > max) return max
    return w
  })

  // Toggle directory expand/collapse
  const toggleDir = (target: FileEntry) => {
    const toggle = (entries: FileEntry[]): FileEntry[] => {
      const result: FileEntry[] = []
      for (const entry of entries) {
        if (entry.path === target.path) {
          result.push({ ...entry, expanded: !entry.expanded })
        } else if (entry.children) {
          result.push({ ...entry, children: toggle(entry.children) })
        } else {
          result.push(entry)
        }
      }
      return result
    }
    setFiles(toggle(files()))
  }

  // Open a file
  const openFileHandler = (entry: FileEntry) => {
    const content = readFileContent(entry.path)
    setOpenFile(entry.path)
    setFileContent(content)
    setActivePanel("editor")

    const existing = tabs().find((t) => t.path === entry.path)
    if (!existing) {
      setTabs([...tabs(), { path: entry.path, name: basename(entry.path) }])
    }
  }

  let sidebarScrollRef: any

  onMount(() => {
    setTimeout(() => enableScrollX(sidebarScrollRef), 50)
  })

  // Keyboard
  useKeyboard((key) => {
    if (key.name === "tab") {
      setActivePanel((p) => (p === "tree" ? "editor" : "tree"))
    }
    if (key.ctrl && key.name === "c") {
      renderer.destroy()
    }
    // Shift+arrow = horizontal scroll on sidebar
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

  // Drag border color
  const borderHandleColor = () => {
    if (isDragging()) return "#007acc"
    if (dragHover()) return "#4d9fd6"
    return "#3c3c3c"
  }

  return (
    <box
      flexDirection="column"
      width="100%"
      height="100%"
      backgroundColor="#1e1e1e"
    >
      {/* Title bar */}
      <box width="100%" height={1} backgroundColor="#323233">
        <text fg="#cccccc" bg="#323233" attributes={1}>
          {` Mini IDE - ${CWD} `}
        </text>
        <box flexGrow={1} backgroundColor="#323233" />
        <text fg="#666666" bg="#323233">
          {` ${dimensions().width}x${dimensions().height} `}
        </text>
      </box>

      {/* Main area */}
      <box flexDirection="row" flexGrow={1} width="100%">
        {/* Sidebar */}
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
              onSelect={openFileHandler}
              onToggle={toggleDir}
              onFocus={() => setActivePanel("tree")}
            />
          </scrollbox>
        </box>

        {/* Drag handle (resize border) */}
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

        {/* Editor area */}
        <box
          flexDirection="column"
          flexGrow={1}
          height="100%"
          onMouseDown={() => setActivePanel("editor")}
        >
          <TabBar tabs={tabs()} activeTab={openFile()} />
          <CodeViewer filePath={openFile()} content={fileContent()} focused={activePanel() === "editor"} availableWidth={dimensions().width - clampedSidebarWidth() - 1} availableHeight={dimensions().height - 3} />
        </box>
      </box>

      {/* Status bar */}
      <StatusBar
        filePath={openFile()}
        panel={activePanel()}
        lineCount={lineCount()}
      />
    </box>
  )
}

render(App, {
  targetFps: 30,
  exitOnCtrlC: true,
  useMouse: true,
  enableMouseMovement: true,
  consoleOptions: {
    sizePercent: 0,
  },
})
