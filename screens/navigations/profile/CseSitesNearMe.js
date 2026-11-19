import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import {
  StyleSheet, Text, View, ActivityIndicator, TouchableOpacity,
  Modal, ScrollView, Platform, Linking, StatusBar, useWindowDimensions
} from 'react-native'
import { Ionicons, Feather } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { WebView } from 'react-native-webview'
import * as Location from 'expo-location'
import { supabase } from '../../../utils/supabase'
import { getCache, setCache } from '../../../utils/cache'
import { withTimeout } from '../../../utils/queryHelper'
import { getScrollBottomPadding } from '../../../utils/responsiveLayout'

const NAVY = '#0f2747'
const ACCENT = '#d85e67'

const VENUES_TABLE = 'philnits_testing_venues'
const VENUES_COLUMNS = 'id, name, address, city, region, latitude, longitude, phone, email, website, notes, sort_order'
const CACHE_KEY = 'philnits_testing_venues_v1'
const CACHE_TTL_MS = 24 * 60 * 60 * 1000
const DEFAULT_CENTER = { latitude: 14.5995, longitude: 120.9842 } // Manila

// Last-resort list, used ONLY when the venues table has never been loaded (no connection and no saved copy,
// or supabase_testing_venues.sql has not been run yet). Live Supabase data always replaces it.
// Official exam sites from https://philnits.org/exam-site/ (fallback only; live data comes from Supabase)
const BUILTIN_SITES = [
  { id: 'b1', name: "Philippine Christian University (PCU)", address: "1648 Taft Ave, Malate, Manila, 1004 Metro Manila", lat: 14.575564, lng: 120.989159, phone: null },
  { id: 'b2', name: "University of St. La Salle - Bacolod City", address: "La Salle Avenue corner San Agustin Dr, Bacolod, 6100 Negros Occidental", lat: 10.678417, lng: 122.962484, phone: null },
  { id: 'b3', name: "University of Negros Occidental – Recoletos", address: "#51 Lizares St, Bacolod, 6100 Negros Occidental", lat: 10.656413, lng: 122.947967, phone: null },
  { id: 'b4', name: "University of the Cordilleras (UC)", address: "Gov. Pack Road, Baguio City, Benguet", lat: 16.408455, lng: 120.597928, phone: null },
  { id: 'b5', name: "Batangas State University - Lipa Campus", address: "Lipa City, Batangas", lat: 13.956658, lng: 121.163273, phone: null },
  { id: 'b6', name: "Batangas State University - Malvar Campus", address: "Malvar, Batangas", lat: 14.044912, lng: 121.156329, phone: null },
  { id: 'b7', name: "Batangas State University - Nasugbu Campus", address: "R. Martinez St, Bucana, Nasugbu, Batangas", lat: 14.067242, lng: 120.626724, phone: null },
  { id: 'b8', name: "Holy Name University - Dampas Campus", address: "Dampas, Tagbilaran City, Bohol 6300", lat: 9.649598, lng: 123.8679, phone: null },
  { id: 'b9', name: "Camarines Sur Polytechnic Colleges", address: "San Miguel, Nabua, Camarines Sur", lat: 13.405818, lng: 123.376338, phone: null },
  { id: 'b10', name: "University of San Carlos - Talamban Campus", address: "Talamban, Cebu City", lat: 10.355938, lng: 123.907154, phone: null },
  { id: 'b11', name: "University of Cebu - Main Campus", address: "Sanciangko St, Cebu City, 6000 Cebu", lat: 10.297446, lng: 123.896292, phone: null },
  { id: 'b12', name: "University of Cebu - Banilad Campus", address: "Gov. M. Cuenco Ave, Banilad, Cebu City, 6000 Cebu", lat: 10.338154, lng: 123.911471, phone: null },
  { id: 'b13', name: "Foundation University", address: "Dr. Meciano Road, Dumaguete City, Negros Oriental", lat: 9.305209, lng: 123.299915, phone: null },
  { id: 'b14', name: "Colegio de Santa Rita", address: "San Carlos City, Negros Occidental", lat: 10.495526, lng: 123.424692, phone: null },
  { id: 'b15', name: "Don Mariano Marcos Memorial State University - Mid La Union Campus (College of Information Technology)", address: "Catbangen, San Fernando City, La Union", lat: 16.613938, lng: 120.314431, phone: null },
  { id: 'b16', name: "Saint Joseph College of Maasin", address: "Tunga-tunga, Maasin City, Southern Leyte 6600", lat: 10.133433, lng: 124.837676, phone: null },
  { id: 'b17', name: "La Salle University - Ozamiz", address: "Valconcha St., Ozamiz City, Misamis Occidental", lat: 8.149351, lng: 123.8471, phone: null },
  { id: 'b18', name: "Carlos Hilado Memorial State University - Talisay", address: "Mabini Street, Talisay City, Negros Occidental", lat: 10.742615, lng: 122.970323, phone: null },
  { id: 'b19', name: "Visayas State University", address: "Visca, Baybay City, Leyte", lat: 10.745887, lng: 124.794771, phone: null },
]

