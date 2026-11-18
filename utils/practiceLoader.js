import NetInfo from '@react-native-community/netinfo'
import { getLocalQuestions, cacheQuestionsLocally } from './database'
import { balancePracticeDistribution } from './practiceDistribution'
import { withTimeout } from './queryHelper'

/**
 * Shared loader for Flashcards, Multiple Choice, True/False and Matching.
 *
 * Fixes over the old per-screen code:
 *  - The questions used to be the first 100 rows in a fixed order, so users kept seeing the same ones.
 *    We now read from random windows of the table (when it is larger than the pool).
 *  - Cached questions were rendered first and then REPLACED by the fresh ones in the middle of a quiz.
 *    Now: online -> fetch once (8 s timeout) and use that; offline / failed -> use the local cache.
 *  - The offline fallback could return questions from any exam track / subject. Everything coming from
 *    the local cache is now filtered with the same rules as the database query (track, FE section,
 *    subject / major / minor category, deck).
 */

const shuffle = (arr) => [...arr].sort(() => 0.5 - Math.random())
const norm = (v) => String(v ?? '').trim().toLowerCase()

/** Local mirror of the database filters, used for items read from the SQLite cache. */
export function buildItemMatcher({
  track,
  section,
  targetDbCategories = [],
  majorCategory,
  minorCategory,
  deckId,
  getCategoryName = (it) => it?.practice_categories?.name,
}) {
  const wantedTrack = norm(track)
  const wantedSection = norm(section)
  const wantedCategories = targetDbCategories.map(norm)

  return (item) => {
    if (!item) return false
    const itemTrack = norm(item.exam_level || item.practice_categories?.exam_level || item.flashcard_decks?.exam_level)
    if (wantedTrack && itemTrack && itemTrack !== wantedTrack) return false

    if (wantedTrack === 'fe' && wantedSection) {
      const itemSection = norm(item.fe_section)
      if (itemSection && itemSection !== wantedSection) return false
    }

    if (deckId) return String(item.deck_id) === String(deckId)
    if (minorCategory) return norm(item.minor_category) === norm(minorCategory)
    if (majorCategory) return norm(item.major_category) === norm(majorCategory)
    if (wantedCategories.length > 0) return wantedCategories.includes(norm(getCategoryName(item)))
    return true
  }
}

/**
 * @param {object} p
 * @param {'mcq'|'tf'|'flashcard'|'matching'} p.cacheType
 * @param {string}   p.cacheScope   canonical pool scope, e.g. "ip_all_pool" / "fe_subjecta_pool"
 * @param {string}   p.track        'IP' | 'FE'
 * @param {Function} p.buildQuery   () => supabase query built with .select(..., { count: 'exact' })
 * @param {Function} p.matches      filter used for locally cached items (see buildItemMatcher)
 * @param {number}   p.limit        how many items the user asked for
 * @returns {Promise<{ items: any[], fromCache: boolean }>}
 */
export async function loadPracticeItems({
  cacheType,
  cacheScope,
  track,
  buildQuery,
  matches,
  limit,
  subject,
  majorCategory,
  minorCategory,
  timeoutMs = 8000,
}) {
  const wanted = Math.max(1, Number(limit) || 10)
  const poolSize = Math.min(180, Math.max(60, wanted * 6))

  let pool = []
  let fromCache = false

  // ── 1. Database (when online) ───────────────────────────────────────────
  let online = true
  try {
    online = Boolean((await NetInfo.fetch()).isConnected)
  } catch (_) {}

  if (online) {
    try {
      const first = await withTimeout(buildQuery().order('id').range(0, poolSize - 1), timeoutMs)
      if (first?.error) throw first.error
      let rows = first?.data || []
      const total = typeof first?.count === 'number' ? first.count : rows.length

      // Table bigger than the pool: sample 3 random windows so every visit shows different questions
      if (total > poolSize) {
        const windowSize = Math.ceil(poolSize / 3)
        const maxStart = Math.max(0, total - windowSize)
        const starts = new Set()
        while (starts.size < Math.min(3, maxStart + 1)) {
          starts.add(Math.floor(Math.random() * (maxStart + 1)))
        }
        const windows = await Promise.allSettled(
          [...starts].map((s) => withTimeout(buildQuery().order('id').range(s, s + windowSize - 1), timeoutMs))
        )
        const seen = new Set()
        const merged = []
        windows.forEach((w) => {
          if (w.status !== 'fulfilled' || w.value?.error) return
          ;(w.value.data || []).forEach((row) => {
            const key = row?.id ?? JSON.stringify(row)
            if (!seen.has(key)) { seen.add(key); merged.push(row) }
          })
        })
        if (merged.length > 0) rows = merged
      }

      if (rows.length > 0) {
        pool = rows
        // Store under ONE canonical scope per track so the cache never holds duplicates
        cacheQuestionsLocally(cacheType, cacheScope, rows).catch(() => {})
      }
    } catch (err) {
      console.warn(`[practice] ${cacheType} fetch failed, using local cache:`, err?.message || err)
    }
  }

  // ── 2. Local cache (offline, timeout or empty result) ───────────────────
  if (pool.length === 0) {
    try {
      const local = await getLocalQuestions(cacheType, cacheScope, 400, { trackPrefix: `${String(track).toLowerCase()}_` })
      pool = (local || []).filter(matches)
      fromCache = pool.length > 0
    } catch (_) {}
  }

  if (pool.length === 0) return { items: [], fromCache }

  const balanced = balancePracticeDistribution(pool, wanted, subject, majorCategory, minorCategory)
  return { items: shuffle(balanced), fromCache }
}
