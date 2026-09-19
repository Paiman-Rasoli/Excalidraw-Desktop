import {
  CaptureUpdateAction,
  convertToExcalidrawElements,
  exportToBlob,
  FONT_FAMILY,
  newElementWith,
} from "@excalidraw/excalidraw";
import type { ExcalidrawElementSkeleton } from "@excalidraw/excalidraw/data/transform";
import type {
  ExcalidrawElement,
  ExcalidrawLinearElement,
  ExcalidrawTextElement,
} from "@excalidraw/excalidraw/element/types";
import { whenExcalidrawReady } from "./excalidraw-handle";
import { insertLibraryItem, listLibrary, previewLibrary } from "./mcp-library";

export type McpOp = (params: unknown) => Promise<unknown>;

/** Op name -> handler. Names match `BridgeRequest.op` on the Rust side. */
export const MCP_OPS: Record<string, McpOp> = {
  ping: async () => ({ pong: true }),
  getScene: handleGetScene,
  addElements: handleAddElements,
  updateElements: handleUpdateElements,
  deleteElements: handleDeleteElements,
  clearScene: handleClearScene,
  exportImage: handleExportImage,
  scrollToContent: handleScrollToContent,
  listLibrary,
  previewLibrary,
  insertLibraryItem,
};

/* -------------------------------------------------------------------------
 * The universal write rule
 *
 * Every write reads getSceneElementsIncludingDeleted() and writes the whole
 * array back. getSceneElements() strips tombstones, so building on it would
 * silently drop previously-deleted elements -- which breaks undo (the Store
 * diffs on the isDeleted transition, not array membership) and orphans
 * boundElements/containerId references that still point at them.
 * ---------------------------------------------------------------------- */

const DEFAULT_STROKE = "#1e1e1e";

function round(value: number, places = 1): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/* ---------------------------------- get ---------------------------------- */

/**
 * Raw elements are ~25 fields each and over 90% seed/versionNonce/index and
 * default styling. An agent needs topology and layout; if it needs paint, it
 * calls exportImage and looks.
 */
function project(
  element: ExcalidrawElement,
  byId: Map<string, ExcalidrawElement>,
): Record<string, unknown> {
  const node: Record<string, unknown> = {
    id: element.id,
    type: element.type,
    x: round(element.x),
    y: round(element.y),
    w: round(element.width),
    h: round(element.height),
  };

  if (element.type === "text") {
    node.text = (element as ExcalidrawTextElement).text;
    if (element.containerId) {
      node.containerId = element.containerId;
    }
  }

  // Fold a bound label up into its container so the graph reads in one pass.
  for (const bound of element.boundElements ?? []) {
    if (bound.type !== "text") {
      continue;
    }
    const label = byId.get(bound.id);
    if (label && label.type === "text") {
      node.text = (label as ExcalidrawTextElement).text;
      node.labelId = label.id;
    }
  }

  if (element.type === "arrow" || element.type === "line") {
    const linear = element as ExcalidrawLinearElement;
    if (linear.startBinding) {
      node.from = linear.startBinding.elementId;
    }
    if (linear.endBinding) {
      node.to = linear.endBinding.elementId;
    }
    if (linear.points && linear.points.length <= 12) {
      node.points = linear.points.map(([x, y]) => [round(x), round(y)]);
    }
  }

  if (element.angle) {
    node.angle = round(element.angle, 3);
  }
  if (element.backgroundColor && element.backgroundColor !== "transparent") {
    node.bg = element.backgroundColor;
  }
  if (element.strokeColor && element.strokeColor !== DEFAULT_STROKE) {
    node.stroke = element.strokeColor;
  }
  if (element.groupIds?.length) {
    node.groupIds = element.groupIds;
  }
  if (element.frameId) {
    node.frameId = element.frameId;
  }
  if (element.link) {
    node.link = element.link;
  }
  if (element.locked) {
    node.locked = true;
  }
  if (element.isDeleted) {
    node.deleted = true;
  }

  return node;
}

