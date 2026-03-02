/**
 * Dropdown menu overlay.
 *
 * Positioned absolutely below the title bar at a given X offset.
 * Each item shows a label + optional shortcut. Separators are
 * rendered as horizontal lines. Escape closes the dropdown.
 *
 * Uses position="absolute" with zIndex to overlay on top of content.
 * Rendered inside a parent with overflow="visible" so it escapes
 * the 1-row title bar height constraint.
 */

import { createSignal, For, Show } from "solid-js"
import { useKeyboard } from "@opentui/solid"

export interface MenuItem {
  label: string
  shortcut?: string
  action?: () => void
  separator?: boolean
}

interface MenuDropdownProps {
  items: MenuItem[]
  /** Absolute left position in terminal columns */
  left: number
  /** Whether the dropdown is open */
  open: boolean
  /** Called when the dropdown should close */
  onClose: () => void
  /** Terminal width (needed for backdrop since % is relative to 1-row parent) */
  termWidth: number
  /** Terminal height */
  termHeight: number
}

/** Minimum dropdown width (chars) */
const MIN_WIDTH = 24

const MenuDropdown = (props: MenuDropdownProps) => {
  const [hovered, setHovered] = createSignal(-1)

  // Compute dropdown width based on longest item
  const dropdownWidth = () => {
    let max = MIN_WIDTH
    for (const item of props.items) {
      if (item.separator) continue
      const len = item.label.length + (item.shortcut ? item.shortcut.length + 4 : 2)
      if (len > max) max = len
    }
    return max + 2
  }

  // Close on Escape
  useKeyboard((key) => {
    if (!props.open) return
    if (key.name === "escape") {
      props.onClose()
    }
  })

  return (
    <Show when={props.open}>
      {/* Full-screen invisible backdrop — catches clicks outside the dropdown */}
      <box
        position="absolute"
        left={0}
        top={0}
        width={props.termWidth}
        height={props.termHeight}
        zIndex={99}
        onMouseDown={() => props.onClose()}
      />
      {/* Dropdown panel */}
      <box
        position="absolute"
        left={props.left}
        top={1}
        width={dropdownWidth()}
        zIndex={100}
        flexDirection="column"
        backgroundColor="#252526"
        border
        borderStyle="single"
        borderColor="#454545"
        onMouseOut={() => setHovered(-1)}
      >
        <For each={props.items}>
          {(item, i) => {
            if (item.separator) {
              return (
                <text fg="#454545" wrapMode="none">
                  {"─".repeat(dropdownWidth() - 2)}
                </text>
              )
            }

            const isHovered = () => i() === hovered()
            const fg = () => (isHovered() ? "#ffffff" : "#cccccc")
            const bg = () => (isHovered() ? "#094771" : "#252526")

            const padded = () => {
              const w = dropdownWidth() - 2
              if (item.shortcut) {
                const gap = w - item.label.length - item.shortcut.length
                return " " + item.label + " ".repeat(Math.max(1, gap)) + item.shortcut
              }
              return " " + item.label + " ".repeat(Math.max(0, w - item.label.length - 1))
            }

            return (
              <text
                fg={fg()}
                bg={bg()}
                wrapMode="none"
                onMouseOver={() => setHovered(i())}
                onMouseOut={() => {
                  if (hovered() === i()) setHovered(-1)
                }}
                onMouseDown={() => {
                  if (item.action) item.action()
                  setHovered(-1)
                  props.onClose()
                }}
              >
                {padded()}
              </text>
            )
          }}
        </For>
      </box>
    </Show>
  )
}

export default MenuDropdown
