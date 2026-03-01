# Runo

A terminal-based IDE inspired by VS Code, built entirely on top of [OpenTUI](https://github.com/murat-sen-tr/opentui) and [SolidJS](https://www.solidjs.com/).

Runo aims to bring the familiar features of visual IDEs like VS Code into the terminal, offering a lightweight and performant alternative for developers who prefer or need to work in terminal environments.

## Why Runo?

Modern visual IDEs are powerful but heavy. They consume significant memory and CPU, and are not always available in remote servers, containers, or minimal environments. Terminal editors like Vim and Nano exist, but their learning curve and lack of visual affordances keep many developers away.

Runo bridges that gap: **a VS Code-like experience that runs in your terminal.**

- File explorer with tree navigation
- Syntax highlighting powered by [Shiki](https://shiki.style/) (VS Code TextMate grammars)
- Tab system with preview and pinned tabs
- Code editing with cursor, scroll sync, and line numbers
- Resizable sidebar with drag handle
- Single-file mode (`--file` / `-f`) for quick editing without the full IDE layout
- Mouse support (click, drag, hover)
- Status bar with file info, cursor position, and keyboard shortcuts

## Built with AI

This project was created in collaboration with multiple AI models, alternated throughout the development process using the [opencode](https://github.com/nicholascostadev/opencode) agent tool.

[Methone Tecnologia](https://github.com/methonetecnologia) believes in a world where AI can be used as a force for good, amplifying the productive capacity of developers around the globe. Runo is a direct product of that belief — built by a human developer working alongside AI agents as coding partners.

The author's interest in building a terminal IDE came directly from using opencode, which introduced him to [OpenTUI](https://github.com/murat-sen-tr/opentui) — the terminal rendering engine that powers Runo's entire UI.

## Architecture & OpenTUI Dependency

Runo's rendering layer depends entirely on **OpenTUI** (`@opentui/core` + `@opentui/solid`). OpenTUI provides the terminal rendering primitives (`<box>`, `<text>`, `<scrollbox>`) that make the IDE's layout possible.

**For contributors and maintainers:** if a feature requires complex terminal rendering capabilities that don't exist yet (e.g., advanced input handling, new layout modes, accessibility), those should be implemented upstream in [OpenTUI](https://github.com/murat-sen-tr/opentui) first. Once accepted and released there, we can integrate them into Runo.

### Tech Stack

| Layer               | Technology                                         |
| ------------------- | -------------------------------------------------- |
| Runtime             | [Bun](https://bun.sh/)                             |
| UI Framework        | [SolidJS](https://www.solidjs.com/)                |
| Terminal Renderer   | [OpenTUI](https://github.com/murat-sen-tr/opentui) |
| Syntax Highlighting | [Shiki](https://shiki.style/)                      |
| Language            | TypeScript / TSX                                   |

### Project Structure

```
src/
  index.tsx              # Entry point, app layout, state management
  components/
    FileTree.tsx          # Sidebar file explorer
    CodeViewer.tsx        # Editor panel (gutter + code + cursor)
    TabBar.tsx            # Tab management (preview/pinned)
    StatusBar.tsx         # Bottom status bar
  lib/
    files.ts              # Filesystem utilities (scan, read, write)
    highlighter.ts        # Shiki highlighter singleton
    scrollbox.ts          # OpenTUI scrollbox patches
```

## Getting Started

### Prerequisites

- [Bun](https://bun.sh/) v1.0+

### Install & Run

```bash
git clone https://github.com/methonetecnologia/runo.git
cd runo
bun install
bun run dev
```

### Single-File Mode

Open a single file without the sidebar, focused entirely on content:

```bash
bun run dev -- --file ./path/to/file.ts
# or
bun run dev -- -f ./path/to/file.ts
```

### Keyboard Shortcuts

| Shortcut            | Action                                   |
| ------------------- | ---------------------------------------- |
| `Tab`               | Switch focus between explorer and editor |
| `j` / `k` or arrows | Navigate file tree / move cursor         |
| `Enter`             | Open file / toggle directory             |
| `h` / `l`           | Collapse / expand directory              |
| `Ctrl+S`            | Save current file                        |
| `Ctrl+W`            | Close active tab                         |
| `Ctrl+C`            | Exit                                     |

## Development

```bash
bun run dev          # Start the IDE
bun test             # Run tests
bun run lint         # Lint with ESLint
bun run format       # Format with Prettier
bun run typecheck    # TypeScript type checking
bun run ci           # Full CI pipeline (lint + format check + tests)
```

## Contributing

Contributions are welcome. Before submitting a PR:

1. Make sure `bun run ci` passes
2. If your change requires new terminal rendering capabilities, consider contributing to [OpenTUI](https://github.com/murat-sen-tr/opentui) first
3. Keep the codebase simple and maintainable — avoid unnecessary abstractions

## License

This project is licensed under [Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)](https://creativecommons.org/licenses/by-nc/4.0/).

You are free to use, share, and adapt this project for **non-commercial purposes** with proper attribution. Commercial use is not permitted.

See [LICENSE](./LICENSE) for details.

---

Created by [Methone Tecnologia](https://github.com/methonetecnologia) with the help of AI.
