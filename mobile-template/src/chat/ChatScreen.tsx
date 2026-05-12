import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  View,
} from "react-native";

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
import type { Message } from "./types";
import { useChatScroll } from "./useChatScroll";

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function ChatScreen() {
  const [session, setSession] = useState<Session | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [status, setStatus] = useState<"connecting" | "open" | "closed">("connecting");
  const [messages, setMessages] = useState<Message[]>([
    { id: "greeting", role: "bot", text: product.greeting },
  ]);
  const [showTyping, setShowTyping] = useState(false);
  const streamRef = useRef<StreamClient | null>(null);
  const streamingIdRef = useRef<string | null>(null);
  const voice = useVoiceRecorder();
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);

  // Scroll behavior — see useChatScroll banner. Single source of truth
  // for chat scroll across botella products. Don't add ad-hoc
  // scrollToEnd / scrollToIndex calls in this file.
  const scroll = useChatScroll<Message>(messages);
  const { listRef, jumpToLatest } = scroll;

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

  // Auto-scroll is owned by useChatScroll's onContentSizeChange — no
  // useEffect needed.

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
        setMessages((m) => {
          // Empty-prompt chips attach to the previous bot bubble instead of
          // creating their own message. A new `text: ""` bubble produces a
          // ghost gold-dot row AND triggers a smart-snap re-anchor that
          // can overshoot past a long bubble the chip belongs to.
          if (!prompt && m.length > 0 && m[m.length - 1].role === "bot") {
            const next = m.slice();
            next[next.length - 1] = {
              ...next[next.length - 1],
              quickReplies: options,
            };
            return next;
          }
          return [
            ...m,
            { id: uid(), role: "bot", text: prompt, quickReplies: options },
          ];
        });
        return;
      }

      case "media": {
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
    if (!streamRef.current) return;
    // Sending implies "follow new content" — clear any earlier scroll
    // override + re-prime the auto-follow.
    jumpToLatest();
    setMessages((m) => [...m, { id: uid(), role: "user", text }]);
    streamRef.current.send({ text, voice_origin: opts?.voice });
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
    setRecording(false);
    if (!session) return;
    setTranscribing(true);
    try {
      const blob = await voice.stop();
      if (!blob || blob.size < 200) return;
      const text = await transcribe(product.apiUrl, session.jwt, blob);
      if (!text) return;
      send(text, { voice: true });
    } catch (e: any) {
      console.warn("transcribe failed", e?.message || e);
    } finally {
      setTranscribing(false);
    }
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
        onLayout={scroll.onLayout}
        onScroll={scroll.onScroll}
        onScrollBeginDrag={scroll.onScrollBeginDrag}
        onContentSizeChange={scroll.onContentSizeChange}
        scrollEventThrottle={32}
      />

      <Composer
        onSend={send}
        disabled={status !== "open"}
        voiceEnabled={recorderAvailable}
        onToggleRecord={toggleRecord}
        recording={recording}
        transcribing={transcribing}
      />
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
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { color: theme.textSubtle, fontSize: 13 },
  list: { flex: 1 },
  listContent: { paddingVertical: 12 },
  errorTitle: { fontSize: 18, fontWeight: "600", color: theme.text, marginBottom: 8 },
  errorBody: { color: theme.textSubtle, textAlign: "center", marginBottom: 12 },
  errorHint: { color: theme.textSubtle, fontSize: 13, textAlign: "center" },
});
