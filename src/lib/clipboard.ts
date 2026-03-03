/**
 * System clipboard integration.
 *
 * Detects available clipboard tools in order of preference:
 *   1. Wayland: wl-copy / wl-paste (when WAYLAND_DISPLAY is set)
 *   2. X11: xclip or xsel (when DISPLAY is set)
 *   3. macOS: pbcopy / pbpaste
 *
 * Falls back to OSC 52 escape sequence for copy if no tool is found.
 * Paste has no fallback — returns null if no tool is available.
 */

import { log } from "./logger"

interface ClipboardTool {
  copy: string[]
  paste: string[]
}

/** Detect which clipboard tool is available. Cached after first call. */
let cachedTool: ClipboardTool | null | undefined = undefined

const detectTool = async (): Promise<ClipboardTool | null> => {
  if (cachedTool !== undefined) return cachedTool

  const tryRun = async (cmd: string): Promise<boolean> => {
    try {
      const proc = Bun.spawn([cmd, "--version"], {
        stdout: "ignore",
        stderr: "ignore",
      })
      await proc.exited
      return true
    } catch {
      // Also try --help for tools that don't have --version
      try {
        const proc = Bun.spawn([cmd, "--help"], {
          stdout: "ignore",
          stderr: "ignore",
        })
        await proc.exited
        return true
      } catch {
        return false
      }
    }
  }

  // Wayland
  if (process.env.WAYLAND_DISPLAY) {
    if (await tryRun("wl-copy")) {
      cachedTool = {
        copy: ["wl-copy"],
        paste: ["wl-paste", "--no-newline"],
      }
      log.app.info("Clipboard: using wl-copy/wl-paste (Wayland)")
      return cachedTool
    }
  }

  // X11
  if (process.env.DISPLAY) {
    if (await tryRun("xclip")) {
      cachedTool = {
        copy: ["xclip", "-selection", "clipboard"],
        paste: ["xclip", "-selection", "clipboard", "-o"],
      }
      log.app.info("Clipboard: using xclip (X11)")
      return cachedTool
    }
    if (await tryRun("xsel")) {
      cachedTool = {
        copy: ["xsel", "--clipboard", "--input"],
        paste: ["xsel", "--clipboard", "--output"],
      }
      log.app.info("Clipboard: using xsel (X11)")
      return cachedTool
    }
  }

  // macOS
  if (process.platform === "darwin") {
    cachedTool = {
      copy: ["pbcopy"],
      paste: ["pbpaste"],
    }
    log.app.info("Clipboard: using pbcopy/pbpaste (macOS)")
    return cachedTool
  }

  log.app.warn("Clipboard: no system clipboard tool found, falling back to OSC 52")
  cachedTool = null
  return null
}

/**
 * Copy text to the system clipboard.
 * Returns true if successful.
 */
export const copyToClipboard = async (text: string): Promise<boolean> => {
  const tool = await detectTool()

  if (tool) {
    try {
      const proc = Bun.spawn(tool.copy, {
        stdin: new Response(text).body!,
        stdout: "ignore",
        stderr: "ignore",
      })
      const code = await proc.exited
      if (code === 0) {
        log.app.debug({ len: text.length }, "Copied to system clipboard")
        return true
      }
    } catch (err) {
      log.app.warn({ err }, "System clipboard copy failed")
    }
  }

  // No tool or tool failed — caller should fall back to OSC 52
  return false
}

/**
 * Read text from the system clipboard.
 * Returns null if no clipboard tool is available or read fails.
 */
export const pasteFromClipboard = async (): Promise<string | null> => {
  const tool = await detectTool()
  if (!tool) return null

  try {
    const proc = Bun.spawn(tool.paste, {
      stdout: "pipe",
      stderr: "ignore",
    })
    const output = await new Response(proc.stdout).text()
    const code = await proc.exited
    if (code === 0) {
      log.app.debug({ len: output.length }, "Pasted from system clipboard")
      return output
    }
  } catch (err) {
    log.app.warn({ err }, "System clipboard paste failed")
  }

  return null
}
