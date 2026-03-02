/**
 * File-based logger for Runo (powered by Pino).
 *
 * Writes to ~/.runo/runo.log.
 * Logs interactions and state changes — never file content/data.
 *
 * Usage:
 *   import { log } from "../lib/logger"
 *   log.app.info({ path }, "openFile")
 *   log.history.warn({ undo: 0 }, "nothing to undo")
 */

import pino from "pino"
import { mkdirSync, createWriteStream } from "fs"
import { join } from "path"
import { homedir } from "os"

const LOG_DIR = join(homedir(), ".runo")
const LOG_FILE = join(LOG_DIR, "runo.log")

// Ensure directory exists
mkdirSync(LOG_DIR, { recursive: true })

const stream = createWriteStream(LOG_FILE, { flags: "a" })

const rootLogger = pino(
  {
    level: "debug",
    timestamp: pino.stdTimeFunctions.isoTime,
  },
  stream
)

rootLogger.info("Runo session started")

/** Pre-built child loggers per category */
export const log = {
  app: rootLogger.child({ cat: "app" }),
  editor: rootLogger.child({ cat: "editor" }),
  history: rootLogger.child({ cat: "history" }),
  keyboard: rootLogger.child({ cat: "keyboard" }),
  file: rootLogger.child({ cat: "file" }),
  ui: rootLogger.child({ cat: "ui" }),
  root: rootLogger,
}
