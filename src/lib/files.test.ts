/**
 * Unit tests for lib/files.ts pure functions.
 *
 * These tests validate the core utility functions used throughout the IDE.
 * All functions under test are pure (no side effects, deterministic output),
 * making them straightforward to test in isolation.
 *
 * Run with: bun test
 */

import { describe, expect, test } from "bun:test"
import {
  flattenTree,
  toggleDirectory,
  getFileIcon,
  computeTreeWidth,
  expandTabs,
  maxLineLength,
  splitLines,
  gutterWidth,
  getFileExtension,
  extToFiletype,
  type FileEntry,
} from "./files"

// -- Test data factories --

/** Creates a file entry with sensible defaults */
function makeFile(name: string, depth = 0, path?: string): FileEntry {
  return {
    name,
    path: path || `/project/${name}`,
    isDirectory: false,
    depth,
  }
}

/** Creates a directory entry with optional children */
function makeDir(name: string, depth = 0, children: FileEntry[] = [], expanded = false, path?: string): FileEntry {
  return {
    name,
    path: path || `/project/${name}`,
    isDirectory: true,
    depth,
    expanded,
    children,
  }
}

// ---------------------------------------------------------------------------
// flattenTree
// ---------------------------------------------------------------------------

describe("flattenTree", () => {
  test("returns empty array for empty input", () => {
    expect(flattenTree([])).toEqual([])
  })

  test("returns flat list of top-level entries", () => {
    const entries = [makeFile("a.ts"), makeFile("b.ts")]
    const result = flattenTree(entries)
    expect(result).toHaveLength(2)
    expect(result[0].name).toBe("a.ts")
    expect(result[1].name).toBe("b.ts")
  })

  test("includes children of expanded directories", () => {
    const entries = [makeDir("src", 0, [makeFile("index.ts", 1)], true)]
    const result = flattenTree(entries)
    expect(result).toHaveLength(2)
    expect(result[0].name).toBe("src")
    expect(result[1].name).toBe("index.ts")
  })

  test("excludes children of collapsed directories", () => {
    const entries = [makeDir("src", 0, [makeFile("index.ts", 1)], false)]
    const result = flattenTree(entries)
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe("src")
  })

  test("handles nested expanded directories", () => {
    const entries = [
      makeDir(
        "src",
        0,
        [makeDir("lib", 1, [makeFile("utils.ts", 2, "/project/src/lib/utils.ts")], true, "/project/src/lib")],
        true,
        "/project/src"
      ),
    ]
    const result = flattenTree(entries)
    expect(result).toHaveLength(3)
    expect(result.map((e) => e.name)).toEqual(["src", "lib", "utils.ts"])
  })
})

// ---------------------------------------------------------------------------
// toggleDirectory
// ---------------------------------------------------------------------------

