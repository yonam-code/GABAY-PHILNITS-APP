import React, { useEffect, useRef, useState } from 'react'
import { Keyboard, KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native'

/**
 * Drop-in replacement for KeyboardAvoidingView that works on Android edge-to-edge builds.
 *
 * Why: since Android 15 (and Expo SDK 54+) apps are always edge-to-edge, so the old
 * `adjustResize` window behaviour no longer lifts content above the keyboard and
 * `KeyboardAvoidingView behavior={undefined}` does nothing. Inputs (and the text being typed)
 * end up hidden behind the keyboard.
 *
 * How: on Android we measure how much the keyboard really overlaps THIS view and pad the bottom
 * by exactly that amount. If the OS already resized the window the overlap is 0, so there is never
 * double padding. iOS keeps the standard `padding` behaviour.
 *
 * Props: same as View, plus
 *  - keyboardVerticalOffset (iOS only, same as KeyboardAvoidingView)
 *  - idlePaddingBottom: bottom padding while the keyboard is hidden (e.g. safe-area inset)
 */
export default function KeyboardSafeView({
  style,
  children,
  keyboardVerticalOffset = 0,
  idlePaddingBottom = 0,
  behavior, // accepted for API compatibility, ignored
  ...rest
}) {
  if (Platform.OS === 'ios') {
    return (
      <KeyboardAvoidingView
        behavior="padding"
        keyboardVerticalOffset={keyboardVerticalOffset}
        style={[style, idlePaddingBottom ? { paddingBottom: idlePaddingBottom } : null]}
        {...rest}
      >
        {children}
      </KeyboardAvoidingView>
    )
  }
  return (
    <AndroidKeyboardSafeView style={style} idlePaddingBottom={idlePaddingBottom} {...rest}>
      {children}
    </AndroidKeyboardSafeView>
  )
}

function AndroidKeyboardSafeView({ style, children, idlePaddingBottom, ...rest }) {
  const ref = useRef(null)
  const [overlap, setOverlap] = useState(0)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const showSub = Keyboard.addListener('keyboardDidShow', (e) => {
      const keyboardTop = e?.endCoordinates?.screenY
      setVisible(true)
      if (!ref.current || typeof keyboardTop !== 'number') {
        // Fallback when geometry is unavailable: assume the keyboard overlaps by its full height
        setOverlap(e?.endCoordinates?.height || 0)
        return
      }
      ref.current.measureInWindow((x, y, w, h) => {
        // Our own padding sits INSIDE the view, so y + h is stable between keyboard changes
        const viewBottom = y + h
        setOverlap(Math.max(0, Math.round(viewBottom - keyboardTop)))
      })
    })
    const hideSub = Keyboard.addListener('keyboardDidHide', () => {
      setVisible(false)
      setOverlap(0)
    })
    return () => {
      showSub.remove()
      hideSub.remove()
    }
  }, [])

  // Keep any paddingBottom the caller set; while the keyboard is up use whichever is larger
  const ownPadding = StyleSheet.flatten(style)?.paddingBottom
  const basePadding = typeof ownPadding === 'number' ? ownPadding : 0
  let paddingStyle = null
  if (visible) paddingStyle = { paddingBottom: Math.max(basePadding, overlap) }
  else if (idlePaddingBottom) paddingStyle = { paddingBottom: Math.max(basePadding, idlePaddingBottom) }

  return (
    <View ref={ref} collapsable={false} style={[style, paddingStyle]} {...rest}>
      {children}
    </View>
  )
}
