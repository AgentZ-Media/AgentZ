import { afterEach, describe, expect, it } from "vitest";
import { FOCUSABLE, trapTab } from "../focusTrap";

function setup() {
  document.body.innerHTML = '<button id="out"></button><div id="box"><button id="a"></button><input id="b" /><button id="c" disabled></button></div>';
  const box = document.getElementById("box")!;
  const list = Array.from(box.querySelectorAll<HTMLElement>(FOCUSABLE));
  return { box, list, el: (id: string) => document.getElementById(id)! };
}

function tab(shiftKey = false) {
  return new KeyboardEvent("keydown", { key: "Tab", shiftKey, cancelable: true });
}

afterEach(() => { document.body.innerHTML = ""; });

describe("trapTab", () => {
  it("skips disabled elements and wraps at both ends", () => {
    const { box, list, el } = setup();
    expect(list.map((e) => e.id)).toEqual(["a", "b"]);
    el("b").focus();
    const forward = tab();
    trapTab(forward, box, list);
    expect(forward.defaultPrevented).toBe(true);
    expect(document.activeElement?.id).toBe("a");
    const back = tab(true);
    trapTab(back, box, list);
    expect(document.activeElement?.id).toBe("b");
  });

  it("leaves Tab between inner elements to the browser", () => {
    const { box, list, el } = setup();
    el("a").focus();
    const e = tab();
    trapTab(e, box, list);
    expect(e.defaultPrevented).toBe(false);
  });

  it("pulls escaped focus back in and blocks Tab without targets", () => {
    const { box, list, el } = setup();
    el("out").focus();
    trapTab(tab(), box, list);
    expect(document.activeElement?.id).toBe("a");
    const empty = tab();
    trapTab(empty, box, []);
    expect(empty.defaultPrevented).toBe(true);
  });
});