describe("toggleDirectory", () => {
  test("toggles expanded state of matching directory", () => {
    const entries = [makeDir("src", 0, [], false, "/project/src")]
    const result = toggleDirectory(entries, "/project/src")
    expect(result[0].expanded).toBe(true)
  })

  test("toggles back to collapsed", () => {
    const entries = [makeDir("src", 0, [], true, "/project/src")]
    const result = toggleDirectory(entries, "/project/src")
    expect(result[0].expanded).toBe(false)
  })

  test("does not mutate the original array", () => {
    const entries = [makeDir("src", 0, [], false, "/project/src")]
    const result = toggleDirectory(entries, "/project/src")
    expect(entries[0].expanded).toBe(false)
    expect(result[0].expanded).toBe(true)
  })

  test("toggles nested directory by path", () => {
    const entries = [makeDir("src", 0, [makeDir("lib", 1, [], false, "/project/src/lib")], true, "/project/src")]
    const result = toggleDirectory(entries, "/project/src/lib")
    expect(result[0].expanded).toBe(true) // parent unchanged
    expect(result[0].children![0].expanded).toBe(true) // child toggled
  })

  test("leaves unrelated entries untouched", () => {
    const entries = [makeFile("readme.md", 0, "/project/readme.md"), makeDir("src", 0, [], false, "/project/src")]
    const result = toggleDirectory(entries, "/project/src")
    expect(result[0]).toEqual(entries[0]) // file unchanged
    expect(result[1].expanded).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// getFileIcon
// ---------------------------------------------------------------------------

describe("getFileIcon", () => {
  test("returns expand arrow for collapsed directory", () => {
    expect(getFileIcon(makeDir("src"))).toBe("▸ ")
  })

  test("returns collapse arrow for expanded directory", () => {
    expect(getFileIcon(makeDir("src", 0, [], true))).toBe("▾ ")
  })

  test("returns TS icon for .ts files", () => {
    expect(getFileIcon(makeFile("index.ts"))).toBe("TS ")
  })

  test("returns TX icon for .tsx files", () => {
    expect(getFileIcon(makeFile("App.tsx"))).toBe("TX ")
  })

  test("returns JS icon for .js files", () => {
    expect(getFileIcon(makeFile("main.js"))).toBe("JS ")
  })

  test("returns {} icon for .json files", () => {
    expect(getFileIcon(makeFile("package.json"))).toBe("{} ")
  })

  test("returns PY icon for .py files", () => {
    expect(getFileIcon(makeFile("script.py"))).toBe("PY ")
  })

  test("returns default icon for unknown extension", () => {
    expect(getFileIcon(makeFile("data.xyz"))).toBe("·· ")
  })
})

// ---------------------------------------------------------------------------
// computeTreeWidth
// ---------------------------------------------------------------------------

describe("computeTreeWidth", () => {
  test("computes width for single entry", () => {
    const entries = [makeFile("hello.ts")]
    // "hello.ts" = 8 chars + 4 (icon+padding) + 0 (depth indent) + 1 = 13
    const width = computeTreeWidth(entries)
    expect(width).toBe(13)
  })

  test("accounts for depth indentation", () => {
    const shallow = [makeFile("a.ts", 0)]
    const deep = [makeFile("a.ts", 3)]
    expect(computeTreeWidth(deep)).toBeGreaterThan(computeTreeWidth(shallow))
  })

  test("returns width of the widest entry", () => {
    const entries = [makeFile("a.ts"), makeFile("very-long-filename.tsx")]
    const width = computeTreeWidth(entries)
    // Should be based on "very-long-filename.tsx" (22 chars)
    expect(width).toBe(22 + 4 + 1)
  })
})

// ---------------------------------------------------------------------------
// expandTabs
// ---------------------------------------------------------------------------

describe("expandTabs", () => {
  test("replaces tabs with 4 spaces by default", () => {
    expect(expandTabs("\thello")).toBe("    hello")
  })

  test("replaces multiple tabs", () => {
    expect(expandTabs("\t\thello")).toBe("        hello")
  })

  test("custom tab size", () => {
    expect(expandTabs("\thello", 2)).toBe("  hello")
  })

  test("returns string unchanged when no tabs", () => {
    expect(expandTabs("no tabs here")).toBe("no tabs here")
  })

  test("handles empty string", () => {
    expect(expandTabs("")).toBe("")
  })
})

// ---------------------------------------------------------------------------
// maxLineLength
// ---------------------------------------------------------------------------

describe("maxLineLength", () => {
  test("returns 0 for empty array", () => {
    expect(maxLineLength([])).toBe(0)
  })

  test("returns length of single line", () => {
    expect(maxLineLength(["hello"])).toBe(5)
  })

  test("returns length of longest line", () => {
    expect(maxLineLength(["hi", "hello world", "hey"])).toBe(11)
  })

  test("expands tabs before measuring", () => {
    // "\t" expands to 4 spaces, so "\thello" = 9 chars
    expect(maxLineLength(["\thello"])).toBe(9)
  })
})

// ---------------------------------------------------------------------------
// splitLines
// ---------------------------------------------------------------------------

describe("splitLines", () => {
  test("returns empty array for empty string", () => {
    expect(splitLines("")).toEqual([])
  })

  test("splits content on newlines", () => {
    expect(splitLines("a\nb\nc")).toEqual(["a", "b", "c"])
  })

  test("handles single line (no newline)", () => {
    expect(splitLines("hello")).toEqual(["hello"])
  })

  test("handles trailing newline", () => {
    expect(splitLines("a\nb\n")).toEqual(["a", "b", ""])
  })
})

// ---------------------------------------------------------------------------
// gutterWidth
// ---------------------------------------------------------------------------

describe("gutterWidth", () => {
  test("returns 2 for single-digit line count", () => {
    expect(gutterWidth(1)).toBe(2)
    expect(gutterWidth(9)).toBe(2)
  })

  test("returns 3 for double-digit line count", () => {
    expect(gutterWidth(10)).toBe(3)
    expect(gutterWidth(99)).toBe(3)
  })

  test("returns 4 for triple-digit line count", () => {
    expect(gutterWidth(100)).toBe(4)
    expect(gutterWidth(999)).toBe(4)
  })

  test("returns 5 for 1000+ lines", () => {
    expect(gutterWidth(1000)).toBe(5)
  })
})

// ---------------------------------------------------------------------------
// getFileExtension
// ---------------------------------------------------------------------------

describe("getFileExtension", () => {
  test("extracts extension from filename", () => {
    expect(getFileExtension("/path/to/file.ts")).toBe("ts")
  })

  test("extracts last extension for dotfiles", () => {
    expect(getFileExtension("/path/.eslintrc.json")).toBe("json")
  })

  test("returns empty string for no extension", () => {
    expect(getFileExtension("/path/Makefile")).toBe("")
  })
})

// ---------------------------------------------------------------------------
// extToFiletype
// ---------------------------------------------------------------------------

describe("extToFiletype", () => {
  test("maps ts to typescript", () => {
    expect(extToFiletype("ts")).toBe("typescript")
  })

  test("maps tsx to tsx", () => {
    expect(extToFiletype("tsx")).toBe("tsx")
  })

  test("maps py to python", () => {
    expect(extToFiletype("py")).toBe("python")
  })

  test("maps yml and yaml to yaml", () => {
    expect(extToFiletype("yml")).toBe("yaml")
    expect(extToFiletype("yaml")).toBe("yaml")
  })

  test("returns text for unknown extension", () => {
    expect(extToFiletype("xyz")).toBe("text")
  })
})
