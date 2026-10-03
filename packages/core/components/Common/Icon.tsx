import { ICONS, ICON_VIEWBOX, type IconName } from "@agentz/design/icons";

export type { IconName };

export interface IconProps {
  name: IconName;
  /** Rendered width and height in px. Default 15 (the concept's `svg.i`). */
  size?: number;
  class?: string;
  /** Accessible label. Without it the icon is decorative (aria-hidden). */
  title?: string;
}

/**
 * Stroke icon from the @agentz/design set. Colour follows `currentColor`.
 * The markup is static package data (never user input), so innerHTML is safe.
 */
export function Icon(props: IconProps) {
  const size = () => props.size ?? 15;
  return (
    <svg
      class={props.class ? `i ${props.class}` : "i"}
      viewBox={ICON_VIEWBOX}
      width={size()}
      height={size()}
      fill="none"
      stroke="currentColor"
      stroke-width="1.75"
      stroke-linecap="round"
      stroke-linejoin="round"
      role={props.title ? "img" : undefined}
      aria-label={props.title}
      aria-hidden={props.title ? undefined : "true"}
      style={{ width: `${size()}px`, height: `${size()}px` }}
      innerHTML={(props.title ? `<title>${escapeText(props.title)}</title>` : "") + ICONS[props.name]}
    />
  );
}

function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export default Icon;
