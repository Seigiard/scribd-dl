use std::time::{Duration, Instant};

use tauri::State;

use crate::sidecar::SidecarState;

const READY_TIMEOUT: Duration = Duration::from_secs(15);
const POLL_INTERVAL: Duration = Duration::from_millis(50);

#[tauri::command]
pub async fn get_backend_url(state: State<'_, SidecarState>) -> Result<String, String> {
    let start = Instant::now();
    loop {
        if let Some(url) = state.backend_url.lock().unwrap().clone() {
            return Ok(url);
        }
        if start.elapsed() > READY_TIMEOUT {
            return Err("engine sidecar did not become ready within 15s".into());
        }
        tokio::time::sleep(POLL_INTERVAL).await;
    }
}
