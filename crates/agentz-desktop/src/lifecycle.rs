use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};
use tauri::{AppHandle, Emitter, Manager, RunEvent, WebviewWindow, WindowEvent, Wry};

const EXIT_EVENT: &str = "agentz:exit-requested";
const MENU_EVENT: &str = "agentz:menu-action";

#[derive(Default)]
pub struct Lifecycle(Mutex<ExitState>, AtomicBool);

#[derive(Default)]
struct ExitState {
    ready: bool,
    next_id: u32,
    pending: Option<(u32, i32)>,
    authorized: bool,
    closed_main: bool,
    menu_action: Option<&'static str>,
}

impl ExitState {
    fn request(&mut self, code: i32) -> Option<u32> {
        if self.pending.is_some() {
            return None;
        }
        self.next_id = self.next_id.wrapping_add(1);
        self.pending = Some((self.next_id, code));
        self.ready.then_some(self.next_id)
    }

    fn finish(&mut self, id: u32, ok: bool) -> Option<i32> {
        let (pending_id, code) = self.pending?;
        if pending_id != id {
            return None;
        }
        self.pending = None;
        self.authorized = ok;
        ok.then_some(code)
    }
}

fn announce_exit(app: &AppHandle<Wry>, request_id: u32) -> Result<(), String> {
    app.emit_to(
        "main",
        EXIT_EVENT,
        serde_json::json!({ "requestId": request_id }),
    )
    .map_err(|error| error.to_string())
}

/// The frontend calls this after installing listeners, before loading its module.
/// An early Quit is held until this handshake instead of losing the event.
#[tauri::command]
pub fn ready(window: WebviewWindow<Wry>, app: AppHandle<Wry>) -> Result<(), String> {
    if window.label() != "main" {
        return Err("only the main window owns the desktop lifecycle".into());
    }
    let (pending, action) = {
        let state = app.state::<Lifecycle>();
        let mut state = state.0.lock().map_err(|error| error.to_string())?;
        state.ready = true;
        state.closed_main = false;
        (state.pending.map(|(id, _)| id), state.menu_action.take())
    };
    if let Some(id) = pending {
        announce_exit(&app, id)?;
    }
    if let Some(action) = action {
        app.emit_to("main", MENU_EVENT, action)
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

/// Only an acknowledgment of the current request can authorize one exit.
#[tauri::command]
pub fn finish_exit(
    window: WebviewWindow<Wry>,
    app: AppHandle<Wry>,
    request_id: u32,
    ok: bool,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("only the main window can acknowledge an exit".into());
    }
    let code = app
        .state::<Lifecycle>()
        .0
        .lock()
        .map_err(|error| error.to_string())?
        .finish(request_id, ok);
    if let Some(code) = code {
        app.exit(code);
    }
    Ok(())
}

/// Never build a webview synchronously inside a plugin event callback: Tauri
/// holds its plugin mutex while dispatching the event, and webview creation
/// needs the same mutex. A worker also avoids WebView2's event-handler deadlock.
pub fn show_main(app: &AppHandle<Wry>) {
    let state = app.state::<Lifecycle>();
    if state.1.swap(true, Ordering::AcqRel) {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let result = create_or_show_main(&app);
        app.state::<Lifecycle>().1.store(false, Ordering::Release);
        if let Err(error) = result {
            eprintln!("could not show app window: {error}");
        }
    });
}

fn create_or_show_main(app: &AppHandle<Wry>) -> tauri::Result<()> {
    let window = match app.get_webview_window("main") {
        Some(window) => window,
        None => {
            let config = app
                .config()
                .app
                .windows
                .iter()
                .find(|window| window.label == "main")
                .expect("desktop apps must configure a main window");
            tauri::WebviewWindowBuilder::from_config(app, config)?.build()?
        }
    };
    window.unminimize()?;
    window.show()?;
    window.set_focus()?;
    Ok(())
}

fn menu_action(app: &AppHandle<Wry>, action: &'static str) {
    let ready = app.state::<Lifecycle>().0.lock().unwrap().ready;
    if !ready {
        app.state::<Lifecycle>().0.lock().unwrap().menu_action = Some(action);
    }
    show_main(app);
    if ready {
        if let Err(error) = app.emit_to("main", MENU_EVENT, action) {
            eprintln!("could not send menu action: {error}");
        }
    }
}

pub fn on_event(app: &AppHandle<Wry>, event: &RunEvent) {
    match event {
        RunEvent::ExitRequested { api, code, .. } => {
            // Tauri explicitly bypasses prevention for restart. The updater
            // must already have locked editing and successfully flushed.
            if *code == Some(tauri::RESTART_EXIT_CODE) {
                return;
            }
            let state = app.state::<Lifecycle>();
            let mut state = state.0.lock().unwrap();
            if state.authorized {
                state.authorized = false;
                return;
            }
            let no_window = app.get_webview_window("main").is_none();
            #[cfg(target_os = "macos")]
            if no_window && code.is_none() && state.closed_main {
                // The runtime emits this directly after the last Destroyed.
                // A later explicit Quit (including the Dock menu) can exit.
                state.closed_main = false;
                api.prevent_exit();
                return;
            }
            if no_window {
                // The close path already completed its successful flush.
                return;
            }
            api.prevent_exit();
            let request = state.request(code.unwrap_or(0));
            drop(state);
            if let Some(id) = request {
                if let Err(error) = announce_exit(app, id) {
                    app.state::<Lifecycle>().0.lock().unwrap().pending = None;
                    eprintln!("could not request save before exit: {error}");
                }
            }
        }
        RunEvent::WindowEvent {
            label,
            event: WindowEvent::Destroyed,
            ..
        } if label == "main" => {
            let state = app.state::<Lifecycle>();
            let mut state = state.0.lock().unwrap();
            state.ready = false;
            state.closed_main = true;
            state.pending = None;
        }
        #[cfg(target_os = "macos")]
        RunEvent::Reopen { .. } => show_main(app),
        RunEvent::MenuEvent(event) => match event.id().as_ref() {
            super::menu::SETTINGS => menu_action(app, "settings"),
            super::menu::ABOUT => menu_action(app, "about"),
            super::menu::QUIT => app.exit(0),
            _ => {}
        },
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::ExitState;

    #[test]
    fn early_quit_waits_for_frontend_readiness() {
        let mut state = ExitState::default();
        assert_eq!(state.request(7), None);
        assert_eq!(state.pending, Some((1, 7)));
        state.ready = true;
        assert_eq!(state.finish(1, true), Some(7));
        assert!(state.authorized);
    }

    #[test]
    fn duplicate_and_stale_acknowledgments_cannot_authorize_exit() {
        let mut state = ExitState {
            ready: true,
            ..Default::default()
        };
        assert_eq!(state.request(0), Some(1));
        assert_eq!(state.request(0), None);
        assert_eq!(state.finish(99, true), None);
        assert!(!state.authorized);
        assert_eq!(state.finish(1, false), None);
        assert!(!state.authorized);
        assert_eq!(state.request(0), Some(2));
        assert_eq!(state.finish(1, true), None);
        assert!(!state.authorized);
        assert_eq!(state.finish(2, true), Some(0));
        assert_eq!(state.finish(2, true), None);
    }
}
