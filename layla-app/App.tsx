import { StatusBar } from "expo-status-bar";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, SafeAreaView, StyleSheet, View } from "react-native";

import { ChatScreen } from "./src/chat/ChatScreen";
import { loadCachedSession, type Session } from "./src/auth/anonymous";
import { SignInScreen } from "./src/auth/SignInScreen";
import { SettingsScreen } from "./src/settings/SettingsScreen";
import { theme } from "./src/config/theme";
import { registerForPushNotifications } from "./src/push/registerPush";

type Route = "signin" | "chat" | "settings";

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [route, setRoute] = useState<Route>("signin");

  useEffect(() => {
    let cancelled = false;
    loadCachedSession().then((s) => {
      if (!cancelled) {
        setSession(s);
        setRoute(s ? "chat" : "signin");
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Best-effort push registration whenever we have a fresh session — covers
  // first sign-in, app upgrade (existing user picks up the new permission
  // flow), and account-link/switch (new JWT registers under the new user).
  // Failure is silent: the user just won't get morning push.
  useEffect(() => {
    if (session) {
      registerForPushNotifications({ jwt: session.jwt }).catch(() => {});
    }
  }, [session?.userId, session?.jwt]);

  function handleSignedIn(s: Session) {
    setSession(s);
    setRoute("chat");
  }

  function handleSignedOut() {
    setSession(null);
    setRoute("signin");
  }

  let body;
  if (loading) {
    body = (
      <View style={styles.loading}>
        <ActivityIndicator />
      </View>
    );
  } else if (route === "signin" || !session) {
    body = <SignInScreen onSignedIn={handleSignedIn} />;
  } else if (route === "settings") {
    body = <SettingsScreen onSignedOut={handleSignedOut} />;
  } else {
    body = <ChatScreen onOpenSettings={() => setRoute("settings")} />;
  }

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style="light" />
      {body}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
});
