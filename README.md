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

## Releases

You can find pre-built desktop versions for your OS in the repository's **Releases** page.

## Project structure

- `src/`: React frontend
- `src-tauri/`: Rust + Tauri desktop backend
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
