/**
 * Tab bar component showing open file tabs.
 *
 * Displays a horizontal row of tabs, one per open file. The active tab
 * is highlighted with a brighter foreground and matching editor background.
 * When no tabs are open, a placeholder message is shown.
 *
 * NOTE: Uses <Show> instead of early return to preserve Solid.js reactivity.
 * Early returns in Solid components prevent reactive updates from firing
 * because the component body only runs once — conditional rendering must
 * use <Show>/<Switch> or ternaries so the reactive graph stays intact.
 */

import { Show, For } from "solid-js"

/** Single tab data */
interface Tab {
  path: string
  name: string
}

interface TabBarProps {
  /** List of currently open tabs */
  tabs: Tab[]
  /** Path of the currently active/visible tab (null if none) */
  activeTab: string | null
}

const TabBar = (props: TabBarProps) => {
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
            return (
              <text fg={isActive() ? "#ffffff" : "#969696"} bg={isActive() ? "#1e1e1e" : "#2d2d2d"}>
                {` ${tab.name} `}
              </text>
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
