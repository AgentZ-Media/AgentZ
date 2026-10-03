# `.sz` — ScriptZ Script File Format

**Status:** Draft v1 (proposal — nothing implemented yet)
**Last updated:** 2026-05-06

A plain-text, human- and AI-writable file format for ScriptZ scripts.
One file = one script. Designed so a language model can produce a valid
file from a single prompt and so a human can read or hand-edit one in
any text editor.

---

## 1. Goals & non-goals

**Goals**

- **Unambiguous.** Every block type is identified by an explicit tag.
  No "UPPERCASE means character" heuristics.
- **Round-trip safe** between ScriptZ instances (no data loss for
  inline formatting, character colours, or block attributes).
- **AI-friendly.** A model briefed with this single document can
  produce valid `.sz` files. No hidden state, no positional rules
  beyond "blocks are separated by blank lines or new tags".
- **Forgiving on import.** Unknown tags become Action blocks instead
  of erroring. Unknown frontmatter keys are preserved verbatim.
- **Readable.** A `.sz` file looks like a script even without a
  renderer.

**Non-goals**

- Not a Fountain superset. We borrow conventions (frontmatter,
  inline formatting) but the block taxonomy is ScriptZ's own.
- No support for industry-standard screenplay layout (Courier 12pt,
  scene numbers, dual-dialogue carets, etc.). Out of scope per
  `CLAUDE.md`.
- No embedded media, no inline JSON for arbitrary user attributes.

---

## 2. File anatomy

| Field | Value |
| --- | --- |
| Extension | `.sz` |
| MIME type | `application/x-scriptz` |
| Encoding | UTF-8, no BOM |
| Newlines | LF on export. CR/CRLF tolerated on import (normalised). |
| Magic header | First non-empty line MUST be `%SZ 1` (format + version). |

A file consists of, in order:

1. **Magic header** — `%SZ 1`
2. **Optional frontmatter** — YAML between `---` fences
3. **Body** — sequence of block tags
4. **Optional meta line** — `@meta lexical=<base64-zlib-json>` for
   lossless round-trip (see §9)

### Minimal valid file

```
%SZ 1
@action Sara öffnet die Tür.
```

### Typical file

```
%SZ 1
---
title: Mein Sketch
characters:
  - { name: SARA, color: "#e0791f" }
  - { name: TIMO, color: "#3b82f6" }
---

@action Sara öffnet die Tür.

@char SARA
@dialog Was machst du hier?

@char TIMO
@paren (verlegen)
@dialog Ich... wollte nur reden.
```

---

## 3. Frontmatter

Optional. If present, must immediately follow the magic header and be
delimited by lines containing exactly `---`.

| Key | Type | Notes |
| --- | --- | --- |
| `title` | string | Defaults to filename stem on import if absent. |
| `characters` | array of `{name, color}` | `name` uppercased on import; `color` is `#rrggbb`. Sticky — preserved across round-trips. |
| `created_at` | int (unix-ms) | Informational only. Importer assigns its own. |
| `updated_at` | int (unix-ms) | Informational only. Importer assigns its own. |
| `summary` | string | Optional one-liner. |
| `highlighting_enabled` | bool | Optional. |

Unknown keys are preserved verbatim in `frontmatter_extra` on import
and re-emitted on export. This keeps the format extensible without a
spec bump for every new field.

---

## 4. Block tags

Seven block types, one tag each. Every tag starts at column 0 with `@`
followed by the tag name (lowercase, ASCII).

| Tag | Block type | Lexical node |
| --- | --- | --- |
| `@action` | Action / description | `scriptz-action` |
| `@char` | Character cue (name only) | `scriptz-character` |
| `@dialog` | Spoken dialogue | `scriptz-dialog` |
| `@paren` | Parenthetical (`(leise)`) | `scriptz-parenthetical` |
| `@cam` | Camera direction | `scriptz-camera` |
| `@caption` | Caption / text overlay | `scriptz-caption` |
| `@sfx` | Sound effect | `scriptz-sfx` |

### Two equivalent forms

Every tag accepts either an inline argument **or** a multi-line body:

**Inline (preferred for short blocks):**

```
@action Sara öffnet die Tür und friert.
```

**Block (for longer or multi-line content):**

```
@action
Sara öffnet die Tür und friert.
Sie schaut über ihre Schulter zurück und atmet aus.
```

Both produce a single Action block. Internal line breaks become Lexical
`linebreak` nodes (Shift+Enter equivalent in the editor).

### Per-tag rules

#### `@char NAME`

The argument is the character name. Always uppercased on import,
matched case-insensitively against `characters` frontmatter and against
the script's existing `characters_meta` (sticky colour). The block has
no body.

```
@char SARA
```

#### `@paren`

