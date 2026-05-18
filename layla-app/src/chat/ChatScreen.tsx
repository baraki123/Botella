import AsyncStorage from "@react-native-async-storage/async-storage";
import { LinearGradient } from "expo-linear-gradient";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";

import { fetchMe, type MeBuild } from "../api/me";
import { connectStream, type StreamClient } from "../api/stream";
import type { BotEvent } from "../api/types";
import { ensureSession, type Session } from "../auth/anonymous";
import { product } from "../config/product";
import { theme } from "../config/theme";
import { getVoicePlaybackEnabled, prefetchAudio } from "../voice/playback";
import {
  recorderAvailable,
  transcribe,
  useVoiceRecorder,
} from "../voice/recorder";
import { AdminBuildBanner } from "./AdminBuildBanner";
import { Bubble, PLAY_BUTTON_MIN_CHARS } from "./Bubble";
import { Composer } from "./Composer";
import { renderInsightCard } from "../api/card";
import { AppleSignInNudge } from "../auth/AppleSignInNudge";
import { ImageLightbox } from "./ImageLightbox";
import { QuickReplies } from "./QuickReplies";
import { TypingIndicator } from "./TypingIndicator";
import { Glow } from "./atmosphere/Glow";
import { Starfield } from "./atmosphere/Starfield";
import type { Message, QuickReplyOption } from "./types";
import { KEYBOARD_VERTICAL_OFFSET_IOS, useChatScroll } from "./useChatScroll";

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// AsyncStorage key for persisting chat history per anonymous/Apple user.
// On full app reload, WS auto-resume only re-emits the CURRENT onboarding
// state — prior bubbles (chart sigils, earlier sections, intro messages)
// disappear. Persisting locally restores continuity; the WS resume layers
// new state on top, and the server-side throttle (emit_first_map) already
// suppresses re-emission of a section the client already has.
//
// Tied to user_id so signing into a different account doesn't pull the
// previous one's history. Cleared explicitly on sign-out and delete-
// account (see SettingsScreen).
const CHAT_KEY_PREFIX = "layla:chat_messages:";
export const CHAT_KEY_FOR = (userId: string) => `${CHAT_KEY_PREFIX}${userId}`;
const CHAT_HISTORY_CAP = 60;
const CHAT_PERSIST_DEBOUNCE_MS = 500;

export interface ChatScreenProps {
  onOpenSettings?: () => void;
  onOpenPeople?: () => void;
  /** When non-null, ChatScreen sends this text to the WS as soon as
   * the connection is open and clears the slot via onPendingConsumed.
   * Used by the People tab's "+" button and "Talk to Layla about X"
   * deep-links. */
  pendingMessage?: string | null;
  onPendingConsumed?: () => void;
}

