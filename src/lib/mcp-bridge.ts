import { Channel, invoke } from "@tauri-apps/api/core";
import { peekExcalidrawAPI } from "./excalidraw-handle";
import { MCP_OPS } from "./mcp-tools";

/** Rust -> here. Mirrors `BridgeRequest` in src-tauri/src/mcp/bridge.rs. */
type BridgeRequest = {
  id: number;
  op: string;
  params: unknown;
};

type BridgeReply = { status: "ok"; data: unknown } | { status: "err"; message: string };

let installPromise: Promise<void> | null = null;

/**
 * Hand Rust a channel it can push tool calls down. Registering is also how
 * Rust learns the canvas is live, so call this only once `excalidrawAPI`
 * exists.
 *
 * Idempotent: safe under a StrictMode double-invoked effect and across HMR.
 */
export function installMcpBridge(): Promise<void> {
  if (!installPromise) {
    const channel = new Channel<BridgeRequest>();
    channel.onmessage = (request) => {
      void handleRequest(request);
    };

    installPromise = invoke<void>("mcp_bridge_register", { channel }).catch((error) => {
      installPromise = null; // let a later mount retry
      throw error;
    });
  }
  return installPromise as Promise<void>;
}

/**
 * Every write op is a read-modify-write over the scene. Two concurrent
 * add_elements would both read the pre-state, and the second updateScene would
 * silently drop the first one's work. Chaining removes the whole class of bug.
 */
let tail: Promise<unknown> = Promise.resolve();

function serialize<T>(work: () => Promise<T>): Promise<T> {
  const next = tail.then(work, work);
  tail = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

async function handleRequest(request: BridgeRequest): Promise<void> {
  let reply: BridgeReply;

  try {
    const handler = MCP_OPS[request.op];
    if (!handler) {
      throw new Error(
        `Unknown op "${request.op}". Known: ${Object.keys(MCP_OPS).join(", ")}`,
      );
    }
    reply = { status: "ok", data: await serialize(() => handler(request.params)) };
    flashToast(request.op);
  } catch (error) {
    reply = { status: "err", message: describeError(error) };
    console.error(`[mcp] ${request.op} failed`, error);
  }

  try {
    await invoke("mcp_bridge_reply", { id: request.id, reply });
  } catch (error) {
    // Rust already dropped the pending request (timed out, or the page
    // reloaded). Retrying cannot help and throwing would kill the handler.
    console.error(`[mcp] could not deliver result for #${request.id}`, error);
  }
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

/** Tell the user something external just touched their canvas. */
function flashToast(op: string): void {
  if (op === "ping") {
    return;
  }
  peekExcalidrawAPI()?.setToast({ message: `MCP · ${op}`, duration: 1200 });
}