async function handleGetScene(rawParams: unknown) {
  const params = (rawParams ?? {}) as {
    ids?: string[];
    includeDeleted?: boolean;
    verbose?: boolean;
    maxElements?: number;
  };

  const api = await whenExcalidrawReady();
  const appState = api.getAppState();
  const all = params.includeDeleted
    ? api.getSceneElementsIncludingDeleted()
    : api.getSceneElements();

  const byId = new Map<string, ExcalidrawElement>(all.map((el) => [el.id, el]));

  // Labels are reported on their container, not as separate elements.
  const folded = new Set(
    all
      .filter(
        (el) =>
          el.type === "text" && el.containerId && byId.has(el.containerId),
      )
      .map((el) => el.id),
  );

  const wanted = params.ids?.length ? new Set(params.ids) : null;

  let nodes = all
    .filter((el) => !folded.has(el.id))
    .filter((el) => !wanted || wanted.has(el.id))
    .map((el) =>
      params.verbose
        ? (el as unknown as Record<string, unknown>)
        : project(el, byId),
    );

  const limit = clamp(params.maxElements ?? 400, 1, 5000);
  const truncated = nodes.length > limit;
  if (truncated) {
    nodes = nodes.slice(0, limit);
  }

  const counts: Record<string, number> = {};
  for (const el of all) {
    counts[el.type] = (counts[el.type] ?? 0) + 1;
  }

  return {
    viewBackgroundColor: appState.viewBackgroundColor,
    scrollX: round(appState.scrollX),
    scrollY: round(appState.scrollY),
    zoom: round(appState.zoom.value, 3),
    theme: appState.theme,
    name: api.getName(),
    count: all.length,
    elements: nodes,
    ...(truncated && {
      truncated: true,
      countsByType: counts,
      hint:
        `Scene has ${all.length} elements; returned the first ${limit}. ` +
        `Pass "ids" to fetch specific ones, or call export_image to see the whole canvas.`,
    }),
  };
}

/* ---------------------------------- add ---------------------------------- */

const FONT_NAMES = FONT_FAMILY as unknown as Record<string, number>;

/** Agents produce font names; Excalidraw wants the numeric id. */
function normalizeFonts(
  skeleton: Record<string, unknown>,
): Record<string, unknown> {
  const next = { ...skeleton };

  if (typeof next.fontFamily === "string") {
    const id = FONT_NAMES[next.fontFamily];
    if (id === undefined) {
      throw new Error(
        `Unknown fontFamily "${next.fontFamily}". Known: ${Object.keys(FONT_NAMES).join(", ")}`,
      );
    }
    next.fontFamily = id;
  }

  if (next.label && typeof next.label === "object") {
    next.label = normalizeFonts(next.label as Record<string, unknown>);
  }

  return next;
}

/** Excalidraw's own FIXED_BINDING_DISTANCE, so the arrow stops just short. */
const BINDING_GAP = 4;

type Box = { x: number; y: number; w: number; h: number };

/**
 * Where a ray from the centre of `box` toward `target` crosses the box border,
 * pushed out by `gap`.
 */
function edgePoint(box: Box, target: { x: number; y: number }, gap: number) {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const dx = target.x - cx;
  const dy = target.y - cy;

  if (dx === 0 && dy === 0) {
    return { x: cx, y: cy };
  }

  const halfW = box.w / 2 + gap;
  const halfH = box.h / 2 + gap;
  const scale = Math.min(
    dx === 0 ? Infinity : halfW / Math.abs(dx),
    dy === 0 ? Infinity : halfH / Math.abs(dy),
  );

  return { x: cx + dx * scale, y: cy + dy * scale };
}

/**
 * Give bound arrows real geometry.
 *
 * `convertToExcalidrawElements` records start/end bindings but does NOT derive
 * the arrow's shape from them -- it leaves the default 100px stub, which then
 * renders on top of the source shape or vanishes into the binding gap. Agents
 * naturally describe a diagram as "box, box, arrow between them" and leave the
 * coordinates to us, so compute them here rather than push the arithmetic back
 * onto the model.
 *
 * Only arrows bound at BOTH ends are touched, and only when the caller did not
 * supply their own `points`.
 */
