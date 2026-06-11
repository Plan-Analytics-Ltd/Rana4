/** Session-scoped in-flight deduplication + short TTL cache for stable org-level API reads. */

const TTL_MS = 60_000;

type CacheEntry<T> = { value: T; expiresAt: number };

const cache = new Map<string, CacheEntry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();

export async function cachedFetch<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) return hit.value as T;

  const pending = inflight.get(key);
  if (pending) return pending as Promise<T>;

  const promise = fetcher()
    .then((value) => {
      cache.set(key, { value, expiresAt: Date.now() + TTL_MS });
      inflight.delete(key);
      return value;
    })
    .catch((err) => {
      inflight.delete(key);
      throw err;
    });

  inflight.set(key, promise);
  return promise as Promise<T>;
}

export function invalidateCachedFetch(key: string): void {
  cache.delete(key);
  inflight.delete(key);
}

export const SHARED_CACHE_KEYS = {
  rateCard: "rate-card",
  activityCodeTypes: (projectId: string) => `activity-code-types:${projectId}`,
} as const;
