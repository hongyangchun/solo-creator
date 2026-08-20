use tauri::Manager;

mod setup;
mod state;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // 拉起引擎 sidecar（Node 常驻进程，127.0.0.1:39281）
            setup::spawn_engine_sidecar(app.handle().clone());
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                setup::shutdown_engine(window.app_handle());
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running SoloCreator GUI");
}
