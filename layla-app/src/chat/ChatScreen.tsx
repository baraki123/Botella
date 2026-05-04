import { LinearGradient } from "expo-linear-gradient";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { connectStream, type StreamClient } from "../api/stream";
import type { BotEvent } from "../api/types";
import { ensureSession, type Session } from "../auth/anonymous";
import { product } from "../config/product";
import { theme } from "../config/theme";
import {
  recorderAvailable,
  transcribe,
  useVoiceRecorder,
} from "../voice/recorder";
import { Bubble } from "./Bubble";
import { Composer } from "./Composer";
import { QuickReplies } from "./QuickReplies";
import { TypingIndicator } from "./TypingIndicator";
import { Glow } from "./atmosphere/Glow";
import { Starfield } from "./atmosphere/Starfield";
import type { Message } from "./types";

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export interface ChatScreenProps {
  onOpenSettings?: () => void;
}

export function ChatScreen({ onOpenSettings }: ChatScreenProps = {}) {
  const [session, setSession] = useState<Session | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [status, setStatus] = useState<"connecting" | "open" | "closed">("connecting");
  // Chat starts EMPTY. Layla begins talking on her own when the WS opens —
  // see the auto-/start effect below. The greeting on SignInScreen is the
  // before-the-door pitch; once you're in, Layla addresses you directly.
  const [messages, setMessages] = useState<Message[]>([]);
  const [showTyping, setShowTyping] = useState(false);
  const streamRef = useRef<StreamClient | null>(null);
  const streamingIdRef = useRef<string | null>(null);
  const listRef = useRef<FlatList<Message>>(null);
  const startedRef = useRef(false);
  const voice = useVoiceRecorder();
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const insets = useSafeAreaInsets();

  // 1. Bootstrap session.
  useEffect(() => {
    ensureSession()
      .then(setSession)
      .catch((e: Error) => setAuthError(e.message));
  }, []);

  // 2. Open WS once session exists.
  useEffect(() => {
    if (!session) return;
    const client = connectStream(session.jwt);
    streamRef.current = client;
    const offEvent = client.onEvent(handleEvent);
    const offStatus = client.onStatus(setStatus);
    return () => {
      offEvent();
      offStatus();
      client.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  // 3. Auto-/start on first WS open. The server's /start trigger checks for
  // an existing chart and either re-enters onboarding (new user) or sends
  // a "welcome back" line (returning user) — safe in both cases. Gated by
  // startedRef so we don't fire it again on reconnects within the session.
  useEffect(() => {
    if (status !== "open" || startedRef.current) return;
    startedRef.current = true;
    streamRef.current?.send({ text: "/start" });
  }, [status]);

  // 4. Auto-scroll on every message change.
  useEffect(() => {
    listRef.current?.scrollToEnd({ animated: true });
  }, [messages, showTyping]);

  function handleEvent(event: BotEvent) {
    switch (event.type) {
      case "typing":
        setShowTyping(true);
        return;

      case "text": {
        // Plain text bot message.
        setShowTyping(false);
        const id = uid();
        setMessages((m) => [
          ...m,
          { id, role: "bot", text: event.payload.text || "" },
        ]);
        return;
      }

      case "token": {
        // Streaming token. Open a streaming bubble on first token.
        setShowTyping(false);
        let openId = streamingIdRef.current;
        if (!openId) {
          openId = uid();
          streamingIdRef.current = openId;
          setMessages((m) => [
            ...m,
            { id: openId!, role: "bot", text: "", streaming: true },
          ]);
        }
        const tok = event.payload.text || "";
        setMessages((m) =>
          m.map((msg) =>
            msg.id === openId ? { ...msg, text: msg.text + tok } : msg,
          ),
        );
        return;
      }

      case "complete": {
        const openId = streamingIdRef.current;
        const full = event.payload.text || "";
        if (openId) {
          // Mark streamed bubble as final.
          setMessages((m) =>
            m.map((msg) =>
              msg.id === openId ? { ...msg, streaming: false } : msg,
            ),
          );
          streamingIdRef.current = null;
        } else if (full) {
          // No tokens streamed — treat complete as a single message.
          setMessages((m) => [
            ...m,
            { id: uid(), role: "bot", text: full },
          ]);
        }
        return;
      }

      case "quick_replies": {
        setShowTyping(false);
        const prompt = event.payload.prompt || "";
        const options = event.payload.options || [];
        setMessages((m) => [
          ...m,
          {
            id: uid(),
            role: "bot",
            text: prompt,
            quickReplies: options,
          },
        ]);
        return;
      }

      case "media": {
        // Inline image (e.g. natal chart PNG). Server scrubs raw bytes into
        // a base64 data URL on `image_data_url`; older payloads may carry
        // `image_url` directly.
        setShowTyping(false);
        const url =
          event.payload.image_data_url || event.payload.image_url || "";
        if (!url) return;
        setMessages((m) => [
          ...m,
          {
            id: uid(),
            role: "bot",
            text: event.payload.caption || "",
            imageUrl: url,
          },
        ]);
        return;
      }

      case "turn_end":
        setShowTyping(false);
        return;

      case "error":
        console.warn("server error event", event.payload);
        return;

      default:
        return;
    }
  }

  function send(text: string, opts?: { voice?: boolean }) {
    // Always render the user's message immediately. The StreamClient queues
    // the wire-send if the WS isn't open and flushes on reconnect, so the
    // user never has to wonder whether their message went through.
    setMessages((m) => [...m, { id: uid(), role: "user", text }]);
    streamRef.current?.send({ text, voice_origin: opts?.voice });
  }

  async function toggleRecord() {
    if (transcribing) return;
    if (!recording) {
      try {
        await voice.start();
        setRecording(true);
      } catch (e: any) {
        console.warn("recorder start failed", e?.message || e);
        setRecording(false);
      }
      return;
    }
    // Stop → upload → send transcript over WS as a regular text turn.
    setRecording(false);
    if (!session) return;
    setTranscribing(true);
    try {
      const blob = await voice.stop();
      if (!blob || blob.size < 200) return; // empty / accidental tap
      const text = await transcribe(product.apiUrl, session.jwt, blob);
      if (!text) return;
      send(text, { voice: true });
    } catch (e: any) {
      console.warn("transcribe failed", e?.message || e);
    } finally {
      setTranscribing(false);
    }
  }

  function pickQuickReply(option: string, fromMessageId: string) {
    // Remove the chips so they can't be tapped twice.
    setMessages((m) =>
      m.map((msg) =>
        msg.id === fromMessageId ? { ...msg, quickReplies: undefined } : msg,
      ),
    );
    send(option);
  }

  if (authError) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorTitle}>Couldn't connect</Text>
        <Text style={styles.errorBody}>{authError}</Text>
        <Text style={styles.errorHint}>
          Is the backend running at {product.apiUrl}?
        </Text>
      </View>
    );
  }

  if (!session) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {/* Atmosphere stack — pointer-events: none on every layer.
          Order matters: glow first (closest to canvas), then sparkles
          on top so the brightest stars are still visible inside the glow.
          Both sit BEHIND the chat content. */}
      <Glow corner="top-left" intensity={0.18} />
      <Starfield />

      <KeyboardAvoidingView
        style={styles.kav}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        // Small lift so the input clears the iOS QuickType suggestions bar
        // with a hair of breathing room.
        keyboardVerticalOffset={Platform.OS === "ios" ? 12 : 0}
      >
        <ChatHeader status={status} onOpenSettings={onOpenSettings} />

        <FlatList
          ref={listRef}
          style={styles.list}
          contentContainerStyle={styles.listContent}
          data={messages}
          keyExtractor={(m) => m.id}
          renderItem={({ item }) => (
            <View>
              <Bubble message={item} />
              {item.quickReplies ? (
                <QuickReplies
                  options={item.quickReplies}
                  onPick={(opt) => pickQuickReply(opt, item.id)}
                />
              ) : null}
            </View>
          )}
          ListFooterComponent={showTyping ? <TypingIndicator /> : null}
          keyboardShouldPersistTaps="handled"
        />

        <Composer
          onSend={send}
          status={status}
          voiceEnabled={recorderAvailable}
          onToggleRecord={toggleRecord}
          recording={recording}
          transcribing={transcribing}
          bottomInset={insets.bottom}
        />
      </KeyboardAvoidingView>
    </View>
  );
}

