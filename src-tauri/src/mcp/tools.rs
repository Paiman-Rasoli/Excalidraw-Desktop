use std::sync::Arc;
use std::time::Duration;

use rmcp::{
    handler::server::{router::tool::ToolRouter, wrapper::Parameters},
    model::*,
    tool, tool_handler, tool_router, ErrorData as McpError, ServerHandler,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::mcp::bridge::Bridge;
use crate::mcp::schema;

/// Every canvas op is one webview round-trip.
const FAST: Duration = Duration::from_secs(15);
/// Rasterising and base64-ing a large canvas takes longer.
const EXPORT: Duration = Duration::from_secs(45);

#[derive(Clone)]
pub struct ExcalidrawMcp {
    bridge: Arc<Bridge>,
    tool_router: ToolRouter<Self>,
}

fn failed(tool: &str, error: String) -> McpError {
    McpError::internal_error(format!("{tool} failed: {error}"), None)
}

fn json_text(value: &Value) -> Result<CallToolResult, McpError> {
    Ok(CallToolResult::success(vec![ContentBlock::text(
        value.to_string(),
    )]))
}

/* -------------------------------------------------------------------------
 * Params. Deserialize only -- the advertised schema comes from
 * `input_schema`, so no JsonSchema derive is needed. Element bodies stay as
 * `Value`: Rust is a passthrough, and `convertToExcalidrawElements` in the
 * webview is the only real validator.
 * ---------------------------------------------------------------------- */

#[derive(Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct GetSceneArgs {
    #[serde(default)]
    pub ids: Option<Vec<String>>,
    #[serde(default)]
    pub include_deleted: Option<bool>,
    #[serde(default)]
    pub max_elements: Option<u32>,
    #[serde(default)]
    pub verbose: Option<bool>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AddElementsArgs {
    /// ExcalidrawElementSkeleton[] -- opaque here.
    pub elements: Vec<Value>,
    #[serde(default)]
    pub preserve_ids: Option<bool>,
}

#[derive(Deserialize, Serialize)]
pub struct ElementUpdate {
    pub id: String,
    pub patch: Value,
}

#[derive(Deserialize, Serialize)]
pub struct UpdateElementsArgs {
    pub updates: Vec<ElementUpdate>,
}

#[derive(Deserialize, Serialize)]
pub struct DeleteElementsArgs {
    pub ids: Vec<String>,
    #[serde(default)]
    pub cascade: Option<bool>,
}

#[derive(Deserialize, Serialize, Default)]
pub struct ClearSceneArgs {
    #[serde(default)]
    pub hard: Option<bool>,
}

#[derive(Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ExportImageArgs {
    #[serde(default)]
    pub ids: Option<Vec<String>>,
    #[serde(default)]
    pub max_width_or_height: Option<u32>,
    #[serde(default)]
    pub background: Option<bool>,
    #[serde(default)]
    pub dark_mode: Option<bool>,
    #[serde(default)]
    pub padding: Option<u32>,
}

#[derive(Deserialize, Serialize, Default)]
pub struct PreviewLibraryArgs {
    #[serde(default)]
    pub indices: Option<Vec<u32>>,
    #[serde(default)]
    pub columns: Option<u32>,
    #[serde(default)]
    pub cell: Option<u32>,
}

#[derive(Deserialize, Serialize, Default)]
pub struct InsertLibraryItemArgs {
    #[serde(default)]
    pub index: Option<u32>,
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub x: Option<f64>,
    #[serde(default)]
    pub y: Option<f64>,
}

#[derive(Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ScrollToContentArgs {
    #[serde(default)]
    pub ids: Option<Vec<String>>,
    #[serde(default)]
    pub fit: Option<String>,
    #[serde(default)]
    pub viewport_zoom_factor: Option<f64>,
    #[serde(default)]
    pub animate: Option<bool>,
}

fn params_of<T: Serialize>(args: &T) -> Value {
    serde_json::to_value(args).unwrap_or_else(|_| json!({}))
}

/* ------------------------------------------------------------------------ */

