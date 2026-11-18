import { getGenericCache, getGenericCacheMany, setGenericCache, clearGenericCache } from './database'

/**
 * Get an item from the SQLite cache. Returns null if not found or expired.
 * @param {string} key 
 */
export async function getCache(key, fallbackIfExpired = true) {
  const item = await getGenericCache(key);
  if (!item) return null;
  
  if (Date.now() > item.expiry) {
    if (fallbackIfExpired) {
      // Return cached content so offline mode never shows a blank screen
      return item.data;
    }
    await clearCache(key);
    return null;
  }
  return item.data;
}

/**
 * Read several cache keys at once (single SQLite query). Returns { key: data | null }.
 * Expired entries are still returned so offline mode never shows a blank screen.
 */
export async function getCacheMany(keys) {
  const raw = await getGenericCacheMany(keys);
  const out = {};
  keys.forEach((k) => {
    out[k] = raw[k] ? raw[k].data ?? null : null;
  });
  return out;
}

/**
 * Save an item in the SQLite cache.
 * @param {string} key 
 * @param {any} data 
 * @param {number} ttlMs Time to live in milliseconds (default: 5 minutes)
 */
export async function setCache(key, data, ttlMs = 5 * 60 * 1000) {
  const cacheObj = {
    data,
    expiry: Date.now() + ttlMs,
  };
  await setGenericCache(key, cacheObj);
}

/**
 * Remove an item or clear all items from the cache.
 * @param {string} [key] 
 */
export async function clearCache(key) {
  await clearGenericCache(key);
}
