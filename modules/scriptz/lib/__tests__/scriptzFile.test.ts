// Roundtrip + validation tests for the `.scriptz` file format.
//
// Catches if someone breaks the format schema (e.g. forgets to
// serialize a script field, or the validation reject becomes
// too lax).

import { beforeAll, describe, it, expect } from "vitest";
import { applyResolvedLanguage } from "@agentz/kit/i18n";

// Tests are pinned against the German wordings (they were there before
// i18n moved in). In the vitest environment navigator.language runs as
// "en-US" depending on the host - we pin the language explicitly so the
// assertions stay deterministic.
beforeAll(() => {
  applyResolvedLanguage("de");
});
import {
  defaultScriptzFilename,
  parseScriptzBytes,
  SCRIPTZ_EXTENSION,
  SCRIPTZ_MIME,
  SCRIPTZ_VERSION_CURRENT,
  ScriptzParseError,
  serializeScript,
  serializeScriptToBytes,
} from "../scriptzFile";

const sampleContent = JSON.stringify({
  root: {
    type: "root",
    version: 1,
    direction: null,
    format: "",
    indent: 0,
    children: [
      {
        type: "scriptz-character",
        version: 1,
        characterName: "MAX",
        direction: null,
        format: "",
        indent: 0,
        children: [
          { detail: 0, format: 0, mode: "normal", style: "", text: "MAX", type: "text", version: 1 },
        ],
      },
      {
        type: "scriptz-dialog",
        version: 1,
        direction: null,
        format: "",
        indent: 0,
        children: [
          { detail: 0, format: 0, mode: "normal", style: "", text: "Hallo Welt", type: "text", version: 1 },
        ],
      },
    ],
  },
});

const baseScript = {
  title: "Mein Drehbuch",
  content_json: sampleContent,
  characters: [
    { name: "MAX", color: "#7aa2f7", share: 1.0 },
  ],
  highlighting_enabled: 1,
  created_at: Date.UTC(2026, 4, 11, 12, 0, 0),
  updated_at: Date.UTC(2026, 4, 11, 14, 30, 0),
};

