/**
 * Pre-chat sign-in screen.
 *
 * Visual: dark twilight canvas with a quiet starfield + a soft golden
 * glow behind the brand mark. The "Layla" wordmark fades up from below,
 * the gold divider draws across like a thread of candlelight, then her
 * tagline settles in. Two ways in — Apple (iOS only) and a "stay
 * anonymous" link beneath. App Store policy 4.8 is satisfied trivially:
 * Apple is the only third-party sign-in shown, and it's primary.
 */
import * as AppleAuthentication from "expo-apple-authentication";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { Glow } from "../chat/atmosphere/Glow";
import { Starfield } from "../chat/atmosphere/Starfield";
import { product } from "../config/product";
import { theme } from "../config/theme";
import { useReducedMotion } from "../lib/useReducedMotion";
import { ensureSession, type Session } from "./anonymous";
import { appleSignInAvailable, signInWithApple } from "./apple";

export interface SignInScreenProps {
  onSignedIn: (session: Session) => void;
}

export function SignInScreen({ onSignedIn }: SignInScreenProps) {
  const [appleAvailable, setAppleAvailable] = useState(false);
  const [busy, setBusy] = useState<"apple" | "anonymous" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reduced = useReducedMotion();

  const titleFade = useRef(new Animated.Value(reduced ? 1 : 0)).current;
  const titleLift = useRef(new Animated.Value(reduced ? 0 : 18)).current;
  const dividerScale = useRef(new Animated.Value(reduced ? 1 : 0)).current;
  const tagFade = useRef(new Animated.Value(reduced ? 1 : 0)).current;
  const actionsFade = useRef(new Animated.Value(reduced ? 1 : 0)).current;

  useEffect(() => {
    appleSignInAvailable().then(setAppleAvailable);

    if (reduced) return;
    Animated.sequence([
      // Title fades up first.
      Animated.parallel([
        Animated.timing(titleFade, {
          toValue: 1,
          duration: 700,
          delay: 200,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(titleLift, {
          toValue: 0,
          duration: 800,
          delay: 200,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
      // Then the divider draws across (scaleX 0 → 1).
      Animated.timing(dividerScale, {
        toValue: 1,
        duration: 700,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      // Tagline + actions settle in last.
      Animated.parallel([
        Animated.timing(tagFade, {
          toValue: 1,
          duration: 600,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(actionsFade, {
          toValue: 1,
          duration: 600,
          delay: 100,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
    ]).start();
    // mount-only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function tryApple() {
    setError(null);
    setBusy("apple");
    try {
      const session = await signInWithApple({});
      onSignedIn(session);
    } catch (e: any) {
      if (e?.code === "ERR_REQUEST_CANCELED") {
        // Apple's user-cancel — silent.
      } else {
        setError(e?.message ?? String(e));
      }
    } finally {
      setBusy(null);
    }
  }

  async function tryAnonymous() {
    setError(null);
    setBusy("anonymous");
    try {
      const session = await ensureSession();
      onSignedIn(session);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <View style={styles.root}>
      {/* Atmosphere — sits behind the title, gives it presence. */}
      <Glow corner="top-left" intensity={0.32} />
      <Starfield introDelay={500} />

      <View style={styles.hero}>
        <Animated.Text
          style={[
            styles.title,
            { opacity: titleFade, transform: [{ translateY: titleLift }] },
          ]}
        >
          {product.name}
        </Animated.Text>
        <Animated.View
          style={[
            styles.divider,
            {
              transform: [{ scaleX: dividerScale }],
            },
          ]}
        />
        <Animated.Text style={[styles.tag, { opacity: tagFade }]}>
          {product.greeting}
        </Animated.Text>
      </View>

      <Animated.View style={[styles.actions, { opacity: actionsFade }]}>
        {appleAvailable ? (
          <AppleAuthentication.AppleAuthenticationButton
            buttonType={
              AppleAuthentication.AppleAuthenticationButtonType.CONTINUE
            }
            buttonStyle={
              AppleAuthentication.AppleAuthenticationButtonStyle.WHITE_OUTLINE
            }
            cornerRadius={12}
            style={styles.appleBtn}
            onPress={tryApple}
          />
        ) : null}

        <Pressable
          onPress={tryAnonymous}
          disabled={busy !== null}
          style={({ pressed }) => [
            styles.skip,
            pressed && styles.skipPressed,
          ]}
        >
          {busy === "anonymous" ? (
            <ActivityIndicator color={theme.accent} />
          ) : (
            <Text style={styles.skipLabel}>
              {appleAvailable ? "Just open the door" : "Begin"}
            </Text>
          )}
        </Pressable>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {Platform.OS !== "ios" && !appleAvailable ? (
          <Text style={styles.note}>
            Sign in with Apple is iOS only. You'll start anonymously here —
            we'll keep what you tell us, and you can attach an Apple account
            later.
          </Text>
        ) : null}

        <Text style={styles.privacy}>
          Everything you share with Layla is private to you.
        </Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: theme.bg,
    paddingHorizontal: 28,
    paddingVertical: 48,
    justifyContent: "space-between",
  },
  hero: { marginTop: 76, alignItems: "flex-start" },
  title: {
    fontSize: 76,
    fontFamily: theme.fontSerifItalic,
    color: theme.text,
    marginBottom: 22,
    letterSpacing: 0.5,
    // Whisper-soft gold halo behind the title — feels like the wordmark
    // is catching candlelight, not glowing neon.
    textShadowColor: "rgba(212,165,116,0.35)",
    textShadowRadius: 18,
    textShadowOffset: { width: 0, height: 0 },
  },
  divider: {
    width: 56,
    height: 1.5,
    backgroundColor: theme.accent,
    marginBottom: 26,
    opacity: 0.85,
    transformOrigin: "left",
    // Inset the scaleX origin to the left so the line "draws" from the
    // wordmark outward, not from the middle out. RN supports this on
    // recent versions; older ones still get a centered scale, which is
    // fine.
    shadowColor: theme.accent,
    shadowOpacity: 0.5,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
  },
  tag: {
    fontSize: 17,
    lineHeight: 26,
    color: theme.textSubtle,
    maxWidth: 380,
  },
  actions: { gap: 18, marginBottom: 16 },
  appleBtn: { width: "100%", height: 50 },
  skip: {
    alignItems: "center",
    paddingVertical: 14,
  },
  skipPressed: { opacity: 0.55 },
  skipLabel: {
    fontSize: 15,
    color: theme.accent,
    letterSpacing: 0.6,
    fontFamily: theme.fontSerifItalic,
  },
  error: {
    color: "#C97777",
    fontSize: 13,
    textAlign: "center",
  },
  note: {
    color: theme.textMuted,
    fontSize: 12,
    textAlign: "center",
    lineHeight: 17,
  },
  privacy: {
    color: theme.textMuted,
    fontSize: 12,
    textAlign: "center",
    fontFamily: theme.fontSerifItalic,
    letterSpacing: 0.3,
    marginTop: 8,
  },
});
