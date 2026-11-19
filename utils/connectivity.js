import NetInfo from '@react-native-community/netinfo'
import { SUPABASE_URL } from './supabase'

/**
 * Reliable "are we online?" check.
 *
 * NetInfo alone is not trustworthy on Android: `isConnected` can be null right after start-up, and
 * `isInternetReachable` can be false on networks where Google's connectivity probe is blocked even
 * though Supabase works fine. So:
 *   - isConnected === false            -> offline (no network at all, e.g. airplane mode)
 *   - NetInfo says online / unknown    -> online
 *   - NetInfo says "not reachable"     -> confirm by actually contacting our Supabase server
 * The result of a server probe is reused for a few seconds so callers can check freely.
 */

let _probe = null            // { at, ok }
let _probing = null
const PROBE_TTL_MS = 5000

async function probeServer(timeoutMs = 4000) {
  if (_probe && Date.now() - _probe.at < PROBE_TTL_MS) return _probe.ok
  if (_probing) return _probing
  _probing = (async () => {
    let ok = false
    try {
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null
      const timer = setTimeout(() => controller?.abort(), timeoutMs)
      try {
        // Any HTTP response (even 401) proves the internet and the server are reachable
        await fetch(`${SUPABASE_URL}/auth/v1/health`, { method: 'GET', signal: controller?.signal })
        ok = true
      } finally {
        clearTimeout(timer)
      }
    } catch (_) {
      ok = false
    }
    _probe = { at: Date.now(), ok }
    _probing = null
    return ok
  })()
  return _probing
}

/** Quick verdict from a NetInfo state, without any network request. */
export function looksOffline(state) {
  return state?.isConnected === false || state?.isInternetReachable === false
}

/** True when the device can actually reach the server. Pass a NetInfo state to skip re-fetching it. */
export async function hasInternet(state) {
  let s = state
  if (!s) {
    try { s = await NetInfo.fetch() } catch (_) { s = null }
  }
  if (s?.isConnected === false) return false
  if (s?.isInternetReachable === false) return await probeServer()
  return true
}
