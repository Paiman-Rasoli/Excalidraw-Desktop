//! Hand-written JSON Schemas for the MCP tools.
//!
//! Not derived with schemars, deliberately. Rust never reads a skeleton field
//! -- the payload is passed straight through to `convertToExcalidrawElements`,
//! which is the only real validator. A Rust mirror of that 13-variant union
//! would buy no type safety, would become a second source of truth that drifts
//! on every Excalidraw release, and would emit `oneOf` over `$defs`, which
//! several MCP clients handle badly.
//!
//! Writing the schemas by hand also lets the `description` strings be tuned,
//! and those are what actually determine whether a model emits usable
//! skeletons.

use std::sync::{Arc, LazyLock};

use rmcp::model::JsonObject;
use serde_json::{json, Value};

fn object(value: Value) -> Arc<JsonObject> {
    match value {
        Value::Object(map) => Arc::new(map),
        _ => unreachable!("a tool input schema must be a JSON object"),
    }
}

/// One Excalidraw element skeleton. Inlined into each schema that takes
/// elements rather than `$ref`-ed, on purpose.
fn skeleton_item() -> Value {
    json!({
        "type": "object",
        "required": ["type", "x", "y"],
        // Skeletons carry many more optional props; do not reject them.
        "additionalProperties": true,
        "properties": {
            "type": {
                "type": "string",
                "enum": ["rectangle", "ellipse", "diamond", "arrow", "line", "text", "frame"]
            },
            "x": { "type": "number", "description": "Scene x of the top-left corner." },
            "y": { "type": "number", "description": "Scene y of the top-left corner; y grows downward." },
            "width": { "type": "number", "description": "Defaults to 100. Omit on a labeled shape to auto-size." },
            "height": { "type": "number", "description": "Defaults to 100. Omit on a labeled shape to auto-size." },
            "id": {
                "type": "string",
                "description": "Nickname used only within this call, so an arrow's start/end can reference this element. Not the final canvas id."
            },
            "label": {
                "type": "object",
                "description": "Text bound inside a shape, or at an arrow's midpoint. Always prefer this over positioning a separate text element by hand.",
                "required": ["text"],
                "properties": {
                    "text": { "type": "string" },
                    "fontSize": { "type": "number", "enum": [16, 20, 28, 36] },
                    "fontFamily": { "$ref": "#/$defs/fontFamily" },
                    "textAlign": { "type": "string", "enum": ["left", "center", "right"] },
                    "verticalAlign": { "type": "string", "enum": ["top", "middle", "bottom"] },
                    "strokeColor": { "type": "string", "description": "Text colour." }
                }
            },
            "text": { "type": "string", "description": "Required when type is \"text\"." },
            "fontSize": { "type": "number", "enum": [16, 20, 28, 36] },
            "fontFamily": { "$ref": "#/$defs/fontFamily" },
            "start": { "$ref": "#/$defs/endpoint" },
            "end": { "$ref": "#/$defs/endpoint" },
            "points": {
                "type": "array",
                "description": "For line/arrow. [x, y] pairs relative to this element's x/y; the first should be [0, 0].",
                "items": { "type": "array", "items": { "type": "number" }, "minItems": 2, "maxItems": 2 }
            },
            "startArrowhead": { "$ref": "#/$defs/arrowhead" },
            "endArrowhead": { "$ref": "#/$defs/arrowhead" },
            "strokeColor": { "type": "string", "description": "CSS colour, e.g. \"#1e1e1e\"." },
            "backgroundColor": { "type": "string", "description": "CSS colour, or \"transparent\"." },
            "fillStyle": { "type": "string", "enum": ["hachure", "cross-hatch", "solid", "zigzag"] },
            "strokeWidth": { "type": "number", "enum": [1, 2, 4], "description": "1 thin, 2 bold, 4 extra-bold." },
            "strokeStyle": { "type": "string", "enum": ["solid", "dashed", "dotted"] },
            "roughness": { "type": "number", "enum": [0, 1, 2], "description": "0 architect, 1 artist, 2 cartoonist." },
            "roundness": {
                "description": "{\"type\": 3} for rounded corners, null for sharp.",
                "oneOf": [
                    { "type": "null" },
                    { "type": "object", "required": ["type"], "properties": { "type": { "type": "number", "enum": [1, 2, 3] } } }
                ]
            },
            "opacity": { "type": "number", "minimum": 0, "maximum": 100 },
            "angle": { "type": "number", "description": "Rotation in radians." },
            "groupIds": {
                "type": "array",
                "items": { "type": "string" },
                "description": "Give several elements the same string here to group them."
            },
            "link": { "type": "string" },
            "locked": { "type": "boolean" }
        }
    })
}