function layoutBoundArrows(
  elements: readonly ExcalidrawElement[],
): ExcalidrawElement[] {
  const boxes = new Map<string, Box>(
    elements.map((el) => [el.id, { x: el.x, y: el.y, w: el.width, h: el.height }]),
  );

  return elements.map((el) => {
    if (el.type !== "arrow") {
      return el;
    }

    const arrow = el as ExcalidrawLinearElement;
    const from = arrow.startBinding && boxes.get(arrow.startBinding.elementId);
    const to = arrow.endBinding && boxes.get(arrow.endBinding.elementId);
    if (!from || !to) {
      return el;
    }

    // An explicit multi-point path is the caller's own routing; leave it be.
    if (arrow.points && arrow.points.length > 2) {
      return el;
    }

    const start = edgePoint(from, { x: to.x + to.w / 2, y: to.y + to.h / 2 }, BINDING_GAP);
    const end = edgePoint(to, { x: from.x + from.w / 2, y: from.y + from.h / 2 }, BINDING_GAP);

    const dx = end.x - start.x;
    const dy = end.y - start.y;

    return newElementWith(el, {
      x: start.x,
      y: start.y,
      width: Math.abs(dx),
      height: Math.abs(dy),
      points: [
        [0, 0],
        [dx, dy],
      ],
    } as Parameters<typeof newElementWith>[1]);
  });
}

async function handleAddElements(rawParams: unknown) {
  const params = (rawParams ?? {}) as {
    elements?: unknown;
    preserveIds?: boolean;
  };

  if (!Array.isArray(params.elements) || params.elements.length === 0) {
    throw new Error("add_elements requires a non-empty `elements` array.");
  }

  const api = await whenExcalidrawReady();
  const existing = api.getSceneElementsIncludingDeleted();
  const existingIds = new Set(existing.map((el) => el.id));

  const skeletons = (params.elements as Record<string, unknown>[]).map(
    normalizeFonts,
  );

  if (params.preserveIds) {
    // convertToExcalidrawElements only warns about duplicates *within* the
    // batch; it has no view of the canvas. Two array entries with the same id
    // is undefined behaviour for the Scene, so catch it here.
    const conflicts = skeletons
      .map((s) => s.id)
      .filter(
        (id): id is string => typeof id === "string" && existingIds.has(id),
      );

    if (conflicts.length) {
      throw new Error(
        `preserveIds was set but these ids already exist on the canvas: ${conflicts.join(", ")}. ` +
          `Use update_elements to change them, or omit preserveIds to get fresh ids.`,
      );
    }
  }

  const converted = convertToExcalidrawElements(
    skeletons as unknown as ExcalidrawElementSkeleton[],
    { regenerateIds: !params.preserveIds },
  );

  const created = layoutBoundArrows(converted);

  api.updateScene({
    elements: [...existing, ...created],
    // So the user can ctrl-Z whatever the agent just did.
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });

  const labelOf = new Map<string, string>();
  for (const el of created) {
    if (el.type === "text" && el.containerId) {
      labelOf.set(el.containerId, el.id);
    }
  }

  // Arrow bindings resolve only against elements in this same call. Excalidraw
  // console.errors an unresolved one and hands back a silently unbound arrow,
  // so surface it or the agent reports false success.
  // Each arrow skeleton yields exactly one arrow element and relative order is
  // preserved, so the two arrow sequences line up 1:1. (Inline start/end shapes
  // and arrow labels add generic/text elements, never arrows.)
  const warnings: string[] = [];
  const arrowSkeletons = skeletons.filter((s) => s.type === "arrow") as {
    start?: { id?: string };
    end?: { id?: string };
  }[];

  created
    .filter((el) => el.type === "arrow")
    .forEach((el, index) => {
      const arrow = el as ExcalidrawLinearElement;
      const skeleton = arrowSkeletons[index];

      if (skeleton?.start?.id && !arrow.startBinding) {
        warnings.push(
          `Arrow ${el.id}: start id "${skeleton.start.id}" did not resolve, so the arrow is ` +
            `unbound. start/end only reference elements created in this same call.`,
        );
      }
      if (skeleton?.end?.id && !arrow.endBinding) {
        warnings.push(
          `Arrow ${el.id}: end id "${skeleton.end.id}" did not resolve, so the arrow is ` +
            `unbound. start/end only reference elements created in this same call.`,
        );
      }
    });

  return {
    added: created
      .filter((el) => !(el.type === "text" && el.containerId))
      .map((el) => ({
        id: el.id,
        type: el.type,
        x: round(el.x),
        y: round(el.y),
        width: round(el.width),
        height: round(el.height),
        ...(labelOf.has(el.id) && { labelId: labelOf.get(el.id) }),
      })),
    ...(warnings.length > 0 && { warnings }),
  };
}

/* -------------------------------- update --------------------------------- */

/** Fields the caller must not set directly; Excalidraw owns them. */
const PROTECTED_FIELDS = new Set([
  "id",
  "type",
  "version",
  "versionNonce",
  "updated",
  "index",
  "seed",
  "isDeleted",
]);

