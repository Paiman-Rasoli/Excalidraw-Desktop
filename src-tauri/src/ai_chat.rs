use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::time::Duration;
use tauri::Manager;
use tokio::time::sleep;

const AI_CHAT_CONFIG_FILE_NAME: &str = "ai-chat-config.json";

fn default_agent() -> String {
    "openai".to_string()
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct ProviderKeys {
    #[serde(default = "default_agent", rename = "defaultAgent")]
    pub default_agent: String,
    pub openai: String,
    pub anthropic: String,
    pub google: String,
}

impl Default for ProviderKeys {
    fn default() -> Self {
        Self {
            default_agent: default_agent(),
            openai: String::new(),
            anthropic: String::new(),
            google: String::new(),
        }
    }
}

fn ai_chat_config_file_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Failed to resolve app data directory: {error}"))?;

    fs::create_dir_all(&app_data_dir)
        .map_err(|error| format!("Failed to create app data directory: {error}"))?;

    Ok(app_data_dir.join(AI_CHAT_CONFIG_FILE_NAME))
}

fn provider_key(config: &ProviderKeys, provider: &str) -> Option<String> {
    let value = match provider {
        "openai" => &config.openai,
        "anthropic" => &config.anthropic,
        "google" => &config.google,
        _ => return None,
    };

    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn pick_provider_and_key(config: &ProviderKeys) -> Option<(String, String)> {
    let preferred = config.default_agent.trim().to_lowercase();
    if let Some(key) = provider_key(config, &preferred) {
        return Some((preferred, key));
    }

    for provider in ["openai", "anthropic", "google"] {
        if let Some(key) = provider_key(config, provider) {
            return Some((provider.to_string(), key));
        }
    }

    None
}

#[tauri::command]
pub fn save_ai_chat_config(app: tauri::AppHandle, config: ProviderKeys) -> Result<(), String> {
    let file_path = ai_chat_config_file_path(&app)?;

    let payload = serde_json::to_string_pretty(&config)
        .map_err(|error| format!("Failed to serialize ai config: {error}"))?;

    fs::write(file_path, payload).map_err(|error| format!("Failed to write ai config file: {error}"))?;
    Ok(())
}

#[tauri::command]
pub fn load_ai_chat_config(app: tauri::AppHandle) -> Result<ProviderKeys, String> {
    let file_path = ai_chat_config_file_path(&app)?;

    if !file_path.exists() {
        return Ok(ProviderKeys::default());
    }

    let content = fs::read_to_string(file_path)
        .map_err(|error| format!("Failed to read ai config file: {error}"))?;

    let config: ProviderKeys = serde_json::from_str(&content)
        .map_err(|error| format!("Failed to parse ai config file: {error}"))?;

    Ok(config)
}

#[tauri::command]
pub async fn send_ai_message(app: tauri::AppHandle, message: String) -> Result<String, String> {
    let trimmed = message.trim();
    if trimmed.is_empty() {
        return Err("Message cannot be empty".to_string());
    }

    let config = load_ai_chat_config(app).unwrap_or_default();

    let (selected_provider, selected_value) = match pick_provider_and_key(&config) {
        Some(selection) => selection,
        None => {
            return Ok(
                "Please open the top gear icon and set at least one AI provider key (OpenAI, Anthropic, or Google), then try again."
                    .to_string(),
            )
        }
    };

    if selected_value.is_empty() {
        return Ok(
            "Please open the top gear icon and set at least one AI provider key (OpenAI, Anthropic, or Google), then try again."
                .to_string(),
        );
    }

    sleep(Duration::from_secs(4)).await;
    Ok(format!(
        "Provider selected: {selected_provider}. I received your message and I am ready for the next step."
    ))
}
