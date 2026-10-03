import { afterEach, describe, expect, it, vi } from "vitest";
import { baseSettingsStore as settings, startBaseSettingsRuntime } from "../baseSettings";
import { createSettingsWriter } from "../settingsWriter";
import { flushAll } from "../../lib";
import type { KvStore } from "../../platform";
import { language } from "../../i18n";

const stops: Array<() => void> = [];
const store = (values: Record<string, string> = {}): KvStore => ({
  getSetting: vi.fn(async (key: string) => values[key] ?? null),
  setSetting: vi.fn(async (key: string, value: string) => { values[key] = value; }),
  getAppState: vi.fn(async () => null), setAppState: vi.fn(async () => {}),
});
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
};
afterEach(() => { stops.splice(0).reverse().forEach((stop) => stop()); vi.restoreAllMocks(); });

describe("base settings lifetime", () => {
  it("loads only the four unchanged shared keys and applies theme/language", async () => {
    const kv = store({ theme: "dark", language: "en", update_check_enabled: "0", hourly_update_check: "1" });
    stops.push(startBaseSettingsRuntime(kv));
    await settings.load();
    expect(vi.mocked(kv.getSetting).mock.calls.map(([key]) => key).sort()).toEqual(["hourly_update_check", "language", "theme", "update_check_enabled"]);
    expect([settings.theme(), settings.language(), settings.updateCheckEnabled(), settings.hourlyUpdateCheck()]).toEqual(["dark", "en", false, true]);
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(language()).toBe("en");
    expect(settings.loaded()).toBe(true);
  });

  it("ignores a disposed boot and resets absent preferences in the next runtime", async () => {
    const pending = deferred<string | null>();
    const old = store(); old.getSetting = () => pending.promise;
    const stop = startBaseSettingsRuntime(old);
    const load = settings.load();
    stop();
    const next = store(); stops.push(startBaseSettingsRuntime(next));
    await settings.load();
    pending.resolve("dark"); await load;
    expect(settings.theme()).toBe("light");
    expect(settings.language()).toBe("auto");
    expect(settings.updateCheckEnabled()).toBe(true);
  });

  it("serializes rapid choices and keeps the final stored value", async () => {
    const gate = deferred<void>();
    const writes: string[] = [];
    const kv = store(); kv.setSetting = vi.fn(async (_key, value) => { writes.push(value); if (writes.length === 1) await gate.promise; });
    stops.push(startBaseSettingsRuntime(kv));
    const first = settings.setTheme("dark");
    const last = settings.setTheme("light");
    await Promise.resolve(); await Promise.resolve();
    expect(writes).toEqual(["dark"]);
    gate.resolve(); await Promise.all([first, last]);
    expect(writes).toEqual(["dark", "light"]);
  });

  it("reports failed writes and retries the original adapter after disposal", async () => {
    let failing = true;
    const old = store(); old.setSetting = vi.fn(async () => { if (failing) throw new Error("offline"); });
    const stop = startBaseSettingsRuntime(old);
    await expect(settings.setTheme("dark")).rejects.toThrow("offline");
    expect((await flushAll()).failed).toContain("base-settings");
    stop();
    const next = store(); stops.push(startBaseSettingsRuntime(next));
    await settings.setLanguage("de");
    failing = false;
    expect(await flushAll()).toEqual({ ok: true, failed: [] });
    expect(old.setSetting).toHaveBeenLastCalledWith("theme", "dark");
    expect(next.setSetting).toHaveBeenCalledOnce();
    expect(next.setSetting).toHaveBeenCalledWith("language", "de");
  });

  it("never retries an old failed value over a newer successful runtime value", async () => {
    const values: Record<string, string> = {};
    const kv = store(values);
    const persist = kv.setSetting;
    let failing = true;
    kv.setSetting = vi.fn(async (key, value) => {
      if (failing) throw new Error("offline");
      await persist(key, value);
    });
    const old = createSettingsWriter(kv, "old-runtime");
    await expect(old.write("theme", "dark")).rejects.toThrow("offline");
    old.dispose();
    failing = false;
    const current = createSettingsWriter(kv, "new-runtime");
    stops.push(() => current.dispose());
    await current.write("theme", "light");
    expect(await flushAll()).toEqual({ ok: true, failed: [] });
    expect(values.theme).toBe("light");
    expect(kv.setSetting).toHaveBeenCalledTimes(2);
  });

  it("retains an in-flight writer during teardown and releases it after success", async () => {
    const gate = deferred<void>();
    const kv = store(); kv.setSetting = vi.fn(() => gate.promise);
    const writer = createSettingsWriter(kv, "pending-preference");
    const pending = writer.write("option", "1");
    writer.dispose();
    expect((await flushAll(1)).failed).toContain("pending-preference");
    gate.resolve(); await pending;
    expect(await flushAll()).toEqual({ ok: true, failed: [] });
  });
});