function sanitizePatch(
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (!PROTECTED_FIELDS.has(key)) {
      clean[key] = value;
    }
  }
  return clean;
}

async function handleUpdateElements(rawParams: unknown) {
  const params = (rawParams ?? {}) as {
    updates?: { id: string; patch?: Record<string, unknown> }[];
  };

  if (!Array.isArray(params.updates) || params.updates.length === 0) {
    throw new Error("update_elements requires a non-empty `updates` array.");
  }

  const api = await whenExcalidrawReady();
  const all = api.getSceneElementsIncludingDeleted();
  const byId = new Map(all.map((el) => [el.id, el]));

  const missing = params.updates
    .filter((u) => !byId.has(u.id))
    .map((u) => u.id);
  if (missing.length) {
    throw new Error(
      `No element(s) with id: ${missing.join(", ")}. Call get_scene for the current ids.`,
    );
  }

  const patches = new Map<string, Record<string, unknown>>();

  for (const { id, patch } of params.updates) {
    const clean = normalizeFonts(sanitizePatch(patch ?? {}));
    patches.set(id, { ...(patches.get(id) ?? {}), ...clean });

    // A container's bound label does not follow it, so carry any move across.
    const target = byId.get(id)!;
    const dx = typeof clean.x === "number" ? clean.x - target.x : 0;
    const dy = typeof clean.y === "number" ? clean.y - target.y : 0;
    if (dx === 0 && dy === 0) {
      continue;
    }

    for (const bound of target.boundElements ?? []) {
      const label = byId.get(bound.id);
      if (bound.type === "text" && label) {
        patches.set(label.id, {
          ...(patches.get(label.id) ?? {}),
          x: label.x + dx,
          y: label.y + dy,
        });
      }
    }
  }

  // newElementWith rather than mutating: elements are Readonly, and writing
  // behind the Scene's back skips the Store increment and breaks undo.
  api.updateScene({
    elements: all.map((el) => {
      const patch = patches.get(el.id);
      return patch ? newElementWith(el, patch) : el;
    }),
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });

  return { updated: [...patches.keys()] };
}

/* -------------------------------- delete --------------------------------- */

async function handleDeleteElements(rawParams: unknown) {
  const params = (rawParams ?? {}) as { ids?: string[]; cascade?: boolean };

  if (!Array.isArray(params.ids) || params.ids.length === 0) {
    throw new Error("delete_elements requires a non-empty `ids` array.");
  }

  const api = await whenExcalidrawReady();
  const all = api.getSceneElementsIncludingDeleted();
  const byId = new Map(all.map((el) => [el.id, el]));

  const missing = params.ids.filter((id) => !byId.has(id));
  if (missing.length) {
    throw new Error(
      `No element(s) with id: ${missing.join(", ")}. Call get_scene for the current ids.`,
    );
  }

  const doomed = new Set(params.ids);

  if (params.cascade !== false) {
    // Bound *text* goes with its container, as it does in the editor. Bound
    // *arrows* deliberately do not -- deleting a node should not silently eat
    // the user's edges; they just render unbound.
    for (const id of params.ids) {
      for (const bound of byId.get(id)?.boundElements ?? []) {
        if (bound.type === "text") {
          doomed.add(bound.id);
        }
      }
    }
  }

  api.updateScene({
    elements: all.map((el) =>
      doomed.has(el.id) && !el.isDeleted
        ? newElementWith(el, { isDeleted: true })
        : el,
    ),
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });

  return { deleted: [...doomed] };
}

/* --------------------------------- clear --------------------------------- */

async function handleClearScene(rawParams: unknown) {
  const params = (rawParams ?? {}) as { hard?: boolean };

  const api = await whenExcalidrawReady();
  const cleared = api.getSceneElements().length;

  if (params.hard) {
    // Also resets background, scroll, zoom and name, and destroys undo.
    api.resetScene();
    return { cleared, hard: true, undoable: false };
  }

  // Tombstoning keeps the Store's diff a clean per-element isDeleted
  // transition, which is what makes the undo reliable.
  api.updateScene({
    elements: api
      .getSceneElementsIncludingDeleted()
      .map((el) =>
        el.isDeleted ? el : newElementWith(el, { isDeleted: true }),
      ),
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });

  return { cleared, hard: false, undoable: true };
}

