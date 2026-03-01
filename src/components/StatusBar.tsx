/** Bottom status bar showing active panel, file info, and shortcuts. */

import { basename } from "path"

interface StatusBarProps {
  filePath: string | null
  panel: "tree" | "editor"
  lineCount: number
}

const StatusBar = (props: StatusBarProps) => {
  const fileName = () => (props.filePath ? basename(props.filePath) : "No file")

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
        {props.filePath ? ` Lines: ${props.lineCount} ` : ""}
      </text>
      <text fg="#ffffff" bg="#005a9e">
        {" Shift+Arrows: scroll H "}
      </text>
      <text fg="#ffffff" bg="#007acc">
        {" Tab/Ctrl+C "}
      </text>
    </box>
  )
}

export default StatusBar