export function ChatScreen({
  onOpenSettings,
  onOpenPeople,
  pendingMessage,
  onPendingConsumed,
}: ChatScreenProps = {}) {
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
  const startedRef = useRef(false);
  // Buffer for the paginated_read event (full first-map read). Holds
  // the sections we haven't rendered yet + their Continue-chip labels
  // + the post-map pivot text + doorway chips. Continue taps walk
  // through this entirely client-side — no WS round-trip per section.
  const paginatedReadRef = useRef<{
    sections: string[];
    chipLabels: string[];
    postText: string;
    doorways: QuickReplyOption[];
  } | null>(null);
  const voice = useVoiceRecorder();
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [lightboxUri, setLightboxUri] = useState<string | null>(null);
  const [cardRendering, setCardRendering] = useState(false);

  // Long-press on a substantial bot bubble → render a shareable
  // 1080×1080 PNG card via POST /v1/card/render and surface it in the
  // existing ImageLightbox (which already has Save-to-Photos + Share).
  // The rendered card is passed as a data: URL — ImageLightbox handles
  // data-URL materialization for the system Save / Share calls. We
  // never show the loading state for long because the render is ~80ms
  // server-side; a short alert covers the brief network round-trip
  // without blocking the bubble.
  const handleShareAsCard = useCallback(
    async (text: string) => {
      if (!session?.jwt) return;
      if (cardRendering) return;
      setCardRendering(true);
      try {
        const b64 = await renderInsightCard(session.jwt, text);
        setLightboxUri(`data:image/png;base64,${b64}`);
      } catch (e: any) {
        Alert.alert(
          "Couldn't make a card",
          e?.message || "Something went wrong. Try again.",
        );
      } finally {
        setCardRendering(false);
      }
    },
    [session?.jwt, cardRendering],
  );
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminBuild, setAdminBuild] = useState<MeBuild | null>(null);
  const insets = useSafeAreaInsets();

  // ─── Scroll behavior — locked in useChatScroll ───────────────────────
  // The hook encapsulates the canonical contract (see its top-of-file
  // banner). Wire its handlers/refs to the FlatList + Pressable below.
  // Do NOT add ad-hoc scroll calls in this file — extend the hook in
  // mobile-template/ and copy.
  const scroll = useChatScroll<Message>(messages);
  const { listRef, pillOpacity, jumpToLatest } = scroll;

  // The chips that are CURRENTLY actionable, rendered in a sticky row
  // above the Composer. Show only when the latest message is a bot
  // message carrying chips; once the user replies or another bot
  // message lands without chips, hide them.
  const latestChipMessage = useMemo(() => {
    if (messages.length === 0) return null;
    const last = messages[messages.length - 1];
    if (last.role === "bot" && last.quickReplies && last.quickReplies.length > 0) {
      return last;
    }
    return null;
  }, [messages]);

  // Detect the active language from message content so RTL-aware UI
  // (composer placeholder, bubble dot side) can respond. Sniff only
  // USER messages — bot messages can contain Hebrew incidentally (the
  // very first opener is bilingual "Choose your language / בחר שפה:"
  // and would flip a brand-new English user into RTL + Hebrew
  // placeholder before they've tapped a chip). Tapping the עברית chip
  // produces a Hebrew user pill, which catches as soon as the user picks.
  const lang = useMemo<"en" | "he">(() => {
    const hebrewChars = /[֐-׿]/;
    for (const m of messages.slice(-10)) {
      if (m.role !== "user") continue;
      if (hebrewChars.test(m.text || "")) return "he";
    }
    return "en";
  }, [messages]);

  // 1. Bootstrap session.
  useEffect(() => {
    ensureSession()
      .then(setSession)
      .catch((e: Error) => setAuthError(e.message));
  }, []);

  // 1b. Hydrate cached chat history for this user before the WS connects.
  // The WS auto-resume only re-emits the *current* onboarding section,
  // so prior bubbles vanish on a hard reload without this. We load up to
  // CHAT_HISTORY_CAP messages; the smart-snap hook treats this as a bulk
  // arrival and jumps to the bottom (no Case-A/B anchor).
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (!session || hydratedRef.current) return;
    AsyncStorage.getItem(CHAT_KEY_FOR(session.userId))
      .then((raw) => {
        hydratedRef.current = true;
        if (!raw) return;
        try {
          const saved = JSON.parse(raw);
          if (Array.isArray(saved) && saved.length > 0) {
            // Strip any `streaming: true` flags before hydration —
            // a bubble that was mid-stream when the user reloaded
            // is now a static completed bubble.
            const cleaned = saved.map((m: any) =>
              m && m.streaming ? { ...m, streaming: false } : m,
            );
            setMessages(cleaned);
          }
        } catch {
          // Corrupt cache — ignore.
        }
      })
      .catch(() => {
        hydratedRef.current = true;
      });
  }, [session]);

  // 1c. Debounced persistence: save the tail of `messages` to AsyncStorage
  // so a full reload can restore the conversation. We skip mid-stream
  // bubbles (their text grows by the token; saving every keystroke would
  // thrash AsyncStorage). Caller doesn't need to await — fire-and-forget.
  useEffect(() => {
    if (!session) return;
    if (!hydratedRef.current) return; // don't overwrite cache before load
    if (messages.length === 0) return;
    const timer = setTimeout(() => {
      const tail = messages
        .slice(-CHAT_HISTORY_CAP)
        .filter((m) => !m.streaming);
      AsyncStorage.setItem(CHAT_KEY_FOR(session.userId), JSON.stringify(tail)).catch(() => {});
    }, CHAT_PERSIST_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [messages, session]);

  // 1d. TTS prefetch: when a new long bot bubble lands and voice playback
  // is enabled, warm the cache so the Listen tap is instant (otherwise
  // the first tap pays a 15-25s synth wait). Only the LATEST finished bot
  // bubble that qualifies — we don't burn TTS budget on older bubbles the
  // user has already scrolled past, and we don't prefetch while streaming
  // (text is still growing). prefetchAudio is idempotent so a re-render
  // doesn't fire a duplicate request.
  const prefetchedKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!session) return;
    // Find the latest qualifying bot bubble.
    let target: Message | null = null;
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role !== "bot") continue;
      if (m.streaming) continue;
      const len = (m.text || "").length;
      if (len < PLAY_BUTTON_MIN_CHARS) continue;
      target = m;
      break;
    }
    if (!target) return;
    if (prefetchedKeyRef.current === target.id) return;
    prefetchedKeyRef.current = target.id;
    (async () => {
      const enabled = await getVoicePlaybackEnabled();
      if (!enabled) return;
      prefetchAudio({ text: target!.text, jwt: session.jwt }).catch(() => {});
    })();
  }, [messages, session]);

  // Pending deep-link from the People tab: the host queues a text via
  // `pendingMessage` and we send it as soon as the WS is open. Cleared
  // via `onPendingConsumed` so the same message can't fire twice.
  // We send via the normal `send()` so the message renders in the
  // composer-echo position and smart-snap fires identically.
  useEffect(() => {
    if (!pendingMessage) return;
    if (status !== "open") return;
    send(pendingMessage);
    onPendingConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingMessage, status]);

  // When a long bot bubble lands (first-map section, deep chat reply,
  // etc.) the user needs the full screen to read. If the keyboard is
  // still open from earlier composer focus, dismiss it. One-shot per
  // qualifying bubble — keyed on message id so we don't fight the user
  // who deliberately re-focuses the composer mid-read.
  const dismissedForBubbleRef = useRef<string | null>(null);
  useEffect(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role !== "bot") continue;
      if (m.streaming) continue;
      const len = (m.text || "").length;
      if (len < PLAY_BUTTON_MIN_CHARS) continue;
      if (dismissedForBubbleRef.current === m.id) return;
      dismissedForBubbleRef.current = m.id;
      Keyboard.dismiss();
      return;
    }
  }, [messages]);

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

  // 2.5. Once we have a session, ping /v1/me so admin gets a one-shot
  // build banner when a new deploy has landed since last open.
  useEffect(() => {
    if (!session) return;
    fetchMe(session.jwt).then((me) => {
      if (!me) return;
      setIsAdmin(me.is_admin);
      setAdminBuild(me.build);
    });
  }, [session?.jwt]);

  // 3. Auto-/start on first WS open. The server's /start trigger checks for
  // an existing chart and either re-enters onboarding (new user) or sends
  // a "welcome back" line (returning user) — safe in both cases. Gated by
  // startedRef so we don't fire it again on reconnects within the session.
  useEffect(() => {
    if (status !== "open" || startedRef.current) return;
    startedRef.current = true;
    streamRef.current?.send({ text: "/start" });
  }, [status]);

  // Scroll behavior is owned by useChatScroll — see its top-of-file
  // banner for the canonical contract.

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
          // creating their own message. Two reasons:
          // 1. A `text: ""` bubble renders as a ghost gold-dot row.
          // 2. Smart-snap re-anchors to each new bubble's TOP; a 0-height
          //    chip-row bubble is Case A → scrollToEnd, which overshoots
          //    past the long section bubble the chip belongs to. Attaching
          //    keeps the section bubble as the latest content for snap
          //    purposes. latestChipMessage still resolves it.
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

      case "paginated_read": {
        // Brain ships the entire first-map read (9 sections + Continue
        // chip labels + post-map pivot text + doorway chips) in ONE
        // event. Render section 0 immediately with its Continue chip;
        // buffer the rest for local pagination so subsequent Continue
        // taps render zero-round-trip from cache (see pickQuickReply's
        // `__paginated_advance` intercept).
        setShowTyping(false);
        const sections: string[] = event.payload.sections || [];
        const chipLabels: string[] = event.payload.chip_labels || [];
        const postText: string = event.payload.post_text || "";
        const doorways: QuickReplyOption[] = event.payload.doorway_options || [];
        if (sections.length === 0) return;
        const firstLabel = chipLabels[0] || "Continue →";
        setMessages((m) => [
          ...m,
          {
            id: uid(),
            role: "bot",
            text: sections[0],
            quickReplies: [{ label: firstLabel, value: "__paginated_advance" }],
          },
        ]);
        paginatedReadRef.current = {
          sections: sections.slice(1),
          chipLabels: chipLabels.slice(1),
          postText,
          doorways,
        };
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
    // Sending also implies "I want to be at the latest" — `jumpToLatest`
    // clears any earlier scroll override so onContentSizeChange resumes
    // sticky-bottom-following.
    jumpToLatest();
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
        const msg = e?.message || String(e);
        console.warn("recorder start failed", msg);
        setRecording(false);
        Alert.alert("Couldn't start recording", msg);
      }
      return;
    }
    // Stop → upload → send transcript over WS as a regular text turn.
    setRecording(false);
    if (!session) return;
    setTranscribing(true);
    try {
      const source = await voice.stop();
      if (!source) {
        Alert.alert(
          "No audio captured",
          "The recorder ran but produced no audio file.",
        );
        return;
      }
      const size =
        source.kind === "blob" ? source.blob.size : source.size;
      if (size > 0 && size < 200) {
        Alert.alert(
          "Too short",
          `Captured ${size} bytes — hold the mic for a beat longer.`,
        );
        return;
      }
      const text = await transcribe(product.apiUrl, session.jwt, source);
      if (!text) {
        Alert.alert("No transcript", "The audio uploaded but came back empty.");
        return;
      }
      send(text, { voice: true });
    } catch (e: any) {
      const msg = e?.message || String(e);
      console.warn("transcribe failed", msg);
      Alert.alert("Voice transcription failed", msg);
    } finally {
      setTranscribing(false);
    }
  }

  function pickQuickReply(
    sendValue: string,
    displayLabel: string,
    fromMessageId: string,
  ) {
    // Paginated-read intercept: Continue taps on the first-map read
    // walk a buffered list locally — no WS round-trip, no user-bubble
    // echo (the user isn't "saying" anything to Layla, they're just
    // turning the page). Falls through to the normal path if there's
    // no buffered read (defensive — value should never appear without
    // a paginated_read event setting up the ref).
    if (sendValue === "__paginated_advance") {
      setMessages((m) =>
        m.map((msg) =>
          msg.id === fromMessageId ? { ...msg, quickReplies: undefined } : msg,
        ),
      );
      advancePaginatedRead();
      return;
    }
    // Remove the chips so they can't be tapped twice. (URL-form chips
    // never reach this callback — they open externally via Linking.)
    setMessages((m) =>
      m.map((msg) =>
        msg.id === fromMessageId ? { ...msg, quickReplies: undefined } : msg,
      ),
    );
    // The user bubble shows the human-readable label (e.g. "Continue →")
    // even when the wire value is something else; for chips like
    // "♃ My Jupiter" the value is the natural-language sentence, so we
    // display that instead — caller controls which it wants by setting
    // value === label or value !== label.
    setMessages((m) => [...m, { id: uid(), role: "user", text: displayLabel }]);
    streamRef.current?.send({ text: sendValue });
  }

  function advancePaginatedRead() {
    const state = paginatedReadRef.current;
    if (!state) return;
    if (state.sections.length === 0) {
      // Final tap — emit post-map pivot text + doorway chips. The
      // user's next real input (typically a doorway chip) routes
      // through free_chat normally.
      setMessages((m) => [
        ...m,
        {
          id: uid(),
          role: "bot",
          text: state.postText,
          quickReplies: state.doorways,
        },
      ]);
      paginatedReadRef.current = null;
      return;
    }
    const nextText = state.sections[0];
    const nextLabel = state.chipLabels[0] || "Continue →";
    setMessages((m) => [
      ...m,
      {
        id: uid(),
        role: "bot",
        text: nextText,
        quickReplies: [{ label: nextLabel, value: "__paginated_advance" }],
      },
    ]);
    paginatedReadRef.current = {
      sections: state.sections.slice(1),
      chipLabels: state.chipLabels.slice(1),
      postText: state.postText,
      doorways: state.doorways,
    };
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
        // Behavior + offset are locked in by the canonical scroll
        // contract — see useChatScroll.ts header (rule 6). Don't
        // tune them here; tune the constant in the hook so every
        // product fork stays in sync.
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={
          Platform.OS === "ios" ? KEYBOARD_VERTICAL_OFFSET_IOS : 0
        }
      >
        <ChatHeader
          status={status}
          onOpenSettings={onOpenSettings}
          onOpenPeople={onOpenPeople}
        />

        <View style={styles.listWrap}>
          <FlatList
            ref={listRef}
            style={styles.list}
            contentContainerStyle={styles.listContent}
            data={messages}
            keyExtractor={(m) => m.id}
            renderItem={({ item }) => (
              // Quick-reply chips render in a sticky row above the
              // Composer (see below) so the keyboard never hides them.
              <Bubble
                message={item}
                onImagePress={setLightboxUri}
                lang={lang}
                onLongPressShare={handleShareAsCard}
              />
            )}
            ListFooterComponent={showTyping ? <TypingIndicator /> : null}
            keyboardShouldPersistTaps="handled"
            // Dismiss the keyboard when the user starts scrolling. On iOS
            // "interactive" lets the keyboard slide down with the scroll
            // gesture (the iMessage / ChatGPT feel); on Android this
            // falls back to no-op so we add it as a non-iOS hint too.
            keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
            onLayout={scroll.onLayout}
            onScroll={scroll.onScroll}
            onScrollBeginDrag={scroll.onScrollBeginDrag}
            onContentSizeChange={scroll.onContentSizeChange}
            // scrollToIndex on a tall message can fail if the index is
            // outside the rendered window; this fallback rescues it.
            onScrollToIndexFailed={(info) => {
              setTimeout(() => {
                listRef.current?.scrollToIndex({
                  index: info.index,
                  viewPosition: 0,
                  animated: true,
                });
              }, 80);
            }}
            scrollEventThrottle={32}
            // Chat conversations rarely exceed a few hundred messages,
            // and the rendered cost per bubble is small (text + a gold
            // dot). Aggressive virtualization removes earlier bubbles
            // from the DOM when many messages arrive in close succession
            // (e.g. the first map read emits 4 bubbles in <100ms after
            // a long LLM call) — the user is then scrolled to the
            // sticky-bottom and earlier messages aren't in the DOM until
            // they scroll up. Defaults: windowSize=21, removeClippedSubviews
            // depending on platform. We bump up so the first ~50 messages
            // stay mounted and any sticky-bottom scroll keeps the prior
            // bubbles available.
            initialNumToRender={50}
            windowSize={50}
            maxToRenderPerBatch={30}
            removeClippedSubviews={false}
          />
          {/* "↓ Latest" pill hidden per product call — the smart-snap
              rule keeps new content visible, so the pill rarely earned
              its weight in practice and added noise. Keeping the
              JumpToLatest component, the pillOpacity animation, and
              the useChatScroll wiring intact so other botella products
              (or a future re-add here) can opt back in by restoring
              this line. See useChatScroll contract rule 3 for the
              pill's intended semantics. */}
          {false ? (
            <JumpToLatest opacity={pillOpacity} onPress={jumpToLatest} />
          ) : null}
        </View>

        {/* Sticky quick-reply row — sits between the message list and the
            Composer, inside the same KeyboardAvoidingView, so it rises
            with the keyboard instead of being covered by it. */}
        {latestChipMessage ? (
          <View style={styles.stickyChips}>
            <QuickReplies
              options={latestChipMessage.quickReplies!}
              onPick={(sendValue, displayLabel) =>
                pickQuickReply(sendValue, displayLabel, latestChipMessage.id)
              }
            />
          </View>
        ) : null}

        <Composer
          onSend={send}
          status={status}
          voiceEnabled={recorderAvailable}
          onToggleRecord={toggleRecord}
          recording={recording}
          transcribing={transcribing}
          lang={lang}
          // Drop the home-indicator safe-area while keyboard is up —
          // the keyboard already covers that strip, so re-applying it
          // creates dead space above the keyboard. See useChatScroll
          // contract rule 7.
          bottomInset={scroll.isKeyboardVisible ? 0 : insets.bottom}
        />
      </KeyboardAvoidingView>

      <ImageLightbox uri={lightboxUri} onClose={() => setLightboxUri(null)} />

      {/* Tiny floating "rendering card…" toast while the share-as-card
          fetch is in flight. Non-blocking — the user can still read the
          chat. The fetch is fast (~80ms server-side + network) so this
          is barely visible in practice, but it gives the right
          immediate feedback that the long-press was registered. */}
      {cardRendering ? (
        <View style={styles.cardToast} pointerEvents="none">
          <ActivityIndicator size="small" color={theme.accent} />
          <Text style={styles.cardToastText}>Rendering card…</Text>
        </View>
      ) : null}

      {/* Admin-only one-shot build banner — fades in when a new deploy
          has landed since this user last opened the app. */}
      <AdminBuildBanner isAdmin={isAdmin} build={adminBuild} />

      {/* One-shot Apple Sign-In nudge — surfaces only after the user
          has sent 3+ messages while on an anon device-only account.
          Dismiss persists forever per userId. iOS only (and a no-op on
          web). See AppleSignInNudge for the gating logic. */}
      {session ? (
        <AppleSignInNudge
          userId={session.userId}
          userMessageCount={messages.filter((m) => m.role === "user").length}
        />
      ) : null}
    </View>
  );
}

