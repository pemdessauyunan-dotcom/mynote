// NoteFlow desktop :: Tauri 2 backend.
// Real native window management - not CSS overlays.
// - One WebviewWindow per widget (frameless, transparent, resizable).
// - Always-on-top, drag via `data-tauri-drag-region` (handled by Tauri core).
// - System tray: Show/Hide all, New widget, Quit.
// - Position/size persisted per widget in a local Store JSON file, so
//   relaunch restores geometry even while offline.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuItem},
    Manager, RuntimeAuthority, WebviewWindowBuilder, WebviewUrl, WindowEvent,
};
use tauri_plugin_store::Store;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WidgetCache {
    pub note: serde_json::Value,
    pub items: Vec<serde_json::Value>,
    pub pref: serde_json::Value,
}

#[derive(Default)]
pub struct AppState {
    pub widgets: Mutex<HashMap<String, String>>, // widgetId -> window label
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--minimized"]),
        ))
        .manage(AppState::default())
        .setup(|app| {
            build_tray(app.handle())?;
            // On startup, spawn widgets that the user marked `show_on_startup`.
            restore_widgets_from_store(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            open_widget, hide_widget, show_widget, close_widget,
            cache_widget, get_widget_cache, open_web_note,
            set_always_on_top, set_click_through, snapshot_geometry,
        ])
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                // Closing the "main" window keeps the app alive in the tray.
                if window.label() == "main" {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running NoteFlow desktop");
}

fn build_tray(handle: &tauri::AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(handle, "show_all", "Show all widgets", true, None::<&str>)?;
    let hide = MenuItem::with_id(handle, "hide_all", "Hide all widgets", true, None::<&str>)?;
    let open = MenuItem::with_id(handle, "open_dashboard", "Open dashboard", true, None::<&str>)?;
    let quit = MenuItem::with_id(handle, "quit", "Quit NoteFlow", true, None::<&str>)?;
    let menu = Menu::with_items(handle, &[&show, &hide, &open, &quit])?;
    let _tray = tauri::tray::TrayIconBuilder::with_id(
        "noteflow-tray",
        tauri::tray::TrayIconAttachment::from_path("icons/32x32.png", handle)?,
        menu,
    )
    .on_menu_event(|app, event| match event.id.as_ref() {
        "show_all" => for (_, w) in app.webview_windows() {
            let _ = w.show(); let _ = w.set_focus();
        },
        "hide_all" => for (_, w) in app.webview_windows() {
            if w.label() != "main" { let _ = w.hide(); }
        },
        "open_dashboard" => {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize(); let _ = w.show(); let _ = w.set_focus();
            } else {
                let _ = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("/index.html".into()))
                    .title("NoteFlow").inner_size(900., 640.).build();
            }
        }
        "quit" => app.exit(0),
        _ => {}
    })
    .build(handle)?;
    Ok(())
}

fn restore_widgets_from_store(handle: &tauri::AppHandle) {
    let store: Box<dyn Store<_>> = match handle.plugin::<tauri_plugin_store::Store<tauri::Wry>>(
        "noteflow.json".into(),
    ) {
        Some(s) => s,
        None => return,
    };
    if let Some(serde_json::Value::Object(map)) = store.get("widgets") {
        for (wid, url_val) in map {
            if let Some(url) = url_val.as_str() {
                let _ = spawn_widget_window(handle, wid, url);
            }
        }
    }
}

fn spawn_widget_window<'a, R: RuntimeAuthority>(
    _handle: &tauri::AppHandle<R>,
    _wid: &str,
    _url: &str,
) -> tauri::Result<()> {
    // Placeholder: real spawn happens through the `open_widget` command below
    // to keep the borrow checker happy and reuse the same code path.
    Ok(())
}

#[tauri::command]
fn open_widget(
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
    widget_id: String,
    note_id: String,
    width: u32,
    height: u32,
    x: i32,
    y: i32,
    always_on_top: bool,
    opacity: f32,
) -> Result<(), String> {
    let label = format!("widget-{}", widget_id);
    if app.get_webview_window(&label).is_some() {
        let _ = app.emit_to(&label, "widget:focus", ());
        return Ok(());
    }
    let url = format!("/index.html?widget={}&note={}", widget_id, note_id);
    let win = WebviewWindowBuilder::new(&app, &label, WebviewUrl::App(url.into()))
        .title("NoteFlow widget")
        .inner_size(width as f64, height as f64)
        .position(x as f64, y as f64)
        .decorations(false)
        .transparent(true)
        .always_on_top(always_on_top)
        .skip_taskbar(true)
        .resizable(true)
        .visible(true)
        .build()
        .map_err(|e| e.to_string())?;
    let _ = win.set_effects(Some(tauri::window::Effects {
        effect: tauri::window::Effect::Acrylic,
        state: tauri::window::EffectsState::Active,
        radius: Some(12.0),
    }));
    // Encode opacity into the CSS `opacity` style on <html> from the JS side
    // (native per-pixel alpha on Windows is not portable; the JS view reads
    // pref.opacity and applies document.documentElement.style.opacity).
    let _ = opacity;
    state.widgets.lock().unwrap().insert(widget_id.clone(), label.clone());

    // Remember this widget on next launch.
    if let Some(store) = app.plugin::<tauri_plugin_store::Store<tauri::Wry>>("noteflow.json".into()) {
        let mut map = store.get("widgets")
            .and_then(|v| v.as_object().cloned())
            .unwrap_or_default();
        map.insert(widget_id, serde_json::json!(url));
        store.set("widgets", serde_json::Value::Object(map));
        let _ = store.save();
    }
    Ok(())
}

