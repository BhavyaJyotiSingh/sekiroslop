import type { Presence } from "colyseus";

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // Omit ambiguous O, 0, I, 1
const PRESENCE_KEY = "colosseum:active_room_codes";
// Synchronous in-process lock keyed by Presence instance to eliminate LocalPresence TOCTOU races
const inProcessReservedByPresence = new WeakMap<Presence, Set<string>>();

function getInProcessLockSet(presence: Presence): Set<string> {
  let set = inProcessReservedByPresence.get(presence);
  if (!set) {
    set = new Set<string>();
    inProcessReservedByPresence.set(presence, set);
  }
  return set;
}

function randomCode(length = 4): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    out += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return out;
}

/**
 * Allocates a unique 4-character room code using an in-process synchronous lock
 * plus Colyseus Presence (`sadd` / `smembers`) to prevent collisions across concurrent rooms.
 */
export async function allocateUniqueRoomCode(
  presence: Presence,
  requestedCode?: string,
  maxAttempts = 32
): Promise<string> {
  const localLocks = getInProcessLockSet(presence);

  const tryReserve = async (candidate: string): Promise<boolean> => {
    const clean = candidate.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
    if (clean.length < 4) return false;

    if (localLocks.has(clean)) return false;
    localLocks.add(clean);

    try {
      // Check existing members then reserve atomically via sadd
      const existing = await presence.smembers(PRESENCE_KEY);
      if (existing.includes(clean)) {
        localLocks.delete(clean);
        return false;
      }

      const added = await presence.sadd(PRESENCE_KEY, clean);
      // LocalPresence returns void/undefined; RedisPresence returns 1 if added, 0 if duplicate
      if (typeof added === "number" && added !== 1) {
        localLocks.delete(clean);
        return false;
      }
      return true;
    } catch (err) {
      localLocks.delete(clean);
      throw err;
    }
  };

  if (requestedCode) {
    if (await tryReserve(requestedCode)) {
      return requestedCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
    }
  }

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const candidate = randomCode(4);
    if (await tryReserve(candidate)) {
      return candidate;
    }
  }

  // Fallback to 5-char code if 4-char space is unexpectedly crowded
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const candidate = randomCode(5);
    if (await tryReserve(candidate)) {
      return candidate;
    }
  }

  throw new Error("Unable to allocate unique room code");
}

export async function releaseRoomCode(presence: Presence, roomCode: string): Promise<void> {
  if (!roomCode || !presence) return;
  const clean = roomCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
  const localLocks = inProcessReservedByPresence.get(presence);
  localLocks?.delete(clean);
  localLocks?.delete(roomCode);
  try {
    await presence.srem(PRESENCE_KEY, roomCode);
  } catch {
    // Ignore cleanup errors during shutdown
  }
}
