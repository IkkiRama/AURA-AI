#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod cloud;
mod database;
mod desktop;
mod release;
mod speech;
mod vault;

use tauri::webview::{PermissionKind, PermissionResponse};
use tauri::{Manager, RunEvent};

fn main() {
    let context = tauri::generate_context!();
    let builder = release::configure_updater(tauri::Builder::default(), context.config());
    let app = builder
        .manage(desktop::Desktop::default())
        .manage(speech::Speech::default())
        .on_permission_request(|webview, kind| match kind {
            PermissionKind::Microphone if webview.label() == "answer" && webview.state::<speech::Speech>().is_active() => PermissionResponse::Default,
            PermissionKind::Microphone | PermissionKind::Camera => PermissionResponse::Deny,
            _ => PermissionResponse::Default,
        })
        .plugin(tauri_plugin_single_instance::init(|app, _, _| desktop::show_main(app)))
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(release::WINDOW_STATE_FLAGS)
                .build(),
        )
        .plugin(desktop::shortcut_plugin())
        .plugin(
            tauri_plugin_opener::Builder::new()
                .open_js_links_on_click(false)
                .build(),
        )
        .plugin(
            // WebView IPC may run while Tauri is still creating its initial windows.
            tauri::plugin::Builder::<tauri::Wry>::new("aura-state")
                .setup(|app, _| {
                    let directory = app.path().app_local_data_dir()?;
                    std::fs::create_dir_all(&directory)?;
                    app.manage(database::Database::open(&directory.join("aura.sqlite3"))?);
                    app.manage(vault::Vault::new(directory));
                    app.manage(cloud::Cloud::new()?);
                    Ok(())
                })
                .build(),
        )
        .setup(|app| {
            desktop::register_shortcuts(app.handle());
            Ok(())
        })
        .on_window_event(desktop::on_window_event)
        .invoke_handler(tauri::generate_handler![
            cloud::session_set_cloud,
            cloud::provider_request,
            cloud::provider_cancel,
            database::db_load,
            database::db_save,
            database::db_index_turn,
            database::db_clear_turns,
            database::db_search_turns,
            database::db_upsert_document,
            database::db_delete_document,
            database::db_search_documents,
            database::db_clear,
            desktop::windows_show,
            desktop::windows_toggle,
            desktop::windows_reset,
            desktop::windows_dock,
            desktop::desktop_set_tray,
            release::release_info,
            release::open_release_link,
            release::updater_prepare_install,
            speech::speech_permit,
            speech::speech_activate,
            speech::speech_stop,
            speech::speech_engine_ready,
            speech::speech_transcribe,
            vault::vault_unlock,
            vault::vault_status,
            vault::vault_set,
            vault::vault_lock,
        ])
        .build(context)
        .expect("AURA gagal memulai aplikasi desktop.");

    app.run(|app, event| {
        if matches!(event, RunEvent::ExitRequested { .. } | RunEvent::Exit) {
            desktop::stop_cloud(app);
            app.state::<speech::Speech>().cancel();
        }
    });
}
