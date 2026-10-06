import { createEffect, createRoot } from "solid-js";
import { describe, expect, it } from "vitest";
import { createEventBus, createVersionBus } from "../versionBus";

describe("createVersionBus", () => {
  it("starts at 0 and counts every bump", () => {
    const bus = createVersionBus();
    expect(bus.version()).toBe(0);
    bus.bump();
    bus.bump();
    expect(bus.version()).toBe(2);
  });

  it("keeps separate buses independent", () => {
    const a = createVersionBus();
    const b = createVersionBus();
    a.bump();
    expect(a.version()).toBe(1);
    expect(b.version()).toBe(0);
  });

  it("does not subscribe an effect that bumps to the bus itself", () => {
    const bus = createVersionBus();
    let runs = 0;
    const dispose = createRoot((dispose) => {
      createEffect(() => {
        runs++;
        bus.bump();
      });
      return dispose;
    });
    bus.bump();
    expect(runs).toBe(1);
    expect(bus.version()).toBe(2);
    dispose();
  });
});

describe("createEventBus", () => {
  it("delivers every value in order and bumps the version", () => {
    const bus = createEventBus<number>();
    const seen: number[] = [];
    const off = bus.listen((v) => seen.push(v));
    bus.emit(1);
    bus.emit(2);
    expect(seen).toEqual([1, 2]);
    expect(bus.version()).toBe(2);
    off();
    bus.emit(3);
    expect(seen).toEqual([1, 2]);
  });
});
