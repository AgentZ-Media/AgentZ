import { For } from "solid-js";
import { LOGOS, type LogoId } from "@agentz/design/logo";

export interface AppMarkProps {
  logo: LogoId;
  appName: string;
  /** Tile edge length in px. Default 28 (sidebar size). */
  size?: number;
  /**
   * - "accent": yellow highlighter tile (in-app: sidebar, onboarding).
   * - "light":  white tile, ink dots, graphite shadow rows (app icon light).
   * - "dark":   graphite tile, chalk dots, accent shadow rows (app icon dark).
   */
  variant?: "accent" | "light" | "dark";
  class?: string;
  /** Optional accessible label overriding the product name. */
  title?: string;
}

/** A product mark selected from the design registry, on a rounded tile. */
export function AppMark(props: AppMarkProps) {
  const logo = () => LOGOS[props.logo];
  const size = () => props.size ?? 28;
  // Glyph width follows the common tile proportions; height follows the selected mark.
  const glyphW = () => Math.round(size() * 0.46 * 10) / 10;
  const glyphH = () => Math.round(glyphW() * logo().height / logo().width * 10) / 10;
  const variantClass = () =>
    props.variant === "light" ? " is-light" : props.variant === "dark" ? " is-dark" : "";
  return (
    <span
      class={`app-mark${variantClass()}${props.class ? ` ${props.class}` : ""}`}
      style={{ width: `${size()}px`, height: `${size()}px` }}
      role="img"
      aria-label={props.title ?? props.appName}
    >
      <svg viewBox={logo().viewBox} width={glyphW()} height={glyphH()}>
        <For each={logo().dots}>
          {(d) => (
            // Tone colours come from `.app-mark .z1/.z2` in components.css;
            // fill="currentColor" is the fallback without the stylesheet.
            <circle
              class={d.tone === "main" ? "z1" : "z2"}
              cx={d.cx}
              cy={d.cy}
              r={logo().dotRadius}
              fill="currentColor"
            />
          )}
        </For>
      </svg>
    </span>
  );
}

export default AppMark;
