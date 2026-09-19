# Excalidraw Desktop (Tauri)

An open-source desktop wrapper around [Excalidraw](https://github.com/excalidraw/excalidraw), built with Tauri + React + TypeScript.

This project aims to make Excalidraw available as a native desktop app experience while staying lightweight and easy to contribute to.

## Why this project

- Run Excalidraw in a desktop app shell
- Use a small, fast stack (Tauri + web UI)
- Keep the codebase open-source and community-friendly

## Tech stack

- [Tauri 2](https://tauri.app/)
- [React](https://react.dev/)
- [TypeScript](https://www.typescriptlang.org/)
- [Vite](https://vite.dev/)

## Development prerequisites

Make sure you have:

- [Node.js](https://nodejs.org/) (LTS recommended)
- [pnpm](https://pnpm.io/)
- [Rust](https://www.rust-lang.org/tools/install)
- Tauri system dependencies for your OS: [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)

## Getting started

Install dependencies:

```bash
pnpm install
```

Run in desktop development mode:

```bash
pnpm desktop:dev
```

Run the web frontend only:

```bash
pnpm dev
```

Build frontend assets:

```bash
pnpm build
```

## MCP server

While the app is open it runs a local [MCP](https://modelcontextprotocol.io/) server, so
AI agents such as Claude Code, Claude Desktop and Cursor can read and draw on the canvas
you have in front of you. Changes appear live and you can undo them.

Add it to a client:

```bash
claude mcp add --transport http excalidraw http://127.0.0.1:3737/mcp
```

The endpoint and a copy button are also in the app, under the gear icon in the AI chat panel.

### Tools

| Tool | What it does |
| --- | --- |
| `get_scene` | Read the canvas: element ids, positions, text and how arrows connect shapes |
| `add_elements` | Append shapes, text and arrows, described in Excalidraw skeleton format |
| `update_elements` | Patch existing elements by id |
| `delete_elements` | Delete by id (a shape takes its label with it; arrows are left alone) |
| `clear_scene` | Empty the canvas (undoable unless `hard`) |
| `export_image` | Render a PNG back to the agent, so it can see its own work |
| `scroll_to_content` | Move the user's viewport |
| `list_library` | List your personal library items with the index used to insert them |
| `preview_library` | Render the whole library as one indexed contact sheet |
| `insert_library_item` | Drop a copy of a library item onto the canvas |

Each call lands as a single undo step, so anything an agent draws can be reversed with Ctrl+Z.

### Security

The server binds to `127.0.0.1` only and validates the `Host` and `Origin` headers, so no
web page can reach it. **It has no authentication**, which means any program running on
your machine can read and modify your canvas while the app is open. Close the app to stop
the server.

## Releases

You can find pre-built desktop versions for your OS in the repository's **Releases** page.

## Project structure

- `src/`: React frontend
- `src/lib/`: MCP bridge and the canvas operations it runs
- `src-tauri/`: Rust + Tauri desktop backend
- `src-tauri/src/mcp/`: MCP server, tool definitions and the webview bridge
- `public/`: static assets

## Open-source license

This repository is licensed under the **MIT License**. See [LICENSE](./LICENSE).

## Attribution

This project is an independent wrapper and is inspired by the Excalidraw project:

- Excalidraw repository: https://github.com/excalidraw/excalidraw

Please review Excalidraw's own licensing and terms for the underlying project and assets.

## Contributing

Contributions are welcome.

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Open a pull request

If you find a bug or have a feature idea, open an issue.
