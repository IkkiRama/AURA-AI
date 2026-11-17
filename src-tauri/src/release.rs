use std::{fs, io, path::Path};

use reqwest::Url;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager, State, WebviewWindow};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_window_state::{AppHandleExt, StateFlags};

use crate::cloud::Cloud;

pub const WINDOW_STATE_FLAGS: StateFlags = StateFlags::POSITION
    .union(StateFlags::SIZE)
    .union(StateFlags::MAXIMIZED);

const RECOVERY_EXE: &str = "AURA-previous.exe";

struct UpdaterAvailability(bool);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseInfo {
    version: String,
    updater_configured: bool,
    instagram_username: Option<String>,
    privacy_policy_url: Option<String>,
    license: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ReleaseLink {
    Instagram,
    Privacy,
}

fn is_https(url: &Url) -> bool {
    url.scheme() == "https" && url.has_host() && url.username().is_empty() && url.password().is_none()
}

fn valid_updater_config(value: Option<&Value>) -> bool {
    let Some(config) = value
        .cloned()
        .and_then(|value| serde_json::from_value::<tauri_plugin_updater::Config>(value).ok())
    else {
        return false;
    };

    !config.pubkey.trim().is_empty()
        && !config.endpoints.is_empty()
        && config.endpoints.iter().all(is_https)
        && !config.dangerous_insecure_transport_protocol
        && !config.dangerous_accept_invalid_certs
        && !config.dangerous_accept_invalid_hostnames
        && !config.allow_downgrades
        && config.require_signed_version
        && config
            .windows
            .as_ref()
            .is_none_or(|windows| windows.install_mode.to_string() == "passive")
}

pub fn configure_updater(
    builder: tauri::Builder<tauri::Wry>,
    config: &tauri::Config,
) -> tauri::Builder<tauri::Wry> {
    let recovery = std::env::current_exe()
        .ok()
        .as_deref()
        .and_then(Path::file_name)
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.eq_ignore_ascii_case(RECOVERY_EXE));
    let configured = !recovery && valid_updater_config(config.plugins.0.get("updater"));
    let builder = builder.manage(UpdaterAvailability(configured));
    if configured {
        builder.plugin(tauri_plugin_updater::Builder::new().build())
    } else {
        builder
    }
}

fn instagram_username(value: &str) -> Option<&str> {
    let value = value.trim();
    let username = value.strip_prefix('@').unwrap_or(value);
    (!username.is_empty()
        && username.len() <= 30
        && username != "."
        && username != ".."
        && username
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_')))
    .then_some(username)
}

fn public_profile(app: &AppHandle, field: &str) -> Option<String> {
    let value = app
        .config()
        .plugins
        .0
        .get("aura")?
        .get(field)?
        .as_str()?
        .trim();
    (!value.is_empty() && value.len() <= 2048).then(|| value.to_owned())
}

#[tauri::command]
pub fn release_info(app: AppHandle) -> ReleaseInfo {
    ReleaseInfo {
        version: app.package_info().version.to_string(),
        updater_configured: app.state::<UpdaterAvailability>().inner().0,
        instagram_username: public_profile(&app, "instagramUsername")
            .as_deref()
            .and_then(instagram_username)
            .map(str::to_owned),
        privacy_policy_url: public_profile(&app, "privacyPolicyUrl")
            .and_then(|value| Url::parse(&value).ok())
            .filter(is_https)
            .map(|url| url.to_string()),
        license: public_profile(&app, "license"),
    }
}

#[tauri::command]
pub fn open_release_link(window: WebviewWindow, link: ReleaseLink) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Tautan ini tersedia di jendela utama AURA.".to_owned());
    }
    let info = release_info(window.app_handle().clone());
    let url = match link {
        ReleaseLink::Instagram => info
            .instagram_username
            .map(|name| format!("https://www.instagram.com/{name}/")),
        ReleaseLink::Privacy => info.privacy_policy_url,
    }
    .ok_or_else(|| "Tautan belum dikonfigurasi.".to_owned())?;

    window
        .opener()
        .open_url(url, None::<&str>)
        .map_err(|_| "Browser bawaan tidak dapat membuka tautan.".to_owned())
}