function JumpToLatest({
  opacity,
  onPress,
}: {
  opacity: Animated.Value;
  onPress: () => void;
}) {
  // Floats over the bottom-right of the message list. Pointer-events
  // none on the wrapper so the flat list still gets scroll touches in
  // the area it covers; the inner Pressable handles taps. Hidden via
  // opacity (animated by parent) — when invisible we also disable the
  // Pressable so VoiceOver doesn't announce a phantom button.
  return (
    <Animated.View pointerEvents="box-none" style={[styles.pillWrap, { opacity }]}>
      <Pressable
        onPress={onPress}
        accessibilityLabel="Jump to latest"
        style={({ pressed }) => [styles.pill, pressed && { opacity: 0.7 }]}
      >
        <Svg width={14} height={14} viewBox="0 0 14 14">
          <Path
            d="M3 5 L7 9 L11 5"
            stroke={theme.text}
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </Svg>
        <Text style={styles.pillText}>Latest</Text>
      </Pressable>
    </Animated.View>
  );
}


function ChatHeader({
  status,
  onOpenSettings,
  onOpenPeople,
}: {
  status: "open" | "connecting" | "closed";
  onOpenSettings?: () => void;
  onOpenPeople?: () => void;
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
        <View style={styles.headerRight}>
          {onOpenPeople ? (
            <Pressable
              onPress={onOpenPeople}
              style={({ pressed }) => [
                styles.settingsBtn,
                pressed && { opacity: 0.5 },
              ]}
              accessibilityLabel="People in your Orbit"
              accessibilityRole="button"
              hitSlop={10}
              testID="header-people-button"
            >
              <Text style={styles.peopleIcon}>✦</Text>
            </Pressable>
          ) : null}
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
  cardToast: {
    position: "absolute",
    alignSelf: "center",
    bottom: 120,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 18,
    backgroundColor: "rgba(28,22,32,0.92)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(212,165,116,0.35)",
  },
  cardToastText: {
    color: theme.textSubtle,
    fontSize: 13,
    fontStyle: "italic",
    marginLeft: 10,
  },
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
  headerRight: { flexDirection: "row", alignItems: "center", gap: 4 },
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
  peopleIcon: { fontSize: 19, color: theme.accent, lineHeight: 24 },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    shadowOpacity: 0.7,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 0 },
  },
  listWrap: { flex: 1 },
  list: { flex: 1 },
  listContent: { paddingVertical: 12 },
  // Sticky chip row sits flush above the Composer with a hairline divider
  // and a translucent surface so the chips read as a tray, not as part of
  // the message stream.
  stickyChips: {
    backgroundColor: theme.bg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.border,
    paddingTop: 6,
    paddingBottom: 0,
  },
  pillWrap: {
    position: "absolute",
    right: 14,
    bottom: 14,
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: theme.surfaceRaised,
    borderWidth: 1,
    borderColor: theme.accentDim,
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 5,
  },
  pillText: {
    color: theme.text,
    fontSize: 13,
    letterSpacing: 0.4,
  },
  errorTitle: { fontSize: 18, fontWeight: "600", color: theme.text, marginBottom: 8 },
  errorBody: { color: theme.textSubtle, textAlign: "center", marginBottom: 12 },
  errorHint: { color: theme.textSubtle, fontSize: 13, textAlign: "center" },
});