#[tool_router]
impl ExcalidrawMcp {
    pub fn new(bridge: Arc<Bridge>) -> Self {
        Self {
            bridge,
            tool_router: Self::tool_router(),
        }
    }

    /// Read what is currently on the Excalidraw canvas: every element with its
    /// real id, position, size, text, and how arrows connect shapes. Call this
    /// before update_elements or delete_elements so you are working with real
    /// ids. Returns a compact projection, not raw Excalidraw elements.
    #[tool(
        name = "get_scene",
        input_schema = schema::GET_SCENE.clone(),
        annotations(read_only_hint = true, open_world_hint = false)
    )]
    async fn get_scene(
        &self,
        Parameters(args): Parameters<GetSceneArgs>,
    ) -> Result<CallToolResult, McpError> {
        let data = self
            .bridge
            .call("getScene", params_of(&args), FAST)
            .await
            .map_err(|error| failed("get_scene", error))?;
        json_text(&data)
    }

    /// Draw new shapes, text and arrows onto the live Excalidraw canvas.
    /// Elements are APPENDED -- nothing already on the canvas is removed or
    /// modified, and the whole call lands as a single undo step.
    ///
    /// Elements use Excalidraw's skeleton format: give only what you care
    /// about and sensible defaults fill in the rest. `x`/`y` is the top-left
    /// corner in scene coordinates and y grows downward.
    ///
    /// Put text inside a shape with `label`, e.g.
    /// {"type":"rectangle","x":0,"y":0,"label":{"text":"Auth Service"}} --
    /// never position a separate text element by hand. Omit width/height on a
    /// labeled shape and it auto-sizes.
    ///
    /// ARROWS: give each shape an `id` nickname and connect them with
    /// {"type":"arrow","x":0,"y":0,"start":{"id":"a"},"end":{"id":"b"},
    /// "label":{"text":"calls"}}. A bound arrow re-routes itself when the user
    /// drags either shape, and when both ends are bound its own x/y/width/height
    /// are computed for you -- just pass x:0, y:0. An arrow can ONLY bind to
    /// shapes declared in the same call; referencing an id from an earlier call
    /// silently produces a free-floating arrow. Build a diagram in one call. To
    /// connect shapes already on the canvas, redraw both endpoints and the
    /// arrow together.
    ///
    /// Leave at least 150px between connected boxes, and more when the arrow
    /// carries a label -- roughly 10px per character, or the label overlaps the
    /// arrowhead. A typical labeled box is 200x80. Returns the canvas id of every
    /// element created -- use those with the other tools. Call export_image
    /// afterwards to see what you drew.
    #[tool(
        name = "add_elements",
        input_schema = schema::ADD_ELEMENTS.clone(),
        annotations(
            read_only_hint = false,
            destructive_hint = false,
            idempotent_hint = false,
            open_world_hint = false
        )
    )]
    async fn add_elements(
        &self,
        Parameters(args): Parameters<AddElementsArgs>,
    ) -> Result<CallToolResult, McpError> {
        let data = self
            .bridge
            .call("addElements", params_of(&args), FAST)
            .await
            .map_err(|error| failed("add_elements", error))?;
        json_text(&data)
    }

    /// Change existing elements in place. Each update needs the element's real
    /// canvas `id` plus a `patch` holding only the properties that change.
    /// Moving a labeled shape moves its label with it.
    #[tool(
        name = "update_elements",
        input_schema = schema::UPDATE_ELEMENTS.clone(),
        annotations(
            read_only_hint = false,
            destructive_hint = true,
            idempotent_hint = true,
            open_world_hint = false
        )
    )]
    async fn update_elements(
        &self,
        Parameters(args): Parameters<UpdateElementsArgs>,
    ) -> Result<CallToolResult, McpError> {
        let data = self
            .bridge
            .call("updateElements", params_of(&args), FAST)
            .await
            .map_err(|error| failed("update_elements", error))?;
        json_text(&data)
    }

    /// Delete elements by their real canvas id. Undoable by the user.
    #[tool(
        name = "delete_elements",
        input_schema = schema::DELETE_ELEMENTS.clone(),
        annotations(
            read_only_hint = false,
            destructive_hint = true,
            idempotent_hint = true,
            open_world_hint = false
        )
    )]
    async fn delete_elements(
        &self,
        Parameters(args): Parameters<DeleteElementsArgs>,
    ) -> Result<CallToolResult, McpError> {
        let data = self
            .bridge
            .call("deleteElements", params_of(&args), FAST)
            .await
            .map_err(|error| failed("delete_elements", error))?;
        json_text(&data)
    }

    /// Remove everything from the canvas. This wipes work the user may not
    /// want to lose -- ask before calling it. The default is undoable; `hard`
    /// is not.
    #[tool(
        name = "clear_scene",
        input_schema = schema::CLEAR_SCENE.clone(),
        annotations(
            read_only_hint = false,
            destructive_hint = true,
            idempotent_hint = true,
            open_world_hint = false
        )
    )]
    async fn clear_scene(
        &self,
        Parameters(args): Parameters<ClearSceneArgs>,
    ) -> Result<CallToolResult, McpError> {
        let data = self
            .bridge
            .call("clearScene", params_of(&args), FAST)
            .await
            .map_err(|error| failed("clear_scene", error))?;
        json_text(&data)
    }

    /// Render the canvas to a PNG and return it as an image, so you can look
    /// at what you drew and fix it. Use this to check spacing, overlaps and
    /// whether arrows landed where you intended.
    #[tool(
        name = "export_image",
        input_schema = schema::EXPORT_IMAGE.clone(),
        annotations(read_only_hint = true, open_world_hint = false)
    )]
    async fn export_image(
        &self,
        Parameters(args): Parameters<ExportImageArgs>,
    ) -> Result<CallToolResult, McpError> {
        let data = self
            .bridge
            .call("exportImage", params_of(&args), EXPORT)
            .await
            .map_err(|error| failed("export_image", error))?;

        let base64 = data
            .get("base64")
            .and_then(Value::as_str)
            .ok_or_else(|| failed("export_image", "the canvas returned no image data".into()))?;

        let elements = data.get("elementCount").and_then(Value::as_u64).unwrap_or(0);
        let size = data.get("maxWidthOrHeight").and_then(Value::as_u64).unwrap_or(0);

        Ok(CallToolResult::success(vec![
            ContentBlock::image(base64.to_owned(), "image/png"),
            ContentBlock::text(format!(
                "PNG of the Excalidraw canvas: {elements} element(s), longest side {size}px."
            )),
        ]))
    }

    /// List the shapes saved in the user's personal Excalidraw library, with
    /// the index you pass to insert_library_item. Most items are unnamed, so
    /// this list alone usually cannot tell you which is which -- call
    /// preview_library to actually look at them.
    #[tool(
        name = "list_library",
        input_schema = schema::LIST_LIBRARY.clone(),
        annotations(read_only_hint = true, open_world_hint = false)
    )]
    async fn list_library(&self) -> Result<CallToolResult, McpError> {
        let data = self
            .bridge
            .call("listLibrary", json!({}), FAST)
            .await
            .map_err(|error| failed("list_library", error))?;
        json_text(&data)
    }

    /// Render the user's personal library as ONE image: a grid of thumbnails,
    /// each labelled with its index. This is how you find the icon you want --
    /// look at the sheet, then pass the index to insert_library_item. Prefer
    /// reusing a library shape over drawing an icon yourself, since these are
    /// the shapes the user has chosen to keep.
    #[tool(
        name = "preview_library",
        input_schema = schema::PREVIEW_LIBRARY.clone(),
        annotations(read_only_hint = true, open_world_hint = false)
    )]
    async fn preview_library(
        &self,
        Parameters(args): Parameters<PreviewLibraryArgs>,
    ) -> Result<CallToolResult, McpError> {
        let data = self
            .bridge
            .call("previewLibrary", params_of(&args), EXPORT)
            .await
            .map_err(|error| failed("preview_library", error))?;

        let base64 = data
            .get("base64")
            .and_then(Value::as_str)
            .ok_or_else(|| failed("preview_library", "the canvas returned no image".into()))?;

        let count = data.get("count").and_then(Value::as_u64).unwrap_or(0);
        let columns = data.get("columns").and_then(Value::as_u64).unwrap_or(0);

        Ok(CallToolResult::success(vec![
            ContentBlock::image(base64.to_owned(), "image/png"),
            ContentBlock::text(format!(
                "{count} library item(s), {columns} per row, each labelled with the index \
                 to pass to insert_library_item."
            )),
        ]))
    }

    /// Place a copy of one personal-library item on the canvas at the given
    /// position. Identify it by `index` from the preview sheet, or by `id`
    /// from list_library. The copy is independent of the library and of any
    /// earlier copy, and lands as a single undo step.
    #[tool(
        name = "insert_library_item",
        input_schema = schema::INSERT_LIBRARY_ITEM.clone(),
        annotations(
            read_only_hint = false,
            destructive_hint = false,
            idempotent_hint = false,
            open_world_hint = false
        )
    )]
    async fn insert_library_item(
        &self,
        Parameters(args): Parameters<InsertLibraryItemArgs>,
    ) -> Result<CallToolResult, McpError> {
        let data = self
            .bridge
            .call("insertLibraryItem", params_of(&args), FAST)
            .await
            .map_err(|error| failed("insert_library_item", error))?;
        json_text(&data)
    }

    /// Scroll and zoom the user's viewport so the given elements, or the whole
    /// drawing, are on screen. Affects only the view, not the drawing.
    #[tool(
        name = "scroll_to_content",
        input_schema = schema::SCROLL_TO_CONTENT.clone(),
        annotations(
            read_only_hint = false,
            destructive_hint = false,
            idempotent_hint = true,
            open_world_hint = false
        )
    )]
    async fn scroll_to_content(
        &self,
        Parameters(args): Parameters<ScrollToContentArgs>,
    ) -> Result<CallToolResult, McpError> {
        let data = self
            .bridge
            .call("scrollToContent", params_of(&args), FAST)
            .await
            .map_err(|error| failed("scroll_to_content", error))?;
        json_text(&data)
    }
}

