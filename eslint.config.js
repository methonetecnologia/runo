import js from "@eslint/js"
import tseslint from "typescript-eslint"
import solid from "eslint-plugin-solid/configs/typescript"
import prettier from "eslint-config-prettier"

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    ...solid,
    rules: {
      ...solid.rules,
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      // OpenTUI usa `let ref: any` + ref={ref} que atribui post-mount
      "no-unassigned-vars": "off",
      // Solid usa `props.x;` como tracking expression em createEffect
      "@typescript-eslint/no-unused-expressions": "off",
    },
  },
  prettier,
  {
    ignores: ["node_modules/", "dist/", "bun.lock"],
  }
)