describe("scriptzFile - serializeScript", () => {
  it("sets format, version and ISO date fields", () => {
    const out = serializeScript(baseScript);
    expect(out.format).toBe("scriptz");
    expect(out.version).toBe(SCRIPTZ_VERSION_CURRENT);
    expect(out.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(out.script.createdAt).toBe("2026-05-11T12:00:00.000Z");
    expect(out.script.updatedAt).toBe("2026-05-11T14:30:00.000Z");
  });

  it("parses content_json into an object, not a double-encoded JSON string", () => {
    const out = serializeScript(baseScript);
    expect(out.script.contentJson).toBeTypeOf("object");
    // root property must be passed through
    expect((out.script.contentJson as { root: unknown }).root).toBeDefined();
  });

  it("survives malformed content_json with a clear error message", () => {
    expect(() =>
      serializeScript({ ...baseScript, content_json: "{not-json" }),
    ).toThrow(/content_json ist kein gueltiges JSON|content_json ist kein gültiges JSON/);
  });

  it("keeps characters including the optional share", () => {
    const out = serializeScript(baseScript);
    expect(out.script.characters).toEqual([
      { name: "MAX", color: "#7aa2f7", share: 1.0 },
    ]);
  });

  it("omits share when it is not set", () => {
    const out = serializeScript({
      ...baseScript,
      characters: [{ name: "MAX", color: "#7aa2f7" }],
    });
    expect(out.script.characters).toEqual([{ name: "MAX", color: "#7aa2f7" }]);
  });
});

describe("scriptzFile - roundtrip", () => {
  it("serialize -> parseBytes yields an equivalent object", () => {
    const bytes = serializeScriptToBytes(baseScript);
    const parsed = parseScriptzBytes(bytes);
    expect(parsed.format).toBe("scriptz");
    expect(parsed.version).toBe(1);
    expect(parsed.script.title).toBe(baseScript.title);
    expect(parsed.script.highlightingEnabled).toBe(1);
    expect(parsed.script.characters).toEqual([
      { name: "MAX", color: "#7aa2f7", share: 1.0 },
    ]);
    // contentJson comes back as an object - roundtrip via JSON.stringify
    // must be bit-identical to the original because JSON.parse produces
    // a canonical tree.
    expect(JSON.stringify(parsed.script.contentJson)).toBe(
      JSON.stringify(JSON.parse(baseScript.content_json)),
    );
  });

  it("keeps parenthetical blocks unchanged through export and import", () => {
    const withParen = JSON.parse(sampleContent) as {
      root: { children: Array<Record<string, unknown>> };
    };
    withParen.root.children.splice(1, 0, {
      type: "scriptz-parenthetical",
      version: 1,
      blockType: "scriptz-parenthetical",
      direction: null,
      format: "",
      indent: 0,
      children: [
        { detail: 0, format: 0, mode: "normal", style: "", text: "(leise)", type: "text", version: 1 },
      ],
    });
    const content = JSON.stringify(withParen);
    const parsed = parseScriptzBytes(
      serializeScriptToBytes({ ...baseScript, content_json: content }),
    );
    expect(JSON.stringify(parsed.script.contentJson)).toBe(content);
  });
});

describe("scriptzFile - parseScriptzBytes validation", () => {
  function asBytes(o: unknown): Uint8Array {
    return new TextEncoder().encode(JSON.stringify(o));
  }

  it("throws on broken JSON", () => {
    const bytes = new TextEncoder().encode("{not-json");
    expect(() => parseScriptzBytes(bytes)).toThrow(ScriptzParseError);
  });

  it("throws when the format marker is missing or wrong", () => {
    expect(() => parseScriptzBytes(asBytes({ version: 1, script: {} }))).toThrow(
      /Format-Marker/,
    );
    expect(() =>
      parseScriptzBytes(asBytes({ format: "fountain", version: 1, script: {} })),
    ).toThrow(/Format-Marker/);
  });

  it("throws on an unknown version", () => {
    expect(() =>
      parseScriptzBytes(
        asBytes({ format: "scriptz", version: 2, script: {} }),
      ),
    ).toThrow(/Version/);
  });

  it("throws when script is missing", () => {
    expect(() =>
      parseScriptzBytes(asBytes({ format: "scriptz", version: 1 })),
    ).toThrow(/script/);
  });

  it("throws on invalid character entries", () => {
    expect(() =>
      parseScriptzBytes(
        asBytes({
          format: "scriptz",
          version: 1,
          script: {
            title: "X",
            contentJson: {},
            characters: [{ name: 42, color: "#000" }],
          },
        }),
      ),
    ).toThrow(/characters/);
  });

  it("tolerates missing date fields", () => {
    const parsed = parseScriptzBytes(
      asBytes({
        format: "scriptz",
        version: 1,
        script: {
          title: "X",
          contentJson: { root: {} },
          characters: [],
        },
      }),
    );
    expect(parsed.script.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(parsed.script.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe("scriptzFile - defaultScriptzFilename", () => {
  it("replaces file-system-unfriendly characters", () => {
    // Consecutive forbidden characters collapse to a single underscore
    // (regex + flag), that is intentional - otherwise we'd get
    // filenames like "Foo_____bar.scriptz".
    expect(defaultScriptzFilename('Hallo / Welt: "Test"?')).toBe(
      `Hallo _ Welt_ _Test_.${SCRIPTZ_EXTENSION}`,
    );
  });

  it("falls back to a default for empty or whitespace-only titles", () => {
    expect(defaultScriptzFilename("")).toBe(`Unbenannt.${SCRIPTZ_EXTENSION}`);
    expect(defaultScriptzFilename("   ")).toBe(`Unbenannt.${SCRIPTZ_EXTENSION}`);
  });

  it("exports sensible constants", () => {
    expect(SCRIPTZ_EXTENSION).toBe("scriptz");
    expect(SCRIPTZ_MIME).toBe("application/x-scriptz+json");
  });
});

describe("scriptzFile - status (additive field, version stays 1)", () => {
  function asBytes(o: unknown): Uint8Array {
    return new TextEncoder().encode(JSON.stringify(o));
  }

  it("writes and reads back the status", () => {
    for (const status of ["writing", "ready", "shot", "online"] as const) {
      const bytes = serializeScriptToBytes({ ...baseScript, status });
      const parsed = parseScriptzBytes(bytes);
      expect(parsed.version).toBe(1);
      expect(parsed.script.status).toBe(status);
    }
  });

  it("defaults to writing when the caller passes no status", () => {
    expect(serializeScript(baseScript).script.status).toBe("writing");
  });

  it("falls back to writing for old files without status", () => {
    const old = serializeScript(baseScript) as unknown as {
      script: Record<string, unknown>;
    };
    delete old.script.status;
    expect(parseScriptzBytes(asBytes(old)).script.status).toBe("writing");
  });

  it("falls back to writing for an unknown status value", () => {
    const file = serializeScript({ ...baseScript, status: "ready" }) as unknown as {
      script: Record<string, unknown>;
    };
    file.script.status = "archived-in-the-future";
    expect(parseScriptzBytes(asBytes(file)).script.status).toBe("writing");
  });
});

describe("scriptzFile - legacy block types", () => {
  const legacyContent = JSON.stringify({
    root: {
      type: "root",
      children: [
        { type: "scriptz-parenthetical", children: [{ type: "text", text: "leise" }] },
        { type: "scriptz-camera", children: [{ type: "text", text: "Close-Up" }] },
      ],
    },
  });

  it("converts retired block types on import, keeps parentheticals", () => {
    const file = serializeScript(baseScript) as unknown as {
      script: Record<string, unknown>;
    };
    file.script.contentJson = JSON.parse(legacyContent);
    const parsed = parseScriptzBytes(new TextEncoder().encode(JSON.stringify(file)));
    const children = (parsed.script.contentJson as {
      root: { children: Array<{ type: string; children: Array<{ text: string }> }> };
    }).root.children;
    expect(children.map((c) => c.type)).toEqual(["scriptz-parenthetical", "scriptz-action"]);
    expect(children[0].children[0].text).toBe("leise");
  });

  it("never exports retired block types", () => {
    const out = serializeScript({ ...baseScript, content_json: legacyContent });
    const json = JSON.stringify(out);
    expect(json).not.toMatch(/scriptz-(camera|caption|sfx)/);
    expect(json).toContain("scriptz-parenthetical");
  });
});
