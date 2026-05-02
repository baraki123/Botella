import { StatusBar } from "expo-status-bar";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, SafeAreaView, StyleSheet, View } from "react-native";

import { ChatScreen } from "./src/chat/ChatScreen";
import { loadCachedSession, type Session } from "./src/auth/anonymous";
import { SignInScreen } from "./src/auth/SignInScreen";
import { theme } from "./src/config/theme";

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    loadCachedSession().then((s) => {
      if (!cancelled) {
        setSession(s);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  let body;
  if (loading) {
    body = (
      <View style={styles.loading}>
        <ActivityIndicator />
      </View>
    );
  } else if (!session) {
    body = <SignInScreen onSignedIn={setSession} />;
  } else {
    body = <ChatScreen />;
  }

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style="auto" />
      {body}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
});
