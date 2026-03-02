/** Bottom status bar showing active panel, file info, cursor position, and shortcuts. */

import { basename } from "path"

interface StatusBarProps {
  filePath: string | null
  panel: "tree" | "editor"
  lineCount: number
  cursorLine?: number
  cursorCol?: number
  isDirty?: boolean
}

const StatusBar = (props: StatusBarProps) => {
  const fileName = () => {
    if (!props.filePath) return "No file"
    const name = basename(props.filePath)
    return props.isDirty ? name + " *" : name
  }

  return (
    <box flexDirection="row" width="100%" height={1} backgroundColor="#007acc">
      <text fg="#ffffff" bg="#007acc">
        {` ${props.panel === "tree" ? "EXPLORER" : "EDITOR"} `}
      </text>
      <text fg="#ffffff" bg="#005a9e">
        {` ${fileName()} `}
      </text>
      <box flexGrow={1} backgroundColor="#007acc" />
      <text fg="#ffffff" bg="#007acc">
        {props.filePath && props.cursorLine ? ` Ln ${props.cursorLine}, Col ${props.cursorCol ?? 1} ` : ""}
      </text>
      <text fg="#ffffff" bg="#005a9e">
        {props.filePath ? ` Lines: ${props.lineCount} ` : ""}
      </text>
      <text fg="#ffffff" bg="#007acc">
        {props.isDirty ? " Ctrl+S: save " : ""}
      </text>
      <text fg="#ffffff" bg="#005a9e">
        {" Ctrl+B/Ctrl+C "}
      </text>
    </box>
  )
}

export default StatusBar
