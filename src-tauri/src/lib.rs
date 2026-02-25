use serde_json::Value;
use std::fs;
use std::path::PathBuf;
use tauri::Manager;

const LIBRARY_ITEMS_FILE_NAME: &str = "library-items.json";

fn library_items_file_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Failed to resolve app data directory: {error}"))?;

    fs::create_dir_all(&app_data_dir)
        .map_err(|error| format!("Failed to create app data directory: {error}"))?;

    Ok(app_data_dir.join(LIBRARY_ITEMS_FILE_NAME))
}

#[tauri::command]
fn save_library_items(app: tauri::AppHandle, items: Vec<Value>) -> Result<(), String> {
    let file_path = library_items_file_path(&app)?;

    let payload = serde_json::to_string_pretty(&items)
        .map_err(|error| format!("Failed to serialize items: {error}"))?;

    fs::write(file_path, payload).map_err(|error| format!("Failed to write library file: {error}"))?;

    Ok(())
}

#[tauri::command]
fn load_library_items(app: tauri::AppHandle) -> Result<Vec<Value>, String> {
    let file_path = library_items_file_path(&app)?;

    if !file_path.exists() {
        return Ok(Vec::new());
    }

    let content = fs::read_to_string(file_path)
        .map_err(|error| format!("Failed to read library file: {error}"))?;

    let items: Vec<Value> = serde_json::from_str(&content)
        .map_err(|error| format!("Failed to parse library file: {error}"))?;

    Ok(items)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
    .invoke_handler(tauri::generate_handler![save_library_items, load_library_items])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
