/**
 * Build script for Runo.
 *
 * Two-step process:
 *   1. Bun.build() bundles the app with SolidJS plugin (target: "bun", outdir: dist/)
 *   2. Patch the dynamic @opentui/core platform import to a static one for the target
 *   3. bun build --compile converts the bundle into a standalone binary
 *
 * Usage:
 *   bun run build.ts                           # build for current platform
 *   bun run build.ts --target=bun-linux-x64    # cross-compile
 */

import { transformAsync } from "@babel/core"
// @ts-expect-error
import ts from "@babel/preset-typescript"
// @ts-expect-error
import solid from "babel-preset-solid"
import type { BunPlugin } from "bun"
import { rmSync, readFileSync, writeFileSync } from "fs"

const solidPlugin: BunPlugin = {
  name: "solid-transform",
  setup: (build) => {
    build.onLoad({ filter: /\/node_modules\/solid-js\/dist\/server\.js$/ }, async (args) => {
      const path = args.path.replace("server.js", "solid.js")
      return { contents: await Bun.file(path).text(), loader: "js" }
    })
    build.onLoad({ filter: /\/node_modules\/solid-js\/store\/dist\/server\.js$/ }, async (args) => {
      const path = args.path.replace("server.js", "store.js")
      return { contents: await Bun.file(path).text(), loader: "js" }
    })
    build.onLoad({ filter: /\.(js|ts)x$/ }, async (args) => {
      const code = await Bun.file(args.path).text()
      const result = await transformAsync(code, {
        filename: args.path,
        presets: [[solid, { moduleName: "@opentui/solid", generate: "universal" }], [ts]],
      })
      return { contents: result?.code ?? "", loader: "js" }
    })
  },
}

/**
 * Map bun compile target to @opentui/core platform package name.
 * bun-linux-x64   -> @opentui/core-linux-x64
 * bun-darwin-arm64 -> @opentui/core-darwin-arm64
 * bun-windows-x64  -> @opentui/core-win32-x64
 */
function targetToPlatformPkg(target: string | undefined): string {
  if (!target) {
    // Current platform
    const os = process.platform === "win32" ? "win32" : process.platform
    return `@opentui/core-${os}-${process.arch}`
  }
  // target format: bun-<os>-<arch>  e.g. bun-linux-x64, bun-darwin-arm64, bun-windows-x64
  const parts = target.replace("bun-", "").split("-")
  let os = parts[0]
  const arch = parts[1]
  if (os === "windows") os = "win32"
  return `@opentui/core-${os}-${arch}`
}

// Parse --target and --outfile from CLI args
const args = process.argv.slice(2)
let target: string | undefined
let outfile = "runo"

for (const arg of args) {
  if (arg.startsWith("--target=")) {
    target = arg.split("=")[1]
  }
  if (arg.startsWith("--outfile=")) {
    outfile = arg.split("=")[1]
  }
}

const platformPkg = targetToPlatformPkg(target)

console.log(`Building Runo...`)
if (target) console.log(`  Target: ${target}`)
console.log(`  Platform binding: ${platformPkg}`)
console.log(`  Output: ${outfile}`)

// Step 1: Bundle with SolidJS plugin (always target "bun" here)
const result = await Bun.build({
  entrypoints: ["./src/index.tsx"],
  outdir: "./dist",
  plugins: [solidPlugin],
  conditions: ["browser"],
  target: "bun",
  minify: true,
  define: {
    "process.env.RUNO_VERSION": JSON.stringify(require("./package.json").version),
  },
})

if (!result.success) {
  console.error("Bundle failed:")
  for (const log of result.logs) {
    console.error(log)
  }
  process.exit(1)
}

console.log("Bundle succeeded!")

// Step 2: Patch the dynamic platform import to a static one
const bundledFile = result.outputs[0].path
let bundleCode = readFileSync(bundledFile, "utf-8")

// Replace: import(`@opentui/core-${process.platform}-${process.arch}/index.ts`)
// With:    import("@opentui/core-<platform>-<arch>/index.ts")
const dynamicImportPattern = /import\(`@opentui\/core-\$\{process\.platform\}-\$\{process\.arch\}\/index\.ts`\)/g
const staticImport = `import("${platformPkg}/index.ts")`
const patchCount = (bundleCode.match(dynamicImportPattern) || []).length

if (patchCount > 0) {
  bundleCode = bundleCode.replace(dynamicImportPattern, staticImport)
  writeFileSync(bundledFile, bundleCode)
  console.log(`Patched ${patchCount} dynamic platform import(s) -> ${platformPkg}`)
} else {
  console.log("No dynamic platform imports found to patch (may already be static)")
}

// Step 3: Compile the patched bundle into a standalone binary
const compileArgs = ["bun", "build", "--compile", bundledFile, "--outfile", outfile]
if (target) compileArgs.push(`--target=${target}`)

const proc = Bun.spawn(compileArgs, { stdout: "inherit", stderr: "inherit" })
const exitCode = await proc.exited

// Clean up dist/
try {
  rmSync("./dist", { recursive: true, force: true })
} catch {}

if (exitCode !== 0) {
  console.error("Compile failed")
  process.exit(exitCode)
}

console.log(`Binary ready: ${outfile}`)
