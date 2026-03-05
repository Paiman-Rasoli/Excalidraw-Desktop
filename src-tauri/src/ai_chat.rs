use std::time::Duration;
use tokio::time::sleep;

#[tauri::command]
pub async fn send_ai_message(message: String) -> Result<String, String> {
    let trimmed = message.trim();
    if trimmed.is_empty() {
        return Err("Message cannot be empty".to_string());
    }

    sleep(Duration::from_secs(4)).await;
    Ok("It seems like your message might have been a typo. Could you please clarify or let me know how I can assist you?".to_string())
}
