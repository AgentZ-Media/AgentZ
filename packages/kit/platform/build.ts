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
}

export const STABLE_BUILD: BuildInfo = { channel: "stable" };

/** True for versions published by the nightly workflow. */
export function isNightlyVersion(version: string | null | undefined): boolean {
  return typeof version === "string" && /^v?\d+\.\d+\.\d+-nightly\.\d+$/.test(version);
}
