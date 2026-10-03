import { STAGE_GLYPHS, STAGE_VIEWBOX, type StageGlyphName } from "@agentz/design/icons";

/**
 * Pipeline stage as drawn by the glyph. Structurally identical to
 * `Stage` in lib/types.ts, kept local so this component has no data-model
 * dependency.
 */
export type StageName = StageGlyphName;

export interface StageGlyphProps {
  stage: StageName;
  /** Rendered width and height in px. Default 14. */
  size?: number;
  class?: string;
}

/**
 * Ring that fills in quarters (idea -> online). Colour follows
 * `currentColor`; "online" is filled with `--accent`. Decorative - pair it
 * with a visible stage label.
 */
export function StageGlyph(props: StageGlyphProps) {
  const size = () => props.size ?? 14;
  return (
    <svg
      class={props.class ? `st ${props.class}` : "st"}
      viewBox={STAGE_VIEWBOX}
      width={size()}
      height={size()}
      aria-hidden="true"
      data-stage={props.stage}
      style={{ width: `${size()}px`, height: `${size()}px` }}
      innerHTML={STAGE_GLYPHS[props.stage]}
    />
  );
}

export default StageGlyph;
