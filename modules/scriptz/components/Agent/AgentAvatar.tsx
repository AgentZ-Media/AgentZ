import { For, createMemo } from "solid-js";
import type { AgentLook } from "../../stores/agentSettings";

export type AvatarState = "still" | "idle" | "think" | "talk" | "learn";

/** 5x5 dot patterns, the same dot-matrix language as the Z mark. */
const PATTERNS: Record<AgentLook, readonly string[]> = {
  eyes: [".....", ".X.X.", ".....", "X...X", ".XXX."],
  z: ["XXXXX", "...X.", "..X..", ".X...", "XXXXX"],
  diamond: ["..X..", ".XXX.", "XXXXX", ".XXX.", "..X.."],
  spark: ["..X..", "..X..", "XX.XX", "..X..", "..X.."],
};

interface Dot {
  cx: number;
  cy: number;
  lit: boolean;
  role: "" | "eye" | "mouth";
  d: number;
  r: string;
}

export interface AgentAvatarProps {
  look: AgentLook;
  size: number;
  state?: AvatarState;
  /** Lighter tile for dark surfaces (sidebar, onboarding stage). */
  onDark?: boolean;
  /** Large hero avatars get a soft drop shadow. */
  lifted?: boolean;
  class?: string;
}

/** The agent's face: a 5x5 dot matrix in highlighter yellow on graphite.
 *  States animate via CSS only (Agent.css), reduced motion stops them. */
export function AgentAvatar(props: AgentAvatarProps) {
  const dots = createMemo<Dot[]>(() => {
    const pattern = PATTERNS[props.look] ?? PATTERNS.eyes;
    const out: Dot[] = [];
    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 5; x++) {
        const lit = pattern[y][x] === "X";
        let role: Dot["role"] = "";
        if (props.look === "eyes" && lit && y === 1) role = "eye";
        if (props.look === "eyes" && lit && y >= 3) role = "mouth";
        out.push({ cx: 7 + x * 9, cy: 7 + y * 9, lit, role, d: x + y, r: Math.hypot(x - 2, y - 2).toFixed(2) });
      }
    }
    return out;
  });
  return (
    <span
      class={`ag-av ag-av-${props.state ?? "still"}${props.class ? ` ${props.class}` : ""}`}
      classList={{ "has-mouth": props.look === "eyes", "on-dark": !!props.onDark, lifted: !!props.lifted }}
      style={{ "--av-size": `${props.size}px` }}
      aria-hidden="true"
    >
      <svg viewBox="0 0 50 50">
        <For each={dots()}>
          {(dot) => (
            <circle
              cx={dot.cx}
              cy={dot.cy}
              r={3.3}
              class={`${dot.lit ? "lit" : "dim"}${dot.role ? ` ${dot.role}` : ""}`}
              style={{ "--d": String(dot.d), "--r": dot.r }}
            />
          )}
        </For>
      </svg>
    </span>
  );
}
