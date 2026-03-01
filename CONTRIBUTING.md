# Contributing

## Setup

```bash
bun install
bun run dev
```

## Before submitting a PR

```bash
bun run lint        # ESLint
bun run format:check # Prettier
bun run typecheck    # TypeScript
```

Or run all at once:

```bash
bun run ci
```

To auto-fix lint and formatting:

```bash
bun run lint:fix
bun run format
```

## Pull Request rules

- All PRs must target `main`
- CI must pass (lint + format + typecheck)
- At least 1 approval required
- Direct pushes to `main` are not allowed

## Code style

- TypeScript strict mode
- Prettier for formatting (no semicolons, double quotes)
- ESLint with Solid and TypeScript rules
- Prefer `for...of` over `.map/.filter/.reduce`
- Use `wrapMode="none"` for text elements in the TUI
- OpenTUI refs use `let ref: any` pattern (assigned post-mount via `ref={ref}`)
