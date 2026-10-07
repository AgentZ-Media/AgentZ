// Hiding the agent (onboarding or Settings > Agent): a device-local switch
// that pauses the agent without forgetting whether it was on.

import { afterEach, describe, expect, it } from "vitest";
import { agentSettings, startAgentSettingsRuntime } from "../agentSettings";

function memoryKv(initial: Record<string, string> = {}) {
  const settings = new Map(Object.entries(initial));
  return {
    settings,
    getAppState: async () => null,
    setAppState: async () => {},
    getSetting: async (key: string) => settings.get(key) ?? null,
    setSetting: async (key: string, value: string) => { settings.set(key, value); },
  };
}

let stop: (() => void) | undefined;
afterEach(() => {
  stop?.();
  stop = undefined;
});

async function start(initial: Record<string, string> = {}) {
  const kv = memoryKv(initial);
  stop = startAgentSettingsRuntime(kv);
  await agentSettings.load();
  return kv;
}

describe("agentSettings.hidden", () => {
  it("defaults to shown, so existing installs keep the agent", async () => {
    await start({ "agent.enabled": "1" });
    expect(agentSettings.hidden()).toBe(false);
    expect(agentSettings.enabled()).toBe(true);
  });

  it("switches the agent off while hidden and restores it when shown again", async () => {
    const kv = await start({ "agent.enabled": "1", "agent.onboarded": "1" });
    await agentSettings.setHidden(true);
    expect(agentSettings.enabled()).toBe(false);
    expect(kv.settings.get("agent.hidden")).toBe("1");
    expect(kv.settings.get("agent.enabled")).toBe("1");
    await agentSettings.setHidden(false);
    expect(agentSettings.enabled()).toBe(true);
    expect(kv.settings.get("agent.hidden")).toBe("0");
  });

  it("reads a stored hidden flag", async () => {
    await start({ "agent.enabled": "1", "agent.hidden": "1" });
    expect(agentSettings.hidden()).toBe(true);
    expect(agentSettings.enabled()).toBe(false);
  });
});
