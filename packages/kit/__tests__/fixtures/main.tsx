import { render } from "solid-js/web";
import { SuiteShell } from "@agentz/kit/shell";
import { setUpdatesStore, type UpdatesStore } from "@agentz/kit/platform";
import "@agentz/design/fonts.css";
import "@agentz/design/tokens.css";
import "@agentz/design/components.css";
import "@agentz/kit/styles.css";
import "./fixture.css";
import { createFixtureKv, createFixtureModule, fixturePlatform } from "./module";

// `?nightly` previews a nightly build: night sky, badges and the update
// channel settings with an available nightly update.
const nightly = new URLSearchParams(location.search).has("nightly");
const platform = nightly
  ? { ...fixturePlatform, build: { channel: "nightly" as const, commit: "479ff19c0ffee479ff19c0ffee479ff19c0ffee4", builtAt: "2026-10-05T15:00:00Z" } }
  : fixturePlatform;
if (nightly) {
  const updates: UpdatesStore = {
    stage: () => "available", available: () => ({ version: "0.1.1-nightly.202610051800" }), progress: () => 0,
    manualCheck: () => null, checkNow: async () => {}, downloadAndInstall: async () => {}, restart: async () => {},
    clearManualCheck: () => {}, startBackgroundPolling: () => {}, stopBackgroundPolling: () => {},
  };
  setUpdatesStore(updates);
}

const { kv } = createFixtureKv();
const root = document.getElementById("root");
if (!root) throw new Error("Missing fixture root");
render(() => <SuiteShell module={createFixtureModule()} platform={platform} kv={kv} />, root);
