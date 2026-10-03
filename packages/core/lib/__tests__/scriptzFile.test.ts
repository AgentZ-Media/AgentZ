// Roundtrip + validation tests for the `.scriptz` file format.
//
// Catches if someone breaks the format schema (e.g. forgets to
// serialize a script field, or the validation reject becomes
// too lax).

import { beforeAll, describe, it, expect } from "vitest";
import { applyResolvedLanguage } from "../../i18n";

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
  SCRIPTZ_BUNDLE_FORMAT,
  SCRIPTZ_BUNDLE_VERSION_CURRENT,
  SCRIPTZ_EXTENSION,
  SCRIPTZ_MIME,
  SCRIPTZ_VERSION_CURRENT,
  ScriptzParseError,
  serializeBundle,
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
  it("setzt format + version + ISO-Datumsfelder", () => {
    const out = serializeScript(baseScript);
    expect(out.format).toBe("scriptz");
    expect(out.version).toBe(SCRIPTZ_VERSION_CURRENT);
    expect(out.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(out.script.createdAt).toBe("2026-05-11T12:00:00.000Z");
    expect(out.script.updatedAt).toBe("2026-05-11T14:30:00.000Z");
  });

  it("parst content_json zu Objekt, nicht doppeltes JSON-String", () => {
    const out = serializeScript(baseScript);
    expect(out.script.contentJson).toBeTypeOf("object");
    // root property must be passed through
    expect((out.script.contentJson as { root: unknown }).root).toBeDefined();
  });

  it("ueberlebt malformes content_json mit klarer Fehlermeldung", () => {
    expect(() =>
      serializeScript({ ...baseScript, content_json: "{not-json" }),
    ).toThrow(/content_json ist kein gueltiges JSON|content_json ist kein gültiges JSON/);
  });

  it("erhaelt characters inkl. optional share", () => {
    const out = serializeScript(baseScript);
    expect(out.script.characters).toEqual([
      { name: "MAX", color: "#7aa2f7", share: 1.0 },
    ]);
  });

  it("laesst share weg, wenn nicht gesetzt", () => {
    const out = serializeScript({
      ...baseScript,
      characters: [{ name: "MAX", color: "#7aa2f7" }],
    });
    expect(out.script.characters).toEqual([{ name: "MAX", color: "#7aa2f7" }]);
  });
});

describe("scriptzFile - roundtrip", () => {
  it("serialize -> parseBytes ergibt aequivalentes Objekt", () => {
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
});

describe("scriptzFile - parseScriptzBytes Validierung", () => {
  function asBytes(o: unknown): Uint8Array {
    return new TextEncoder().encode(JSON.stringify(o));
  }

  it("wirft bei kaputtem JSON", () => {
    const bytes = new TextEncoder().encode("{not-json");
    expect(() => parseScriptzBytes(bytes)).toThrow(ScriptzParseError);
  });

  it("wirft wenn format-Marker fehlt/falsch", () => {
    expect(() => parseScriptzBytes(asBytes({ version: 1, script: {} }))).toThrow(
      /Format-Marker/,
    );
    expect(() =>
      parseScriptzBytes(asBytes({ format: "fountain", version: 1, script: {} })),
    ).toThrow(/Format-Marker/);
  });

  it("wirft bei unbekannter Version", () => {
    expect(() =>
      parseScriptzBytes(
        asBytes({ format: "scriptz", version: 2, script: {} }),
      ),
    ).toThrow(/Version/);
  });

  it("wirft wenn script fehlt", () => {
    expect(() =>
      parseScriptzBytes(asBytes({ format: "scriptz", version: 1 })),
    ).toThrow(/script/);
  });

  it("wirft bei ungueltigen Charakter-Eintraegen", () => {
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

  it("toleriert fehlende Datumsfelder", () => {
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

describe("scriptzFile - serializeBundle", () => {
  it("baut ein Multi-Item-Buendel mit localId pro Eintrag", () => {
    const bundle = serializeBundle(
      [{ ...baseScript, localId: "s-1" }],
      [{ localId: "i-1", title: "Idee A", notes: "Notiz", created_at: Date.UTC(2026, 4, 11) }],
    );
    expect(bundle.format).toBe(SCRIPTZ_BUNDLE_FORMAT);
    expect(bundle.version).toBe(SCRIPTZ_BUNDLE_VERSION_CURRENT);
    expect(bundle.scripts).toHaveLength(1);
    expect(bundle.scripts[0].localId).toBe("s-1");
    // content_json is parsed into an object, not a double-stringified string.
    expect(bundle.scripts[0].contentJson).toBeTypeOf("object");
    expect(bundle.scripts[0].characters).toEqual([{ name: "MAX", color: "#7aa2f7", share: 1.0 }]);
    expect(bundle.ideas).toHaveLength(1);
    expect(bundle.ideas[0]).toMatchObject({ localId: "i-1", title: "Idee A", notes: "Notiz" });
    expect(bundle.ideas[0].createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("vertraegt leere Listen", () => {
    const bundle = serializeBundle([], []);
    expect(bundle.scripts).toEqual([]);
    expect(bundle.ideas).toEqual([]);
  });

  it("ueberlebt JSON.stringify -> JSON.parse unveraendert (HTTP-Body)", () => {
    const bundle = serializeBundle([{ ...baseScript, localId: "s-1" }], []);
    const roundtrip = JSON.parse(JSON.stringify(bundle));
    expect(roundtrip.scripts[0].contentJson).toEqual(JSON.parse(baseScript.content_json));
  });
});

describe("scriptzFile - defaultScriptzFilename", () => {
  it("ersetzt FS-unfreundliche Zeichen", () => {
    // Consecutive forbidden characters collapse to a single underscore
    // (regex + flag), that is intentional - otherwise we'd get
    // filenames like "Foo_____bar.scriptz".
    expect(defaultScriptzFilename('Hallo / Welt: "Test"?')).toBe(
      `Hallo _ Welt_ _Test_.${SCRIPTZ_EXTENSION}`,
    );
  });

  it("Default fuer leeren/whitespace-only Titel", () => {
    expect(defaultScriptzFilename("")).toBe(`Unbenannt.${SCRIPTZ_EXTENSION}`);
    expect(defaultScriptzFilename("   ")).toBe(`Unbenannt.${SCRIPTZ_EXTENSION}`);
  });

  it("exportiert sinnvolle Konstanten", () => {
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

  it("converts retired block types on import", () => {
    const file = serializeScript(baseScript) as unknown as {
      script: Record<string, unknown>;
    };
    file.script.contentJson = JSON.parse(legacyContent);
    const parsed = parseScriptzBytes(new TextEncoder().encode(JSON.stringify(file)));
    const children = (parsed.script.contentJson as {
      root: { children: Array<{ type: string; children: Array<{ text: string }> }> };
    }).root.children;
    expect(children.map((c) => c.type)).toEqual(["scriptz-action", "scriptz-action"]);
    expect(children[0].children[0].text).toBe("(leise)");
  });

  it("never exports retired block types", () => {
    const out = serializeScript({ ...baseScript, content_json: legacyContent });
    expect(JSON.stringify(out)).not.toMatch(/scriptz-(parenthetical|camera|caption|sfx)/);
  });
});
