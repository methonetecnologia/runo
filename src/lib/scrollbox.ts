/**
 * Habilita scroll horizontal num scrollbox do OpenTUI.
 *
 * O binding Solid cria o ScrollBoxRenderable com { id } apenas,
 * sem passar scrollX/scrollY/scrollbarOptions ao constructor.
 * O content fica com maxWidth:"100%" impedindo overflow horizontal.
 *
 * Este helper corrige isso post-mount.
 */
export function enableScrollX(scrollRef: any) {
  if (!scrollRef?.content) return
  scrollRef.content.maxWidth = undefined
  scrollRef.content.minWidth = "100%"
  // Aplica estilo consistente nas scrollbars
  styleScrollbars(scrollRef)
}

/**
 * Corrige o layout do ScrollBox para que ambas as scrollbars fiquem visíveis.
 *
 * O problema: o ScrollBox usa flexbox internamente, e quando o conteúdo
 * é maior que o viewport, o wrapper/viewport crescem com o conteúdo,
 * empurrando as scrollbars para fora da área visível.
 *
 * A solução: setar maxWidth/maxHeight explícitos nos elementos internos,
 * baseados no espaço real disponível, para conter o layout.
 *
 * Estrutura interna do ScrollBox:
 *   root (row, width=W, height=H)
 *   ├── wrapper (col, flexGrow:1) → precisa maxWidth = W - vBarWidth
 *   │   ├── viewport (col, flexGrow:1, overflow:hidden) → precisa maxHeight = H - hBarHeight
 *   │   └── horizontalScrollBar (height: 1)
 *   └── verticalScrollBar (width: 1~2)
 */
export function constrainScrollbox(scrollRef: any, width: number, height: number) {
  if (!scrollRef) return

  const vBarW = 2
  const hBarH = 1

  // Root: tamanho fixo
  scrollRef.width = width
  scrollRef.height = height

  // Wrapper: não pode ser mais largo que root - vBar
  if (scrollRef.wrapper) {
    scrollRef.wrapper.maxWidth = Math.max(1, width - vBarW)
  }

  // Viewport: não pode ser mais alto que root - hBar
  if (scrollRef.viewport) {
    scrollRef.viewport.maxHeight = Math.max(1, height - hBarH)
  }
}

/** Aplica cores e harmoniza tamanhos nas scrollbars */
export function styleScrollbars(scrollRef: any) {
  if (!scrollRef) return
  const fg = "#5a5a5a"
  const bg = "#2b2b2b"

  if (scrollRef.verticalScrollBar) {
    scrollRef.verticalScrollBar.slider.foregroundColor = fg
    scrollRef.verticalScrollBar.slider.backgroundColor = bg
    scrollRef.verticalScrollBar.slider.width = 2
    scrollRef.verticalScrollBar.width = 2
  }
  if (scrollRef.horizontalScrollBar) {
    scrollRef.horizontalScrollBar.slider.foregroundColor = fg
    scrollRef.horizontalScrollBar.slider.backgroundColor = bg
    scrollRef.horizontalScrollBar.slider.height = 1
    scrollRef.horizontalScrollBar.height = 1
  }
}
