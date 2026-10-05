fn main() {
    tauri_plugin::Builder::new(&[
        "ready",
        "finish_exit",
        "set_menu_language",
        "codex_locate",
        "codex_start",
        "codex_send",
        "codex_stop",
    ])
    .build();
}
