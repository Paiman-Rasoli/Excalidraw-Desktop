use aisdk::core::language_model::request::LanguageModelRequest;
use aisdk::providers::{Anthropic, Google, OpenAI};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;
use tauri::Manager;

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

#[derive(Clone, Debug, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DrawingAgentResponse {
    pub short_description: String,
    pub elements: Vec<BTreeMap<String, serde_json::Value>>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct FrontendChatMessage {
    pub role: String,
    pub text: String,
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

fn build_drawing_prompt(
    user_prompt: &str,
    elements_guide: Option<&str>,
    last_messages: Option<&[FrontendChatMessage]>,
) -> String {
    let guide_block = elements_guide.unwrap_or(
        "{\"targetType\":\"ImportedDataState[\\\"elements\\\"]\",\"note\":\"Return valid Excalidraw elements objects only.\"}",
    );

    let history_block = last_messages
        .map(|messages| {
            if messages.is_empty() {
                "No previous conversation context.".to_string()
            } else {
                messages
                    .iter()
                    .map(|message| format!("{}: {}", message.role, message.text))
                    .collect::<Vec<_>>()
                    .join("\n")
            }
        })
        .unwrap_or_else(|| "No previous conversation context.".to_string());

    format!(
        "You are an AI Agent for Excalidraw. Understand what drawing the user wants and produce only valid JSON matching the schema.\n\
        Rules:\n\
        1) shortDescription: one short sentence describing what you created.\n\
        2) elements: an array of Excalidraw element objects.\n\
        3) elements must be directly usable by Excalidraw and compatible with ImportedDataState[\"elements\"].\n\
        4) If request is unclear, still return a simple helpful diagram with a valid elements array.\n\
        5) Follow this compact element guide JSON:\n{guide_block}\n\
        6) Use this recent chat context when forming your response:\n{history_block}\n\
        User request: {user_prompt}"
    )
}

fn configure_provider_api_key(provider: &str, api_key: &str) {
    match provider {
        "openai" => std::env::set_var("OPENAI_API_KEY", api_key),
        "anthropic" => std::env::set_var("ANTHROPIC_API_KEY", api_key),
        "google" => std::env::set_var("GOOGLE_API_KEY", api_key),
        _ => {}
    }
}

async fn generate_structured_output(
    provider: &str,
    prompt: &str,
) -> Result<DrawingAgentResponse, String> {
    match provider {
        "openai" => {
            let response: DrawingAgentResponse = LanguageModelRequest::builder()
                .model(OpenAI::gpt_4o())
                .prompt(prompt)
                .schema::<DrawingAgentResponse>()
                .build()
                .generate_text()
                .await
                .map_err(|error| format!("OpenAI request failed: {error}"))?
                .into_schema()
                .map_err(|error| format!("OpenAI schema parse failed: {error}"))?;

            Ok(response)
        }
        "anthropic" => {
            let response: DrawingAgentResponse = LanguageModelRequest::builder()
                .model(Anthropic::model_name("claude-opus-4-5"))
                .prompt(prompt)
                .schema::<DrawingAgentResponse>()
                .build()
                .generate_text()
                .await
                .map_err(|error| format!("Anthropic request failed: {error}"))?
                .into_schema()
                .map_err(|error| format!("Anthropic schema parse failed: {error}"))?;

            Ok(response)
        }
        "google" => {
            let response: DrawingAgentResponse = LanguageModelRequest::builder()
                .model(Google::gemini_3_flash_preview())
                .prompt(prompt)
                .schema::<DrawingAgentResponse>()
                .build()
                .generate_text()
                .await
                .map_err(|error| format!("Google request failed: {error}"))?
                .into_schema()
                .map_err(|error| format!("Google schema parse failed: {error}"))?;

            Ok(response)
        }
        _ => Err("Unsupported provider".to_string()),
    }
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
pub async fn send_ai_message(
    app: tauri::AppHandle,
    message: String,
    elements_guide: Option<String>,
    last_messages: Option<Vec<FrontendChatMessage>>,
) -> Result<DrawingAgentResponse, String> {
    let trimmed = message.trim();
    if trimmed.is_empty() {
        return Err("Message cannot be empty".to_string());
    }

    let config = load_ai_chat_config(app).unwrap_or_default();

    let (selected_provider, selected_value) = match pick_provider_and_key(&config) {
        Some(selection) => selection,
        None => {
            return Ok(DrawingAgentResponse {
                short_description:
                    "Please open the top gear icon and set at least one AI provider key (OpenAI, Anthropic, or Google), then try again."
                        .to_string(),
                elements: Vec::new(),
            });
        }
    };

    if selected_value.is_empty() {
        return Ok(DrawingAgentResponse {
            short_description:
                "Please open the top gear icon and set at least one AI provider key (OpenAI, Anthropic, or Google), then try again."
                    .to_string(),
            elements: Vec::new(),
        });
    }

    configure_provider_api_key(&selected_provider, &selected_value);

    let prompt = build_drawing_prompt(trimmed, elements_guide.as_deref(), last_messages.as_deref());
    let response = generate_structured_output(&selected_provider, &prompt).await?;

    println!(
        "AI response from provider '{}': {:?}",
        selected_provider, response
    );
    Ok(response)
}
