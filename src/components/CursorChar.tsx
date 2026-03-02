/**
 * Cursor blink character — isolated component so only it reacts to blink.
 *
 * By reading cursorVisible inside this component (not in the parent line),
 * blink toggling avoids re-rendering entire code lines.
 */

import type { Accessor } from "solid-js"
import type { ColorToken } from "../lib/highlighter"

interface CursorCharProps {
  token: ColorToken
  bg: string
  cursorVisible: Accessor<boolean>
}

const CursorChar = (props: CursorCharProps) => {
  const cFg = () => (props.cursorVisible() ? "#1e1e1e" : props.token.color)
  const cBg = () => (props.cursorVisible() ? props.token.color : props.bg)
  return (
    <text fg={cFg()} bg={cBg()} wrapMode="none">
      {props.token.content}
    </text>
  )
}

export default CursorChar
