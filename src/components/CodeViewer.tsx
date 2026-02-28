import { createMemo, createEffect, Show, For, onMount } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import { enableScrollX, constrainScrollbox, styleScrollbars } from "../lib/scrollbox"

interface CodeViewerProps {
  filePath: string | null
  content: string
  focused: boolean
  availableWidth: number
  availableHeight: number
}

const CodeViewer = (props: CodeViewerProps) => {
  let codeScrollRef: any
  let gutterScrollRef: any

  const lines = createMemo(() => {
    if (!props.content) return []
    return props.content.split("\n")
  })

  const gutterW = createMemo(() => String(lines().length).length + 1)

  const codeWidth = createMemo(() => Math.max(1, props.availableWidth - gutterW() - 1))

  const maxLineLen = createMemo(() => {
    let max = 0
    for (const line of lines()) {
      const len = line.replace(/\t/g, "    ").length
      if (len > max) max = len
    }
    return max
  })

  const syncGutterScroll = () => {
    if (!gutterScrollRef || !codeScrollRef) return
    gutterScrollRef.scrollTop = codeScrollRef.scrollTop
  }

  createEffect(() => {
    props.filePath
    if (codeScrollRef) {
      codeScrollRef.scrollTop = 0
      codeScrollRef.scrollLeft = 0
    }
    if (gutterScrollRef) {
      gutterScrollRef.scrollTop = 0
    }
  })

  useKeyboard((key) => {
    if (!props.focused || !codeScrollRef) return
    if (key.shift && (key.name === "left" || key.name === "right")) {
      const delta = key.name === "right" ? 3 : -3
      codeScrollRef.scrollBy({ x: delta, y: 0 })
    }
  })

  const setupCodeScroll = () => {
    if (!codeScrollRef) return
    enableScrollX(codeScrollRef)
    constrainScrollbox(codeScrollRef, codeWidth(), props.availableHeight)
    if (codeScrollRef.verticalScrollBar) {
      const origOnChange = codeScrollRef.verticalScrollBar._onChange
      codeScrollRef.verticalScrollBar._onChange = (pos: number) => {
        origOnChange?.(pos)
        syncGutterScroll()
      }
    }
  }

  onMount(() => setTimeout(() => {
    setupCodeScroll()
    if (gutterScrollRef) {
      styleScrollbars(gutterScrollRef)
      if (gutterScrollRef.verticalScrollBar) gutterScrollRef.verticalScrollBar.visible = false
      if (gutterScrollRef.horizontalScrollBar) gutterScrollRef.horizontalScrollBar.visible = false
    }
  }, 50))

  createEffect(() => {
    props.filePath
    setTimeout(() => {
      setupCodeScroll()
      if (gutterScrollRef) {
        if (gutterScrollRef.verticalScrollBar) gutterScrollRef.verticalScrollBar.visible = false
        if (gutterScrollRef.horizontalScrollBar) gutterScrollRef.horizontalScrollBar.visible = false
      }
    }, 50)
  })

  // Atualiza constraints quando dimensões mudam (resize, sidebar drag)
  createEffect(() => {
    const w = codeWidth()
    const h = props.availableHeight
    if (codeScrollRef) {
      constrainScrollbox(codeScrollRef, w, h)
    }
  })

  return (
    <box flexDirection="column" flexGrow={1} height="100%" backgroundColor="#1e1e1e">
      <Show
        when={props.filePath}
        fallback={
          <box flexDirection="column" flexGrow={1} justifyContent="center" alignItems="center" backgroundColor="#1e1e1e">
            <text fg="#555555">Nenhum arquivo aberto</text>
            <text fg="#3c3c3c" marginTop={1}>Selecione um arquivo na barra lateral</text>
          </box>
        }
      >
        <box flexDirection="row" flexGrow={1} width="100%">
          <scrollbox ref={gutterScrollRef} width={gutterW() + 1} height="100%" scrollY={true}>
            <box flexDirection="column">
              <For each={lines()}>
                {(_, i) => {
                  const num = () => String(i() + 1).padStart(gutterW(), " ") + " "
                  return <text fg="#858585" bg="#1e1e1e" wrapMode="none">{num()}</text>
                }}
              </For>
            </box>
          </scrollbox>

          <scrollbox ref={codeScrollRef} width={codeWidth()} height={props.availableHeight} focused={props.focused} scrollX={true} scrollY={true}>
            <box flexDirection="column" width={Math.max(maxLineLen() + 2, 1)}>
              <For each={lines()}>
                {(line) => {
                  const code = () => line.replace(/\t/g, "    ")
                  return <text fg="#d4d4d4" bg="#1e1e1e" wrapMode="none">{code()}</text>
                }}
              </For>
            </box>
          </scrollbox>
        </box>
      </Show>
    </box>
  )
}

export default CodeViewer
