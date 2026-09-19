pub mod bridge;
pub mod schema;
pub mod server;
pub mod tools;

use std::sync::{Arc, Mutex};

use tauri::{AppHandle, Manager};

pub use server::{MCP_PATH, MCP_PORT};

#[derive(Clone, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpStatusData {
    pub listening: bool,
    pub url: String,
    pub error: Option<String>,
}

#[derive(Default)]
pub struct McpStatus(pub Mutex<McpStatusData>);

#[tauri::command]
pub fn mcp_status(state: tauri::State<'_, McpStatus>) -> McpStatusData {
    state.0.lock().unwrap().clone()
}

/// Spawn the MCP listener on Tauri's runtime. Never panics: a bind failure is
/// recorded in [`McpStatus`] so the settings UI can explain it. Release builds
/// have no console, so the UI is the only reliable channel for this.
pub fn start(app: &AppHandle) {
    let bridge = app.state::<Arc<bridge::Bridge>>().inner().clone();

    app.state::<McpStatus>().0.lock().unwrap().url =
        format!("http://127.0.0.1:{MCP_PORT}{MCP_PATH}");

    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let listener = match server::bind().await {
            Ok(listener) => {
                app.state::<McpStatus>().0.lock().unwrap().listening = true;
                listener
            }
            Err(error) => {
                app.state::<McpStatus>().0.lock().unwrap().error = Some(error);
                return;
            }
        };

        if let Err(error) = server::serve(listener, bridge).await {
            let state = app.state::<McpStatus>();
            let mut status = state.0.lock().unwrap();
            status.listening = false;
            status.error = Some(error);
        }
    });
}
