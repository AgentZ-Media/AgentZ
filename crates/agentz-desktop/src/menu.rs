use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    AppHandle, WebviewWindow, Wry,
};

pub const SETTINGS: &str = "agentz.settings";
pub const ABOUT: &str = "agentz.about";
pub const QUIT: &str = "agentz.quit";

#[tauri::command]
pub fn set_menu_language(
    window: WebviewWindow<Wry>,
    app: AppHandle<Wry>,
    language: &str,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("only the main window owns the desktop menu".into());
    }
    if !matches!(language, "de" | "en") {
        return Err("unsupported menu language".into());
    }
    app.set_menu(build(&app, language).map_err(|error| error.to_string())?)
        .map_err(|error| error.to_string())?;
    Ok(())
}

pub fn build(app: &AppHandle<Wry>, language: &str) -> tauri::Result<Menu<Wry>> {
    let de = language == "de";
    let label = |german, english| if de { german } else { english };
    let name = app
        .config()
        .product_name
        .as_deref()
        .unwrap_or(&app.package_info().name);
    let about = MenuItem::with_id(
        app,
        ABOUT,
        format!("{} {name}", label("Über", "About")),
        true,
        None::<&str>,
    )?;
    let settings = MenuItem::with_id(
        app,
        SETTINGS,
        label("Einstellungen…", "Settings…"),
        true,
        Some("CmdOrCtrl+,"),
    )?;
    // A custom quit item supplies an explicit exit code. On macOS a last-window
    // close has code None and must keep the Dock process alive instead.
    let quit_label = if de {
        format!("{name} beenden")
    } else {
        format!("Quit {name}")
    };
    let quit = MenuItem::with_id(app, QUIT, quit_label, true, Some("CmdOrCtrl+Q"))?;
    let app_menu = Submenu::with_items(
        app,
        name,
        true,
        &[
            &about,
            &settings,
            &PredefinedMenuItem::separator(app)?,
            #[cfg(target_os = "macos")]
            &PredefinedMenuItem::services(app, Some(label("Dienste", "Services")))?,
            #[cfg(target_os = "macos")]
            &PredefinedMenuItem::hide(
                app,
                Some(&if de {
                    format!("{name} ausblenden")
                } else {
                    format!("Hide {name}")
                }),
            )?,
            #[cfg(target_os = "macos")]
            &PredefinedMenuItem::hide_others(app, Some(label("Andere ausblenden", "Hide Others")))?,
            #[cfg(target_os = "macos")]
            &PredefinedMenuItem::show_all(app, Some(label("Alle einblenden", "Show All")))?,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;
    let edit = Submenu::with_items(
        app,
        label("Bearbeiten", "Edit"),
        true,
        &[
            &PredefinedMenuItem::undo(app, Some(label("Rückgängig", "Undo")))?,
            &PredefinedMenuItem::redo(app, Some(label("Wiederholen", "Redo")))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, Some(label("Ausschneiden", "Cut")))?,
            &PredefinedMenuItem::copy(app, Some(label("Kopieren", "Copy")))?,
            &PredefinedMenuItem::paste(app, Some(label("Einfügen", "Paste")))?,
            &PredefinedMenuItem::select_all(app, Some(label("Alles auswählen", "Select All")))?,
        ],
    )?;
    let window = Submenu::with_items(
        app,
        label("Fenster", "Window"),
        true,
        &[
            &PredefinedMenuItem::minimize(app, Some(label("Minimieren", "Minimize")))?,
            &PredefinedMenuItem::maximize(app, Some(label("Zoomen", "Zoom")))?,
            &PredefinedMenuItem::close_window(
                app,
                Some(label("Fenster schließen", "Close Window")),
            )?,
        ],
    )?;
    Menu::with_items(app, &[&app_menu, &edit, &window])
}
