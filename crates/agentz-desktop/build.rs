fn main() {
    tauri_plugin::Builder::new(&["ready", "finish_exit", "set_menu_language"]).build();
}
