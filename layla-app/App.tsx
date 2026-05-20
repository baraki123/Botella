import { StatusBar } from "expo-status-bar";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

import { ChatScreen } from "./src/chat/ChatScreen";
import { loadCachedSession, type Session } from "./src/auth/anonymous";
import { SignInScreen } from "./src/auth/SignInScreen";
import { PeopleScreen } from "./src/people/PeopleScreen";
import { SettingsScreen } from "./src/settings/SettingsScreen";
import { theme } from "./src/config/theme";
import { registerForPushNotifications } from "./src/push/registerPush";

type Route = "signin" | "chat" | "settings" | "people";

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [route, setRoute] = useState<Route>("signin");
  // Deep-link queue: when People taps "+" or "Talk about X", we queue
  // the text here, switch route → "chat", and ChatScreen sends it
  // (then calls onPendingConsumed to clear). Plain prop drilling beats
  // pulling in a state lib for one signal.
  const [pendingChatMessage, setPendingChatMessage] = useState<string | null>(null);
  // Companion focus-id slot. When People→"Talk about Maya" enters chat,
  // we send `callback_data: "__focus_person:<id>"` on the queued WS
  // frame so the brain's free_chat pins Maya as the turn's focus.
  // Cleared together with the message via onPendingConsumed.
  const [pendingFocusPersonId, setPendingFocusPersonId] = useState<string | null>(null);

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

  // Keep ChatScreen mounted whenever we have a session — Settings overlays
  // on top instead of swapping. Unmounting ChatScreen wipes its message
  // state, so coming back from Settings would land on an empty thread.
  let body;
  if (loading) {
    body = (
      <View style={styles.loading}>
        <ActivityIndicator />
      </View>
    );
  } else if (!session || route === "signin") {
    body = <SignInScreen onSignedIn={handleSignedIn} />;
  } else {
    body = (
      <View style={styles.fill}>
        <ChatScreen
          onOpenSettings={() => setRoute("settings")}
          onOpenPeople={() => setRoute("people")}
          pendingMessage={pendingChatMessage}
          pendingFocusPersonId={pendingFocusPersonId}
          onPendingConsumed={() => {
            setPendingChatMessage(null);
            setPendingFocusPersonId(null);
          }}
        />
        {route === "settings" ? (
          <View style={StyleSheet.absoluteFillObject}>
            <SettingsScreen
              onSignedOut={handleSignedOut}
              onClose={() => setRoute("chat")}
            />
          </View>
        ) : null}
        {route === "people" ? (
          <View style={StyleSheet.absoluteFillObject}>
            <PeopleScreen
              jwt={session.jwt}
              onClose={() => setRoute("chat")}
              onSendToChat={(text, focusPersonId) => {
                setPendingChatMessage(text);
                setPendingFocusPersonId(focusPersonId ?? null);
                setRoute("chat");
              }}
            />
          </View>
        ) : null}
      </View>
    );
  }

  // SafeAreaView only owns the TOP edge here. The chat screen owns its own
  // bottom inset via useSafeAreaInsets so it can hand the right offset to
  // the KeyboardAvoidingView — otherwise the home-indicator inset gets
  // double-counted and the iOS QuickType bar covers the input.
  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.root} edges={["top"]}>
        <StatusBar style="light" />
        {body}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  fill: { flex: 1 },
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
});
