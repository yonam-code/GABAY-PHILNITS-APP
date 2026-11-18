import NetInfo from '@react-native-community/netinfo'
import {
    getPendingSyncItems, markSyncItemCompleted, markSyncItemFailed,
    getUnsyncedPoints, markPointsSynced, cacheQuestionsLocally, pruneCompletedSyncItems,
} from './database'
import { getCache, setCache } from './cache'
import { supabase } from './supabase'

let isSyncing = false
const syncListeners = new Set()

export const addSyncListener = (cb) => {
    syncListeners.add(cb)
    return () => syncListeners.delete(cb)
}

const notifySyncListeners = (status, count = 0) => {
    syncListeners.forEach(cb => {
        try { cb({ status, count, isSyncing }) } catch (_) {}
    })
}

// True when the failure is a connectivity problem (not a server-side rejection).
// Those items must stay queued and must NOT burn one of their retries.
export const isNetworkError = (err) => {
    const msg = String(err?.message || err || '').toLowerCase()
    return (
        msg.includes('network request failed') ||
        msg.includes('failed to fetch') ||
        msg.includes('network error') ||
        msg.includes('timed out') ||
        msg.includes('timeout') ||
        msg.includes('internet')
    )
}

const parseJson = (str) => {
    if (!str) return null
    try { return JSON.parse(str) } catch (_) { return null }
}

// Runs one queued operation. Returns { error } (error may be null).
export const runQueueItem = async (item, payload, options) => {
    const table = item.table_name

    if (item.action === 'INSERT') {
        const { error } = await supabase.from(table).insert(payload)
        // 23505 = unique violation: the row already reached the server, so treat as success (no duplicate).
        if (error && String(error.code) === '23505') return { error: null }
        return { error }
    }

    if (item.action === 'UPSERT') {
        const onConflict = options?.onConflict || (payload.id ? 'id' : (payload.user_id ? 'user_id' : undefined))
        const { error } = await supabase.from(table).upsert(payload, onConflict ? { onConflict } : undefined)
        return { error }
    }

    if (item.action === 'UPDATE') {
        // Explicit match from the caller wins (e.g. { email: 'a@b.c' })
        if (options?.match && Object.keys(options.match).length > 0) {
            let q = supabase.from(table).update(payload)
            for (const [k, v] of Object.entries(options.match)) q = q.eq(k, v)
            const { error } = await q
            return { error }
        }
        if (payload.id) {
            const { error } = await supabase.from(table).update(payload).eq('id', payload.id)
            return { error }
        }
        if (payload.user_id) {
            const { error } = await supabase.from(table).update(payload).eq('user_id', payload.user_id)
            return { error }
        }
        if (payload.email) {
            const { email: targetEmail, ...updateFields } = payload
            const { error } = await supabase.from(table).update(updateFields).ilike('email', targetEmail)
            return { error }
        }
        if (table === 'users') {
            const { data: { session } } = await supabase.auth.getSession()
            const sessionEmail = session?.user?.email
            if (!sessionEmail) return { discard: true }
            const { email: _, id: __, user_id: ___, ...updateFields } = payload
            const { error } = await supabase.from('users').update(updateFields).ilike('email', sessionEmail)
            return { error }
        }
        return { discard: true }
    }

    if (item.action === 'DELETE') {
        if (!payload.id) return { discard: true }
        const { error } = await supabase.from(table).delete().eq('id', payload.id)
        return { error }
    }

    return { discard: true }
}