/* --------------------------------- export -------------------------------- */

const MAX_PNG_BYTES = 1_500_000;
const FALLBACK_SIZES = [1024, 768, 512];

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  // Chunked: btoa(String.fromCharCode(...bytes)) blows the call stack past
  // roughly 100 KB.
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

async function handleExportImage(rawParams: unknown) {
  const params = (rawParams ?? {}) as {
    ids?: string[];
    background?: boolean;
    darkMode?: boolean;
    padding?: number;
    maxWidthOrHeight?: number;
  };

  const api = await whenExcalidrawReady();
  const appState = api.getAppState();

  let elements = api.getSceneElements();

  if (params.ids?.length) {
    const wanted = new Set(params.ids);
    // Pull in a requested shape's bound label and anything in a requested
    // group, so "export this box" includes its text.
    elements = elements.filter((el) => {
      const containerId = el.type === "text" ? el.containerId : null;
      return (
        wanted.has(el.id) ||
        (containerId != null && wanted.has(containerId)) ||
        el.groupIds.some((group) => wanted.has(group))
      );
    });
    if (!elements.length) {
      throw new Error(`No elements matched ids: ${params.ids.join(", ")}`);
    }
  }

  if (!elements.length) {
    throw new Error("The canvas is empty; there is nothing to export.");
  }

  const requested = clamp(params.maxWidthOrHeight ?? 1024, 256, 2048);
  const ladder = [
    requested,
    ...FALLBACK_SIZES.filter((size) => size < requested),
  ];

  let blob: Blob | undefined;
  let usedSize = requested;

  for (const size of ladder) {
    const rendered = await exportToBlob({
      elements,
      files: api.getFiles(), // required key; images render blank without it
      appState: {
        ...appState,
        exportBackground: params.background ?? true,
        exportWithDarkMode: params.darkMode ?? appState.theme === "dark",
        // Otherwise Excalidraw stuffs the whole serialized scene into a PNG
        // tEXt chunk, multiplying the payload for no benefit to an agent.
        exportEmbedScene: false,
        exportScale: 1,
      },
      mimeType: "image/png",
      exportPadding: clamp(params.padding ?? 16, 0, 200),
      maxWidthOrHeight: size,
    });
    blob = rendered;
    usedSize = size;
    if (rendered.size <= MAX_PNG_BYTES) {
      break;
    }
  }

  if (!blob || blob.size > MAX_PNG_BYTES) {
    throw new Error(
      `Rendered PNG is ${Math.round((blob?.size ?? 0) / 1024)} KB even at 512px, over the ` +
        `${MAX_PNG_BYTES / 1024} KB limit. Pass "ids" to export a smaller region.`,
    );
  }

  return {
    mimeType: "image/png",
    base64: await blobToBase64(blob),
    byteLength: blob.size,
    maxWidthOrHeight: usedSize,
    elementCount: elements.length,
  };
}

/* --------------------------------- scroll -------------------------------- */

async function handleScrollToContent(rawParams: unknown) {
  const params = (rawParams ?? {}) as {
    ids?: string[];
    fit?: "content" | "viewport";
    viewportZoomFactor?: number;
    animate?: boolean;
  };

  const api = await whenExcalidrawReady();
  const all = api.getSceneElements();

  let target: readonly ExcalidrawElement[] = all;

  if (params.ids?.length) {
    const wanted = new Set(params.ids);
    target = all.filter((el) => wanted.has(el.id));
    const missing = params.ids.filter(
      (id) => !target.some((el) => el.id === id),
    );
    if (missing.length) {
      throw new Error(`No element(s) with id: ${missing.join(", ")}.`);
    }
  }

  if (!target.length) {
    throw new Error("Nothing to scroll to; the canvas is empty.");
  }

  // Defaults to false: agents chain scroll_to_content -> export_image, and a
  // tween would be captured mid-animation.
  const animate = params.animate ?? false;

  if (params.fit === "viewport") {
    api.scrollToContent(target, {
      fitToViewport: true,
      viewportZoomFactor: clamp(params.viewportZoomFactor ?? 0.7, 0.1, 1),
      animate,
    });
  } else {
    api.scrollToContent(target, { fitToContent: true, animate });
  }

  const next = api.getAppState();
  return {
    scrollX: round(next.scrollX),
    scrollY: round(next.scrollY),
    zoom: round(next.zoom.value, 3),
    focused: target.length,
  };
}
