import { createSignal } from "solid-js";
import { listSessions, type SessionSummary } from "../../lib/agent/chats";

// ---------------------------------------------------------------------------
// Stored sessions for the start screen and the session menu
// ---------------------------------------------------------------------------

/** Bumped after a session row was written; the session list follows. */
const [sessionsVersion, setSessionsVersion] = createSignal(0);
export { sessionsVersion };
let sessionsBump: ReturnType<typeof setTimeout> | null = null;

export function bumpSessions(delayMs = 300): void {
  if (sessionsBump) clearTimeout(sessionsBump);
  sessionsBump = setTimeout(() => { sessionsBump = null; setSessionsVersion((v) => v + 1); }, delayMs);
}

const [sessionList, setSessionList] = createSignal<SessionSummary[]>([]);
export { sessionList };
let sessionListGeneration = 0;

export async function refreshSessionList(): Promise<void> {
  const generation = ++sessionListGeneration;
  try {
    const list = await listSessions(40);
    if (generation === sessionListGeneration) setSessionList(list);
  } catch (error) {
    console.warn("[agent] listing sessions failed", error);
  }
}

/** Empties the list and drops a pending refresh (runtime stop). */
export function resetSessionList(): void {
  sessionListGeneration += 1;
  setSessionList([]);
  if (sessionsBump) clearTimeout(sessionsBump);
  sessionsBump = null;
}