export const processSyncQueue = async () => {
    // Prevent multiple sync processes running at the same time
    if (isSyncing) return
    isSyncing = true
    let didWork = false

    try {
        const state = await NetInfo.fetch()
        if (!state.isConnected) return

        const pendingItems = await getPendingSyncItems()
        const unsyncedPtsPreview = await getUnsyncedPoints()
        if (pendingItems.length === 0 && unsyncedPtsPreview.length === 0) return

        didWork = true
        notifySyncListeners('SYNCING', pendingItems.length)

        let offlineAgain = false
        for (const item of pendingItems) {
            const payload = parseJson(item.payload)
            if (!payload) {
                await markSyncItemCompleted(item.id) // corrupt row, nothing recoverable
                continue
            }
            const options = parseJson(item.options)

            try {
                const result = await runQueueItem(item, payload, options)
                if (result.discard) {
                    console.warn(`Discarding unusable queue item ${item.id} (${item.table_name}/${item.action})`)
                    await markSyncItemCompleted(item.id)
                } else if (result.error) {
                    if (isNetworkError(result.error)) { offlineAgain = true; break }
                    console.warn(`Failed to sync item ${item.id} (${item.table_name}):`, result.error?.message || result.error)
                    await markSyncItemFailed(item.id, result.error?.message)
                } else {
                    await markSyncItemCompleted(item.id)
                }
            } catch (err) {
                if (isNetworkError(err)) { offlineAgain = true; break }
                console.warn(`Error processing item ${item.id}:`, err?.message || err)
                await markSyncItemFailed(item.id, err?.message)
            }
        }

        if (offlineAgain) return // connection dropped mid-sync; remaining items stay queued

        // --- POINTS SYNC LOGIC ---
        const unsyncedPoints = await getUnsyncedPoints()
        if (unsyncedPoints.length > 0) {
            const { data: { session } } = await supabase.auth.getSession()
            if (session?.user?.id) {
                const userFullName = session.user.user_metadata?.full_name || session.user.user_metadata?.fullName || ''
                const payload = unsyncedPoints.map(p => {
                    let metaObj = p.metadata ? (typeof p.metadata === 'string' ? (parseJson(p.metadata) || {}) : p.metadata) : {}
                    if (userFullName && !metaObj.user_name) {
                        metaObj.user_name = userFullName
                    }
                    return {
                        user_id: session.user.id,
                        category: p.category,
                        points: p.points,
                        metadata: metaObj,
                        created_at: p.created_at
                    }
                })

                let syncSucceeded = false
                const { error: rpcError } = await supabase.rpc('sync_points_ledger', { payload })

                if (rpcError) {
                    const { error: insertError } = await supabase.from('points_ledger').insert(payload)
                    if (insertError) {
                        console.warn('Failed to sync points to Supabase points_ledger:', insertError?.message || insertError)
                    } else {
                        syncSucceeded = true
                    }
                } else {
                    syncSucceeded = true
                }

                if (syncSucceeded) {
                    await markPointsSynced(unsyncedPoints.map(p => p.id))
                }
            }
        }

        await pruneCompletedSyncItems()
    } catch (error) {
        console.warn('Error during sync process:', error?.message || error)
        if (didWork) notifySyncListeners('ERROR', 0)
    } finally {
        isSyncing = false
        // Only announce "synced" when something was actually attempted
        notifySyncListeners(didWork ? 'COMPLETED' : 'IDLE', 0)
    }
}

/**
 * Pre-cache published practice questions, true/false, and flashcards into SQLite
 * so offline mode immediately has questions ready without needing prior visits.
 */
export const precachePracticeContent = async ({ force = false } = {}) => {
    try {
        const state = await NetInfo.fetch()
        if (!state.isConnected) return

        // Practice tables require a signed-in user, and the content rarely changes: refresh at most every 12h
        const { data: { session } } = await supabase.auth.getSession()
        if (!session?.user) return
        if (!force && (await getCache('precache_practice_done', false))) return

        console.log('Pre-caching practice questions for offline use...')

        // 1. Multiple Choice Questions
        const { data: mcqs } = await supabase
            .from('multiple_choice_questions')
            .select('*, practice_categories!inner(name)')
            .eq('is_published', true)
            .limit(150)
        if (mcqs && mcqs.length > 0) {
            await cacheQuestionsLocally('mcq', 'all', mcqs)
            // Also index by category name for targeted subject practice
            const byCategory = {}
            mcqs.forEach(q => {
                const catName = q.practice_categories?.name
                if (catName) {
                    if (!byCategory[catName]) byCategory[catName] = []
                    byCategory[catName].push(q)
                }
            })
            for (const [catName, catQs] of Object.entries(byCategory)) {
                await cacheQuestionsLocally('mcq', catName, catQs)
            }
        }

        // 2. True / False Questions
        const { data: tfs } = await supabase
            .from('true_false_questions')
            .select('*, practice_categories!inner(name)')
            .eq('is_published', true)
            .limit(150)
        if (tfs && tfs.length > 0) {
            await cacheQuestionsLocally('tf', 'all', tfs)
            const byCategory = {}
            tfs.forEach(q => {
                const catName = q.practice_categories?.name
                if (catName) {
                    if (!byCategory[catName]) byCategory[catName] = []
                    byCategory[catName].push(q)
                }
            })
            for (const [catName, catQs] of Object.entries(byCategory)) {
                await cacheQuestionsLocally('tf', catName, catQs)
            }
        }

        // 3. Flashcards
        const { data: fcs } = await supabase
            .from('flashcards')
            .select('*, flashcard_decks!inner(category_id, practice_categories!inner(name))')
            .limit(150)
        if (fcs && fcs.length > 0) {
            await cacheQuestionsLocally('flashcard', 'all', fcs)
            const byCategory = {}
            fcs.forEach(c => {
                const catName = c.flashcard_decks?.practice_categories?.name
                if (catName) {
                    if (!byCategory[catName]) byCategory[catName] = []
                    byCategory[catName].push(c)
                }
            })
            for (const [catName, catCards] of Object.entries(byCategory)) {
                await cacheQuestionsLocally('flashcard', catName, catCards)
            }
        }

        await setCache('precache_practice_done', true, 12 * 60 * 60 * 1000)
        console.log('Pre-caching practice content complete.')
    } catch (e) {
        console.warn('Precache error:', e?.message || e)
    }
}