fn skeleton_defs() -> Value {
    json!({
        "fontFamily": {
            "type": "string",
            "enum": ["Excalifont", "Nunito", "Comic Shanns", "Helvetica", "Cascadia", "Virgil", "Lilita One", "Liberation Sans"]
        },
        "arrowhead": {
            "description": "null for no arrowhead.",
            "oneOf": [
                { "type": "null" },
                {
                    "type": "string",
                    "enum": ["arrow", "bar", "dot", "circle", "circle_outline", "triangle",
                             "triangle_outline", "diamond", "diamond_outline",
                             "crowfoot_one", "crowfoot_many", "crowfoot_one_or_many"]
                }
            ]
        },
        "endpoint": {
            "type": "object",
            "additionalProperties": true,
            "description": "Binds one end of an arrow. Either {\"id\": \"<id of a shape declared in THIS SAME call>\"} to attach to it, or {\"type\": \"rectangle\"|\"ellipse\"|\"diamond\"} to create a new shape there, or {\"type\": \"text\", \"text\": \"...\"} for a text label. Ids from earlier calls do NOT work.",
            "properties": {
                "id": { "type": "string", "description": "Nickname of an element declared in this same `elements` array." },
                "type": { "type": "string", "enum": ["rectangle", "ellipse", "diamond", "text"] },
                "text": { "type": "string", "description": "Required when type is \"text\"." },
                "x": { "type": "number" },
                "y": { "type": "number" },
                "width": { "type": "number" },
                "height": { "type": "number" },
                "label": { "type": "object", "required": ["text"], "properties": { "text": { "type": "string" } } }
            }
        }
    })
}

pub static GET_SCENE: LazyLock<Arc<JsonObject>> = LazyLock::new(|| {
    object(json!({
        "type": "object",
        "additionalProperties": false,
        "properties": {
            "ids": {
                "type": "array",
                "items": { "type": "string" },
                "description": "Only return these elements. Omit for the whole scene."
            },
            "includeDeleted": {
                "type": "boolean",
                "default": false,
                "description": "Include soft-deleted elements. Useful to find something you just deleted."
            },
            "maxElements": {
                "type": "number",
                "default": 400,
                "description": "Cap on how many elements come back. The response says so when it truncated."
            },
            "verbose": {
                "type": "boolean",
                "default": false,
                "description": "Return raw Excalidraw elements with every field instead of the compact projection. Expensive; for debugging."
            }
        }
    }))
});

pub static ADD_ELEMENTS: LazyLock<Arc<JsonObject>> = LazyLock::new(|| {
    object(json!({
        "type": "object",
        "required": ["elements"],
        "additionalProperties": false,
        "$defs": skeleton_defs(),
        "properties": {
            "elements": {
                "type": "array",
                "minItems": 1,
                "description": "Element skeletons, drawn in array order (later elements render on top).",
                "items": skeleton_item()
            },
            "preserveIds": {
                "type": "boolean",
                "default": false,
                "description": "Use the literal `id` values you supplied as the real canvas ids instead of generating fresh ones. Fails if any of them already exists on the canvas."
            }
        }
    }))
});

pub static UPDATE_ELEMENTS: LazyLock<Arc<JsonObject>> = LazyLock::new(|| {
    object(json!({
        "type": "object",
        "required": ["updates"],
        "additionalProperties": false,
        "$defs": skeleton_defs(),
        "properties": {
            "updates": {
                "type": "array",
                "minItems": 1,
                "items": {
                    "type": "object",
                    "required": ["id", "patch"],
                    "additionalProperties": false,
                    "properties": {
                        "id": { "type": "string", "description": "Real canvas id, from get_scene or add_elements." },
                        "patch": {
                            "type": "object",
                            "additionalProperties": true,
                            "description": "Only the properties that change, e.g. {\"backgroundColor\": \"#ffec99\"} or {\"x\": 320, \"y\": 80}. Moving a labeled shape moves its label too. To change label text, patch the label element by its labelId with {\"text\": \"...\"}."
                        }
                    }
                }
            }
        }
    }))
});

