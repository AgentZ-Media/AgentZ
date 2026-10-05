# agentz-desktop

Shared native host for AgentZ desktop apps.

`builder(Config { id, migrations })` returns a plain `tauri::Builder<Wry>`.
Apps may add their own plugins and commands, then call
`.run(tauri::generate_context!())`. The database is `sqlite:<id>.db`, the
same name the frontend host (`@agentz/desktop`) opens. Window config,
identifier, updater key and product migrations stay in the app.

- New apps use `KIT_BASELINE_SQL` (`settings`, `app_state`) as migration 1.
  Published migrations are never replaced.
- Standard plugins are registered here, single-instance first. Every app
  also lists them as direct Cargo dependencies: Tauri reads their
  capability metadata through Cargo `links`. Apps need the capability
  `agentz-desktop:default`. System-wide shortcuts are not part of the base.
- macOS gets a native app menu (About, Settings, Quit, Edit, Window);
  Windows keeps a plain window without a menu bar.

## Frontend contract

`@agentz/desktop` installs its listeners and then calls
`plugin:agentz-desktop|ready`. A quit requested earlier waits for it.

- `agentz:exit-requested` sends `{ requestId }`. The frontend locks editing,
  flushes and answers `plugin:agentz-desktop|finish_exit({ requestId, ok })`.
  Only the current, successful answer allows one exit.
- If the frontend never becomes ready, the app quits after 10 s (nothing can
  be unsaved). If a save hangs, a second Quit after 2 s offers
  "Quit Anyway" in a native dialog.
- `agentz:menu-action` sends `settings` or `about`; a closed window is
  recreated first.
- `plugin:agentz-desktop|set_menu_language({ language })` passes `de` or `en`
  for the menu and native dialogs. Rust never reads the database.

Closing the window is prevented in the frontend until the flush succeeded.
On macOS the process stays in the Dock and a Dock click reopens the window;
a Quit that arrives while the window closes still completes. A second app
launch focuses the existing window.

**Updates:** a Tauri restart cannot be prevented and the Windows installer
ends the process itself, so the updater must lock editing and flush
successfully **before** `install()` and `relaunch()`.

**Known limit:** a system-initiated quit on macOS (Dock menu, logout,
shutdown) bypasses the quit handshake; edits rely on the editor's short
autosave debounce.
