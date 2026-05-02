/**
 * Pre-chat sign-in screen.
 *
 * App Store policy (4.8 Sign In with Apple): if the app uses any third-party
 * sign-in (Google/Facebook/etc), Apple Sign-In must also be offered. This
 * project starts with Apple-or-anonymous, which satisfies the policy
 * trivially. Adding Google later means adding Apple stays first.
 *
 * Design: this screen is intentionally bare. The hero is the product name
 * + a short tagline; the buttons are the only chrome. Apple's HIG requires
 * the AppleAuthenticationButton component on iOS — it handles dark mode,
 * RTL, and is the only blessed way to brand "Sign in with Apple."
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
      // Apple's user-cancel error is well-known; don't show it.
      const code = e?.code;
      if (code === "ERR_REQUEST_CANCELED") {
        // Cancelled — silent.
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
        <Text style={styles.tag}>{product.greeting}</Text>
      </View>

      <View style={styles.actions}>
        {appleAvailable ? (
          <AppleAuthentication.AppleAuthenticationButton
            buttonType={
              AppleAuthentication.AppleAuthenticationButtonType.CONTINUE
            }
            buttonStyle={
              AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
            }
            cornerRadius={theme.radius}
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
            <ActivityIndicator />
          ) : (
            <Text style={styles.skipLabel}>Continue without an account</Text>
          )}
        </Pressable>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {Platform.OS !== "ios" && !appleAvailable ? (
          <Text style={styles.note}>
            Sign in with Apple is iOS-only. On this device you'll start
            anonymously; you can link an Apple account later from Settings.
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: theme.bg,
    paddingHorizontal: 24,
    paddingVertical: 36,
    justifyContent: "space-between",
  },
  hero: { marginTop: 64 },
  title: {
    fontSize: 36,
    fontWeight: "600" as const,
    color: theme.text,
    marginBottom: theme.spacing,
  },
  tag: {
    fontSize: 16,
    lineHeight: 22,
    color: theme.textSubtle,
  },
  actions: { gap: theme.spacing, marginBottom: 36 },
  appleBtn: { width: "100%", height: 48 },
  skip: {
    alignItems: "center",
    paddingVertical: theme.spacing,
    borderRadius: theme.radius,
    borderWidth: 1,
    borderColor: theme.border,
  },
  skipPressed: { opacity: 0.6 },
  skipLabel: {
    fontSize: 15,
    color: theme.text,
  },
  error: {
    color: "#B91C1C",
    fontSize: 13,
    textAlign: "center",
  },
  note: {
    color: theme.textSubtle,
    fontSize: 12,
    textAlign: "center",
    lineHeight: 16,
  },
});
