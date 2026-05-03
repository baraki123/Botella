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
  // Chat starts EMPTY. Layla begins talking on her own when the WS opens —
  // see the auto-/start effect below. The greeting on SignInScreen is the
  // before-the-door pitch; once you're in, Layla addresses you directly.
  const [messages, setMessages] = useState<Message[]>([]);
  const [showTyping, setShowTyping] = useState(false);
  const streamRef = useRef<StreamClient | null>(null);
  const streamingIdRef = useRef<string | null>(null);
  const listRef = useRef<FlatList<Message>>(null);
  const startedRef = useRef(false);

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
    // Always render the user's message immediately. The StreamClient queues
    // the wire-send if the WS isn't open and flushes on reconnect, so the
    // user never has to wonder whether their message went through.
    setMessages((m) => [...m, { id: uid(), role: "user", text }]);
    streamRef.current?.send({ text });
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
        <View style={styles.headerLeft}>
          <View
            style={[
              styles.statusDot,
              {
                backgroundColor:
                  status === "open"
                    ? theme.statusOpen
                    : status === "connecting"
                      ? theme.statusConnecting
                      : theme.statusClosed,
              },
            ]}
          />
          <Text style={styles.headerTitle}>{product.name}</Text>
        </View>
        {onOpenSettings ? (
          <Pressable
            onPress={onOpenSettings}
            style={({ pressed }) => [styles.settingsBtn, pressed && { opacity: 0.5 }]}
            accessibilityLabel="Settings"
            hitSlop={10}
          >
            <Text style={styles.settingsIcon}>⋯</Text>
          </Pressable>
        ) : null}
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

      <Composer onSend={send} status={status} />
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
    paddingHorizontal: theme.spacing + 6,
    paddingTop: 16,
    paddingBottom: 14,
    backgroundColor: theme.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.border,
  },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 10 },
  headerTitle: {
    fontSize: 22,
    color: theme.text,
    fontFamily: theme.fontSerifItalic,
    letterSpacing: 0.5,
  },
  settingsBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 14,
  },
  settingsIcon: { fontSize: 24, color: theme.textSubtle, lineHeight: 24 },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  list: { flex: 1 },
  listContent: { paddingVertical: 12 },
  errorTitle: { fontSize: 18, fontWeight: "600", color: theme.text, marginBottom: 8 },
  errorBody: { color: theme.textSubtle, textAlign: "center", marginBottom: 12 },
  errorHint: { color: theme.textSubtle, fontSize: 13, textAlign: "center" },
});