fn backup_executable(source: &Path, directory: &Path) -> io::Result<()> {
    fs::create_dir_all(directory)?;
    let destination = directory.join(RECOVERY_EXE);
    let temporary = destination.with_extension("exe.tmp");
    let result = (|| {
        fs::copy(source, &temporary)?;
        fs::OpenOptions::new()
            .write(true)
            .open(&temporary)?
            .sync_all()?;
        fs::rename(&temporary, destination)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

#[tauri::command]
pub async fn updater_prepare_install(
    window: WebviewWindow,
    cloud: State<'_, Cloud>,
) -> Result<(), String> {
    let app = window.app_handle();
    if window.label() != "main" || !app.state::<UpdaterAvailability>().inner().0 {
        return Err("Pembaruan belum dikonfigurasi.".to_owned());
    }
    if !cloud.is_idle_for_update() {
        return Err("AURA masih menggunakan layanan AI.".to_owned());
    }
    if !app.state::<crate::speech::Speech>().is_idle_for_update() {
        return Err("AURA masih menyelesaikan pemrosesan audio.".to_owned());
    }

    app.save_window_state(WINDOW_STATE_FLAGS)
        .map_err(|_| "Posisi jendela belum dapat disimpan.".to_owned())?;
    let directory = app
        .path()
        .app_local_data_dir()
        .map_err(|_| "Folder pemulihan pembaruan tidak tersedia.".to_owned())?
        .join("update-recovery");
    let executable = std::env::current_exe()
        .map_err(|_| "Aplikasi sebelumnya tidak dapat ditemukan.".to_owned())?;
    let backup =
        tauri::async_runtime::spawn_blocking(move || backup_executable(&executable, &directory));
    let error = || "Salinan pemulihan aplikasi belum dapat disimpan.".to_owned();
    backup.await.map_err(|_| error())?.map_err(|_| error())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn updater_requires_signed_https_release_config() {
        let mut config = json!({
            "pubkey": "fixture-key",
            "endpoints": ["https://example.com/latest.json"],
            "requireSignedVersion": true,
            "windows": { "installMode": "passive" }
        });
        assert!(!valid_updater_config(None));
        assert!(valid_updater_config(Some(&config)));
        config["dangerousAcceptInvalidCerts"] = json!(true);
        assert!(!valid_updater_config(Some(&config)));
        config["dangerousAcceptInvalidCerts"] = json!(false);
        config["requireSignedVersion"] = json!(false);
        assert!(!valid_updater_config(Some(&config)));
        config["requireSignedVersion"] = json!(true);
        config["endpoints"] = json!(["http://example.com/latest.json"]);
        assert!(!valid_updater_config(Some(&config)));
    }

    #[test]
    fn public_links_accept_only_safe_inputs() {
        assert_eq!(instagram_username(" @valid.profile "), Some("valid.profile"));
        assert_eq!(instagram_username("../settings"), None);
        assert_eq!(instagram_username("name?query"), None);
        assert_eq!(instagram_username(".."), None);
        assert!(is_https(&Url::parse("https://example.com/privacy").unwrap()));
        assert!(!is_https(&Url::parse("https://user:pass@example.com/").unwrap()));
        assert!(!is_https(&Url::parse("file:///secret").unwrap()));
    }

    #[test]
    fn recovery_copy_replaces_previous_backup_and_survives_copy_failure() -> io::Result<()> {
        let directory = std::env::temp_dir().join(format!("aura-recovery-{}", std::process::id()));
        fs::create_dir(&directory)?;
        let source = directory.join("current.exe");
        let recovery = directory.join("recovery");
        let result = (|| {
            fs::write(&source, b"first executable")?;
            backup_executable(&source, &recovery)?;
            fs::write(&source, b"new executable")?;
            backup_executable(&source, &recovery)?;
            fs::remove_file(&source)?;
            assert!(backup_executable(&source, &recovery).is_err());
            assert_eq!(fs::read(recovery.join(RECOVERY_EXE))?, b"new executable");
            assert!(!recovery.join(RECOVERY_EXE).with_extension("exe.tmp").exists());
            Ok(())
        })();
        let _ = fs::remove_file(&source);
        let _ = fs::remove_file(recovery.join(RECOVERY_EXE));
        let _ = fs::remove_dir(recovery);
        result.and(fs::remove_dir(directory))
    }
}
