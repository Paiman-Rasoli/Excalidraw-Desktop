import type {
  ExcalidrawImperativeAPI,
  LibraryItems,
} from "@excalidraw/excalidraw/types";

/**
 * Module-level handle on the Excalidraw imperative API.
 *
 * The MCP bridge runs outside the React tree, so it cannot read context. It
 * also needs a readiness primitive: a tool call can arrive before the lazily
 * loaded Excalidraw chunk has mounted.
 */

let api: ExcalidrawImperativeAPI | null = null;
let resolveReady: ((value: ExcalidrawImperativeAPI) => void) | null = null;
let readyPromise = new Promise<ExcalidrawImperativeAPI>((resolve) => {
  resolveReady = resolve;
});

/** Called from `<Excalidraw excalidrawAPI={...}>`. Pass null on teardown. */
export function setExcalidrawAPI(next: ExcalidrawImperativeAPI | null): void {
  if (next === api) {
    return;
  }
  api = next;

  if (next) {
    resolveReady?.(next);
    resolveReady = null;
  } else {
    // Re-arm the gate. Without this, a resolved promise would keep handing out
    // the old instance after an HMR remount.
    readyPromise = new Promise<ExcalidrawImperativeAPI>((resolve) => {
      resolveReady = resolve;
    });
  }
}

/** Only clears if `expected` is still the live instance. */
export function clearExcalidrawAPI(expected: ExcalidrawImperativeAPI): void {
  if (api === expected) {
    setExcalidrawAPI(null);
  }
}

/** Synchronous peek. Null until the lazy chunk mounts. */
export function peekExcalidrawAPI(): ExcalidrawImperativeAPI | null {
  return api;
}

/** Resolves once the canvas is mounted; rejects so a tool call can never hang. */
export function whenExcalidrawReady(timeoutMs = 15_000): Promise<ExcalidrawImperativeAPI> {
  if (api) {
    return Promise.resolve(api);
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Excalidraw canvas not ready after ${timeoutMs}ms`)),
      timeoutMs,
    );
  });

  return Promise.race([readyPromise, timeout]).finally(() => {
    clearTimeout(timer);
  });
}

/**
 * The imperative API exposes `updateLibrary` but no getter, so mirror what
 * `onLibraryChange` reports. Falls back to the file Rust persists when the
 * canvas has not emitted a change yet this session.
 */
let libraryItems: LibraryItems | null = null;

export function setLibraryItems(items: LibraryItems): void {
  libraryItems = items;
}

export function peekLibraryItems(): LibraryItems | null {
  return libraryItems;
}
