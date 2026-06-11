use std::fs::{create_dir_all, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::Mutex;
use std::time::Duration;

use tauri::{AppHandle, Manager};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

pub struct SidecarState {
    pub backend_url: Mutex<Option<String>>,
    pub child: Mutex<Option<CommandChild>>,
    pub quit_confirmed: AtomicBool,
}

impl SidecarState {
    pub fn new() -> Self {
        Self {
            backend_url: Mutex::new(None),
            child: Mutex::new(None),
            quit_confirmed: AtomicBool::new(false),
        }
    }
}

pub fn parse_ready_line(line: &str) -> Option<u16> {
    let stripped = line.strip_prefix("READY port=")?;
    if stripped.is_empty() || !stripped.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    stripped.parse().ok()
}

fn engine_log_path() -> Option<PathBuf> {
    let home = std::env::var("HOME").ok()?;
    let dir = PathBuf::from(home).join("Library/Logs/scribd-dl");
    create_dir_all(&dir).ok()?;
    Some(dir.join("engine.log"))
}

pub fn spawn_sidecar(app: &AppHandle) -> Result<(), String> {
    let sidecar = app
        .shell()
        .sidecar("scribd-dl-engine")
        .map_err(|e| format!("sidecar lookup failed: {e}"))?;

    let (mut rx, child) = sidecar
        .args(["--port", "0"])
        .spawn()
        .map_err(|e| format!("sidecar spawn failed: {e}"))?;

    let state = app.state::<SidecarState>();
    *state.child.lock().unwrap() = Some(child);

    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let state = app_handle.state::<SidecarState>();
        let mut ready = false;
        let mut log_file = engine_log_path().and_then(|p| {
            OpenOptions::new()
                .create(true)
                .write(true)
                .truncate(true)
                .open(p)
                .ok()
        });

        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(bytes) => {
                    let line = String::from_utf8_lossy(&bytes);
                    let line_str = line.trim_end_matches('\n').trim_end_matches('\r');

                    if !ready {
                        if let Some(port) = parse_ready_line(line_str) {
                            let url = format!("http://127.0.0.1:{port}");
                            *state.backend_url.lock().unwrap() = Some(url.clone());
                            ready = true;
                            log::info!("engine sidecar ready at {url}");
                            continue;
                        }
                    }

                    if let Some(f) = log_file.as_mut() {
                        let _ = writeln!(f, "[stdout] {line_str}");
                    }
                }
                CommandEvent::Stderr(bytes) => {
                    let line = String::from_utf8_lossy(&bytes);
                    let line_str = line.trim_end_matches('\n').trim_end_matches('\r');
                    if let Some(f) = log_file.as_mut() {
                        let _ = writeln!(f, "[stderr] {line_str}");
                    }
                }
                CommandEvent::Terminated(payload) => {
                    log::warn!("engine sidecar terminated: {payload:?}");
                    if let Some(f) = log_file.as_mut() {
                        let _ = writeln!(f, "[terminated] {payload:?}");
                    }
                    break;
                }
                CommandEvent::Error(err) => {
                    if let Some(f) = log_file.as_mut() {
                        let _ = writeln!(f, "[error] {err}");
                    }
                }
                _ => {}
            }
        }
    });

    Ok(())
}

pub fn kill_sidecar(state: &SidecarState) {
    let child = state.child.lock().unwrap().take();
    let Some(child) = child else { return };

    let pid = child.pid() as i32;
    unsafe {
        libc::kill(pid, libc::SIGTERM);
    }

    let waited = std::thread::spawn(move || {
        for _ in 0..30 {
            std::thread::sleep(Duration::from_millis(100));
            let alive = unsafe { libc::kill(pid, 0) } == 0;
            if !alive {
                return None;
            }
        }
        Some(child)
    })
    .join();

    if let Ok(Some(child)) = waited {
        let _ = child.kill();
    }

    *state.backend_url.lock().unwrap() = None;
}

#[cfg(test)]
mod tests {
    use super::parse_ready_line;

    #[test]
    fn parses_valid_ready_line() {
        assert_eq!(parse_ready_line("READY port=53421"), Some(53421));
    }

    #[test]
    fn rejects_unrelated_line() {
        assert_eq!(parse_ready_line("hello world"), None);
    }

    #[test]
    fn rejects_non_numeric_port() {
        assert_eq!(parse_ready_line("READY port=abc"), None);
    }

    #[test]
    fn rejects_trailing_garbage() {
        assert_eq!(parse_ready_line("READY port=53421 extra"), None);
    }

    #[test]
    fn rejects_empty_port() {
        assert_eq!(parse_ready_line("READY port="), None);
    }

    #[test]
    fn rejects_negative_port() {
        assert_eq!(parse_ready_line("READY port=-1"), None);
    }
}
