// Keyboard helpers - plattform-aware modifier-key handling + Hotkey-
// Display-Strings.
//
// On macOS the canonical "command" modifier is Cmd (event.metaKey);
// on Windows and Linux it's Ctrl (event.ctrlKey). Code that needs to
// react to "the user pressed the platform modifier + a letter" should
// go through isModKey() instead of checking metaKey or ctrlKey directly.
//
// Display strings ("⌘B", "Ctrl+B") run through formatHotkey() / K(),
// which take a logical spec like "Mod+B", "Mod+Shift+T", "Mod+Alt+ArrowLeft"
// and render the platform-correct symbols.
//
// Defensive fallback: if no PlatformAdapter has been registered yet
// (very early imports, tests without setup, browser pre-mount), we
// default to "macos" so dev/test environments behave like the
// historical desktop default. The real value gets picked up the
// moment the host's platform.ts runs.

import { getPlatformAdapter, type Platform } from "./platform";

export function getPlatform(): Platform {
  try {
    return getPlatformAdapter().platform;
  } catch {
    return "macos";
  }
}

export function isMac(): boolean {
  return getPlatform() === "macos";
}

/** True if the keyboard event carries the platform's "command" modifier
 * (Cmd on macOS, Ctrl on Windows/Linux). */
export function isModKey(
  e: Pick<KeyboardEvent, "metaKey" | "ctrlKey">,
): boolean {
  return isMac() ? e.metaKey : e.ctrlKey;
}

interface Labels {
  mod: string;
  shift: string;
  alt: string;
  ctrl: string;
  sep: string;
  arrowLeft: string;
  arrowRight: string;
  arrowUp: string;
  arrowDown: string;
  enter: string;
}

const LABELS: Record<Platform, Labels> = {
  macos: {
    mod: "⌘",
    shift: "⇧",
    alt: "⌥",
    ctrl: "⌃",
    sep: "",
    arrowLeft: "←",
    arrowRight: "→",
    arrowUp: "↑",
    arrowDown: "↓",
    enter: "⏎",
  },
  windows: {
    mod: "Ctrl",
    shift: "Shift",
    alt: "Alt",
    ctrl: "Ctrl",
    sep: "+",
    arrowLeft: "←",
    arrowRight: "→",
    arrowUp: "↑",
    arrowDown: "↓",
    enter: "Enter",
  },
  linux: {
    mod: "Ctrl",
    shift: "Shift",
    alt: "Alt",
    ctrl: "Ctrl",
    sep: "+",
    arrowLeft: "←",
    arrowRight: "→",
    arrowUp: "↑",
    arrowDown: "↓",
    enter: "Enter",
  },
};

/** Format a logical hotkey spec for display.
 *
 * Tokens are separated by `+`. Recognised tokens: `Mod` (Cmd/Ctrl),
 * `Shift`, `Alt`, `Ctrl` (the literal control key, rarely needed),
 * `ArrowLeft` / `ArrowRight` / `ArrowUp` / `ArrowDown`, `Enter`. Any
 * other token is passed through verbatim - so `"Mod+B"`, `"Mod+1"`,
 * `"Mod+,"` all work.
 *
 * On macOS the parts are concatenated without a separator (`⌘B`);
 * on Windows/Linux they are joined with `+` (`Ctrl+B`).
 *
 * @example
 *   formatHotkey("Mod+B")              -> "⌘B"        / "Ctrl+B"
 *   formatHotkey("Mod+Shift+S")        -> "⌘⇧S"       / "Ctrl+Shift+S"
 *   formatHotkey("Mod+Alt+ArrowLeft")  -> "⌘⌥←"       / "Ctrl+Alt+←"
 */
export function formatHotkey(spec: string): string {
  const lbl = LABELS[getPlatform()];
  return spec
    .split("+")
    .map((raw) => {
      const t = raw.trim();
      switch (t) {
        case "Mod":
          return lbl.mod;
        case "Shift":
          return lbl.shift;
        case "Alt":
          return lbl.alt;
        case "Ctrl":
          return lbl.ctrl;
        case "ArrowLeft":
          return lbl.arrowLeft;
        case "ArrowRight":
          return lbl.arrowRight;
        case "ArrowUp":
          return lbl.arrowUp;
        case "ArrowDown":
          return lbl.arrowDown;
        case "Enter":
          return lbl.enter;
        default:
          return t;
      }
    })
    .join(lbl.sep);
}

/** Convenience alias - shorter to read inline in JSX. */
export const K = formatHotkey;
