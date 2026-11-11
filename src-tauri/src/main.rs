#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod cloud;
mod database;
mod desktop;
mod vault;

use tauri::{Manager, RunEvent};
use tauri_plugin_window_state::StateFlags;

fn main() {
    let app = tauri::Builder::default()
        .manage(desktop::Desktop::default())
        .plugin(tauri_plugin_single_instance::init(|app, _, _| desktop::show_main(app)))
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(StateFlags::POSITION | StateFlags::SIZE | StateFlags::MAXIMIZED)
                .build(),
        )
        .plugin(desktop::shortcut_plugin())
        .setup(|app| {
            let directory = app.path().app_local_data_dir()?;
            std::fs::create_dir_all(&directory)?;
            app.manage(database::Database::open(&directory.join("aura.sqlite3"))?);
            app.manage(vault::Vault::new(directory));
            app.manage(cloud::Cloud::new()?);
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
            vault::vault_unlock,
            vault::vault_status,
            vault::vault_set,
            vault::vault_lock,
        ])
        .build(tauri::generate_context!())
        .expect("AURA gagal memulai aplikasi desktop.");

    app.run(|app, event| {
        if matches!(event, RunEvent::ExitRequested { .. } | RunEvent::Exit) {
            desktop::stop_cloud(app);
        }
    });
}
