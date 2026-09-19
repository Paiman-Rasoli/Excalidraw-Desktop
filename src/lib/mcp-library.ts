import {
  CaptureUpdateAction,
  exportToCanvas,
  restoreElements,
} from "@excalidraw/excalidraw";
import type {
  ExcalidrawElement,
  ExcalidrawLinearElement,
  ExcalidrawTextElement,
} from "@excalidraw/excalidraw/element/types";
import type { LibraryItem, LibraryItems } from "@excalidraw/excalidraw/types";
import { invoke } from "@tauri-apps/api/core";
import { peekLibraryItems, whenExcalidrawReady } from "./excalidraw-handle";

/**
 * Personal-library access for MCP agents.
 *
 * Most items in a real library are unnamed shape clusters, so a metadata list
 * cannot tell a database icon from a person. `previewLibrary` exists for that:
 * it renders every item into one indexed contact sheet the agent can actually
 * look at, and then it inserts by index.
 */

function round(value: number, places = 1): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/**
 * The imperative API has `updateLibrary` but no getter, so read the mirror fed
 * by `onLibraryChange`, falling back to the file Rust persists when the canvas
 * has not emitted a change yet this session.
 */
async function getLibrary(): Promise<LibraryItems> {
  const live = peekLibraryItems();
  if (live) {
    return live;
  }
  try {
    return await invoke<LibraryItems>("load_library_items");
  } catch {
    return [];
  }
}

function itemBounds(item: LibraryItem) {
  const minX = Math.min(...item.elements.map((el) => el.x));
  const minY = Math.min(...item.elements.map((el) => el.y));
  const maxX = Math.max(...item.elements.map((el) => el.x + el.width));
  const maxY = Math.max(...item.elements.map((el) => el.y + el.height));
  return { minX, minY, width: maxX - minX, height: maxY - minY };
}

function describeItem(item: LibraryItem, index: number) {
  const bounds = itemBounds(item);
  const text = item.elements
    .filter((el) => el.type === "text")
    .map((el) => (el as ExcalidrawTextElement).text)
    .join(" ")
    .trim();

  return {
    index,
    id: item.id,
    ...(item.name && { name: item.name }),
    ...(text && { text: text.slice(0, 60) }),
    elements: item.elements.length,
    types: [...new Set(item.elements.map((el) => el.type))],
    w: round(bounds.width),
    h: round(bounds.height),
  };
}

export async function listLibrary() {
  const items = await getLibrary();
  const named = items.filter((item) => item.name).length;
  const unnamed = items.length - named;

  return {
    count: items.length,
    named,
    items: items.map(describeItem),
    ...(unnamed > 0 && {
      hint:
        `${unnamed} of ${items.length} items have no name and cannot be told apart ` +
        `from this list. Call preview_library to see them all as one indexed image, ` +
        `then insert by index.`,
    }),
  };
}

/* ----------------------------- contact sheet ------------------------------ */

const CELL = 108;
const LABEL_H = 14;
const PAD = 6;

export async function previewLibrary(rawParams: unknown) {
  const params = (rawParams ?? {}) as {
    indices?: number[];
    columns?: number;
    cell?: number;
  };

  const library = await getLibrary();
  if (!library.length) {
    throw new Error("The personal library is empty; there is nothing to preview.");
  }

  const chosen = params.indices?.length
    ? params.indices.map((index) => {
        const item = library[index];
        if (!item) {
          throw new Error(
            `No library item at index ${index}. The library has ${library.length} items ` +
              `(0-${library.length - 1}).`,
          );
        }
        return { item, index };
      })
    : library.map((item, index) => ({ item, index }));

  const cell = clamp(params.cell ?? CELL, 48, 256);
  const columns = clamp(params.columns ?? Math.ceil(Math.sqrt(chosen.length)), 1, 16);
  const rows = Math.ceil(chosen.length / columns);

  const cellW = cell + PAD * 2;
  const cellH = cell + LABEL_H + PAD * 2;

  const sheet = document.createElement("canvas");
  sheet.width = columns * cellW;
  sheet.height = rows * cellH;

  const ctx = sheet.getContext("2d");
  if (!ctx) {
    throw new Error("Could not get a 2D canvas context to build the preview sheet.");
  }

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, sheet.width, sheet.height);
  ctx.font = "600 11px ui-monospace, monospace";
  ctx.textBaseline = "top";

  let failed = 0;

  for (let slot = 0; slot < chosen.length; slot++) {
    const { item, index } = chosen[slot];
    const originX = (slot % columns) * cellW;
    const originY = Math.floor(slot / columns) * cellH;

    ctx.strokeStyle = "#e4e4e7";
    ctx.lineWidth = 1;
    ctx.strokeRect(originX + 0.5, originY + 0.5, cellW - 1, cellH - 1);

    ctx.fillStyle = "#71717a";
    ctx.fillText(
      item.name ? `${index} ${item.name}`.slice(0, 18) : String(index),
      originX + PAD,
      originY + PAD,
    );

    try {
      const tile = await exportToCanvas({
        elements: item.elements,
        files: null,
        appState: { exportBackground: false, exportEmbedScene: false },
        maxWidthOrHeight: cell,
        exportPadding: 2,
      });
      ctx.drawImage(
        tile,
        originX + PAD + (cell - tile.width) / 2,
        originY + PAD + LABEL_H + (cell - tile.height) / 2,
      );
    } catch {
      failed++;
      ctx.fillStyle = "#ef4444";
      ctx.fillText("failed", originX + PAD, originY + PAD + LABEL_H);
    }
  }

  const blob = await new Promise<Blob | null>((resolve) =>
    sheet.toBlob(resolve, "image/png"),
  );
  if (!blob) {
    throw new Error("Could not encode the library preview sheet.");
  }

  return {
    mimeType: "image/png",
    base64: await blobToBase64(blob),
    byteLength: blob.size,
    count: chosen.length,
    columns,
    width: sheet.width,
    height: sheet.height,
    ...(failed > 0 && { failedToRender: failed }),
  };
}

