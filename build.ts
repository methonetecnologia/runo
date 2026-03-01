/**
 * Build script for Runo.
 *
 * Compiles the project into a standalone binary using Bun.build + --compile.
 * The SolidJS Babel transform plugin is applied at build time (same as preload.ts).
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

const buildConfig: Parameters<typeof Bun.build>[0] = {
  entrypoints: ["./src/index.tsx"],
  outdir: ".",
  plugins: [solidPlugin],
  conditions: ["browser"],
  target: (target as any) ?? "bun",
  minify: true,
  define: {
    "process.env.RUNO_VERSION": JSON.stringify(require("./package.json").version),
  },
}

const result = await Bun.build(buildConfig)

if (!result.success) {
  console.error("Build failed:")
  for (const log of result.logs) {
    console.error(log)
  }
  process.exit(1)
}

console.log("Build succeeded!")

// Now compile the bundled output into a standalone binary
const bundledFile = result.outputs[0].path
const compileArgs = ["bun", "build", "--compile", bundledFile, "--outfile", outfile]
if (target) compileArgs.push(`--target=${target}`)

const proc = Bun.spawn(compileArgs, { stdout: "inherit", stderr: "inherit" })
const exitCode = await proc.exited

// Clean up intermediate bundle
try {
  const { unlinkSync } = await import("fs")
  unlinkSync(bundledFile)
} catch {}

if (exitCode !== 0) {
  console.error("Compile failed")
  process.exit(exitCode)
}

console.log(`Binary ready: ${outfile}`)
