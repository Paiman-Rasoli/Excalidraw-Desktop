//! Round-trips one MCP tool call through the webview.
//!
//! An MCP tool call arrives on a tokio task, but the only thing that can touch
//! the canvas is `excalidrawAPI` inside the webview. This module owns that
//! hop: Rust pushes a [`BridgeRequest`] down a [`Channel`] and parks on a
//! oneshot until the frontend answers via [`mcp_bridge_reply`].
//!
//! A `Channel` rather than `app.emit` because the frontend has to hand the
//! channel to Rust to register it -- which makes registration double as the
//! "canvas is live" signal. `emit` into a page with no listener is a silent
//! no-op, so a client connecting during startup would burn the whole timeout
//! with nothing to diagnose.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::ipc::Channel;
use tauri::State;
use tokio::sync::{oneshot, watch};

/// How long a tool call waits for the webview to register before giving up.
const READY_TIMEOUT: Duration = Duration::from_secs(30);

/// Rust -> webview. One per tool call.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeRequest {
    pub id: u64,
    /// "ping" | "getScene" | "addElements" | "updateElements"
    /// | "deleteElements" | "clearScene" | "exportImage" | "scrollToContent"
    pub op: &'static str,
    pub params: Value,
}

/// webview -> Rust, via [`mcp_bridge_reply`].
#[derive(Debug, Deserialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum BridgeReply {
    Ok { data: Value },
    Err { message: String },
}

pub struct Bridge {
    /// An AtomicU64 rather than a Uuid: collision-free within the process,
    /// which is the only scope that matters, and it saves a dependency.
    next_id: AtomicU64,
    pending: Mutex<HashMap<u64, oneshot::Sender<BridgeReply>>>,
    channel: Mutex<Option<Channel<BridgeRequest>>>,
    /// Bumped on every (re)registration, to wake callers that arrived before
    /// the webview was up.
    generation: watch::Sender<u64>,
}

impl Default for Bridge {
    fn default() -> Self {
        Self::new()
    }
}

impl Bridge {
    pub fn new() -> Self {
        let (generation, _) = watch::channel(0u64);
        Self {
            next_id: AtomicU64::new(1),
            pending: Mutex::new(HashMap::new()),
            channel: Mutex::new(None),
            generation,
        }
    }

    fn current(&self) -> Option<Channel<BridgeRequest>> {
        self.channel.lock().unwrap().clone()
    }

    async fn wait_for_channel(&self) -> Result<Channel<BridgeRequest>, String> {
        if let Some(channel) = self.current() {
            return Ok(channel);
        }

        let mut rx = self.generation.subscribe();
        let wait = async {
            loop {
                if rx.changed().await.is_err() {
                    return Err("The MCP bridge was shut down.".to_string());
                }
                if let Some(channel) = self.current() {
                    return Ok(channel);
                }
            }
        };

        tokio::time::timeout(READY_TIMEOUT, wait)
            .await
            .map_err(|_| {
                "The Excalidraw canvas has not connected to the MCP bridge. \
                 Is the Excalidraw Desktop window open?"
                    .to_string()
            })?
    }

    /// Run one operation in the webview and wait for its answer.
    pub async fn call(
        &self,
        op: &'static str,
        params: Value,
        timeout: Duration,
    ) -> Result<Value, String> {
        let channel = self.wait_for_channel().await?;
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);

        let (tx, rx) = oneshot::channel();
        self.pending.lock().unwrap().insert(id, tx);

        if let Err(error) = channel.send(BridgeRequest { id, op, params }) {
            self.pending.lock().unwrap().remove(&id);
            return Err(format!("Could not reach the Excalidraw window: {error}"));
        }

        match tokio::time::timeout(timeout, rx).await {
            Ok(Ok(BridgeReply::Ok { data })) => Ok(data),
            Ok(Ok(BridgeReply::Err { message })) => Err(message),
            // The sender was dropped, which only happens in mcp_bridge_reply's
            // drain: the page reloaded out from under this request.
            Ok(Err(_)) => Err(
                "The Excalidraw window reloaded while the request was in flight. Try again."
                    .to_string(),
            ),
            Err(_) => {
                self.pending.lock().unwrap().remove(&id);
                Err(format!(
                    "The Excalidraw window did not answer `{op}` within {}s.",
                    timeout.as_secs()
                ))
            }
        }
    }
}

/// Called by the frontend once `excalidrawAPI` exists, and again on every
/// remount (F5, Vite HMR, window recreate).
#[tauri::command]
pub fn mcp_bridge_register(state: State<'_, Arc<Bridge>>, channel: Channel<BridgeRequest>) {
    let bridge = state.inner();

    // Anything still in flight belonged to the page that just went away.
    // Dropping the senders wakes those tasks immediately with a useful message
    // instead of letting each one burn its full timeout.
    bridge.pending.lock().unwrap().clear();

    *bridge.channel.lock().unwrap() = Some(channel);
    bridge.generation.send_modify(|generation| *generation += 1);
}

#[tauri::command]
pub fn mcp_bridge_reply(state: State<'_, Arc<Bridge>>, id: u64, reply: BridgeReply) {
    if let Some(tx) = state.pending.lock().unwrap().remove(&id) {
        let _ = tx.send(reply);
    }
}