// ── helpers ──────────────────────────────────────────────────────────────
const toNumber = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(v)
  return Number.isFinite(n) ? n : null
}

// Database row -> shape used by this screen
function normalizeVenue(row) {
  if (!row || !row.name) return null
  return {
    id: String(row.id),
    name: String(row.name).trim(),
    address: row.address || '',
    city: row.city || '',
    region: row.region || '',
    lat: toNumber(row.latitude ?? row.lat),
    lng: toNumber(row.longitude ?? row.lng),
    phone: row.phone || '',
    email: row.email || '',
    website: row.website || '',
    notes: row.notes || '',
  }
}

const rad = (deg) => deg * (Math.PI / 180)
function distanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371
  const dLat = rad(lat2 - lat1)
  const dLon = rad(lon2 - lon1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

const withTimeoutValue = (promise, ms) =>
  Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))])

// Self-contained OpenStreetMap (Leaflet) page. No Google Maps API key is needed, so it can never crash the app.
function buildMapHtml(sites, user) {
  const payload = JSON.stringify(
    sites.filter((s) => s.lat != null && s.lng != null).map((s) => ({ id: s.id, la: s.lat, lo: s.lng }))
  ).replace(/</g, '\\u003c')
  const userJson = JSON.stringify(user ? { la: user.latitude, lo: user.longitude } : null)

  return `<!DOCTYPE html>
<html><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0" />
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>
  html, body, #map { width:100%; height:100%; margin:0; padding:0; background:#e2e8f0; }
  #off { display:none; position:absolute; inset:0; z-index:9999; background:#e2e8f0; color:#475569;
         font: 600 14px -apple-system, Roboto, sans-serif; text-align:center; align-items:center; justify-content:center; padding:24px; }
</style>
</head><body>
<div id="map"></div>
<div id="off">The map needs an internet connection.<br/>Venues are still listed below.</div>
<script>
(function () {
  function send(o) { try { window.ReactNativeWebView.postMessage(JSON.stringify(o)); } catch (e) {} }
  if (typeof L === 'undefined') { document.getElementById('off').style.display = 'flex'; send({ type: 'nomap' }); return; }

  var SITES = ${payload};
  var USER = ${userJson};
  var map = L.map('map', { zoomControl: true, attributionControl: true });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '&copy; OpenStreetMap' }).addTo(map);

  var markers = {};
  var selected = null;
  function style(sel) {
    return { radius: sel ? 12 : 9, color: '#ffffff', weight: 3, fillColor: sel ? '#0f2747' : '#d85e67', fillOpacity: 1 };
  }
  SITES.forEach(function (s) {
    var m = L.circleMarker([s.la, s.lo], style(false)).addTo(map);
    m.on('click', function () { send({ type: 'select', id: s.id }); });
    markers[s.id] = m;
  });
  if (USER) {
    L.circleMarker([USER.la, USER.lo], { radius: 8, color: '#ffffff', weight: 3, fillColor: '#2563eb', fillOpacity: 1 }).addTo(map);
  }

  var pts = SITES.map(function (s) { return [s.la, s.lo]; });
  if (USER) {
    var nearest = SITES.slice().sort(function (a, b) {
      return Math.hypot(a.la - USER.la, a.lo - USER.lo) - Math.hypot(b.la - USER.la, b.lo - USER.lo);
    })[0];
    var far = !nearest || Math.hypot(nearest.la - USER.la, nearest.lo - USER.lo) > 8; // > ~900 km away: show the venues instead
    if (far && pts.length) {
      map.fitBounds(pts, { padding: [30, 30] });
    } else {
      map.setView([USER.la, USER.lo], 10);
      if (nearest) map.fitBounds([[USER.la, USER.lo], [nearest.la, nearest.lo]], { padding: [40, 40], maxZoom: 13 });
    }
  } else if (pts.length) {
    map.fitBounds(pts, { padding: [30, 30] });
  } else {
    map.setView([${DEFAULT_CENTER.latitude}, ${DEFAULT_CENTER.longitude}], 6);
  }

  window.focusSite = function (id) {
    if (selected && markers[selected]) markers[selected].setStyle(style(false));
    selected = id;
    var m = markers[id];
    if (!m) return;
    m.setStyle(style(true)); m.bringToFront();
    map.flyTo(m.getLatLng(), Math.max(map.getZoom(), 13), { duration: 0.6 });
  };
  send({ type: 'ready' });
})();
</script>
</body></html>`
}

