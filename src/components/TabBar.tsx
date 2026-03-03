/**
 * Tab bar component with VSCode-style preview/pinned tab behavior.
 *
 * - Preview tabs show the filename in italic (dimmer color) and are replaced
 *   when another file is single-clicked.
 * - Pinned tabs show the filename normally and stay open until explicitly closed.
 * - Each tab has a close button (x) on hover or when active.
 * - Clicking a tab switches to it.
 * - Double-clicking a preview tab pins it.
 */

import { createSignal, Show, For } from "solid-js"

/** Single tab data */
interface Tab {
  path: string
  name: string
  mode: "preview" | "pinned"
}

interface TabBarProps {
  /** List of currently open tabs */
  tabs: Tab[]
  /** Path of the currently active/visible tab (null if none) */
  activeTab: string | null
  /** Set of file paths with unsaved changes */
  dirtyFiles?: Set<string>
  /** Called when a tab is clicked (switch to it) */
  onSelect: (path: string) => void
  /** Called when a tab's close button is clicked */
  onClose: (path: string) => void
  /** Called when a preview tab should be pinned (double-click) */
  onPin: (path: string) => void
}

const TabBar = (props: TabBarProps) => {
  /** Track which tab the mouse is hovering over */
  const [hoveredTab, setHoveredTab] = createSignal<string | null>(null)

  /** Double-click detection state */
  let lastClickTime = 0
  let lastClickPath = ""

  return (
    <Show
      when={props.tabs.length > 0}
      fallback={
        <box width="100%" height={1} backgroundColor="#252526">
          <text fg="#555555" bg="#252526">
            {" No tabs open"}
          </text>
        </box>
      }
    >
      <box flexDirection="row" width="100%" height={1} backgroundColor="#252526">
        <For each={props.tabs}>
          {(tab) => {
            const isActive = () => tab.path === props.activeTab
            const isHovered = () => tab.path === hoveredTab()
            const isPreview = () => tab.mode === "preview"
            const isDirty = () => props.dirtyFiles?.has(tab.path) ?? false

            // Tab background: active = editor bg, inactive = darker
            const bg = () => (isActive() ? "#1e1e1e" : "#2d2d2d")

            // Tab text color: preview uses italic-like dimmer color
            const fg = () => {
              if (isActive()) return isPreview() ? "#bbbbbb" : "#ffffff"
              return isPreview() ? "#777777" : "#969696"
            }

            // Close button: show on hover or when active
            const showClose = () => isActive() || isHovered()

            // Preview tabs show name in italic style; dirty files get a dot indicator
            const displayName = () => {
              const name = isPreview() ? `${tab.name}` : tab.name
              return isDirty() ? `${name} *` : name
            }

            return (
              <box
                flexDirection="row"
                height={1}
                backgroundColor={bg()}
                onMouseOver={() => setHoveredTab(tab.path)}
                onMouseOut={() => {
                  if (hoveredTab() === tab.path) setHoveredTab(null)
                }}
                onMouseDown={() => {
                  props.onSelect(tab.path)
                  // Double-click detection: pin preview tab
                  const now = Date.now()
                  if (now - lastClickTime < 400 && lastClickPath === tab.path) {
                    if (isPreview()) props.onPin(tab.path)
                  }
                  lastClickTime = now
                  lastClickPath = tab.path
                }}
              >
                {/* Tab name */}
                <text fg={fg()} bg={bg()} attributes={isPreview() ? 3 : 0}>
                  {` ${displayName()} `}
                </text>
                {/* Close button or spacer */}
                <text
                  fg={showClose() ? "#969696" : bg()}
                  bg={bg()}
                  onMouseDown={(e: any) => {
                    e?.stopPropagation?.()
                    props.onClose(tab.path)
                  }}
                >
                  {showClose() ? "x " : "  "}
                </text>
              </box>
            )
          }}
        </For>
        {/* Fill remaining space with tab bar background */}
        <box flexGrow={1} backgroundColor="#252526" />
      </box>
    </Show>
  )
}

export default TabBar
