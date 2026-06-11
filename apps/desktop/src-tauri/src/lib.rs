mod commands;
mod quit_guard;
mod sidecar;

use std::sync::atomic::Ordering;

use tauri::{Manager, RunEvent, WindowEvent};

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
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let state = window.state::<SidecarState>();
                if state.quit_confirmed.load(Ordering::SeqCst) {
                    return;
                }
                api.prevent_close();
                let app = window.app_handle().clone();
                let window_clone = window.clone();
                tauri::async_runtime::spawn(async move {
                    quit_guard::handle_close_request(app, window_clone).await;
                });
            }
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
