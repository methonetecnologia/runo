/**
 * Build script for Runo.
 *
 * Two-step process:
 *   1. Bun.build() bundles the app with SolidJS plugin + platform binding resolution
 *   2. bun build --compile converts the bundle into a standalone binary
 *
 * The @opentui/core package uses a dynamic import to load a platform-specific
 * native binding at runtime. For cross-compilation, we intercept this and
 * resolve it statically at build time.
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
import { rmSync, readFileSync, writeFileSync, existsSync } from "fs"
import { resolve, dirname, join } from "path"

/**
 * Map bun compile target to @opentui/core platform package name.
 * bun-linux-x64    -> @opentui/core-linux-x64
 * bun-darwin-arm64 -> @opentui/core-darwin-arm64
 * bun-windows-x64  -> @opentui/core-win32-x64
 */
function targetToPlatformPkg(target: string | undefined): string {
  if (!target) {
    const os = process.platform === "win32" ? "win32" : process.platform
    return `@opentui/core-${os}-${process.arch}`
  }
  const parts = target.replace("bun-", "").split("-")
  let os = parts[0]
  const arch = parts[1]
  if (os === "windows") os = "win32"
  return `@opentui/core-${os}-${arch}`
}

/** Find the native .so/.dylib/.dll path for a platform package */
function findNativeLib(pkg: string): string {
  const pkgDir = resolve("node_modules", pkg.replace("@", "").replace("/", "/"))
  const exts = ["libopentui.so", "libopentui.dylib", "opentui.dll"]
  for (const ext of exts) {
    const libPath = join(pkgDir, ext)
    if (existsSync(libPath)) return libPath
  }
  // Fallback: check @scoped path
  const scopedDir = resolve("node_modules", pkg)
  for (const ext of exts) {
    const libPath = join(scopedDir, ext)
    if (existsSync(libPath)) return libPath
  }
  throw new Error(`Native library not found for ${pkg} in ${pkgDir} or ${scopedDir}`)
}

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
const nativeLibPath = findNativeLib(platformPkg)

console.log(`Building Runo...`)
if (target) console.log(`  Target: ${target}`)
console.log(`  Platform binding: ${platformPkg}`)
console.log(`  Native lib: ${nativeLibPath}`)
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

// Step 2: Patch the bundle to replace the dynamic platform import chain
// with a direct file import of the native library.
//
// The bundle contains:
//   await import(`@opentui/core-${process.platform}-${process.arch}/index.ts`)
// Which at runtime would do:
//   const module = await import("./libopentui.so", { with: { type: "file" } })
//   export default module.default  (the file path)
//
// We replace the entire dynamic import expression so it resolves to
// a direct import of the native lib, which bun --compile can embed.
const bundledFile = result.outputs[0].path
let bundleCode = readFileSync(bundledFile, "utf-8")

// Copy the native lib next to the bundle so relative import works
const distLibPath = join(dirname(bundledFile), "libopentui.native")
const { copyFileSync } = await import("fs")
copyFileSync(nativeLibPath, distLibPath)

// Replace the dynamic template import with inline code that imports the native lib directly
const dynamicImportPattern = /import\(`@opentui\/core-\$\{process\.platform\}-\$\{process\.arch\}\/index\.ts`\)/g
const patchCount = (bundleCode.match(dynamicImportPattern) || []).length

// The replacement: immediately resolve with the native lib path via file import
const replacement = `import("./libopentui.native",{with:{type:"file"}}).then(m=>({default:m.default}))`

if (patchCount > 0) {
  bundleCode = bundleCode.replace(dynamicImportPattern, replacement)
  writeFileSync(bundledFile, bundleCode)
  console.log(`Patched ${patchCount} dynamic platform import(s) -> direct native lib`)
} else {
  console.log("Warning: no dynamic platform imports found to patch")
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
