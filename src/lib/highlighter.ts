/**
 * Shiki syntax highlighter — singleton wrapper with lazy initialization.
 *
 * Loads grammars on demand per language. Tokens come back as
 * `{ content: string; color: string }[][]` (lines → tokens).
 */

import { createHighlighter, type Highlighter, type BundledLanguage } from "shiki"

export interface ColorToken {
  content: string
  color: string
}

const THEME = "dark-plus"
const DEFAULT_COLOR = "#d4d4d4"

/** Languages we eagerly load on init (most common in our IDE). */
const INITIAL_LANGS: BundledLanguage[] = ["typescript", "tsx", "javascript", "json"]

let highlighter: Highlighter | null = null
let initPromise: Promise<Highlighter> | null = null

/** Loaded language set (avoids redundant loadLanguage calls). */
const loadedLangs = new Set<string>(INITIAL_LANGS)

/** Ensure the singleton highlighter is ready. */
async function getHighlighter(): Promise<Highlighter> {
  if (highlighter) return highlighter
  if (initPromise) return initPromise

  initPromise = createHighlighter({
    themes: [THEME],
    langs: INITIAL_LANGS,
  }).then((hl) => {
    highlighter = hl
    return hl
  })

  return initPromise
}

/** Load a language grammar if not already loaded. */
async function ensureLang(lang: string): Promise<boolean> {
  const hl = await getHighlighter()
  if (loadedLangs.has(lang)) return true

  try {
    await hl.loadLanguage(lang as BundledLanguage)
    loadedLangs.add(lang)
    return true
  } catch {
    return false
  }
}

/**
 * Tokenize `code` for the given Shiki `lang`.
 * Returns an array of lines, each line an array of ColorTokens.
 *
 * If the highlighter isn't ready or the language fails to load,
 * returns `null` so the caller can fall back to plain text.
 */
export async function highlightCode(
  code: string,
  lang: string
): Promise<ColorToken[][] | null> {
  try {
    const ok = await ensureLang(lang)
    if (!ok) return null

    const hl = await getHighlighter()
    const result = hl.codeToTokensBase(code, { lang: lang as BundledLanguage, theme: THEME })

    const lines: ColorToken[][] = []
    for (const lineTokens of result) {
      const tokens: ColorToken[] = []
      for (const t of lineTokens) {
        tokens.push({ content: t.content, color: t.color || DEFAULT_COLOR })
      }
      lines.push(tokens)
    }
    return lines
  } catch {
    return null
  }
}

/** Start loading the highlighter eagerly (call at app boot). */
export function preloadHighlighter(): void {
  getHighlighter()
}
