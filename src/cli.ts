/**
 * CLI argument parsing and subcommands (upgrade, --version, --help).
 *
 * This runs BEFORE the TUI boots. If a subcommand is matched,
 * it executes and exits. Otherwise, returns parsed options for the IDE.
 */

import { resolve } from "path"
import { existsSync, statSync } from "fs"

const REPO = "methonetecnologia/runo"
const VERSION = process.env.RUNO_VERSION ?? "dev"

export interface CliOptions {
  /** Single-file mode: absolute path to the file */
  singleFile: string | null
}

/** Detect current platform in the format used by release asset names */
function getPlatformAsset(): string {
  const platform = process.platform
  const arch = process.arch === "arm64" ? "arm64" : "x64"

  let os: string
  if (platform === "darwin") os = "darwin"
  else if (platform === "win32") os = "windows"
  else os = "linux"

  return `runo-${os}-${arch}`
}

/** Self-update: download latest binary from GitHub Releases */
async function upgrade(): Promise<void> {
  console.log(`Runo ${VERSION}`)
  console.log("Checking for updates...")

  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`)
  if (!res.ok) {
    console.error(`Failed to check for updates: ${res.status} ${res.statusText}`)
    process.exit(1)
  }

  const release = (await res.json()) as {
    tag_name: string
    assets: { name: string; browser_download_url: string }[]
  }
  const latest = release.tag_name.replace(/^v/, "")

  if (VERSION === latest) {
    console.log("Already up to date.")
    return
  }

  console.log(`Updating ${VERSION} -> ${latest}...`)

  const assetName = getPlatformAsset()
  const asset = release.assets.find((a) => a.name === assetName)
  if (!asset) {
    console.error(`No binary available for your platform: ${assetName}`)
    console.error(`Available: ${release.assets.map((a) => a.name).join(", ")}`)
    process.exit(1)
  }

  const binary = await fetch(asset.browser_download_url)
  if (!binary.ok) {
    console.error(`Download failed: ${binary.status}`)
    process.exit(1)
  }

  const execPath = process.execPath
  const tmpPath = execPath + ".tmp"
  const bakPath = execPath + ".bak"

  const { chmod, rename, unlink } = await import("fs/promises")

  await Bun.write(tmpPath, binary)
  await chmod(tmpPath, 0o755)

  try {
    await rename(execPath, bakPath)
    await rename(tmpPath, execPath)
    await unlink(bakPath).catch(() => {})
  } catch (err: any) {
    // Rollback if possible
    await rename(bakPath, execPath).catch(() => {})
    await unlink(tmpPath).catch(() => {})
    console.error(`Update failed: ${err.message}`)
    console.error("You may need to run with sudo.")
    process.exit(1)
  }

  console.log(`Updated to ${latest}`)
}

function printHelp(): void {
  console.log(`Runo ${VERSION} - Terminal IDE`)
  console.log("")
  console.log("Usage:")
  console.log("  runo                     Open IDE in current directory")
  console.log("  runo --file <path>       Open a single file (no sidebar)")
  console.log("  runo -f <path>           Same as --file")
  console.log("  runo upgrade             Update to the latest version")
  console.log("  runo --version           Show version")
  console.log("  runo --help              Show this help")
}

/**
 * Parse CLI args. Handles subcommands (upgrade, --version, --help)
 * and returns options for the IDE if no subcommand matched.
 */
export async function parseCli(): Promise<CliOptions> {
  const args = process.argv.slice(2)

  // Subcommands that exit
  if (args.includes("--version") || args.includes("-v")) {
    console.log(VERSION)
    process.exit(0)
  }

  if (args.includes("--help") || args.includes("-h")) {
    printHelp()
    process.exit(0)
  }

  if (args[0] === "upgrade") {
    await upgrade()
    process.exit(0)
  }

  // Parse --file / -f
  let singleFile: string | null = null
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--file" || args[i] === "-f") {
      const filePath = args[i + 1]
      if (!filePath) {
        console.error("Error: --file / -f requires a file path argument")
        process.exit(1)
      }
      const resolved = resolve(process.cwd(), filePath)
      if (!existsSync(resolved)) {
        console.error(`Error: file not found: ${resolved}`)
        process.exit(1)
      }
      if (statSync(resolved).isDirectory()) {
        console.error(`Error: expected a file, got a directory: ${resolved}`)
        process.exit(1)
      }
      singleFile = resolved
      break
    }
  }

  return { singleFile }
}
