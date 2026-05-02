/**
 * Settings — required by App Store policy 5.1.1(v) for any app with sign-in.
 *
 * Includes:
 *  - Sign out (clears local session; doesn't delete the server-side data)
 *  - Delete account (calls DELETE /v1/account; permanent)
 *  - Privacy policy + Terms links (placeholder URLs — replace before
 *    submission)
 *  - Auth provider label (anonymous vs apple)
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { product } from "../config/product";
import { theme } from "../config/theme";
import { clearSession, loadCachedSession } from "../auth/anonymous";
import { currentAuthProvider } from "../auth/apple";

const PRIVACY_URL = "https://layla.app/privacy"; // TODO: real URL before submission
const TERMS_URL = "https://layla.app/terms";

export interface SettingsScreenProps {
  onSignedOut: () => void;
}

export function SettingsScreen({ onSignedOut }: SettingsScreenProps) {
  const [provider, setProvider] = useState<string | null>(null);
  const [busy, setBusy] = useState<"signout" | "delete" | null>(null);

  useEffect(() => {
    currentAuthProvider().then((p) => setProvider(p ?? "anonymous"));
  }, []);

  async function handleSignOut() {
    setBusy("signout");
    await clearSession();
    await AsyncStorage.removeItem("botella.authProvider");
    setBusy(null);
    onSignedOut();
  }

  async function handleDelete() {
    if (Platform.OS === "web") {
      // RN Alert isn't a real modal on web; use confirm()
      // @ts-ignore
      if (typeof window !== "undefined" && !window.confirm(
        "Delete your account? This will permanently remove your chart, " +
        "your people, your chat history, and your sign-in. This can't be undone."
      )) return;
      await deleteServerSide();
      return;
    }
    Alert.alert(
      "Delete account?",
      "This permanently removes your chart, your people, your chat " +
      "history, and your sign-in. This can't be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: deleteServerSide,
        },
      ],
    );
  }

  async function deleteServerSide() {
    setBusy("delete");
    try {
      const session = await loadCachedSession();
      if (!session) {
        // Already signed out — nothing to delete server-side.
        await handleSignOut();
        return;
      }
      const r = await fetch(`${product.apiUrl}/v1/account`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${session.jwt}` },
      });
      if (!r.ok && r.status !== 204) {
        throw new Error(`delete failed: ${r.status}`);
      }
      await clearSession();
      await AsyncStorage.removeItem("botella.authProvider");
      onSignedOut();
    } catch (e: any) {
      // On web fall back to alert(); on native we can use Alert
      if (Platform.OS === "web") {
        // @ts-ignore
        window.alert(`Couldn't delete: ${e?.message ?? e}`);
      } else {
        Alert.alert("Couldn't delete", String(e?.message ?? e));
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>Settings</Text>

      <Section title="Account">
        <Row label="Signed in with" value={provider === "apple" ? "Apple" : "Anonymous device"} />
        <ActionRow
          label="Sign out"
          onPress={handleSignOut}
          busy={busy === "signout"}
        />
        <ActionRow
          label="Delete account"
          destructive
          onPress={handleDelete}
          busy={busy === "delete"}
        />
      </Section>

      <Section title="About">
        <ActionRow label="Privacy policy" onPress={() => Linking.openURL(PRIVACY_URL)} />
        <ActionRow label="Terms of use" onPress={() => Linking.openURL(TERMS_URL)} />
      </Section>

      <Text style={styles.footer}>{product.name} · v1.0.0</Text>
    </ScrollView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.card}>{children}</View>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

function ActionRow({
  label,
  onPress,
  busy = false,
  destructive = false,
}: {
  label: string;
  onPress: () => void;
  busy?: boolean;
  destructive?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      style={({ pressed }) => [
        styles.row,
        pressed && styles.rowPressed,
      ]}
    >
      {busy ? (
        <ActivityIndicator />
      ) : (
        <Text style={[styles.rowAction, destructive && styles.destructive]}>{label}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  content: { padding: 20, paddingBottom: 60 },
  heading: {
    fontSize: 28,
    fontWeight: "600" as const,
    color: theme.text,
    marginBottom: 20,
  },
  section: { marginBottom: 20 },
  sectionTitle: {
    fontSize: 12,
    color: theme.textSubtle,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 8,
    marginLeft: 4,
  },
  card: {
    backgroundColor: theme.surface,
    borderRadius: theme.radius,
    borderWidth: 1,
    borderColor: theme.border,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.border,
  },
  rowPressed: { opacity: 0.6 },
  rowLabel: { fontSize: 15, color: theme.textSubtle },
  rowValue: { fontSize: 15, color: theme.text },
  rowAction: { fontSize: 15, color: theme.text },
  destructive: { color: "#B91C1C" },
  footer: {
    color: theme.textSubtle,
    fontSize: 12,
    textAlign: "center",
    marginTop: 16,
  },
});
