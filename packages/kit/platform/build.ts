// Build identity supplied by the host. Nightly builds are prereleases of the
// next version (`0.10.1-nightly.202610051500`) and look different on purpose.

export type BuildChannel = "stable" | "nightly";
export type UpdateChannel = BuildChannel;

export interface BuildInfo {
  channel: BuildChannel;
  /** Full commit SHA the build was made from, when the host knows it. */
  commit?: string;
  /** ISO timestamp of the build, when the host knows it. */
  builtAt?: string;
  /** Running from the development server (`pnpm dev:<app>`), not an installed build. */
  development?: boolean;
}

export const STABLE_BUILD: BuildInfo = { channel: "stable" };

const SEMVER = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z.-]+)?$/;

/** SemVer precedence: negative if a < b, 0 if equal, positive if a > b; null if either is invalid.
 *  Mirrors apps/site/convex/compat.ts. */
export function compareVersions(a: string, b: string): number | null {
  const left = SEMVER.exec(a.trim());
  const right = SEMVER.exec(b.trim());
  if (!left || !right) return null;
  for (let i = 1; i <= 3; i++) {
    const diff = Number(left[i]) - Number(right[i]);
    if (diff !== 0) return diff;
  }
  const lp = left[4]?.split(".") ?? [];
  const rp = right[4]?.split(".") ?? [];
  // A pre-release (nightly, rc) is older than the release of the same version.
  if (lp.length === 0 || rp.length === 0) return rp.length - lp.length;
  for (let i = 0; i < Math.min(lp.length, rp.length); i++) {
    if (lp[i] === rp[i]) continue;
    const ln = /^\d+$/.test(lp[i]);
    const rn = /^\d+$/.test(rp[i]);
    if (ln && rn) return Number(lp[i]) - Number(rp[i]);
    if (ln) return -1;
    if (rn) return 1;
    return lp[i] < rp[i] ? -1 : 1;
  }
  return lp.length - rp.length;
}

/** True for versions published by the nightly workflow. */
export function isNightlyVersion(version: string | null | undefined): boolean {
  return typeof version === "string" && /^v?\d+\.\d+\.\d+-nightly\.\d+$/.test(version);
}
