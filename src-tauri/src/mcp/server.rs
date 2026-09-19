use std::net::SocketAddr;

use rmcp::transport::streamable_http_server::{
    session::local::LocalSessionManager, StreamableHttpServerConfig, StreamableHttpService,
};
use tokio::net::TcpListener;

use std::sync::Arc;

use crate::mcp::bridge::Bridge;
use crate::mcp::tools::ExcalidrawMcp;

pub const MCP_PORT: u16 = 3737;
pub const MCP_PATH: &str = "/mcp";

/// Bind the listener. Split from [`serve`] so an `AddrInUse` failure can be
/// reported before the long-lived serve future starts.
///
/// Loopback only -- never `0.0.0.0`, never `[::]`. Besides the obvious, a
/// loopback-only bind does not raise the Windows Defender Firewall prompt or
/// the macOS incoming-connections prompt.
pub async fn bind() -> Result<TcpListener, String> {
    let addr = SocketAddr::from(([127, 0, 0, 1], MCP_PORT));

    TcpListener::bind(addr).await.map_err(|error| {
        format!(
            "Could not start the MCP server on {addr}: {error}. \
             Is another Excalidraw Desktop instance already running?"
        )
    })
}

pub async fn serve(listener: TcpListener, bridge: Arc<Bridge>) -> Result<(), String> {
    // rmcp validates the Host header against `allowed_hosts`, which already
    // defaults to loopback-only. `enforce_origin_validation` additionally
    // rejects any request that *carries* an Origin, while still allowing
    // requests with no Origin at all -- which is exactly what CLI and desktop
    // MCP clients send. No browser page can reach this endpoint.
    let config = StreamableHttpServerConfig::default()
        .enforce_origin_validation()
        // A large skeleton array can approach the 4 MiB default.
        .with_max_request_body_bytes(32 * 1024 * 1024);

    // Let the browser-based MCP Inspector in while developing.
    #[cfg(debug_assertions)]
    let config =
        config.with_allowed_origins(["http://localhost:6274", "http://127.0.0.1:6274"]);

    // The factory runs once per MCP session.
    let service = StreamableHttpService::new(
        move || Ok(ExcalidrawMcp::new(bridge.clone())),
        LocalSessionManager::default().into(),
        config,
    );

    let router = axum::Router::new().nest_service(MCP_PATH, service);

    axum::serve(listener, router)
        .await
        .map_err(|error| format!("MCP server stopped: {error}"))
}