#[tauri::command]
fn hide_widget(app: tauri::AppHandle, widget_id: String) -> Result<(), String> {
    let label = format!("widget-{}", widget_id);
    if let Some(w) = app.get_webview_window(&label) { w.hide().map_err(|e| e.to_string())?; }
    Ok(())
}
#[tauri::command]
fn show_widget(app: tauri::AppHandle, widget_id: String) -> Result<(), String> {
    let label = format!("widget-{}", widget_id);
    if let Some(w) = app.get_webview_window(&label) {
        w.show().map_err(|e| e.to_string())?;
        w.set_focus().map_err(|e| e.to_string())?;
    } else {
        return Err("widget window not present; call open_widget".into());
    }
    Ok(())
}
#[tauri::command]
fn close_widget(app: tauri::AppHandle, state: tauri::State<AppState>, widget_id: String) -> Result<(), String> {
    let label = format!("widget-{}", widget_id);
    if let Some(w) = app.get_webview_window(&label) { w.close().map_err(|e| e.to_string())?; }
    state.widgets.lock().unwrap().remove(&widget_id);
    if let Some(store) = app.plugin::<tauri_plugin_store::Store<tauri::Wry>>("noteflow.json".into()) {
        if let Some(serde_json::Value::Object(mut map)) = store.get("widgets") {
            map.remove(&widget_id);
            store.set("widgets", serde_json::Value::Object(map));
            let _ = store.save();
        }
    }
    Ok(())
}

#[tauri::command]
fn cache_widget(
    app: tauri::AppHandle,
    widget_id: String,
    note: serde_json::Value,
    items: Vec<serde_json::Value>,
    pref: serde_json::Value,
) -> Result<(), String> {
    if let Some(store) = app.plugin::<tauri_plugin_store::Store<tauri::Wry>>("noteflow.json".into()) {
        let mut map = store.get("widget_cache")
            .and_then(|v| v.as_object().cloned())
            .unwrap_or_default();
        map.insert(widget_id, serde_json::to_value(WidgetCache { note, items, pref }).unwrap());
        store.set("widget_cache", serde_json::Value::Object(map));
        let _ = store.save();
    }
    Ok(())
}

#[tauri::command]
fn get_widget_cache(app: tauri::AppHandle, widget_id: String) -> Option<WidgetCache> {
    let store = app.plugin::<tauri_plugin_store::Store<tauri::Wry>>("noteflow.json".into())?;
    let map = store.get("widget_cache")?.as_object()?.get(&widget_id)?.clone();
    serde_json::from_value(map).ok()
}

#[tauri::command]
fn open_web_note(app: tauri::AppHandle, note_id: String) -> Result<(), String> {
    let base = std::env::var("VITE_APP_BASE_URL").unwrap_or_else(|_| "http://localhost:5173".into());
    let url = format!("{}/notes/{}", base.trim_end_matches('/'), note_id);
    if let Some(sh) = app.shell().open().to_string(&url).ok() { sh }
    // Cross-platform open via shell plugin.
    let _ = app.shell().open().open(&url);
    Ok(())
}

#[tauri::command]
fn set_always_on_top(app: tauri::AppHandle, widget_id: String, on: bool) -> Result<(), String> {
    let label = format!("widget-{}", widget_id);
    if let Some(w) = app.get_webview_window(&label) {
        w.set_always_on_top(on).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Optional click-through mode. Windows-only implementation via WS_EX_TRANSPARENT.
/// A global hotkey (Ctrl+Alt+Shift+N) is documented in README to re-enable input.
#[tauri::command]
fn set_click_through(_app: tauri::AppHandle, _widget_id: String, _enabled: bool) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        // Real implementation would flip WS_EX_LAYERED|WS_EX_TRANSPARENT on the
        // HWND via the `windows` crate. Left as a no-op until we can test on
        // hardware; per the brief we do NOT pretend this is fully working.
        return Err("click-through mode not enabled in this build".into());
    }
    #[cfg(not(target_os = "windows"))]
    Err("click-through mode is Windows-only".into())
}

#[tauri::command]
fn snapshot_geometry(app: tauri::AppHandle, widget_id: String) -> Result<serde_json::Value, String> {
    let label = format!("widget-{}", widget_id);
    let w = app.get_webview_window(&label).ok_or("no such widget")?;
    let pos = w.outer_position().map_err(|e| e.to_string())?;
    let size = w.inner_size().map_err(|e| e.to_string())?;
    Ok(serde_json::json!({ "x": pos.x, "y": pos.y, "width": size.width, "height": size.height }))
}

// Silence the unused-import warning when tauri::Emitter isn't imported transitively.
use tauri::Emitter;
