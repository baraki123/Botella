import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { connectStream, type StreamClient } from "../api/stream";
import type { BotEvent } from "../api/types";
import { ensureSession, type Session } from "../auth/anonymous";
import { product } from "../config/product";
import { theme } from "../config/theme";
import { Bubble } from "./Bubble";
import { Composer } from "./Composer";
import { QuickReplies } from "./QuickReplies";
import { TypingIndicator } from "./TypingIndicator";
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
  const [messages, setMessages] = useState<Message[]>([
    { id: "greeting", role: "bot", text: product.greeting },
  ]);
  const [showTyping, setShowTyping] = useState(false);
  const streamRef = useRef<StreamClient | null>(null);
  const streamingIdRef = useRef<string | null>(null);
  const listRef = useRef<FlatList<Message>>(null);

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

  // 3. Auto-scroll on every message change.
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

      case "turn_end":
        setShowTyping(false);
        return;

      case "error":
        console.warn("server error event", event.payload);
        return;

      default:
        // media, future event types — ignore for the demo
        return;
    }
  }

  function send(text: string) {
    if (!streamRef.current) return;
    setMessages((m) => [...m, { id: uid(), role: "user", text }]);
    streamRef.current.send({ text });
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
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{product.name}</Text>
        <View style={styles.statusRow}>
          <View
            style={[
              styles.statusDot,
              {
                backgroundColor:
                  status === "open"
                    ? "#22C55E"
                    : status === "connecting"
                      ? "#F59E0B"
                      : "#EF4444",
              },
            ]}
          />
          <Text style={styles.statusText}>{status}</Text>
          {onOpenSettings ? (
            <Pressable
              onPress={onOpenSettings}
              style={({ pressed }) => [styles.settingsBtn, pressed && { opacity: 0.5 }]}
              accessibilityLabel="Settings"
            >
              <Text style={styles.settingsIcon}>⋯</Text>
            </Pressable>
          ) : null}
        </View>
      </View>

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
      />

      <Composer onSend={send} disabled={status !== "open"} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing,
    backgroundColor: theme.bg,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: theme.spacing,
    paddingTop: 14,
    paddingBottom: 10,
    backgroundColor: theme.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.border,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: "600",
    color: theme.text,
  },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  settingsBtn: {
    marginLeft: 8,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 14,
  },
  settingsIcon: { fontSize: 22, color: theme.textSubtle, lineHeight: 22 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { color: theme.textSubtle, fontSize: 13 },
  list: { flex: 1 },
  listContent: { paddingVertical: 12 },
  errorTitle: { fontSize: 18, fontWeight: "600", color: theme.text, marginBottom: 8 },
  errorBody: { color: theme.textSubtle, textAlign: "center", marginBottom: 12 },
  errorHint: { color: theme.textSubtle, fontSize: 13, textAlign: "center" },
});