export default function CseSitesNearMe({ navigation }) {
  const insets = useSafeAreaInsets()
  const { height: windowHeight } = useWindowDimensions()

  const [sites, setSites] = useState([])
  const [source, setSource] = useState(null) // 'live' | 'cache' | 'builtin'
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [selectedSite, setSelectedSite] = useState(null)

  const [permissionModalVisible, setPermissionModalVisible] = useState(false)
  const [location, setLocation] = useState(null)
  const [locating, setLocating] = useState(false)
  const [mapUnavailable, setMapUnavailable] = useState(false)

  const webRef = useRef(null)
  const sitesCountRef = useRef(0)
  const gotLiveRef = useRef(false)
  const mountedRef = useRef(true)

  useEffect(() => () => { mountedRef.current = false }, [])

  // ── Venues: saved copy first, then Supabase (never lets an old copy overwrite newer live data) ──
  const loadVenues = useCallback(async () => {
    setLoadError(null)
    if (!gotLiveRef.current && sitesCountRef.current === 0) {
      const cached = await getCache(CACHE_KEY)
      if (!gotLiveRef.current && Array.isArray(cached) && cached.length > 0 && mountedRef.current) {
        sitesCountRef.current = cached.length
        setSites(cached)
        setSource('cache')
        setLoading(false)
      }
    }

    try {
      const res = await withTimeout(
        supabase.from(VENUES_TABLE).select(VENUES_COLUMNS).eq('is_active', true).order('sort_order').order('name'),
        10000
      )
      if (res?.error) throw res.error
      const rows = (res?.data || []).map(normalizeVenue).filter(Boolean)
      if (!mountedRef.current) return
      if (rows.length > 0) {
        gotLiveRef.current = true
        sitesCountRef.current = rows.length
        setSites(rows)
        setSource('live')
        setCache(CACHE_KEY, rows, CACHE_TTL_MS).catch(() => {})
        setSelectedSite((prev) => (prev ? rows.find((r) => r.id === prev.id) || null : prev))
      } else if (sitesCountRef.current === 0) {
        throw new Error('No venues have been added yet')
      }
    } catch (err) {
      if (!mountedRef.current) return
      console.warn('[venues] could not load from Supabase:', err?.message || err)
      if (sitesCountRef.current === 0) {
        sitesCountRef.current = BUILTIN_SITES.length
        setSites(BUILTIN_SITES)
        setSource('builtin')
        setLoadError("Couldn't load the latest venues. Showing a saved list.")
      }
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }, [])

  // ── Location: never blocks the screen, always times out ──
  const getUserLocation = useCallback(async () => {
    setLocating(true)
    try {
      let coords = null
      try {
        const pos = await withTimeoutValue(
          Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
          9000
        )
        coords = pos?.coords
      } catch (_) {
        const last = await Location.getLastKnownPositionAsync().catch(() => null)
        coords = last?.coords || null
      }
      if (coords && mountedRef.current) {
        setLocation({ latitude: coords.latitude, longitude: coords.longitude })
      }
    } finally {
      if (mountedRef.current) setLocating(false)
    }
  }, [])

  const checkPermissionAndGetLocation = useCallback(async () => {
    try {
      const { status } = await Location.getForegroundPermissionsAsync()
      if (status === 'granted') {
        getUserLocation()
      } else {
        setPermissionModalVisible(true)
      }
    } catch (err) {
      console.warn('[venues] permission check failed:', err?.message || err)
    }
  }, [getUserLocation])

  const requestPermission = async () => {
    setPermissionModalVisible(false)
    try {
      const { status } = await Location.requestForegroundPermissionsAsync()
      if (status === 'granted') getUserLocation()
    } catch (err) {
      console.warn('[venues] permission request failed:', err?.message || err)
    }
  }

  useEffect(() => {
    loadVenues()
    checkPermissionAndGetLocation()
  }, [loadVenues, checkPermissionAndGetLocation])

  // ── Derived data ──
  const sortedSites = useMemo(() => {
    if (!sites.length) return []
    if (!location) return sites
    return sites
      .map((s) => ({
        ...s,
        distance: s.lat != null && s.lng != null
          ? Math.round(distanceKm(location.latitude, location.longitude, s.lat, s.lng) * 10) / 10
          : undefined,
      }))
      .sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity))
  }, [location, sites])

  // The map page is only rebuilt when the venues or the user's (rounded) position change, not on every tap
  const userKey = location ? `${location.latitude.toFixed(2)},${location.longitude.toFixed(2)}` : 'none'
  const mapHtml = useMemo(
    () => buildMapHtml(sites, location),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sites, userKey]
  )

  const selectSite = useCallback((site) => {
    setSelectedSite(site)
    if (site && webRef.current && site.lat != null) {
      webRef.current.injectJavaScript(`window.focusSite && window.focusSite(${JSON.stringify(site.id)}); true;`)
    }
  }, [])

  const onMapMessage = useCallback((event) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data)
      if (msg.type === 'select') {
        const site = sites.find((s) => s.id === msg.id)
        if (site) setSelectedSite(site)
      } else if (msg.type === 'nomap') {
        setMapUnavailable(true)
      } else if (msg.type === 'ready') {
        setMapUnavailable(false)
      }
    } catch (_) {}
  }, [sites])

  const openDirections = (site) => {
    if (site.lat == null || site.lng == null) return
    Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${site.lat},${site.lng}`).catch(() => {})
  }
  const callSite = (phone) => {
    const digits = String(phone || '').replace(/[^\d+]/g, '')
    if (digits) Linking.openURL(`tel:${digits}`).catch(() => {})
  }

  const sheetHeight = Math.round(Math.min(Math.max(windowHeight * 0.46, 250), 440))
  const listBottomPadding = getScrollBottomPadding(insets, true, 8)

  return (
    <View style={styles.screen}>
      <StatusBar barStyle="dark-content" backgroundColor="#fff" />

      {/* Header */}
      <View style={[styles.header, { paddingTop: Math.max(insets.top, StatusBar.currentHeight || 0) + 8 }]}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Feather name="arrow-left" size={24} color={NAVY} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>PhilNITS Testing Venues</Text>
        <View style={styles.placeholderBtn} />
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={NAVY} />
          <Text style={styles.loadingText}>Loading testing venues…</Text>
        </View>
      ) : (
        <View style={styles.content}>
          {/* Map (OpenStreetMap, no API key) */}
          <View style={styles.map}>
            <WebView
              ref={webRef}
              style={styles.webview}
              originWhitelist={['*']}
              source={{ html: mapHtml, baseUrl: 'https://gabay-philnits.app/' }}
              javaScriptEnabled
              domStorageEnabled
              onMessage={onMapMessage}
              androidLayerType="hardware"
              mixedContentMode="always"
              setSupportMultipleWindows={false}
              overScrollMode="never"
            />
            {mapUnavailable ? (
              <View style={styles.mapNotice} pointerEvents="none">
                <Feather name="wifi-off" size={14} color="#fff" />
                <Text style={styles.mapNoticeText}>Map needs internet</Text>
              </View>
            ) : null}
          </View>

          {/* Venue sheet */}
          <View style={[styles.sitesSheet, { height: sheetHeight }]}>
            <View style={styles.sheetTitleRow}>
              <Text style={styles.sheetSectionTitle}>
                {location ? 'Nearest Centers' : 'All PhilNITS Venues'}
              </Text>
              {locating ? <ActivityIndicator size="small" color={NAVY} /> : null}
              {!location && !locating ? (
                <TouchableOpacity onPress={checkPermissionAndGetLocation} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Text style={styles.linkText}>Use my location</Text>
                </TouchableOpacity>
              ) : null}
            </View>

            {loadError ? (
              <View style={styles.errorBanner}>
                <Text style={styles.errorBannerText} numberOfLines={2}>{loadError}</Text>
                <TouchableOpacity onPress={() => { setLoading(true); loadVenues() }}>
                  <Text style={styles.retryText}>Retry</Text>
                </TouchableOpacity>
              </View>
            ) : null}

            <ScrollView
              style={styles.sitesList}
              contentContainerStyle={{ paddingBottom: listBottomPadding }}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {sortedSites.length === 0 ? (
                <Text style={styles.emptyText}>No testing venues available yet.</Text>
              ) : null}

              {sortedSites.map((site) => {
                const active = selectedSite?.id === site.id
                const place = [site.city, site.region].filter(Boolean).join(', ')
                return (
                  <TouchableOpacity
                    key={site.id}
                    style={[styles.siteItem, active && styles.siteItemActive]}
                    activeOpacity={0.85}
                    onPress={() => selectSite(site)}
                  >
                    <View style={styles.siteItemHeader}>
                      <Text style={styles.siteName}>{site.name}</Text>
                      {site.distance !== undefined && (
                        <View style={styles.distanceBadge}>
                          <Text style={styles.distanceText}>{site.distance} km</Text>
                        </View>
                      )}
                    </View>
                    <Text style={styles.siteAddress} numberOfLines={active ? 4 : 1}>{site.address}</Text>
                    {place ? <Text style={styles.sitePlace} numberOfLines={1}>{place}</Text> : null}

                    {site.phone ? (
                      <Text style={styles.sitePhone}><Feather name="phone" size={10} /> {site.phone}</Text>
                    ) : null}

                    {active ? (
                      <View style={styles.detailBlock}>
                        {site.email ? (
                          <TouchableOpacity onPress={() => Linking.openURL(`mailto:${site.email}`).catch(() => {})}>
                            <Text style={styles.detailLine}><Feather name="mail" size={11} /> {site.email}</Text>
                          </TouchableOpacity>
                        ) : null}
                        {site.website ? (
                          <TouchableOpacity onPress={() => Linking.openURL(/^https?:/i.test(site.website) ? site.website : `https://${site.website}`).catch(() => {})}>
                            <Text style={styles.detailLine} numberOfLines={1}><Feather name="globe" size={11} /> {site.website}</Text>
                          </TouchableOpacity>
                        ) : null}
                        {site.notes ? <Text style={styles.detailNotes}>{site.notes}</Text> : null}

                        <View style={styles.actionRow}>
                          {site.lat != null && site.lng != null ? (
                            <TouchableOpacity style={styles.actionBtn} onPress={() => openDirections(site)}>
                              <Feather name="navigation" size={13} color="#fff" />
                              <Text style={styles.actionBtnText}>Directions</Text>
                            </TouchableOpacity>
                          ) : null}
                          {site.phone ? (
                            <TouchableOpacity style={[styles.actionBtn, styles.actionBtnAlt]} onPress={() => callSite(site.phone)}>
                              <Feather name="phone" size={13} color={NAVY} />
                              <Text style={[styles.actionBtnText, { color: NAVY }]}>Call</Text>
                            </TouchableOpacity>
                          ) : null}
                        </View>
                      </View>
                    ) : null}
                  </TouchableOpacity>
                )
              })}
            </ScrollView>
          </View>
        </View>
      )}

      {/* Permission Request Modal */}
      <Modal
        visible={permissionModalVisible}
        transparent
        animationType="fade"
        statusBarTranslucent
        navigationBarTranslucent
        onRequestClose={() => setPermissionModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.permissionCard}>
            <View style={styles.iconCircle}>
              <Ionicons name="location-outline" size={40} color={NAVY} />
            </View>
            <Text style={styles.permissionTitle}>Enable Location Services</Text>
            <Text style={styles.permissionDesc}>
              We need access to your device location to show the PhilNITS testing venues closest to you. You can still browse every venue without it.
            </Text>

            <TouchableOpacity style={styles.allowButton} onPress={requestPermission}>
              <Text style={styles.allowButtonText}>Allow Access</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.denyButton} onPress={() => setPermissionModalVisible(false)}>
              <Text style={styles.denyButtonText}>Not Now</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f5f7fb' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#e8edf5',
    backgroundColor: '#fff',
    paddingHorizontal: 16,
  },
  backBtn: { padding: 4 },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 17,
    fontWeight: '900',
    color: NAVY,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginHorizontal: 6,
  },
  placeholderBtn: { width: 32 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  loadingText: { marginTop: 12, color: '#64748b', fontSize: 14, fontWeight: '500' },
  content: { flex: 1 },
  map: { flex: 1, minHeight: 160, backgroundColor: '#e2e8f0' },
  webview: { flex: 1, backgroundColor: '#e2e8f0' },
  mapNotice: {
    position: 'absolute',
    top: 10,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(15,39,71,0.85)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  mapNoticeText: { color: '#fff', fontSize: 12, fontWeight: '700', marginLeft: 6 },
  sitesSheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 18,
    paddingHorizontal: 18,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowOffset: { width: 0, height: -3 },
    shadowRadius: 10,
    elevation: 10,
  },
  sheetTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  sheetSectionTitle: { fontSize: 16, fontWeight: '800', color: NAVY },
  linkText: { fontSize: 12, fontWeight: '700', color: '#2563eb' },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#fef2f2',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 10,
  },
  errorBannerText: { flex: 1, fontSize: 12, color: '#991b1b', marginRight: 10 },
  retryText: { fontSize: 12, fontWeight: '800', color: '#dc2626' },
  emptyText: { textAlign: 'center', color: '#94a3b8', fontSize: 13, paddingVertical: 24 },
  sitesList: { flex: 1 },
  siteItem: {
    padding: 14,
    borderRadius: 12,
    backgroundColor: '#f8fafc',
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#f1f5f9',
  },
  siteItemActive: { backgroundColor: '#eff6ff', borderColor: '#bfdbfe' },
  siteItemHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  siteName: { fontSize: 14, fontWeight: '700', color: NAVY, flex: 1, marginRight: 8 },
  distanceBadge: { backgroundColor: NAVY, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  distanceText: { fontSize: 10, color: '#fff', fontWeight: '700' },
  siteAddress: { fontSize: 12, color: '#64748b', marginBottom: 3 },
  sitePlace: { fontSize: 11, color: '#94a3b8', marginBottom: 3 },
  sitePhone: { fontSize: 11, color: '#64748b' },
  detailBlock: { marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#dbeafe' },
  detailLine: { fontSize: 12, color: '#1e3a8a', marginBottom: 6 },
  detailNotes: { fontSize: 12, color: '#475569', lineHeight: 17, marginBottom: 8 },
  actionRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: NAVY,
    paddingVertical: 9,
    paddingHorizontal: 16,
    borderRadius: 20,
    gap: 6,
  },
  actionBtnAlt: { backgroundColor: '#e0e7ff' },
  actionBtnText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 39, 71, 0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  permissionCard: {
    backgroundColor: '#fff',
    borderRadius: 24,
    padding: 24,
    alignItems: 'center',
    width: '100%',
    maxWidth: 420,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowOffset: { width: 0, height: 10 },
    shadowRadius: 15,
    elevation: 10,
  },
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  permissionTitle: { fontSize: 20, fontWeight: '800', color: NAVY, marginBottom: 8, textAlign: 'center' },
  permissionDesc: {
    fontSize: 14,
    color: '#64748b',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
    paddingHorizontal: 10,
  },
  allowButton: { backgroundColor: NAVY, width: '100%', paddingVertical: 14, borderRadius: 30, alignItems: 'center', marginBottom: 10 },
  allowButtonText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  denyButton: { paddingVertical: 12, width: '100%', alignItems: 'center' },
  denyButtonText: { color: '#64748b', fontSize: 14, fontWeight: '600' },
})
