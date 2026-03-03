/**
 * File system utilities for directory scanning and file reading.
 * Pure functions — no UI dependencies, easily testable.
 */

import { readdirSync, readFileSync, writeFileSync, statSync, openSync, readSync, closeSync } from "fs"
import { join, basename } from "path"

export interface FileEntry {
  name: string
  path: string
  isDirectory: boolean
  depth: number
  expanded?: boolean
  children?: FileEntry[]
}

/** Directories/files excluded from the tree */
const IGNORED = new Set(["node_modules", ".git", ".DS_Store", "dist", "bun.lockb", ".bun"])

/** File extensions known to be binary (images, media, compiled, archives, etc.) */
const BINARY_EXTENSIONS = new Set([
  // Images
  "png",
  "jpg",
  "jpeg",
  "gif",
  "bmp",
  "ico",
  "webp",
  "svg",
  "tiff",
  "tif",
  "avif",
  // Media
  "mp3",
  "mp4",
  "wav",
  "ogg",
  "flac",
  "avi",
  "mkv",
  "mov",
  "webm",
  "m4a",
  "aac",
  // Fonts
  "woff",
  "woff2",
  "ttf",
  "otf",
  "eot",
  // Archives
  "zip",
  "tar",
  "gz",
  "bz2",
  "xz",
  "7z",
  "rar",
  "zst",
  // Compiled / binary
  "wasm",
  "so",
  "dylib",
  "dll",
  "exe",
  "o",
  "a",
  "class",
  "pyc",
  "pyo",
  "node",
  "bin",
  "dat",
  "db",
  "sqlite",
  "sqlite3",
  // Documents
  "pdf",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
  // Other
  "map",
  "min.js",
  "min.css",
])

/**
 * Checks if a file is binary by extension or by reading the first bytes.
 * Returns true for files that should not be opened in the text editor.
 */
export function isBinaryFile(filePath: string): boolean {
  const name = basename(filePath).toLowerCase()
  const ext = name.includes(".") ? name.split(".").pop()! : ""

  if (BINARY_EXTENSIONS.has(ext)) return true

  // Check first 512 bytes for null bytes (strong binary indicator)
  try {
    const fd = openSync(filePath, "r")
    const buf = new Uint8Array(512)
    const bytesRead = readSync(fd, buf, 0, 512, 0)
    closeSync(fd)

    for (let i = 0; i < bytesRead; i++) {
      if (buf[i] === 0) return true
    }
  } catch {
    // If we can't read it, treat as binary (can't edit it anyway)
    return true
  }

  return false
}

/** Recursively scans a directory into a sorted FileEntry tree. */
export function scanDirectory(dir: string, depth = 0, maxDepth = 4): FileEntry[] {
  const entries: FileEntry[] = []

  try {
    const items = readdirSync(dir)
    for (const item of items) {
      if (IGNORED.has(item)) continue

      const fullPath = join(dir, item)
      const stat = statSync(fullPath)
      const isDir = stat.isDirectory()

      const entry: FileEntry = {
        name: item,
        path: fullPath,
        isDirectory: isDir,
        depth,
        expanded: false,
      }

      if (isDir && depth < maxDepth) {
        entry.children = scanDirectory(fullPath, depth + 1, maxDepth)
      }

      entries.push(entry)
    }
  } catch {
    // Skip unreadable directories (permission denied, etc.)
  }

  // Directories first, then files, both alphabetical
  entries.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
    return a.name.localeCompare(b.name)
  })

  return entries
}

/** Flattens a nested tree into a list, only including expanded children. */
export function flattenTree(entries: FileEntry[]): FileEntry[] {
  const result: FileEntry[] = []
  for (const entry of entries) {
    result.push(entry)
    if (entry.isDirectory && entry.expanded && entry.children) {
      result.push(...flattenTree(entry.children))
    }
  }
  return result
}

/**
 * Builds indentation guide prefixes for a flat tree list.
 * Returns an array of strings (one per entry) using box-drawing chars:
 *   "│ " — vertical line continuation (ancestor still has siblings below)
 *   "├ " — branch connector (entry has siblings after it)
 *   "└ " — last branch (entry is the last child)
 *   "  " — blank (ancestor was the last child, no line needed)
 *
 * Depth-0 entries get no prefix (they are root-level).
 */
export function buildTreeGuides(flat: FileEntry[]): string[] {
  const guides: string[] = []
  // For each depth level, track whether the last-seen entry at that depth
  // is the final sibling (so we know whether to draw │ or blank above it).
  // We do this by scanning forward: an entry is "last at its depth" if no
  // subsequent entry at the same depth (or shallower) shares the same parent depth.

  for (let i = 0; i < flat.length; i++) {
    const entry = flat[i]
    if (entry.depth === 0) {
      guides.push("")
      continue
    }

    // Determine if this entry is the last sibling at its depth:
    // scan forward until we find another entry at the same or shallower depth.
    let isLast = true
    for (let j = i + 1; j < flat.length; j++) {
      if (flat[j].depth < entry.depth) break // went up — no more siblings
      if (flat[j].depth === entry.depth) {
        isLast = false
        break
      }
    }

    // Build prefix for levels 1..depth-1 (ancestors), then the connector for this level.
    let prefix = ""
    for (let d = 1; d < entry.depth; d++) {
      // Check if the ancestor at depth d still has siblings below this point.
      let ancestorHasMore = false
      for (let j = i + 1; j < flat.length; j++) {
        if (flat[j].depth < d) break
        if (flat[j].depth === d) {
          ancestorHasMore = true
          break
        }
      }
      prefix += ancestorHasMore ? "│ " : "  "
    }

    // Connector for the current depth level
    prefix += isLast ? "└ " : "├ "
    guides.push(prefix)
  }

  return guides
}

