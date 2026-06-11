use std::sync::atomic::Ordering;
use std::time::Duration;

use serde::Deserialize;
use tauri::{AppHandle, Manager, Window};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};

use crate::sidecar::SidecarState;

#[derive(Debug, Deserialize)]
struct Snapshot {
    jobs: Vec<JobStatus>,
}

#[derive(Debug, Deserialize)]
struct JobStatus {
    status: String,
}

const FETCH_TIMEOUT: Duration = Duration::from_secs(2);

fn snapshot_has_active(snapshot: &Snapshot) -> bool {
    snapshot
        .jobs
        .iter()
        .any(|j| j.status == "Queued" || j.status == "Downloading")
}

pub async fn has_active_jobs(backend_url: &str) -> Result<bool, reqwest::Error> {
    let client = reqwest::Client::builder()
        .timeout(FETCH_TIMEOUT)
        .build()?;
    let snapshot: Snapshot = client
        .get(format!("{backend_url}/snapshot"))
        .send()
        .await?
        .json()
        .await?;
    Ok(snapshot_has_active(&snapshot))
}

pub async fn handle_close_request(app: AppHandle, window: Window) {
    let url = app
        .state::<SidecarState>()
        .backend_url
        .lock()
        .unwrap()
        .clone();

    let active = match url {
        Some(u) => has_active_jobs(&u).await.unwrap_or(false),
        None => false,
    };

    if !active {
        confirm_and_close(&app, &window);
        return;
    }

    let app_cb = app.clone();
    let window_cb = window.clone();
    app.dialog()
        .message("Closing will cancel any downloads still in progress.")
        .title("Cancel active downloads?")
        .buttons(MessageDialogButtons::OkCancelCustom(
            "Close anyway".into(),
            "Keep open".into(),
        ))
        .show(move |confirmed| {
            if confirmed {
                confirm_and_close(&app_cb, &window_cb);
            }
        });
}

fn confirm_and_close(app: &AppHandle, window: &Window) {
    app.state::<SidecarState>()
        .quit_confirmed
        .store(true, Ordering::SeqCst);
    let _ = window.close();
}

#[cfg(test)]
mod tests {
    use super::{snapshot_has_active, Snapshot};

    fn parse(json: &str) -> Snapshot {
        serde_json::from_str(json).expect("valid snapshot json")
    }

    #[test]
    fn empty_snapshot_has_no_active() {
        let snap = parse(r#"{"jobs":[]}"#);
        assert!(!snapshot_has_active(&snap));
    }

    #[test]
    fn downloaded_only_has_no_active() {
        let snap = parse(r#"{"jobs":[{"status":"Downloaded"}]}"#);
        assert!(!snapshot_has_active(&snap));
    }

    #[test]
    fn queued_counts_as_active() {
        let snap = parse(r#"{"jobs":[{"status":"Queued"}]}"#);
        assert!(snapshot_has_active(&snap));
    }

    #[test]
    fn downloading_counts_as_active() {
        let snap = parse(r#"{"jobs":[{"status":"Downloading"}]}"#);
        assert!(snapshot_has_active(&snap));
    }

    #[test]
    fn failed_does_not_count_as_active() {
        let snap = parse(r#"{"jobs":[{"status":"Failed"}]}"#);
        assert!(!snapshot_has_active(&snap));
    }

    #[test]
    fn mixed_with_one_active_returns_true() {
        let snap = parse(
            r#"{"jobs":[{"status":"Downloaded"},{"status":"Queued"},{"status":"Failed"}]}"#,
        );
        assert!(snapshot_has_active(&snap));
    }

    #[test]
    fn ignores_unknown_extra_fields() {
        let snap = parse(
            r#"{"jobs":[{"status":"Downloading","id":"x","extra":42}],"foo":"bar"}"#,
        );
        assert!(snapshot_has_active(&snap));
    }
}
