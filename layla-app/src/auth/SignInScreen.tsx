/**
 * Pre-chat sign-in screen.
 *
 * Visual: dark twilight canvas. Large italic-serif "Layla" mark, then a
 * single line of her voice as a tagline. Two ways in — Apple (iOS only)
 * and a quiet "stay anonymous" text link beneath. App Store policy 4.8
 * is satisfied trivially: Apple is the only third-party sign-in shown,
 * and it's primary.
 */
import * as AppleAuthentication from "expo-apple-authentication";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { product } from "../config/product";
import { theme } from "../config/theme";
import { ensureSession, type Session } from "./anonymous";
import { appleSignInAvailable, signInWithApple } from "./apple";

export interface SignInScreenProps {
  onSignedIn: (session: Session) => void;
}

export function SignInScreen({ onSignedIn }: SignInScreenProps) {
  const [appleAvailable, setAppleAvailable] = useState(false);
  const [busy, setBusy] = useState<"apple" | "anonymous" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    appleSignInAvailable().then(setAppleAvailable);
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
      <View style={styles.hero}>
        <Text style={styles.title}>{product.name}</Text>
        <View style={styles.divider} />
        <Text style={styles.tag}>{product.greeting}</Text>
      </View>

      <View style={styles.actions}>
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
      </View>
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
  hero: { marginTop: 72, alignItems: "flex-start" },
  title: {
    fontSize: 72,
    fontFamily: theme.fontSerifItalic,
    color: theme.text,
    marginBottom: 18,
    letterSpacing: 0.5,
  },
  divider: {
    width: 36,
    height: 1.5,
    backgroundColor: theme.accent,
    marginBottom: 22,
    opacity: 0.7,
  },
  tag: {
    fontSize: 17,
    lineHeight: 26,
    color: theme.textSubtle,
    maxWidth: 380,
  },
  actions: { gap: 18, marginBottom: 16 },
  appleBtn: { width: "100%", height: 48 },
  skip: {
    alignItems: "center",
    paddingVertical: 14,
  },
  skipPressed: { opacity: 0.5 },
  skipLabel: {
    fontSize: 15,
    color: theme.accent,
    letterSpacing: 0.6,
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
