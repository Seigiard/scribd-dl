mod commands;
mod quit_guard;
mod sidecar;

use std::sync::atomic::Ordering;

use tauri::{Manager, RunEvent, WindowEvent};

use commands::{get_backend_url, pick_folder};
use sidecar::{kill_sidecar, spawn_sidecar, SidecarState};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(SidecarState::new())
        .invoke_handler(tauri::generate_handler![get_backend_url, pick_folder])
        .setup(|app| {
            let handle = app.handle().clone();
            if let Err(e) = spawn_sidecar(&handle) {
                eprintln!("[scribd-dl-desktop] failed to spawn engine sidecar: {e}");
            }
            install_signal_handler(handle.clone());
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
        .run(|app_handle, event| match event {
            RunEvent::ExitRequested { .. } | RunEvent::Exit => {
                let state = app_handle.state::<SidecarState>();
                kill_sidecar(&state);
            }
            _ => {}
        });
}

#[cfg(unix)]
fn install_signal_handler(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        use tokio::signal::unix::{signal, SignalKind};
        let mut sigint = match signal(SignalKind::interrupt()) {
            Ok(s) => s,
            Err(e) => {
                eprintln!("[scribd-dl-desktop] SIGINT hook failed: {e}");
                return;
            }
        };
        let mut sigterm = match signal(SignalKind::terminate()) {
            Ok(s) => s,
            Err(e) => {
                eprintln!("[scribd-dl-desktop] SIGTERM hook failed: {e}");
                return;
            }
        };
        let mut sighup = match signal(SignalKind::hangup()) {
            Ok(s) => s,
            Err(e) => {
                eprintln!("[scribd-dl-desktop] SIGHUP hook failed: {e}");
                return;
            }
        };
        tokio::select! {
            _ = sigint.recv() => eprintln!("[scribd-dl-desktop] SIGINT received, killing sidecar"),
            _ = sigterm.recv() => eprintln!("[scribd-dl-desktop] SIGTERM received, killing sidecar"),
            _ = sighup.recv() => eprintln!("[scribd-dl-desktop] SIGHUP received, killing sidecar"),
        }
        let state = app.state::<SidecarState>();
        kill_sidecar(&state);
        app.exit(0);
    });
}

#[cfg(not(unix))]
fn install_signal_handler(_app: tauri::AppHandle) {}
