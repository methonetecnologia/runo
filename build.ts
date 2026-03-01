/**
 * Build script for Runo.
 *
 * Two-step process:
 *   1. Bun.build() bundles the app with SolidJS plugin (target: "bun", outdir: dist/)
 *   2. bun build --compile converts the bundle into a standalone binary
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
import { rmSync } from "fs"

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

console.log(`Building Runo...`)
if (target) console.log(`  Target: ${target}`)
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

// Step 2: Compile the bundle into a standalone binary
const bundledFile = result.outputs[0].path
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