// Point the macro at the prebuilt field. Its default is `Self::tool_router()`,
// which would reconstruct all seven tools and their schemas on every request.
#[tool_handler(router = self.tool_router)]
impl ServerHandler for ExcalidrawMcp {
    fn get_info(&self) -> ServerConfig {
        ServerConfig::new(ServerCapabilities::builder().enable_tools().build())
            // Not `Implementation::from_build_env()`: that reads rmcp's own
            // CARGO_PKG_*, so the server would introduce itself as "rmcp".
            .with_server_info(Implementation::new(
                "excalidraw-desktop",
                env!("CARGO_PKG_VERSION"),
            ))
            .with_instructions(
                "Draws on the Excalidraw Desktop canvas the user has open on this machine. \
                 The canvas is live and shared with them: they see every change immediately \
                 and can undo it.\n\n\
                 Describe elements in Excalidraw's skeleton format -- give `type`, `x`, `y`, \
                 and optionally `width`/`height`, and let Excalidraw derive the rest. Put text \
                 in a shape with `label` rather than positioning a separate text element. \
                 Connect shapes by setting `start.id`/`end.id` on an arrow instead of computing \
                 endpoint coordinates, and declare the shapes and the arrows between them in \
                 one `add_elements` call, because bindings only resolve within a single call.\n\n\
                 The user also has a personal library of saved shapes and icons. Before drawing \
                 an icon by hand, call `preview_library` to see them as one indexed image and \
                 reuse what is there with `insert_library_item`.\n\n\
                 Call `get_scene` before `update_elements` or `delete_elements` so you have real \
                 ids. Call `export_image` after drawing to look at your own work and correct it. \
                 `clear_scene` wipes the user's canvas -- ask first."
                    .to_string(),
            )
    }
}
