use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, PhysicalPosition, WebviewWindow, Window, WindowEvent,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

use crate::{cloud::Cloud, vault::Vault};

const PANELS: [&str; 2] = ["prompt", "answer"];
const TRAY_ID: &str = "aura-tray";

#[derive(Default)]
pub struct Desktop(AtomicBool);

impl Desktop {
    pub fn is_background(&self) -> bool {
        self.0.load(Ordering::Relaxed)
    }

    fn set_background(&self, hidden: bool) {
        self.0.store(hidden, Ordering::Relaxed);
    }
}

fn shortcut(code: Code) -> Shortcut {
    Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT | Modifiers::SHIFT), code)
}

pub fn shortcut_plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri_plugin_global_shortcut::Builder::new()
        .with_handler(|app, pressed, event| {
            if event.state() != ShortcutState::Pressed {
                return;
            }
            if *pressed == shortcut(Code::KeyA) {
                if app.state::<Desktop>().is_background() {
                    show_main(app);
                }
                let _ = windows_toggle(app.clone());
            } else if *pressed == shortcut(Code::KeyR) {
                let _ = windows_reset(app.clone());
            }
        })
        .build()
}

pub fn register_shortcuts(app: &AppHandle) {
    for code in [Code::KeyA, Code::KeyR] {
        if let Err(error) = app.global_shortcut().register(shortcut(code)) {
            eprintln!("AURA: {error}");
        }
    }
}

fn window(app: &AppHandle, label: &str) -> Result<WebviewWindow, String> {
    app.get_webview_window(label).ok_or_else(|| format!("Jendela {label} tidak tersedia."))
}

fn window_error(_: tauri::Error) -> String {
    "Jendela desktop tidak dapat diatur.".to_owned()
}

fn show_panels(app: &AppHandle) -> Result<(), String> {
    for label in ["answer", "prompt"] {
        let panel = window(app, label)?;
        panel.show().map_err(window_error)?;
        if label == "prompt" {
            panel.set_focus().map_err(window_error)?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn windows_show(app: AppHandle) -> Result<(), String> {
    show_panels(&app)
}

#[tauri::command]
pub fn windows_toggle(app: AppHandle) -> Result<(), String> {
    let both_visible = PANELS.iter().all(|label| {
        app.get_webview_window(label).is_some_and(|panel| panel.is_visible().unwrap_or(false))
    });
    if both_visible {
        for label in PANELS {
            window(&app, label)?.hide().map_err(window_error)?;
        }
        Ok(())
    } else {
        show_panels(&app)
    }
}

fn position(window: &WebviewWindow, right: bool, primary: bool) -> Result<(), String> {
    let current = if primary { None } else { window.current_monitor().map_err(window_error)? };
    let monitor = match current {
        Some(monitor) => monitor,
        None => window.primary_monitor().map_err(window_error)?
            .ok_or_else(|| "Monitor desktop tidak tersedia.".to_owned())?,
    };
    let work = monitor.work_area();
    let margin = (22.0 * monitor.scale_factor()).round() as u32;
    let width = window.outer_size().map_err(window_error)?.width;
    let x_offset = if right {
        work.size.width.saturating_sub(width).saturating_sub(margin)
    } else {
        margin.min(work.size.width.saturating_sub(width))
    };
    window.set_position(PhysicalPosition::new(
        work.position.x + x_offset as i32,
        work.position.y + margin as i32,
    )).map_err(window_error)
}

#[tauri::command]
pub fn windows_reset(app: AppHandle) -> Result<(), String> {
    for (index, label) in PANELS.iter().enumerate() {
        position(&window(&app, label)?, index == 1, true)?;
    }
    Ok(())
}

#[tauri::command]
pub fn windows_dock(app: AppHandle, label: String, side: String) -> Result<(), String> {
    if !PANELS.contains(&label.as_str()) || !matches!(side.as_str(), "left" | "right") {
        return Err("Pilihan docking tidak valid.".to_owned());
    }
    position(&window(&app, &label)?, side == "right", false)
}

pub fn show_main(app: &AppHandle) {
    if let Some(main) = app.get_webview_window("main") {
        app.state::<Desktop>().set_background(false);
        let _ = main.unminimize();
        let _ = main.show();
        let _ = main.set_focus();
    }
}

pub fn stop_cloud(app: &AppHandle) {
    if let Some(cloud) = app.try_state::<Cloud>() {
        cloud.set_enabled(false);
    }
}

fn session_action(app: &AppHandle, action: &str) {
    stop_cloud(app);
    let _ = app.emit("aura:session-action", action);
}

pub fn on_window_event(window: &Window, event: &WindowEvent) {
    let WindowEvent::CloseRequested { api, .. } = event else {
        return;
    };
    api.prevent_close();
    if window.label() != "main" {
        let _ = window.hide();
        return;
    }

    let app = window.app_handle();
    if app.tray_by_id(TRAY_ID).is_some() {
        app.state::<Desktop>().set_background(true);
        session_action(app, "hide");
        let _ = app.state::<Vault>().lock();
        for label in PANELS {
            if let Some(panel) = app.get_webview_window(label) {
                let _ = panel.hide();
            }
        }
        let _ = window.hide();
    } else {
        stop_cloud(app);
        app.exit(0);
    }
}

fn add_tray(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "aura-show", "Tampilkan AURA", true, None::<&str>)?;
    let pause = MenuItem::with_id(app, "aura-pause", "Jeda sesi", true, None::<&str>)?;
    let end = MenuItem::with_id(app, "aura-end", "Akhiri sesi", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "aura-quit", "Keluar dari AURA", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &pause, &end, &quit])?;
    let builder = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("AURA — proses aplikasi aktif")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "aura-show" => show_main(app),
            "aura-pause" => session_action(app, "pause"),
            "aura-end" => session_action(app, "end"),
            "aura-quit" => {
                stop_cloud(app);
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                show_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder.icon(icon.clone()).build(app)?;
    } else {
        builder.build(app)?;
    }
    Ok(())
}

#[tauri::command]
pub fn desktop_set_tray(app: AppHandle, enabled: bool) -> Result<(), String> {
    if enabled {
        if app.tray_by_id(TRAY_ID).is_none() {
            add_tray(&app).map_err(|_| "Ikon system tray tidak dapat ditampilkan.".to_owned())?;
        }
    } else {
        if app.state::<Desktop>().is_background() {
            show_main(&app);
        }
        app.remove_tray_by_id(TRAY_ID);
    }
    Ok(())
}