/** Immutably toggles expanded state of a directory by path. */
export function toggleDirectory(entries: FileEntry[], targetPath: string): FileEntry[] {
  const result: FileEntry[] = []
  for (const entry of entries) {
    if (entry.path === targetPath) {
      result.push({ ...entry, expanded: !entry.expanded })
    } else if (entry.children) {
      result.push({ ...entry, children: toggleDirectory(entry.children, targetPath) })
    } else {
      result.push(entry)
    }
  }
  return result
}

/** Reads file content as UTF-8. Returns error/warning message for binary or unreadable files. */
export function readFileContent(filePath: string): string {
  try {
    if (isBinaryFile(filePath)) {
      return "[Binary file — cannot be displayed]"
    }
    return readFileSync(filePath, "utf-8")
  } catch {
    return "[Error reading file]"
  }
}

/** Writes file content as UTF-8. Returns true on success, false on failure. Blocks binary files. */
export function writeFileContent(filePath: string, content: string): boolean {
  try {
    if (isBinaryFile(filePath)) return false
    writeFileSync(filePath, content, "utf-8")
    return true
  } catch {
    return false
  }
}

/** Extracts the file extension without the dot. */
export function getFileExtension(filePath: string): string {
  const name = basename(filePath)
  const dot = name.lastIndexOf(".")
  if (dot === -1) return ""
  return name.slice(dot + 1)
}

/** Maps file extension to a filetype label for display. */
export function extToFiletype(ext: string): string {
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "tsx",
    js: "javascript",
    jsx: "jsx",
    json: "json",
    md: "markdown",
    css: "css",
    html: "html",
    py: "python",
    rs: "rust",
    go: "go",
    toml: "toml",
    yaml: "yaml",
    yml: "yaml",
    sh: "bash",
    bash: "bash",
    php: "php",
    sql: "sql",
    xml: "xml",
    txt: "text",
  }
  return map[ext] || "text"
}

/** Returns a 2-3 char icon for the file tree based on entry type/extension. */
export function getFileIcon(entry: FileEntry): string {
  if (entry.isDirectory) return entry.expanded ? "▾ " : "▸ "

  const ext = entry.name.split(".").pop() || ""
  const icons: Record<string, string> = {
    ts: "TS",
    tsx: "TX",
    js: "JS",
    jsx: "JX",
    json: "{}",
    md: "MD",
    css: "CS",
    html: "<>",
    py: "PY",
    rs: "RS",
    go: "GO",
    toml: "TM",
    php: "PH",
    sh: "SH",
    sql: "SQ",
  }
  return (icons[ext] || "··") + " "
}

/** Computes the max display width needed for the flat file tree. */
export function computeTreeWidth(flatEntries: FileEntry[]): number {
  let max = 0
  for (const entry of flatEntries) {
    const len = "  ".repeat(entry.depth).length + entry.name.length + 4
    if (len > max) max = len
  }
  return max + 1
}

/** Replaces tabs with spaces. */
export function expandTabs(text: string, tabSize = 4): string {
  return text.replace(/\t/g, " ".repeat(tabSize))
}

/** Returns the length of the longest line after tab expansion. */
export function maxLineLength(lines: string[]): number {
  let max = 0
  for (const line of lines) {
    const len = expandTabs(line).length
    if (len > max) max = len
  }
  return max
}

/** Splits content into lines, returns [] if empty. */
export function splitLines(content: string): string[] {
  if (!content) return []
  return content.split("\n")
}

/** Width needed for the line number gutter. */
export function gutterWidth(lineCount: number): number {
  return String(lineCount).length + 1
}

/** Maps file extension to Shiki BundledLanguage id. Returns null for unknown. */
export function extToShikiLang(ext: string): string | null {
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "tsx",
    js: "javascript",
    jsx: "jsx",
    json: "json",
    jsonc: "jsonc",
    md: "markdown",
    css: "css",
    scss: "scss",
    less: "less",
    html: "html",
    py: "python",
    rs: "rust",
    go: "go",
    toml: "toml",
    yaml: "yaml",
    yml: "yaml",
    sh: "bash",
    bash: "bash",
    zsh: "bash",
    php: "php",
    sql: "sql",
    xml: "xml",
    svg: "xml",
    txt: "plaintext",
    c: "c",
    cpp: "cpp",
    h: "c",
    hpp: "cpp",
    java: "java",
    rb: "ruby",
    lua: "lua",
    swift: "swift",
    kt: "kotlin",
    dart: "dart",
    vue: "vue",
    svelte: "svelte",
    dockerfile: "dockerfile",
    makefile: "makefile",
    graphql: "graphql",
    prisma: "prisma",
    env: "dotenv",
    ini: "ini",
    conf: "ini",
    lock: "json",
  }
  return map[ext] || null
}