function ChatHeader({
  status,
  onOpenSettings,
}: {
  status: "open" | "connecting" | "closed";
  onOpenSettings?: () => void;
}) {
  const dotColor = useMemo(() => {
    if (status === "open") return theme.statusOpen;
    if (status === "connecting") return theme.statusConnecting;
    return theme.statusClosed;
  }, [status]);

  return (
    <View style={styles.header}>
      <View style={styles.headerInner}>
        <View style={styles.headerLeft}>
          <View
            style={[
              styles.statusDot,
              {
                backgroundColor: dotColor,
                shadowColor: dotColor,
              },
            ]}
          />
          <Text style={styles.headerTitle}>{product.name}</Text>
        </View>
        {onOpenSettings ? (
          <Pressable
            onPress={onOpenSettings}
            style={({ pressed }) => [
              styles.settingsBtn,
              pressed && { opacity: 0.5 },
            ]}
            accessibilityLabel="Settings"
            hitSlop={10}
          >
            <Text style={styles.settingsIcon}>⋯</Text>
          </Pressable>
        ) : null}
      </View>
      {/* Soft gold hairline gradient under the header — fades in from
          edges, peaks in the middle. Replaces the flat 1px border with
          something that feels like firelight on a windowsill. */}
      <LinearGradient
        colors={[
          "rgba(212,165,116,0)",
          "rgba(212,165,116,0.45)",
          "rgba(212,165,116,0)",
        ]}
        locations={[0, 0.5, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={styles.headerHairline}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  kav: { flex: 1 },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing,
    backgroundColor: theme.bg,
  },
  header: {
    backgroundColor: "transparent",
  },
  headerInner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: theme.spacing + 6,
    paddingTop: 16,
    paddingBottom: 14,
  },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 10 },
  headerTitle: {
    fontSize: 24,
    color: theme.text,
    fontFamily: theme.fontSerifItalic,
    letterSpacing: 0.5,
  },
  headerHairline: {
    height: 1,
    width: "100%",
    opacity: 0.9,
  },
  settingsBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 14,
  },
  settingsIcon: { fontSize: 24, color: theme.textSubtle, lineHeight: 24 },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    shadowOpacity: 0.7,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 0 },
  },
  list: { flex: 1 },
  listContent: { paddingVertical: 12 },
  errorTitle: { fontSize: 18, fontWeight: "600", color: theme.text, marginBottom: 8 },
  errorBody: { color: theme.textSubtle, textAlign: "center", marginBottom: 12 },
  errorHint: { color: theme.textSubtle, fontSize: 13, textAlign: "center" },
});