The body is the parenthetical text. Surrounding `()` are optional;
the importer adds them if missing. The exporter writes them.

```
@paren (leise)
```
or
```
@paren leise
```
both produce the same block.

#### `@dialog`

Standard text body. May span multiple lines using the block form.

#### `@action`, `@cam`, `@caption`, `@sfx`

Standard text body. No special handling.

### Block boundaries

A block ends at the **next `@tag` line** OR a **blank line**, whichever
comes first. Blank lines between blocks are ignored. Two blank lines
or twenty are the same as one.

```
@action First.

@action Second.
```

is identical to:

```
@action First.
@action Second.
```

---

## 5. Inline formatting

Inside any block body, the following Markdown-style markers are
recognised and round-trip to Lexical's `format` bitfield:

| Markup | Meaning | Lexical bit |
| --- | --- | --- |
| `**text**` | Bold | 1 |
| `*text*` | Italic | 2 |
| `__text__` | Underline | 8 |
| `~~text~~` | Strikethrough | 4 |
| `` `text` `` | Code (inline) | 16 |

Combinations work via nesting: `**_bold underlined_**`. Markers do not
cross block boundaries. To produce a literal `*` or `_`, escape with a
backslash: `\*not italic\*`.

These markers are deliberately Fountain-compatible (apart from
strikethrough and code, which Fountain doesn't define) so that a
`.sz` file can be skim-read by anyone familiar with Markdown or
Fountain.

---

## 6. Comments

Lines beginning with `//` are stripped on import and never round-trip.
Useful for human notes that should not become part of the script.

```
// TODO: rewrite this scene before recording
@action Sara öffnet die Tür.
```

There is no block-comment syntax. Keep notes one line at a time.

---

## 7. Escapes

A line whose first non-whitespace character is `@` is interpreted as a
tag. To start a body line with a literal `@`, escape with a backslash:

```
@dialog
\@home auf Twitter ist mein Username.
```

Inside inline arguments (after the tag) no escaping is needed — the
parser does not look for further tags on the same line.

The magic header `%SZ` and frontmatter fences `---` are only special
at the very start of the file. Body lines starting with them need no
escape.

---

## 8. Parser rules (precedence)

The importer applies these in order to each line:

1. If the file's first non-empty line, expect `%SZ <version>` — error
   otherwise.
2. If inside frontmatter (between `---` fences), feed to YAML parser.
3. If line is `// …` — comment, skip.
4. If line is empty — close current block.
5. If line starts with `@<known-tag>` (after optional leading
   whitespace which is ignored) — close current block, open new block.
6. If line starts with `@<unknown-tag>` — emit warning, treat as
   Action block (forward compatibility).
7. Otherwise — append to current block as a body line. If no block is
   open, implicitly open an Action block.

This means **a `.sz` file with no tags at all is a valid single-Action
script.** The format degrades gracefully to plain text.

---

## 9. Lossless round-trip via `@meta lexical=…`

The text format above captures everything the editor renders, but
**not** every detail of the underlying Lexical state (e.g. node keys,
explicit format flags on empty text nodes, future custom attributes).

For perfect round-trip when going App → file → App, the exporter MAY
append a final line:

```
@meta lexical=eJxLLEnUTUlNzC0pVihRSCxJVChLLSpOzc7PSwQAH8oH0w==
```

The value is base64-encoded zlib-compressed Lexical state JSON. On
import, if `@meta lexical=` is present and `version` matches, the
importer **prefers** it over the parsed text body. The text body is
still parsed (and used for fallback) but the Lexical state wins for
identity-preserving fields.

This makes the format:

- **AI-writable** — no model ever needs to produce the meta line; just
  use the tags.
- **App-to-app lossless** — the meta line is automatically generated
  on export and consumed on import.
- **Editable in either world** — if a human edits the text body and
  the meta line falls out of sync, the importer detects this (text
  body's structural hash differs from meta's) and discards the meta
  line in favour of the text.

The `lexical=…` payload is opaque to the spec — its internal schema is
whatever Lexical's `editor.toJSON()` produces at the time of export.

---

## 10. Round-trip guarantees

| Scenario | Guarantee |
| --- | --- |
| App → `.sz` → App, meta line intact | **Identical** Lexical state. |
| App → `.sz` → App, meta line stripped or stale | All blocks, block types, character names, character colours, and inline formatting preserved. Lexical node keys regenerated. |
| AI → `.sz` → App | Whatever the AI wrote, faithfully. Character colours assigned from `DEFAULT_PALETTE` for any names not in frontmatter. |
| App → `.sz` → human edit → App | As above; meta line discarded if structural mismatch detected. |

---

## 11. Why not just use Fountain?

Considered and rejected for these reasons:

- **Block taxonomy mismatch.** Fountain has Scene Heading, Action,
  Character, Dialogue, Parenthetical, Transition, Lyrics. ScriptZ has
  Action, Character, Dialog, Parenthetical, Camera, Caption, SFX.
  Camera/Caption/SFX have no Fountain equivalent and would round-trip
  as Action — lossy.
- **Implicit detection breaks AI generation.** Fountain decides
  "Character" by checking if a line is all-caps with blank lines
  around it. A model that accidentally produces an all-caps line
  inside dialogue silently corrupts the document. Explicit `@char`
  tags eliminate this class of failure.
- **No standard for ScriptZ-specific features.** Per-character
  colours, the Caption block, the SFX block — Fountain has nothing
  to say about any of these.

We do borrow:

- YAML-style frontmatter (Fountain has its own `Title:` block; we use
  `---`-fenced YAML for richer typing).
- Markdown emphasis markers (`*italic*`, `**bold**`, `_underline_`).
- The "when in doubt, make it Action" fallback rule.

Compatibility direction: a future `fountain-import` and
`fountain-export` could be added alongside `.sz`, mapping the
overlapping subset. Not in v1.

---

## 12. Worked example

```
%SZ 1
---
title: Tür-Sketch
characters:
  - { name: SARA, color: "#e0791f" }
  - { name: TIMO, color: "#3b82f6" }
summary: Sara erwischt Timo nachts im Hausflur.
---

// Cold open
@cam Totale auf den dunklen Hausflur. Mondlicht durchs Fenster.

@action
Eine Tür quietscht. SARA steht im Türrahmen, in einem Bademantel,
und hält ein Küchenmesser locker in der Hand.

@sfx Bodendielen knarzen.

@char SARA
@dialog Wer ist da?

@char TIMO
@paren flüsternd
@dialog Ich bin's nur. **Nicht** schießen.

@cam Schwenk auf Timo, der mit erhobenen Händen aus dem Schatten tritt.

@char SARA
@dialog Du hast einen Schlüssel. Warum schleichst du?

@caption Ein peinliches Schweigen.

@meta lexical=<base64-payload-here>
```

---

## 13. Versioning & forward compatibility

- Magic header version (`%SZ 1`) bumps only on **breaking** parser
  changes. Adding tags or frontmatter keys is non-breaking.
- Importers MUST accept files with a higher minor structure (unknown
  tags → Action, unknown frontmatter keys → preserved).
- Importers SHOULD warn but not fail on `%SZ` versions higher than
  they support.
- A future `%SZ 2` would document its breaking change at the top of
  this file alongside a migration note.

---

## 14. Open questions (decide before implementation)

1. **Multi-line dialogue with internal blank lines.** Currently a blank
   line ends the block. If a human wants a beat (literal blank line)
   inside dialogue, they have no way to express it. Options:
   (a) accept that as a limitation, (b) introduce `@beat` as a
   semantic block, (c) allow `\n` escape inside body lines.
   **Recommendation:** (a) for v1; revisit if users complain.
2. **`.sz` for archived/trashed scripts.** Should `archived_at`
   appear in frontmatter, or do we always export as "live"?
   **Recommendation:** always export as live. Archive is a workspace
   concept, not a document concept.
3. **Snapshots.** Out of scope for v1 — `.sz` is single-revision. A
   future `.szbundle` (zip of `.sz` + snapshot history) could come
   later if there is demand.
4. **Strikethrough and inline code.** Not used by the editor today.
   Decide whether to declare them in v1 (forward-compatible) or wait
   until the editor supports them. **Recommendation:** declare now;
   round-trip is trivial and avoids a v2 bump later.

---

## 15. Implementation outline (for the future PR)

Backend (Rust):

- `src-tauri/src/sz/mod.rs` — parser + emitter, no Tauri deps,
  100% unit-testable.
- `src-tauri/src/commands/io.rs` — `export_scriptz(script_id, path)`
  and `import_scriptz(path) -> Script` `#[tauri::command]`s.
- Round-trip test fixture: sample `.sz` files in `src-tauri/tests/sz/`
  with golden Lexical-state JSON.

Frontend (TypeScript):

- "Export as .sz…" entry in `ExportDialog.tsx`.
- "Import .sz…" button on the home/browser view, wires
  `tauri-plugin-dialog` open → `import_scriptz` → opens new tab.
- Optional later: `bundle.macOS.fileAssociations` for double-click
  open. See `CLAUDE.md` "Releasing" section — needs a release rebuild.

Estimated effort, end-to-end with tests:

- Format parser + emitter + round-trip tests: ~1 day
- Tauri commands + UI wiring: ~½ day
- File-association (Finder double-click): ~½ day, requires release

Total: ~2 days for a polished v1 without file-association,
~2.5 days with it.
