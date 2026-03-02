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
  /** Project/folder name (basename of CWD) */
  projectName: string
  /** Active file name (basename) or null */
  activeFileName: string | null
  /** Whether active file has unsaved changes */
  isDirty: boolean
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
  /** Whether we're in single-file mode (hides some menu items) */
  singleFileMode?: boolean
}

const TitleBar = (props: TitleBarProps) => {
  const [openMenu, setOpenMenu] = createSignal<string | null>(null)
  const [closeHover, setCloseHover] = createSignal(false)

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
    { label: "Undo", shortcut: "Ctrl+Z" },
    { label: "Redo", shortcut: "Ctrl+Y" },
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

  const helpItems = (): MenuItem[] => [{ label: "About Runo" }]

  // -- Menu label positions (approximate char offsets) --
  // " Runo " = 6 chars, then each label + spacing
  const menuPositions: Record<string, number> = {
    file: 7,
    edit: 13,
    view: 19,
    help: 25,
  }

  // Toggle or switch menu
  const toggleMenu = (name: string) => {
    setOpenMenu((current) => (current === name ? null : name))
  }

  // Hover-switch: if a menu is already open and user hovers another label, switch
  const hoverMenu = (name: string) => {
    if (openMenu() !== null && openMenu() !== name) {
      setOpenMenu(name)
    }
  }

  const closeMenu = () => setOpenMenu(null)

  // -- Centered title --
  const title = () => {
    const file = props.activeFileName
    const dirty = props.isDirty ? " *" : ""
    if (file) return `${file}${dirty} - ${props.projectName}`
    return props.projectName
  }

  // -- Menu label component --
  const MenuLabel = (p: { name: string; label: string }) => {
    const isActive = () => openMenu() === p.name
    const fg = () => (isActive() ? "#ffffff" : "#cccccc")
    const bg = () => (isActive() ? "#094771" : "#323233")

    return (
      <text fg={fg()} bg={bg()} onMouseDown={() => toggleMenu(p.name)} onMouseOver={() => hoverMenu(p.name)}>
        {` ${p.label} `}
      </text>
    )
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

  return (
    <>
      <box width="100%" height={1} backgroundColor="#323233" flexDirection="row">
        {/* Runo badge */}
        <text fg="#ffffff" bg="#007acc" attributes={1}>
          {" Runo "}
        </text>

        {/* Menu labels */}
        <MenuLabel name="file" label="File" />
        <MenuLabel name="edit" label="Edit" />
        <Show when={viewItems().length > 0}>
          <MenuLabel name="view" label="View" />
        </Show>
        <MenuLabel name="help" label="Help" />

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
      </box>

      {/* Dropdown overlay */}
      <MenuDropdown items={activeItems()} left={activeMenuLeft()} open={openMenu() !== null} onClose={closeMenu} />
    </>
  )
}

export default TitleBar
