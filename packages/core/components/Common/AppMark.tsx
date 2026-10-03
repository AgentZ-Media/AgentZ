import { For } from "solid-js";
import { LOGO_DOTS, LOGO_DOT_R, LOGO_VIEWBOX } from "@agentz/design/logo";

export interface AppMarkProps {
  /** Tile edge length in px. Default 28 (sidebar size). */
  size?: number;
  /**
   * - "accent": yellow highlighter tile (in-app: sidebar, onboarding).
   * - "light":  white tile, ink dots, graphite shadow rows (app icon light).
   * - "dark":   graphite tile, chalk dots, accent shadow rows (app icon dark).
   */
  variant?: "accent" | "light" | "dark";
  class?: string;
  /** Accessible label. Without it the mark is decorative. */
  title?: string;
}

/** The ScriptZ dot-matrix Z on a rounded tile (`.app-mark` in components.css). */
export function AppMark(props: AppMarkProps) {
  const size = () => props.size ?? 28;
  // Glyph is ~46 % of the tile wide, aspect 50:60 (concept: 28 -> 13x16).
  const glyphW = () => Math.round(size() * 0.46 * 10) / 10;
  const glyphH = () => Math.round(glyphW() * 1.2 * 10) / 10;
  const variantClass = () =>
    props.variant === "light" ? " is-light" : props.variant === "dark" ? " is-dark" : "";
  return (
    <span
      class={`app-mark${variantClass()}${props.class ? ` ${props.class}` : ""}`}
      style={{ width: `${size()}px`, height: `${size()}px` }}
      role={props.title ? "img" : undefined}
      aria-label={props.title}
      aria-hidden={props.title ? undefined : "true"}
    >
      <svg viewBox={LOGO_VIEWBOX} width={glyphW()} height={glyphH()}>
        <For each={LOGO_DOTS}>
          {(d) => (
            // Tone colours come from `.app-mark .z1/.z2` in components.css;
            // fill="currentColor" is the fallback without the stylesheet.
            <circle
              class={d.tone === "main" ? "z1" : "z2"}
              cx={d.cx}
              cy={d.cy}
              r={LOGO_DOT_R}
              fill="currentColor"
            />
          )}
        </For>
      </svg>
    </span>
  );
}

export default AppMark;
