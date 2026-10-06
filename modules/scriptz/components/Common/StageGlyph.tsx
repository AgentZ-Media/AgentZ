import { STAGE_GLYPHS, STAGE_VIEWBOX, stageGlyph } from "@agentz/design/icons";
import { isFinalStage, resolveStageId, scriptStages, stageIndex } from "../../lib/stages";

/** "idea" (dashed ring before any script exists) or a script stage id. */
export type StageName = string;

export interface StageGlyphProps {
  stage: StageName;
  /** Rendered width and height in px. Default 14. */
  size?: number;
  class?: string;
}

/**
 * Ring that fills with the stage's position in the configured pipeline
 * (three stages: thirds, ten stages: tenths). The last stage is the filled
 * "done" glyph with `--accent`; "idea" is the dashed ring. Colour follows
 * `currentColor`. Decorative - pair it with a visible stage label.
 */
export function StageGlyph(props: StageGlyphProps) {
  const size = () => props.size ?? 14;
  const id = () => (props.stage === "idea" ? "idea" : resolveStageId(props.stage));
  const markup = () => {
    const stage = id();
    if (stage === "idea") return STAGE_GLYPHS.idea;
    return stageGlyph(stageIndex(stage) + 1, scriptStages().length);
  };
  return (
    <svg
      class={props.class ? `st ${props.class}` : "st"}
      viewBox={STAGE_VIEWBOX}
      width={size()}
      height={size()}
      aria-hidden="true"
      data-stage={id()}
      data-done={id() !== "idea" && isFinalStage(id()) ? "" : undefined}
      style={{ width: `${size()}px`, height: `${size()}px` }}
      innerHTML={markup()}
    />
  );
}
