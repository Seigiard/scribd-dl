mod commands;
mod sidecar;

use tauri::{Manager, RunEvent};

use commands::{get_backend_url, notify, pick_folder};
use sidecar::{kill_sidecar, spawn_sidecar, SidecarState};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .manage(SidecarState::new())
        .invoke_handler(tauri::generate_handler![get_backend_url, pick_folder, notify])
        .setup(|app| {
            let handle = app.handle().clone();
            if let Err(e) = spawn_sidecar(&handle) {
                log::error!("failed to spawn engine sidecar: {e}");
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let RunEvent::ExitRequested { .. } = event {
                let state = app_handle.state::<SidecarState>();
                kill_sidecar(&state);
            }
        });
}
