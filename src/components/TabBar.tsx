import { For } from "solid-js"
import { basename } from "path"

interface Tab {
  path: string
  name: string
}

interface TabBarProps {
  tabs: Tab[]
  activeTab: string | null
}

const TabBar = (props: TabBarProps) => {
  if (props.tabs.length === 0) {
    return (
      <box width="100%" height={1} backgroundColor="#252526">
        <text fg="#555555" bg="#252526"> Nenhuma aba aberta</text>
      </box>
    )
  }

  return (
    <box flexDirection="row" width="100%" height={1} backgroundColor="#252526">
      <For each={props.tabs}>
        {(tab) => {
          const isActive = () => tab.path === props.activeTab
          return (
            <text
              fg={isActive() ? "#ffffff" : "#969696"}
              bg={isActive() ? "#1e1e1e" : "#2d2d2d"}
            >
              {` ${tab.name} `}
            </text>
          )
        }}
      </For>
      <box flexGrow={1} backgroundColor="#252526" />
    </box>
  )
}

export default TabBar
