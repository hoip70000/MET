import { get, set } from 'idb-keyval';

/** Generic TTL'd idb-keyval cache, following the same `get`/`set` pattern already used by
 *  `fontsStore.ts`/`studioProjectStore.ts` etc. Used for data that's cheap to re-fetch but
 *  expensive/annoying to wait on synchronously (e.g. a teammate's name/avatar for chat). */
interface CacheEntry<T> {
  value: T;
  cachedAt: number;
}

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24h

async function getCacheEntry<T>(key: string): Promise<CacheEntry<T> | null> {
  const entry = await get(key);
  return entry && typeof entry === 'object' && 'value' in entry ? (entry as CacheEntry<T>) : null;
}

async function setCacheEntry<T>(key: string, value: T): Promise<void> {
  await set(key, { value, cachedAt: Date.now() } satisfies CacheEntry<T>);
}

export interface CachedTeammate {
  id: string;
  name: string;
  avatar: string;
  email?: string;
}

function teammateKey(teamId: string, userId: string): string {
  return `team:${teamId}:member:${userId}`;
}

/** Returns the cached teammate immediately if present (even if stale — callers that want a
 *  fresh copy should also kick off a real fetch and call `setCachedTeammate` when it resolves;
 *  this is "show something now, correct it if wrong" rather than "block until we know"). */
export async function getCachedTeammate(teamId: string, userId: string): Promise<CachedTeammate | null> {
  const entry = await getCacheEntry<CachedTeammate>(teammateKey(teamId, userId));
  return entry?.value ?? null;
}

export async function setCachedTeammate(teamId: string, teammate: CachedTeammate): Promise<void> {
  await setCacheEntry(teammateKey(teamId, teammate.id), teammate);
}

export async function setCachedTeammates(teamId: string, teammates: CachedTeammate[]): Promise<void> {
  await Promise.all(teammates.map(t => setCachedTeammate(teamId, t)));
}

export async function getCachedTeammates(teamId: string, userIds: string[]): Promise<Record<string, CachedTeammate>> {
  const entries = await Promise.all(userIds.map(async id => [id, await getCachedTeammate(teamId, id)] as const));
  const result: Record<string, CachedTeammate> = {};
  for (const [id, teammate] of entries) {
    if (teammate) result[id] = teammate;
  }
  return result;
}

/** Whether a cached entry is old enough that a background refresh is worth kicking off. */
export async function isTeammateCacheStale(teamId: string, userId: string, ttlMs = DEFAULT_TTL_MS): Promise<boolean> {
  const entry = await getCacheEntry<CachedTeammate>(teammateKey(teamId, userId));
  if (!entry) return true;
  return Date.now() - entry.cachedAt > ttlMs;
}

function avatarColorKey(avatarUrl: string): string {
  return `avatar_color:${avatarUrl}`;
}

export async function getCachedAvatarColor(avatarUrl: string): Promise<string | null> {
  const entry = await getCacheEntry<string>(avatarColorKey(avatarUrl));
  return entry?.value ?? null;
}

export async function setCachedAvatarColor(avatarUrl: string, color: string): Promise<void> {
  await setCacheEntry(avatarColorKey(avatarUrl), color);
}
