import { transformAsync } from "@babel/core"
// @ts-expect-error
import ts from "@babel/preset-typescript"
// @ts-expect-error
import solid from "babel-preset-solid"
import { plugin, type BunPlugin } from "bun"

const solidPlugin: BunPlugin = {
  name: "solid-transform",
  setup: (build) => {
    // Redirect solid-js server to client
    build.onLoad({ filter: /\/node_modules\/solid-js\/dist\/server\.js$/ }, async (args) => {
      const path = args.path.replace("server.js", "solid.js")
      const file = Bun.file(path)
      const code = await file.text()
      return { contents: code, loader: "js" }
    })
    build.onLoad({ filter: /\/node_modules\/solid-js\/store\/dist\/server\.js$/ }, async (args) => {
      const path = args.path.replace("server.js", "store.js")
      const file = Bun.file(path)
      const code = await file.text()
      return { contents: code, loader: "js" }
    })
    // Transform JSX with Solid
    build.onLoad({ filter: /\.(js|ts)x$/ }, async (args) => {
      const file = Bun.file(args.path)
      const code = await file.text()
      const result = await transformAsync(code, {
        filename: args.path,
        presets: [
          [solid, { moduleName: "@opentui/solid", generate: "universal" }],
          [ts],
        ],
      })
      return { contents: result?.code ?? "", loader: "js" }
    })
  },
}

plugin(solidPlugin)
