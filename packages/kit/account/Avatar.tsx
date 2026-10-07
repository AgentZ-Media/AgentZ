import { Show } from "solid-js";
import { Icon } from "../ui";

/** Up to two letters: first and last word, else the first two characters. */
export function initialsOf(name: string): string {
  const parts = name.replace(/@.*/, "").split(/[\s._-]+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] ?? "").slice(0, 2);
  return letters.toUpperCase();
}

/** Stable hue slot (1-8, tokens --avatar-N) for an account ID. */
export function avatarSlot(seed: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return ((hash >>> 0) % 8) + 1;
}

/** Initials in a coloured circle; a neutral person without an account. */
export function Avatar(props: { name?: string; seed?: string; size?: number; class?: string }) {
  const size = () => props.size ?? 26;
  return (
    <span
      class={`acc-avatar${props.class ? ` ${props.class}` : ""}`}
      classList={{ "is-empty": !props.name }}
      style={{
        width: `${size()}px`, height: `${size()}px`, "font-size": `${Math.round(size() * 0.4)}px`,
        "--acc-hue": props.name ? `var(--avatar-${avatarSlot(props.seed ?? props.name)})` : undefined,
      }}
      aria-hidden="true"
    >
      <Show when={props.name} fallback={<Icon name="user" size={Math.round(size() * 0.55)} />}>
        {initialsOf(props.name!)}
      </Show>
    </span>
  );
}
