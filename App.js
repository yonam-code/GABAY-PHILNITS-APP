import React, { useEffect, useState, useRef } from 'react'
import { ActivityIndicator, Animated, AppState, Image, StyleSheet, Text, View } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { NavigationContainer, useNavigationContainerRef, DefaultTheme } from '@react-navigation/native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import Onboarding from './screens/onboarding/Onboarding'
import Login from './screens/authentication/Login'
import PersonalInfo from './screens/onboarding/PersonalInfo'
import DiagnosticAssessment from './screens/onboarding/DiagnosticAssessment'
import Home from './screens/navigations/home/Home'
import StudyPlan from './screens/navigations/study/StudyPlan'
import Library from './screens/navigations/study/Library'
import ReadingMaterial from './screens/navigations/study/ReadingMaterial'
import VideoLectureDetail from './screens/navigations/study/VideoLectureDetail'
import RecentReads from './screens/navigations/study/RecentReads'
import Register from './screens/authentication/Register'
import SetPin from './screens/authentication/SetPin'
import PinAuth from './screens/authentication/PinAuth'
import PracticeLibraryScreen from './screens/navigations/practice/PracticeLibraryScreen.js'
import Flashcards from './screens/navigations/practice/Flashcards.js'
import Matching from './screens/navigations/practice/Matching'
import TrueFalse from './screens/navigations/practice/TrueFalse'
import MultipleChoice from './screens/navigations/practice/MultipleChoice'
import MockExamHome from './screens/navigations/practice/MockExamHome'
import MockExamTake from './screens/navigations/practice/MockExamTake'
import MockExamResult from './screens/navigations/practice/MockExamResult'
import PracticeOverview from './screens/navigations/practice/PracticeOverview'
import PracticeResult from './screens/navigations/practice/PracticeResult'
import Performance from './screens/navigations/performance/Performance'
import Profile from './screens/navigations/profile/Profile'
import AccountInformation from './screens/navigations/profile/AccountInformation'
import Settings from './screens/navigations/profile/Settings'
import HelpCenter from './screens/navigations/profile/HelpCenter'
import Report from './screens/navigations/profile/Report'
import TermsConditions from './screens/navigations/profile/TermsConditions'
import RateApp from './screens/navigations/profile/RateApp'
import AboutApp from './screens/navigations/profile/AboutApp'
import CseGuide from './screens/navigations/profile/CseGuide'
import CseSitesNearMe from './screens/navigations/profile/CseSitesNearMe'
import ActivityCalendar from './screens/navigations/home/ActivityCalendar'
import { Feather } from '@expo/vector-icons'
import BottomNav from './components/BottomNav'
import EdgeHandleAI from './components/EdgeHandleAI'
import OfflineToast from './components/OfflineToast'
import NotificationToast from './components/NotificationToast'
import { supabase } from './utils/supabase'
import NetInfo from '@react-native-community/netinfo'
import { initDb, getUserCache, saveUserCache, saveUserSession, getActiveUserSession, clearUserSession } from './utils/database'
import { clearCache } from './utils/cache'
import { processSyncQueue, addSyncListener, precachePracticeContent } from './utils/syncManager'
import { startRealtimeNotifications, stopRealtimeNotifications } from './utils/notificationManager'

const Stack = createNativeStackNavigator()

const navTheme = {
	...DefaultTheme,
	colors: {
		...DefaultTheme.colors,
		background: '#0f1e35',
	},
}

const NAV_SCREENS = new Set([
	'Home', 'Library',
	'PracticeLibrary', 'Performance', 'Profile', 'AccountInformation', 'Settings', 'HelpCenter', 'TermsConditions', 'AboutApp', 'CseGuide', 'CseSitesNearMe',
])

const MAIN_TAB_SCREENS = new Set([
	'Home', 'Library', 'PracticeLibrary', 'Performance', 'Profile',
])