pub static DELETE_ELEMENTS: LazyLock<Arc<JsonObject>> = LazyLock::new(|| {
    object(json!({
        "type": "object",
        "required": ["ids"],
        "additionalProperties": false,
        "properties": {
            "ids": {
                "type": "array",
                "minItems": 1,
                "items": { "type": "string" },
                "description": "Real canvas ids to delete."
            },
            "cascade": {
                "type": "boolean",
                "default": true,
                "description": "Also delete each shape's bound text label, as the editor does. Arrows bound to a deleted shape are never deleted; they just become unbound."
            }
        }
    }))
});

pub static CLEAR_SCENE: LazyLock<Arc<JsonObject>> = LazyLock::new(|| {
    object(json!({
        "type": "object",
        "additionalProperties": false,
        "properties": {
            "hard": {
                "type": "boolean",
                "default": false,
                "description": "Also reset background, zoom, scroll and name, and discard undo history. NOT undoable -- ask the user before setting this."
            }
        }
    }))
});

pub static EXPORT_IMAGE: LazyLock<Arc<JsonObject>> = LazyLock::new(|| {
    object(json!({
        "type": "object",
        "additionalProperties": false,
        "properties": {
            "ids": {
                "type": "array",
                "items": { "type": "string" },
                "description": "Only render these elements (plus their labels and groups). Omit for the whole canvas."
            },
            "maxWidthOrHeight": {
                "type": "number",
                "default": 1024,
                "minimum": 256,
                "maximum": 2048,
                "description": "Longest side in pixels. Keep it small unless you need to read fine detail."
            },
            "background": { "type": "boolean", "default": true },
            "darkMode": { "type": "boolean", "description": "Defaults to the canvas theme." },
            "padding": { "type": "number", "default": 16, "minimum": 0, "maximum": 200 }
        }
    }))
});

pub static SCROLL_TO_CONTENT: LazyLock<Arc<JsonObject>> = LazyLock::new(|| {
    object(json!({
        "type": "object",
        "additionalProperties": false,
        "properties": {
            "ids": {
                "type": "array",
                "items": { "type": "string" },
                "description": "Bring these elements into view. Omit to fit the whole scene."
            },
            "fit": {
                "type": "string",
                "enum": ["content", "viewport"],
                "default": "content",
                "description": "\"content\" zooms so the target fills the view; \"viewport\" leaves margin around it."
            },
            "viewportZoomFactor": {
                "type": "number",
                "minimum": 0.1,
                "maximum": 1,
                "default": 0.7,
                "description": "Only with fit=\"viewport\": how much of the screen the content should cover."
            },
            "animate": {
                "type": "boolean",
                "default": false,
                "description": "Animate the scroll. Leave false if you are about to call export_image, or you will capture a mid-animation frame."
            }
        }
    }))
});

pub static LIST_LIBRARY: LazyLock<Arc<JsonObject>> = LazyLock::new(|| {
    object(json!({
        "type": "object",
        "additionalProperties": false,
        "properties": {}
    }))
});

pub static PREVIEW_LIBRARY: LazyLock<Arc<JsonObject>> = LazyLock::new(|| {
    object(json!({
        "type": "object",
        "additionalProperties": false,
        "properties": {
            "indices": {
                "type": "array",
                "items": { "type": "number" },
                "description": "Only render these library indices. Omit to render the whole library."
            },
            "columns": {
                "type": "number",
                "minimum": 1,
                "maximum": 16,
                "description": "Grid columns. Defaults to roughly the square root of the item count."
            },
            "cell": {
                "type": "number",
                "minimum": 48,
                "maximum": 256,
                "default": 108,
                "description": "Pixel size of each thumbnail. Raise it to read fine detail on a few items."
            }
        }
    }))
});

pub static INSERT_LIBRARY_ITEM: LazyLock<Arc<JsonObject>> = LazyLock::new(|| {
    object(json!({
        "type": "object",
        "additionalProperties": false,
        "properties": {
            "index": {
                "type": "number",
                "description": "Library index, as shown on the preview sheet. Give this or `id`."
            },
            "id": {
                "type": "string",
                "description": "Library item id from list_library. Give this or `index`."
            },
            "x": { "type": "number", "default": 0, "description": "Scene x for the item's top-left corner." },
            "y": { "type": "number", "default": 0, "description": "Scene y for the item's top-left corner." }
        }
    }))
});
