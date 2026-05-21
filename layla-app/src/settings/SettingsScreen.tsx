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
  TextInput,
  View,
} from "react-native";

import { product } from "../config/product";
import { theme } from "../config/theme";
import { clearSession, loadCachedSession, saveSession } from "../auth/anonymous";
import {
  appleSignInAvailable,
  currentAuthProvider,
  signInWithApple,
} from "../auth/apple";
import { redeemLinkCode } from "../api/link";
import { fetchMe, MeBuild } from "../api/me";
import {
  getVoicePlaybackEnabled,
  setVoicePlaybackEnabled,
  stopPlayback,
} from "../voice/playback";

const PRIVACY_URL = "https://layla.app/privacy"; // TODO: real URL before submission
const TERMS_URL = "https://layla.app/terms";

// Wipe per-user chat-history caches on sign-out and delete-account.
// Keys are `layla:chat_messages:${userId}` (set by ChatScreen). We can't
// know the previous user_id reliably from here (session may already be
// cleared), so sweep all matching keys.
async function clearCachedChatHistory(): Promise<void> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const stale = keys.filter((k) => k.startsWith("layla:chat_messages:"));
    if (stale.length) await AsyncStorage.multiRemove(stale);
  } catch {
    // best-effort — a failure here just means the next user might
    // briefly see the previous chat tail before their own restore.
  }
}

export interface SettingsScreenProps {
  onSignedOut: () => void;
  onAccountSwitched?: () => void;
  /** Called when the user taps the back button to return to the chat. */
  onClose?: () => void;
  /** Fire a pure callback frame over the chat WS. Used by the
   * "Conversation" rows (Re-do my map, Re-read my map, Add to Orbit)
   * which used to be slash-commands. The host (App.tsx) queues the
   * callback to fire on the next chat mount and switches the route
   * back to chat so the user sees Layla's response. */
  onSendCallback?: (callback_data: string) => void;
}

