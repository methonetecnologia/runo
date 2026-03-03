/**
 * Modal dialog shown when the user tries to close a tab or quit the editor
 * with unsaved changes.
 *
 * Layout:
 *   ┌─ Unsaved Changes ─────────────────┐
 *   │                                    │
 *   │  "file.ts" has unsaved changes.    │
 *   │                                    │
 *   │   [Save]  [Don't Save]  [Cancel]   │
 *   └────────────────────────────────────┘
 *
 * Keyboard: Tab/Shift+Tab to cycle buttons, Enter to confirm, Escape to cancel.
 */

import { createSignal, createEffect, Show, For } from "solid-js"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"

interface UnsavedModalProps {
  /** Whether the modal is visible */
  open: boolean
  /** Display message (e.g. file name or "3 files have unsaved changes") */
  message: string
  /** Called when user chooses to save first */
  onSave: () => void
  /** Called when user chooses to discard changes */
  onDiscard: () => void
  /** Called when user cancels (go back to editing) */
  onCancel: () => void
}

type ButtonIndex = 0 | 1 | 2

const BUTTONS = ["Save", "Don't Save", "Cancel"] as const

const UnsavedModal = (props: UnsavedModalProps) => {
  const dimensions = useTerminalDimensions()
  const [focused, setFocused] = createSignal<ButtonIndex>(0)

  // Reset focused button when modal opens
  createEffect(() => {
    if (props.open) setFocused(0)
  })

  const w = 44
  const h = 7
  const left = () => Math.max(0, Math.floor((dimensions().width - w) / 2))
  const top = () => Math.max(0, Math.floor((dimensions().height - h) / 2))

  const confirm = () => {
    const idx = focused()
    if (idx === 0) props.onSave()
    else if (idx === 1) props.onDiscard()
    else props.onCancel()
  }

  useKeyboard((key) => {
    if (!props.open) return

    if (key.name === "escape") {
      props.onCancel()
      return
    }

    if (key.name === "return") {
      confirm()
      return
    }

    if (key.name === "tab") {
      if (key.shift) {
        setFocused((f) => ((f - 1 + 3) % 3) as ButtonIndex)
      } else {
        setFocused((f) => ((f + 1) % 3) as ButtonIndex)
      }
      return
    }

    // Arrow keys also cycle buttons
    if (key.name === "left") {
      setFocused((f) => ((f - 1 + 3) % 3) as ButtonIndex)
      return
    }
    if (key.name === "right") {
      setFocused((f) => ((f + 1) % 3) as ButtonIndex)
      return
    }
  })

  return (
    <Show when={props.open}>
      {/* Backdrop — click to cancel */}
      <box
        position="absolute"
        left={0}
        top={0}
        width="100%"
        height="100%"
        zIndex={299}
        onMouseDown={() => props.onCancel()}
      />
      {/* Modal box */}
      <box
        position="absolute"
        left={left()}
        top={top()}
        width={w}
        height={h}
        zIndex={300}
        flexDirection="column"
        backgroundColor="#252526"
        border
        borderStyle="single"
        borderColor="#007acc"
        alignItems="center"
        justifyContent="center"
      >
        {/* Title */}
        <text fg="#007acc" attributes={1}>
          Unsaved Changes
        </text>

        {/* Message */}
        <text fg="#cccccc" marginTop={1}>
          {props.message}
        </text>

        {/* Buttons row */}
        <box flexDirection="row" marginTop={1} gap={1}>
          <For each={BUTTONS}>
            {(label, idx) => {
              const isFocused = () => focused() === idx()
              const callbacks = [props.onSave, props.onDiscard, props.onCancel]
              return (
                <box
                  onMouseDown={(e: any) => {
                    e?.stopPropagation?.()
                    callbacks[idx()]()
                  }}
                  onMouseOver={() => setFocused(idx() as ButtonIndex)}
                >
                  <text fg={isFocused() ? "#ffffff" : "#999999"} bg={isFocused() ? "#007acc" : "#333333"}>
                    {` ${label} `}
                  </text>
                </box>
              )
            }}
          </For>
        </box>
      </box>
    </Show>
  )
}

export default UnsavedModal