/* -------------------------------- insertion ------------------------------- */

const ID_ALPHABET =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_";

/** Excalidraw ids are 21-char nanoids; any unique string of that shape works. */
function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(21));
  let id = "";
  for (const byte of bytes) {
    id += ID_ALPHABET[byte & 63];
  }
  return id;
}

function randomInt(): number {
  return Math.floor(Math.random() * 2 ** 31);
}

/**
 * Copy a library item onto the canvas.
 *
 * Every id has to be remapped, not only `id`: these items carry `groupIds`,
 * `boundElements` and arrow bindings, and reusing them would fuse the new copy
 * into earlier copies of the same item. The whole thing also gets one fresh
 * outer group so it drags as a single object, matching what Excalidraw's own
 * library insert does.
 */
function cloneLibraryElements(
  elements: readonly ExcalidrawElement[],
  offsetX: number,
  offsetY: number,
): ExcalidrawElement[] {
  const idMap = new Map(elements.map((el) => [el.id, newId()]));
  const groupMap = new Map<string, string>();

  const remapGroup = (group: string) => {
    let next = groupMap.get(group);
    if (!next) {
      next = newId();
      groupMap.set(group, next);
    }
    return next;
  };

  const outerGroup = elements.length > 1 ? newId() : null;

  return elements.map((el) => {
    const clone: Record<string, unknown> = {
      ...el,
      id: idMap.get(el.id)!,
      x: el.x + offsetX,
      y: el.y + offsetY,
      seed: randomInt(),
      version: 1,
      versionNonce: randomInt(),
      updated: Date.now(),
      isDeleted: false,
      // groupIds run innermost -> outermost, so the wrapper goes last.
      groupIds: [
        ...(el.groupIds ?? []).map(remapGroup),
        ...(outerGroup ? [outerGroup] : []),
      ],
    };

    if (el.boundElements) {
      clone.boundElements = el.boundElements.map((bound) => ({
        ...bound,
        id: idMap.get(bound.id) ?? bound.id,
      }));
    }
    if (el.type === "text" && el.containerId) {
      clone.containerId = idMap.get(el.containerId) ?? el.containerId;
    }
    if (el.frameId) {
      clone.frameId = idMap.get(el.frameId) ?? el.frameId;
    }

    const linear = el as ExcalidrawLinearElement;
    if (linear.startBinding) {
      clone.startBinding = {
        ...linear.startBinding,
        elementId:
          idMap.get(linear.startBinding.elementId) ?? linear.startBinding.elementId,
      };
    }
    if (linear.endBinding) {
      clone.endBinding = {
        ...linear.endBinding,
        elementId: idMap.get(linear.endBinding.elementId) ?? linear.endBinding.elementId,
      };
    }

    return clone as unknown as ExcalidrawElement;
  });
}

export async function insertLibraryItem(rawParams: unknown) {
  const params = (rawParams ?? {}) as {
    index?: number;
    id?: string;
    x?: number;
    y?: number;
  };

  const library = await getLibrary();
  if (!library.length) {
    throw new Error("The personal library is empty; there is nothing to insert.");
  }

  let item: LibraryItem | undefined;

  if (typeof params.id === "string") {
    item = library.find((entry) => entry.id === params.id);
    if (!item) {
      throw new Error(
        `No library item with id "${params.id}". Call list_library for the current ids.`,
      );
    }
  } else if (typeof params.index === "number") {
    item = library[params.index];
    if (!item) {
      throw new Error(
        `No library item at index ${params.index}. The library has ${library.length} ` +
          `items (0-${library.length - 1}).`,
      );
    }
  } else {
    throw new Error("insert_library_item needs either `index` or `id`.");
  }

  const api = await whenExcalidrawReady();
  const existing = api.getSceneElementsIncludingDeleted();

  // The item carries arbitrary coordinates; place its top-left at the target.
  const bounds = itemBounds(item);
  const targetX = params.x ?? 0;
  const targetY = params.y ?? 0;

  const cloned = cloneLibraryElements(
    item.elements,
    targetX - bounds.minX,
    targetY - bounds.minY,
  );

  // Normalises fractional indices and re-checks the remapped bindings.
  const restored = restoreElements(cloned, null, { repairBindings: true });

  api.updateScene({
    elements: [...existing, ...restored],
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });

  return {
    inserted: restored.length,
    id: item.id,
    ...(item.name && { name: item.name }),
    x: round(targetX),
    y: round(targetY),
    width: round(bounds.width),
    height: round(bounds.height),
    ids: restored.map((el) => el.id),
  };
}
