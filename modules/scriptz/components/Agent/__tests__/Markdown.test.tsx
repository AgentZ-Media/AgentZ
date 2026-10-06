import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { Markdown } from "../Markdown";

afterEach(cleanup);

describe("Markdown", () => {
  it("follows a streamed reply in plain and formatted text", () => {
    const [text, setText] = createSignal("Hal");
    const view = render(() => <Markdown text={text()} />);
    expect(view.container.textContent).toBe("Hal");
    setText("Hallo **Welt**");
    expect(view.container.textContent).toBe("Hallo Welt");
    setText("Hallo **Welt**, wie geht's?");
    expect(view.container.textContent).toBe("Hallo Welt, wie geht's?");
    expect(view.container.querySelector("strong")?.textContent).toBe("Welt");
  });
});
