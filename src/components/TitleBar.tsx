/**
 * VS Code-inspired title bar with menu dropdowns.
 *
 * Layout:
 *   [ Runo ]  File  Edit  View  Help    fileName - project    WxH  [✕]
 *
 * - "Runo" badge with blue background (like VS Code logo area)
 * - Menu labels that open dropdown overlays on click
 * - Centered title showing active file and project name
 * - Terminal dimensions on the right
 * - Close button (✕) with red hover, calls onExit
 */

import { createSignal, Show } from "solid-js"
import MenuDropdown, { type MenuItem } from "./MenuDropdown"

interface TitleBarProps {
  /** Absolute path to display in the title bar (CWD or single file path) */
  titlePath: string
  /** Terminal width */
  termWidth: number
  /** Terminal height */
  termHeight: number
  /** Called to exit the application */
  onExit: () => void

  // -- Menu action callbacks --
  onSave?: () => void
  onCloseTab?: () => void
  onToggleSidebar?: () => void
  onNextTab?: () => void
  onPrevTab?: () => void
  onUndo?: () => void
  onRedo?: () => void
  onAbout?: () => void
  /** Whether we're in single-file mode (hides some menu items) */
  singleFileMode?: boolean
}

const TitleBar = (props: TitleBarProps) => {
  const [openMenu, setOpenMenu] = createSignal<string | null>(null)
  const [closeHover, setCloseHover] = createSignal(false)
  const [hoveredLabel, setHoveredLabel] = createSignal<string | null>(null)

  // -- Menu definitions --

  const fileItems = (): MenuItem[] => {
    const items: MenuItem[] = []
    if (props.onSave) {
      items.push({ label: "Save", shortcut: "Ctrl+S", action: props.onSave })
    }
    if (props.onCloseTab && !props.singleFileMode) {
      items.push({ label: "Close Tab", shortcut: "Ctrl+W", action: props.onCloseTab })
    }
    if (items.length > 0) {
      items.push({ label: "", separator: true })
    }
    items.push({ label: "Exit", shortcut: "Ctrl+C", action: props.onExit })
    return items
  }

  const editItems = (): MenuItem[] => [
    { label: "Undo", shortcut: "Ctrl+Z", action: props.onUndo },
    { label: "Redo", shortcut: "Ctrl+Y", action: props.onRedo },
  ]

  const viewItems = (): MenuItem[] => {
    const items: MenuItem[] = []
    if (!props.singleFileMode && props.onToggleSidebar) {
      items.push({ label: "Toggle Sidebar", shortcut: "Ctrl+B", action: props.onToggleSidebar })
    }
    if (props.onNextTab && !props.singleFileMode) {
      items.push({ label: "Next Tab", shortcut: "Ctrl+PgDn", action: props.onNextTab })
      items.push({ label: "Prev Tab", shortcut: "Ctrl+PgUp", action: props.onPrevTab })
    }
    return items
  }

  const helpItems = (): MenuItem[] => [{ label: "About Runo", action: props.onAbout }]

  // -- Menu label positions (approximate char offsets) --
  // " Runo " = 6 chars, then " File " = 6, " Edit " = 6, " View " = 6, " Help " = 6
  const menuPositions: Record<string, number> = {
    file: 6,
    edit: 12,
    view: 18,
    help: 24,
  }

  // Toggle or switch menu
  const toggleMenu = (name: string) => {
    setOpenMenu((current) => (current === name ? null : name))
  }

  // Hover-switch: if a menu is already open and user hovers another label, switch
  const hoverMenu = (name: string) => {
    setHoveredLabel(name)
    if (openMenu() !== null && openMenu() !== name) {
      setOpenMenu(name)
    }
  }

  const unhoverMenu = (name: string) => {
    if (hoveredLabel() === name) setHoveredLabel(null)
  }

  const closeMenu = () => setOpenMenu(null)

  // -- Centered title --
  const title = () => props.titlePath

  // -- Menu label helpers --
  const labelFg = (name: string) => {
    if (openMenu() === name) return "#ffffff"
    if (hoveredLabel() === name) return "#ffffff"
    return "#cccccc"
  }

  const labelBg = (name: string) => {
    if (openMenu() === name) return "#094771"
    if (hoveredLabel() === name) return "#454545"
    return "#323233"
  }

  // -- Active menu items --
  const activeItems = () => {
    const menu = openMenu()
    if (menu === "file") return fileItems()
    if (menu === "edit") return editItems()
    if (menu === "view") return viewItems()
    if (menu === "help") return helpItems()
    return []
  }

  const activeMenuLeft = () => {
    const menu = openMenu()
    if (menu) return menuPositions[menu] || 0
    return 0
  }

  const hasViewItems = () => viewItems().length > 0

  return (
    <box width="100%" height={1} backgroundColor="#323233" flexDirection="row" overflow="visible">
      {/* Runo badge */}
      <text fg="#ffffff" bg="#007acc" attributes={1}>
        {" Runo "}
      </text>

      {/* Menu labels */}
      <text
        fg={labelFg("file")}
        bg={labelBg("file")}
        onMouseDown={() => toggleMenu("file")}
        onMouseOver={() => hoverMenu("file")}
        onMouseOut={() => unhoverMenu("file")}
      >
        {" File "}
      </text>
      <text
        fg={labelFg("edit")}
        bg={labelBg("edit")}
        onMouseDown={() => toggleMenu("edit")}
        onMouseOver={() => hoverMenu("edit")}
        onMouseOut={() => unhoverMenu("edit")}
      >
        {" Edit "}
      </text>
      <Show when={hasViewItems()}>
        <text
          fg={labelFg("view")}
          bg={labelBg("view")}
          onMouseDown={() => toggleMenu("view")}
          onMouseOver={() => hoverMenu("view")}
          onMouseOut={() => unhoverMenu("view")}
        >
          {" View "}
        </text>
      </Show>
      <text
        fg={labelFg("help")}
        bg={labelBg("help")}
        onMouseDown={() => toggleMenu("help")}
        onMouseOver={() => hoverMenu("help")}
        onMouseOut={() => unhoverMenu("help")}
      >
        {" Help "}
      </text>

      {/* Center: title */}
      <box flexGrow={1} justifyContent="center" backgroundColor="#323233">
        <text fg="#999999" bg="#323233">
          {title()}
        </text>
      </box>

      {/* Right: dimensions */}
      <text fg="#666666" bg="#323233">
        {`${props.termWidth}x${props.termHeight} `}
      </text>

      {/* Close button */}
      <text
        fg={closeHover() ? "#ffffff" : "#999999"}
        bg={closeHover() ? "#e81123" : "#323233"}
        onMouseOver={() => setCloseHover(true)}
        onMouseOut={() => setCloseHover(false)}
        onMouseDown={() => props.onExit()}
      >
        {" \u2715 "}
      </text>

      {/* Dropdown overlay */}
      <MenuDropdown
        items={activeItems()}
        left={activeMenuLeft()}
        open={openMenu() !== null}
        onClose={closeMenu}
        termWidth={props.termWidth}
        termHeight={props.termHeight}
      />
    </box>
  )
}

export default TitleBar
