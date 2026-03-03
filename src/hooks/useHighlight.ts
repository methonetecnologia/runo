/**
 * Syntax highlighting effect with debounce and stale-result detection.
 *
 * Wraps the Shiki highlighter with a generation counter so that
 * fast typing doesn't cause stale tokens to overwrite current ones.
 */

import { createSignal, createEffect } from "solid-js"
import { getFileExtension, extToShikiLang } from "../lib/files"
import { highlightCode, type ColorToken } from "../lib/highlighter"

export interface UseHighlightOptions {
  /** Reactive getter for file content */
  content: () => string
  /** Reactive getter for file path */
  filePath: () => string | null
  /** Reactive getter for the lines count (to validate stale tokens) */
  lineCount: () => number
}

export function useHighlight(opts: UseHighlightOptions) {
  const [highlightTokens, setHighlightTokens] = createSignal<ColorToken[][] | null>(null)

  let hlTimer: ReturnType<typeof setTimeout> | null = null
  let hlGeneration = 0

  createEffect(() => {
    const content = opts.content()
    const filePath = opts.filePath()

    if (hlTimer) clearTimeout(hlTimer)

    if (!filePath) {
      setHighlightTokens(null)
      return
    }

    const ext = getFileExtension(filePath)
    const lang = extToShikiLang(ext)
    if (!lang || lang === "plaintext") {
      setHighlightTokens(null)
      return
    }

    const gen = ++hlGeneration

    // Keep previous tokens visible while re-highlighting (no flash to white).
    // The getLineTokens fallback in CodeViewer handles any line-count mismatch.

    // Debounce: 30ms after last content change
    hlTimer = setTimeout(() => {
      highlightCode(content, lang).then((tokens) => {
        if (gen === hlGeneration) {
          setHighlightTokens(tokens)
        }
      })
    }, 50)
  })

  return { highlightTokens }
}
