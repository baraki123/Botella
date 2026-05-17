/**
 * Apple Sign-In nudge.
 *
 * After the user has sent 3+ messages while on an anonymous device-only
 * account, surface a quiet banner offering Apple Sign-In so their data
 * survives a phone wipe. One-shot per user — once they tap "Sign in" or
 * "Not now", the nudge stores a flag in AsyncStorage keyed by the user
 * id and never shows again for that user.
 *
 * iOS only — Android / web don't have Apple Sign-In. The banner is
 * dismissible (×) and never re-appears for that user. Per the UX plan,
 * we never block the chat — the nudge is overlaid in the safe area
 * just below the header with a soft slide-in.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Animated,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { loadCachedSession } from "./anonymous";
import {
  appleSignInAvailable,
  currentAuthProvider,
  signInWithApple,
} from "./apple";
import { theme } from "../config/theme";

const NUDGE_THRESHOLD = 3;

function nudgeKey(userId: string): string {
  return `layla:apple_signin_nudged:${userId}`;
}

interface Props {
  /** Internal user id of the active session. Required — the nudged flag
   * is keyed per-user so each fresh anon session gets its own one-shot. */
  userId: string;
  /** Number of user messages sent this session (we evaluate against
   * NUDGE_THRESHOLD). Cumulative — restored on session hydrate. */
  userMessageCount: number;
  /** Called when Apple Sign-In completes successfully so the host
   * (App.tsx) can refresh its session reference. */
  onLinked?: () => void;
}

export function AppleSignInNudge({
  userId,
  userMessageCount,
  onLinked,
}: Props) {
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const slide = useRef(new Animated.Value(0)).current;

  // One-shot evaluation: fire when the user crosses NUDGE_THRESHOLD,
  // only if (iOS + Apple available + currently anon + not nudged before).
  useEffect(() => {
    if (userMessageCount < NUDGE_THRESHOLD) return;
    if (Platform.OS !== "ios" && Platform.OS !== "web") return;
    let cancelled = false;
    (async () => {
      try {
        const [already, available, provider] = await Promise.all([
          AsyncStorage.getItem(nudgeKey(userId)),
          appleSignInAvailable(),
          currentAuthProvider(),
        ]);
        if (cancelled) return;
        if (already === "1") return;
        if (!available) return;
        if (provider && provider !== "anonymous") return;
        setVisible(true);
        Animated.timing(slide, {
          toValue: 1,
          duration: 480,
          useNativeDriver: true,
        }).start();
      } catch {
        // Best-effort — if any of the checks fail, just don't show.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, userMessageCount, slide]);

  const dismissForever = useCallback(async () => {
    Animated.timing(slide, {
      toValue: 0,
      duration: 280,
      useNativeDriver: true,
    }).start(() => setVisible(false));
    try {
      await AsyncStorage.setItem(nudgeKey(userId), "1");
    } catch {
      // Worst case: the user gets re-nudged next session. Acceptable.
    }
  }, [slide, userId]);

  const handleSignIn = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const session = await loadCachedSession();
      if (!session) throw new Error("not signed in yet");
      await signInWithApple({ linkAnonymousUserId: session.userId });
      // Mark nudged FIRST so even if onLinked unmounts us mid-animation,
      // the flag is persisted.
      try {
        await AsyncStorage.setItem(nudgeKey(userId), "1");
      } catch {}
      onLinked?.();
    } catch (e: any) {
      const code = e?.code;
      if (code !== "ERR_REQUEST_CANCELED") {
        Alert.alert("Couldn't link Apple", String(e?.message ?? e));
      }
    } finally {
      setBusy(false);
    }
  }, [busy, onLinked, userId]);

  if (!visible) return null;

  const translateY = slide.interpolate({
    inputRange: [0, 1],
    outputRange: [-14, 0],
  });

  return (
    <Animated.View
      style={[
        styles.banner,
        { opacity: slide, transform: [{ translateY }] },
      ]}
      pointerEvents="box-none"
    >
      <View style={styles.bannerInner}>
        <View style={styles.bannerText}>
          <Text style={styles.bannerTitle}>Keep this on every device.</Text>
          <Text style={styles.bannerBody}>
            Sign in with Apple so your map, conversations, and Orbit travel with you.
          </Text>
        </View>
        <View style={styles.bannerActions}>
          <Pressable
            onPress={handleSignIn}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="Sign in with Apple"
            testID="apple-nudge-signin"
            style={({ pressed }) => [
              styles.primaryBtn,
              pressed && { opacity: 0.85 },
            ]}
          >
            <Text style={styles.primaryBtnText}>
              {busy ? "Signing in…" : " Sign in with Apple"}
            </Text>
          </Pressable>
          <Pressable
            onPress={dismissForever}
            accessibilityRole="button"
            accessibilityLabel="Dismiss the Apple Sign-In nudge"
            testID="apple-nudge-dismiss"
            style={({ pressed }) => [
              styles.dismissBtn,
              pressed && { opacity: 0.6 },
            ]}
            hitSlop={10}
          >
            <Text style={styles.dismissBtnText}>Not now</Text>
          </Pressable>
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: "absolute",
    left: 12,
    right: 12,
    top: 6,
    borderRadius: 16,
    backgroundColor: theme.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(212,165,116,0.45)",
    paddingVertical: 14,
    paddingHorizontal: 16,
    shadowColor: theme.accent,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 18,
    elevation: 6,
    zIndex: 12,
  },
  bannerInner: {
    flexDirection: "column",
    gap: 12,
  },
  bannerText: {
    paddingRight: 8,
  },
  bannerTitle: {
    color: theme.text,
    fontSize: 15,
    fontFamily: theme.fontSerifItalic,
    letterSpacing: 0.4,
  },
  bannerBody: {
    color: theme.textSubtle,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 4,
  },
  bannerActions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  primaryBtn: {
    backgroundColor: "#000",
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.18)",
  },
  primaryBtnText: {
    color: "#F5EAE3",
    fontSize: 13,
    fontWeight: "600",
    letterSpacing: 0.2,
  },
  dismissBtn: {
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  dismissBtnText: {
    color: theme.textSubtle,
    fontSize: 13,
    fontStyle: "italic",
  },
});
