import { readdirSync, readFileSync, statSync } from "fs"
import { join, basename } from "path"

export interface FileEntry {
  name: string
  path: string
  isDirectory: boolean
  depth: number
  expanded?: boolean
  children?: FileEntry[]
}

const IGNORED = new Set([
  "node_modules",
  ".git",
  ".DS_Store",
  "dist",
  "bun.lockb",
  ".bun",
])

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
    // permission denied etc
  }

  // directories first, then files, alphabetical
  entries.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
    return a.name.localeCompare(b.name)
  })

  return entries
}

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

export function readFileContent(filePath: string): string {
  try {
    return readFileSync(filePath, "utf-8")
  } catch {
    return "[Erro ao ler arquivo]"
  }
}

export function getFileExtension(filePath: string): string {
  const name = basename(filePath)
  const dot = name.lastIndexOf(".")
  if (dot === -1) return ""
  return name.slice(dot + 1)
}

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