export function SettingsScreen({ onSignedOut, onAccountSwitched, onClose, onSendCallback }: SettingsScreenProps) {
  const [provider, setProvider] = useState<string | null>(null);
  const [busy, setBusy] = useState<
    "signout" | "delete" | "link" | "tg-link" | null
  >(null);
  const [canLinkApple, setCanLinkApple] = useState(false);
  const [tgCode, setTgCode] = useState("");
  const [tgLinkOpen, setTgLinkOpen] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [build, setBuild] = useState<MeBuild | null>(null);
  const [voiceEnabled, setVoiceEnabled] = useState<boolean>(false);

  useEffect(() => {
    currentAuthProvider().then((p) => setProvider(p ?? "anonymous"));
    appleSignInAvailable().then(setCanLinkApple);
    // Pull /v1/me so we can show admins the deployed build (sha + note +
    // commit time + boot time). Non-admins never see this section.
    loadCachedSession().then((s) => {
      if (!s) return;
      fetchMe(s.jwt).then((me) => {
        if (!me) return;
        setIsAdmin(me.is_admin);
        setBuild(me.build);
      });
    });
    getVoicePlaybackEnabled().then(setVoiceEnabled);
  }, []);

  async function handleVoiceToggle() {
    const next = !voiceEnabled;
    setVoiceEnabled(next);
    await setVoicePlaybackEnabled(next);
    // If turning off mid-playback, stop the current audio so the user
    // doesn't have to chase it.
    if (!next) stopPlayback();
  }

  async function handleRedeemTelegramCode() {
    const code = tgCode.trim();
    if (code.length < 4) {
      const msg = "Type the 8-character code from /link in Telegram.";
      if (Platform.OS === "web") {
        // @ts-ignore
        window.alert(msg);
      } else {
        Alert.alert("Code too short", msg);
      }
      return;
    }
    setBusy("tg-link");
    try {
      const session = await loadCachedSession();
      if (!session) throw new Error("not signed in yet");
      const next = await redeemLinkCode({ jwt: session.jwt, code });
      await saveSession({ jwt: next.jwt, userId: next.userId });
      await AsyncStorage.setItem("botella.authProvider", next.auth);
      setProvider(next.auth);
      setTgCode("");
      setTgLinkOpen(false);
      const ok = "Telegram account linked. Your chart and history are here now.";
      if (Platform.OS === "web") {
        // @ts-ignore
        window.alert(ok);
      } else {
        Alert.alert("Linked", ok);
      }
      onAccountSwitched?.();
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      if (Platform.OS === "web") {
        // @ts-ignore
        window.alert(`Couldn't link: ${msg}`);
      } else {
        Alert.alert("Couldn't link", msg);
      }
    } finally {
      setBusy(null);
    }
  }

  async function handleLinkApple() {
    setBusy("link");
    try {
      const session = await loadCachedSession();
      if (!session) throw new Error("not signed in yet");
      await signInWithApple({ linkAnonymousUserId: session.userId });
      setProvider("apple");
    } catch (e: any) {
      // User cancelled the Apple sheet OR the request failed. Both surface
      // the same way — only complain when it's a real error.
      const code = e?.code;
      if (code !== "ERR_REQUEST_CANCELED") {
        if (Platform.OS === "web") {
          // @ts-ignore
          window.alert?.(`Couldn't link Apple: ${e?.message ?? e}`);
        } else {
          Alert.alert("Couldn't link Apple", String(e?.message ?? e));
        }
      }
    } finally {
      setBusy(null);
    }
  }

  async function handleSignOut() {
    setBusy("signout");
    await clearSession();
    await AsyncStorage.removeItem("botella.authProvider");
    await clearCachedChatHistory();
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
      await clearCachedChatHistory();
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
      <View style={styles.headerRow}>
        {onClose ? (
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Back to chat"
            style={({ pressed }) => [
              styles.backButton,
              pressed && { opacity: 0.6 },
            ]}
          >
            <Text style={styles.backButtonText}>‹ Back</Text>
          </Pressable>
        ) : null}
        <Text style={styles.heading}>Settings</Text>
      </View>

      <Section title="Account">
        <Row label="Signed in with" value={provider === "apple" ? "Apple" : "Anonymous device"} />
        {provider !== "apple" && canLinkApple ? (
          <ActionRow
            label="Sign in with Apple to keep your data"
            onPress={handleLinkApple}
            busy={busy === "link"}
          />
        ) : null}
        <ActionRow
          label="Link Telegram account"
          onPress={() => setTgLinkOpen((v) => !v)}
        />
        {tgLinkOpen ? (
          <View style={styles.linkBox}>
            <Text style={styles.linkHint}>
              On Telegram, send /link to @laylastarbot, then type the 8-char
              code below. Brings your chart and history here.
            </Text>
            <TextInput
              style={styles.linkInput}
              autoCapitalize="characters"
              autoCorrect={false}
              placeholder="ABCD2345"
              placeholderTextColor={theme.textMuted}
              value={tgCode}
              onChangeText={(s) => setTgCode(s.toUpperCase())}
              maxLength={12}
              editable={busy !== "tg-link"}
            />
            <ActionRow
              label="Redeem code"
              onPress={handleRedeemTelegramCode}
              busy={busy === "tg-link"}
            />
          </View>
        ) : null}
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

      {isAdmin && build ? (
        <Section title="Admin · Build">
          <Row label="SHA" value={build.sha} />
          <Row label="Committed" value={formatTimestamp(build.commit_time)} />
          <Row label="Booted" value={formatTimestamp(build.boot_time)} />
          <View style={styles.buildNote}>
            <Text style={styles.buildNoteLabel}>Last change</Text>
            <Text style={styles.buildNoteText}>{build.note}</Text>
          </View>
        </Section>
      ) : null}

      <Section title="Voice">
        <ActionRow
          label={voiceEnabled ? "Voice replies on — tap to turn off" : "Voice replies off — tap to turn on"}
          onPress={handleVoiceToggle}
        />
        <Text style={styles.voiceHint}>
          When on, long readings show a Listen button. Layla speaks them
          in a soft, warm voice (uses your data plan).
        </Text>
      </Section>

      {onSendCallback ? (
        <Section title="Conversation">
          <ActionRow
            label="Re-read my map"
            onPress={() => onSendCallback("__reread_map")}
          />
          <ActionRow
            label="Re-do my map"
            onPress={() => {
              Alert.alert(
                "Re-do your map?",
                "We'll start a fresh birth-data flow. Your Orbit and notes stay; your current chart will be replaced.",
                [
                  { text: "Cancel", style: "cancel" },
                  {
                    text: "Start over",
                    style: "destructive",
                    onPress: () => onSendCallback("__redo_map"),
                  },
                ],
              );
            }}
          />
          <ActionRow
            label="Add someone to my Orbit"
            onPress={() => onSendCallback("__add_person")}
          />
        </Section>
      ) : null}

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

function formatTimestamp(iso: string): string {
  // Best-effort short, locale-friendly rendering of an ISO timestamp.
  // "2026-05-06T16:21:54-04:00" → "May 6, 16:21" (relative to user TZ).
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    const m = d.toLocaleString(undefined, { month: "short", day: "numeric" });
    const t = d.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    return `${m}, ${t}`;
  } catch {
    return iso;
  }
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
  content: { padding: 24, paddingTop: 32, paddingBottom: 60 },
  heading: {
    fontSize: 34,
    fontFamily: theme.fontSerifItalic,
    color: theme.text,
    letterSpacing: 0.4,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 28,
  },
  backButton: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    marginLeft: -8,
  },
  backButtonText: {
    color: theme.accent,
    fontSize: 18,
    letterSpacing: 0.3,
  },
  section: { marginBottom: 24 },
  sectionTitle: {
    fontSize: 11,
    color: theme.accent,
    textTransform: "uppercase",
    letterSpacing: 1.5,
    marginBottom: 10,
    marginLeft: 4,
  },
  card: {
    backgroundColor: theme.surfaceRaised,
    borderRadius: theme.radius,
    borderWidth: 1,
    borderColor: theme.border,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 18,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.border,
  },
  rowPressed: { backgroundColor: theme.surface, opacity: 1 },
  rowLabel: { fontSize: 15, color: theme.textSubtle },
  rowValue: { fontSize: 15, color: theme.text },
  rowAction: { fontSize: 15, color: theme.text },
  destructive: { color: "#C97777" },
  linkBox: {
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.border,
    backgroundColor: theme.surface,
  },
  linkHint: {
    fontSize: 13,
    color: theme.textSubtle,
    marginBottom: 10,
    lineHeight: 18,
  },
  linkInput: {
    fontSize: 18,
    color: theme.text,
    backgroundColor: theme.bg,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    letterSpacing: 2,
    marginBottom: 8,
  },
  buildNote: {
    paddingHorizontal: 18,
    paddingVertical: 14,
    backgroundColor: theme.surface,
  },
  buildNoteLabel: {
    fontSize: 11,
    color: theme.accent,
    textTransform: "uppercase",
    letterSpacing: 1.5,
    marginBottom: 6,
  },
  buildNoteText: {
    fontSize: 14,
    color: theme.text,
    lineHeight: 19,
  },
  voiceHint: {
    fontSize: 13,
    color: theme.textMuted,
    lineHeight: 18,
    paddingHorizontal: 4,
    paddingTop: 6,
  },
  footer: {
    color: theme.textMuted,
    fontSize: 12,
    textAlign: "center",
    marginTop: 20,
    fontFamily: theme.fontSerifItalic,
    letterSpacing: 0.4,
  },
});