export default function App() {
	const [loading, setLoading] = useState(true)
	const [currentRoute, setCurrentRoute] = useState('Login')
	const [initialRoute, setInitialRoute] = useState('Login')
	const [isOffline, setIsOffline] = useState(false)
	const [syncNotice, setSyncNotice] = useState(null)
	const navigationRef = useNavigationContainerRef()
	const fadeAnim = useRef(new Animated.Value(1)).current
	const backgroundVerifyRef = useRef(false)

	// Instant route from the local SQLite session. Only used when the user has already
	// finished personal info + diagnostic, so no network round trips are needed to start.
	const getFastLocalRoute = async () => {
		try {
			const localSession = await getActiveUserSession()
			if (!localSession?.user_id) return null
			const cachedData = await getUserCache(localSession.user_id)
			if (!cachedData?.personal_info_completed || !cachedData?.diagnostic_completed) return null
			const hasPin = Boolean(localSession.hasPin || (cachedData.pin_hash && String(cachedData.pin_hash).trim().length > 0))
			return hasPin ? 'PinAuth' : 'Home'
		} catch (_) {
			return null
		}
	}

	// Validates the remote session and refreshes the local cache AFTER the app is already visible.
	const verifySessionInBackground = async () => {
		const resetToLogin = async () => {
			await clearUserSession().catch(() => { })
			await clearCache().catch(() => { })
			await supabase.auth.signOut().catch(() => { })
			for (let i = 0; i < 20 && !navigationRef.isReady(); i++) {
				await new Promise(r => setTimeout(r, 100))
			}
			if (navigationRef.isReady()) {
				navigationRef.reset({ index: 0, routes: [{ name: 'Login' }] })
			}
		}
		try {
			const net = await NetInfo.fetch()
			if (!net.isConnected) return
			const { data, error } = await supabase.auth.getSession()
			if (error) {
				const errMsg = (error.message || '').toLowerCase()
				if (errMsg.includes('refresh token') || error.status === 400) await resetToLogin()
				return
			}
			const activeUser = data?.session?.user
			if (!activeUser) {
				await resetToLogin()
				return
			}
			const [personalRes, userRes] = await Promise.all([
				supabase.from('personal_info').select('user_id, target_exam_level').eq('user_id', activeUser.id).maybeSingle(),
				supabase.from('users').select('pin_hash').ilike('email', activeUser.email).maybeSingle(),
			])
			// Only overwrite the cache if the queries actually succeeded
			if (personalRes?.error || userRes?.error) return
			const pinHash = userRes?.data?.pin_hash && String(userRes.data.pin_hash).trim() ? userRes.data.pin_hash : null
			await saveUserCache(activeUser.id, pinHash, true, true)
			await saveUserSession(activeUser, {
				pin_hash: pinHash,
				target_exam_level: personalRes?.data?.target_exam_level || '',
			})
		} catch (e) {
			const msg = String(e?.message || e).toLowerCase()
			if (msg.includes('refresh token')) await resetToLogin()
			else console.warn('Background session verification failed:', e?.message || e)
		}
	}

	const determineInitialRoute = async () => {
		try {
			const netState = await NetInfo.fetch()
			const isOnline = Boolean(netState.isConnected)
			setIsOffline(!isOnline)

			// Fast path: known, fully-onboarded user -> start instantly, verify in the background
			if (isOnline) {
				const fastRoute = await getFastLocalRoute()
				if (fastRoute) {
					backgroundVerifyRef.current = true
					return fastRoute
				}
			}

			let activeUser = null

			// 1. If online, check Supabase session
			if (isOnline) {
				try {
					const { data, error } = await supabase.auth.getSession()
					if (error) {
						const errMsg = error.message || ''
						if (errMsg.toLowerCase().includes('refresh token') || error.status === 400) {
							console.warn('Stale/invalid refresh token detected, purging local session:', errMsg)
							await clearUserSession().catch(() => { })
							await clearCache().catch(() => { })
							await supabase.auth.signOut().catch(() => { })
							return 'Login'
						}
					} else if (data?.session?.user) {
						activeUser = data.session.user
						await saveUserSession(data.session.user)
					}
				} catch (netErr) {
					console.warn('Network issue fetching session, will check local cache:', netErr)
					const errMsg = netErr?.message || ''
					if (errMsg.toLowerCase().includes('refresh token')) {
						await clearUserSession().catch(() => { })
						await clearCache().catch(() => { })
						await supabase.auth.signOut().catch(() => { })
						return 'Login'
					}
				}
			}

			// 2. If offline or no remote session returned, check cached user session in SQLite
			if (!activeUser) {
				const localSession = await getActiveUserSession()
				if (localSession?.user_id) {
					const cachedData = await getUserCache(localSession.user_id)
					if (cachedData) {
						if (!cachedData.personal_info_completed) return 'PersonalInfo'
						if (!cachedData.diagnostic_completed) return 'DiagnosticAssessment'
					}
					const hasCachedPin = Boolean(localSession.hasPin || (cachedData?.pin_hash && String(cachedData.pin_hash).trim().length > 0))
					return hasCachedPin ? 'PinAuth' : 'Home'
				}
			}

			if (activeUser) {
				const userId = activeUser.id

				if (!isOnline) {
					const cachedData = await getUserCache(userId)
					if (cachedData) {
						if (!cachedData.personal_info_completed) return 'PersonalInfo'
						if (!cachedData.diagnostic_completed) return 'DiagnosticAssessment'
						const hasCachedPin = Boolean(cachedData.pin_hash && String(cachedData.pin_hash).trim().length > 0)
						return hasCachedPin ? 'PinAuth' : 'Home'
					}
					return 'Home'
				}

				// Run the three completion checks in parallel instead of one after another
				const [personalRes, diagnosticRes, pinRes] = await Promise.all([
					supabase.from('personal_info').select('user_id, target_exam_level').eq('user_id', userId).maybeSingle(),
					supabase.from('diagnostic_assessment_attempts').select('id').eq('user_id', userId).limit(1).maybeSingle(),
					supabase.from('users').select('pin_hash').ilike('email', activeUser.email).maybeSingle(),
				])
				const personalInfoData = personalRes?.data

				if (!personalInfoData) {
					await saveUserCache(userId, null, false, false)
					return 'PersonalInfo'
				}

				const diagnosticData = diagnosticRes?.data

				if (!diagnosticData) {
					await saveUserCache(userId, null, true, false)
					return 'DiagnosticAssessment'
				}

				// Check if user has a PIN — if so, gate with PinAuth
				const userData = pinRes?.data

				const hasPin = Boolean(userData?.pin_hash && String(userData.pin_hash).trim().length > 0)
				await saveUserCache(userId, hasPin ? userData.pin_hash : null, true, true)
				await saveUserSession(activeUser, {
					pin_hash: hasPin ? userData.pin_hash : null,
					target_exam_level: personalInfoData.target_exam_level || ''
				})
				return hasPin ? 'PinAuth' : 'Home'
			}

			// 3. If not logged in, check onboarding
			const onboardingComplete = await AsyncStorage.getItem('onboardingComplete')
			if (onboardingComplete === 'true') {
				return 'Login'
			} else {
				return 'Onboarding'
			}
		} catch (err) {
			console.warn('Error determining initial route:', err)
			return 'Onboarding'
		}
	}

	useEffect(() => {
		const init = async () => {
			await initDb()
			const route = await determineInitialRoute()
			setInitialRoute(route)
			setCurrentRoute(route)

			// Smooth immediate transition once initial route is ready
			Animated.timing(fadeAnim, {
				toValue: 0,
				duration: 350,
				useNativeDriver: true,
			}).start(() => {
				setLoading(false)
				if (backgroundVerifyRef.current) {
					backgroundVerifyRef.current = false
					verifySessionInBackground()
				}
			})
		}
		init()
	}, [fadeAnim])

	useEffect(() => {
		const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
			if (event === 'SIGNED_OUT') {
				// Purge all user cache immediately upon logout
				try {
					await clearUserSession()
					await clearCache()
				} catch (e) {
					console.warn('Error clearing cache on sign out:', e?.message || e)
				}
				if (navigationRef.isReady()) {
					navigationRef.reset({
						index: 0,
						routes: [{ name: 'Login' }],
					})
				}
			} else if (event === 'TOKEN_REFRESHED') {
				// Token refreshed successfully — nothing to do
			} else if (event === 'TOKEN_REFRESH_ERROR') {
				// Refresh token is invalid/expired — clear session immediately to avoid loops
				console.warn('Refresh token invalid/expired, signing out and clearing local cache...')
				try {
					await clearUserSession()
					await clearCache()
					await supabase.auth.signOut()
				} catch (err) {
					console.warn('Sign out error on refresh error:', err?.message || err)
				}
				if (navigationRef.isReady()) {
					navigationRef.reset({
						index: 0,
						routes: [{ name: 'Login' }],
					})
				}
			}
		})

		return () => {
			subscription?.unsubscribe()
		}
	}, [])

	useEffect(() => {
		const unsubscribeNet = NetInfo.addEventListener(state => {
			const offline = !state.isConnected
			setIsOffline(offline)
			if (!offline) {
				processSyncQueue()
				// Download practice content for offline use shortly after connecting (throttled to once / 12h)
				setTimeout(() => { precachePracticeContent().catch(() => {}) }, 5000)
			}
		})

		// Flush queued offline changes whenever the app returns to the foreground
		const appStateSub = AppState.addEventListener('change', (nextState) => {
			if (nextState === 'active') processSyncQueue()
		})

		const unsubscribeSync = addSyncListener(({ status }) => {
			if (status === 'SYNCING') {
				setSyncNotice('syncing')
			} else if (status === 'COMPLETED') {
				setSyncNotice('synced')
				setTimeout(() => setSyncNotice(null), 3500)
			}
		})

		return () => {
			unsubscribeNet()
			unsubscribeSync()
			appStateSub.remove()
		}
	}, [])

	useEffect(() => {
		startRealtimeNotifications()
		return () => {
			stopRealtimeNotifications()
		}
	}, [])

	const activeRoute = navigationRef.isReady() ? navigationRef.getCurrentRoute() : null
	const activeRouteName = activeRoute?.name || currentRoute
	const showNav = NAV_SCREENS.has(activeRouteName) && !(activeRoute?.params?.hideNav)
	const showEdgeHandle = MAIN_TAB_SCREENS.has(activeRouteName) && !(activeRoute?.params?.hideNav)

	if (loading) {
		return (
			<View style={styles.loadingContainer}>
				<Animated.Image
					source={require('./assets/logo_text_dark.png')}
					style={[styles.splashImage, { opacity: fadeAnim }]}
					resizeMode="contain"
				/>
			</View>
		)
	}

	return (
		<SafeAreaProvider>
			<View style={styles.root}>
				{/* Global Realtime Notification Toaster (Active on all pages) */}
				<NotificationToast navigationRef={navigationRef} />

				{/* Floating Offline / Sync Toaster UI */}
				<OfflineToast isOffline={isOffline} syncNotice={syncNotice} />

				<NavigationContainer
					ref={navigationRef}
					theme={navTheme}
					onReady={() => {
						const name = navigationRef.getCurrentRoute()?.name
						if (name) setCurrentRoute(name)
					}}
					onStateChange={() => {
						const name = navigationRef.getCurrentRoute()?.name
						if (name) setCurrentRoute(name)
					}}
				>
					<Stack.Navigator
						screenOptions={{
							headerShown: false,
							animation: 'fade_from_bottom',
						}}
						initialRouteName={initialRoute}
					>
						<Stack.Screen name="Onboarding" component={Onboarding} />
						<Stack.Screen name="Login" component={Login} options={{ animation: 'fade_from_bottom' }} />
						<Stack.Screen name="Register" component={Register} options={{ animation: 'fade_from_bottom' }} />
						<Stack.Screen name="SetPin" component={SetPin} options={{ animation: 'slide_from_bottom' }} />
						<Stack.Screen name="PinAuth" component={PinAuth} options={{ animation: 'fade', gestureEnabled: false }} />
						<Stack.Screen name="PersonalInfo" component={PersonalInfo} options={{ gestureEnabled: false }} />
						<Stack.Screen name="DiagnosticAssessment" component={DiagnosticAssessment} options={{ gestureEnabled: false }} />
						<Stack.Screen name="StudyPlan" component={StudyPlan} />
						<Stack.Screen name="Library" component={Library} />
						<Stack.Screen name="ReadingMaterial" component={ReadingMaterial} options={{ animation: 'fade_from_bottom' }} />
						<Stack.Screen name="RecentReads" component={RecentReads} options={{ animation: 'fade_from_bottom' }} />
						<Stack.Screen name="VideoLectureDetail" component={VideoLectureDetail} options={{ animation: 'fade_from_bottom' }} />
						<Stack.Screen name="Home" component={Home} />
						<Stack.Screen name="PracticeLibrary" component={PracticeLibraryScreen} />
						<Stack.Screen name="Flashcards" component={Flashcards} />
						<Stack.Screen name="Matching" component={Matching} />
						<Stack.Screen name="TrueFalse" component={TrueFalse} />
						<Stack.Screen name="MultipleChoice" component={MultipleChoice} />
						<Stack.Screen name="MockExamHome" component={MockExamHome} />
						<Stack.Screen name="MockExamTake" component={MockExamTake} />
						<Stack.Screen name="MockExamResult" component={MockExamResult} />
						<Stack.Screen name="PracticeOverview" component={PracticeOverview} />
						<Stack.Screen name="PracticeResult" component={PracticeResult} />
						<Stack.Screen name="Performance" component={Performance} />
						<Stack.Screen name="Profile" component={Profile} />
						<Stack.Screen name="AccountInformation" component={AccountInformation} />
						<Stack.Screen name="Settings" component={Settings} />
						<Stack.Screen name="HelpCenter" component={HelpCenter} />
						<Stack.Screen name="Report" component={Report} />
						<Stack.Screen name="TermsConditions" component={TermsConditions} />
						<Stack.Screen name="RateApp" component={RateApp} />
						<Stack.Screen name="AboutApp" component={AboutApp} />
						<Stack.Screen name="CseGuide" component={CseGuide} />
						<Stack.Screen name="CseSitesNearMe" component={CseSitesNearMe} />
						<Stack.Screen name="ActivityCalendar" component={ActivityCalendar} />
					</Stack.Navigator>
				</NavigationContainer>

				{/* Floating Edge Handle for GABAY AI Assistant */}
				{showEdgeHandle && <EdgeHandleAI side="right" />}

				{/* BottomNav lives OUTSIDE the navigator so it is never animated by screen transitions */}
				{showNav && (
					<BottomNav navigation={navigationRef} activeRoute={currentRoute} />
				)}
			</View>
		</SafeAreaProvider>
	)
}

const styles = StyleSheet.create({
	root: {
		flex: 1,
		backgroundColor: '#fff',
	},
	loadingContainer: {
		flex: 1,
		justifyContent: 'center',
		alignItems: 'center',
		backgroundColor: '#f5f7fb',
	},
	splashImage: {
		width: '75%',
		height: '75%',
	},
})
