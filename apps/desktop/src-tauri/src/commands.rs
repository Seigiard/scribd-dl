use std::time::{Duration, Instant};

use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_notification::NotificationExt;

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

#[tauri::command]
pub async fn pick_folder(
    app: AppHandle,
    default_path: Option<String>,
) -> Result<Option<String>, String> {
    let (tx, rx) = tokio::sync::oneshot::channel::<Option<String>>();

    let mut builder = app.dialog().file();
    if let Some(p) = default_path.as_deref().filter(|s| !s.is_empty()) {
        builder = builder.set_directory(p);
    }

    builder.pick_folder(move |selected| {
        let path = selected.and_then(|fp| fp.into_path().ok());
        let path_str = path.map(|p| p.to_string_lossy().to_string());
        let _ = tx.send(path_str);
    });

    rx.await
        .map_err(|e| format!("folder picker dropped without response: {e}"))
}

#[tauri::command]
pub async fn notify(app: AppHandle, title: String, body: String) -> Result<(), String> {
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|e| format!("notification failed: {e}"))?;
    Ok(())
}
