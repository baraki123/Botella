import { LinearGradient } from "expo-linear-gradient";
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
  KeyboardAvoidingView,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
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
import {
  recorderAvailable,
  transcribe,
  useVoiceRecorder,
} from "../voice/recorder";
import { AdminBuildBanner } from "./AdminBuildBanner";
import { Bubble } from "./Bubble";
import { Composer } from "./Composer";
import { ImageLightbox } from "./ImageLightbox";
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
  const [lightboxUri, setLightboxUri] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminBuild, setAdminBuild] = useState<MeBuild | null>(null);
  const insets = useSafeAreaInsets();

  // ─── Scroll behavior — sticky-bottom + jump-to-latest pill ───────────
  //
  // ChatGPT/Claude.ai/iMessage convention: while the user is near the
  // bottom of the list, every new message + every streaming token nudges
  // the view down to keep the latest content visible. As soon as the
  // user scrolls up to re-read something, auto-scroll stops — no
  // yanking. A "↓ Latest" pill fades in over the bottom-right corner
  // and tapping it (or sending a new message) snaps back to the bottom.
  //
  // Implementation: track at-bottom in a ref so the FlatList callbacks
  // can read fresh state without re-rendering, and drive the pill's
  // opacity off a separate Animated value so the fade doesn't depend on
  // React state churn during fast streams.
  const isAtBottomRef = useRef(true);
  const userOverrideRef = useRef(false); // user manually scrolled away
  // Mirror of the FlatList's scroll offset so handleContentSizeChange can
  // recompute distance-from-bottom when new content arrives without
  // waiting for a fresh user scroll event. Without this, the "Latest"
  // pill stays hidden if a long bubble lands BELOW the viewport while
  // the user is reading further up.
  const scrollOffsetYRef = useRef(0);
  const pillOpacity = useRef(new Animated.Value(0)).current;

  const listHeightRef = useRef(0);
  // Mirror of `messages` state for FlatList callbacks that need fresh
  // state without re-rendering. Updated via useLayoutEffect so the
  // mirror is in sync before paint.
  const messagesRef = useRef<Message[]>([]);
  useLayoutEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const showPill = useCallback(
    (visible: boolean) => {
      Animated.timing(pillOpacity, {
        toValue: visible ? 1 : 0,
        duration: 180,
        useNativeDriver: true,
      }).start();
    },
    [pillOpacity],
  );

  const handleScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
      scrollOffsetYRef.current = contentOffset.y;
      const distanceFromBottom = Math.max(
        0,
        contentSize.height - layoutMeasurement.height - contentOffset.y,
      );
      const atBottom = distanceFromBottom < 60;
      isAtBottomRef.current = atBottom;
      if (atBottom) {
        userOverrideRef.current = false;
      }
      // "↓ Latest" pill is only useful when the user has scrolled FAR
      // away — paginating sections is a normal forward read motion,
      // and the pill in that case is just noise. Show it only when
      // they're more than one full viewport above the bottom (i.e.
      // they've actively scrolled up to re-read something earlier).
      const farFromBottom = distanceFromBottom > layoutMeasurement.height;
      showPill(farFromBottom && messages.length > 0);
    },
    [messages.length, showPill],
  );

  const handleScrollBeginDrag = useCallback(() => {
    // Any user-initiated drag means they're taking control. If they end
    // up not-at-bottom, treat it as an override; we won't auto-follow
    // streaming tokens until they're back near the bottom.
    userOverrideRef.current = true;
  }, []);

  const handleContentSizeChange = useCallback(
    (_w: number, height: number) => {
      // Behavior per content type:
      //   - Streaming bot tokens (Layla's chat reply unfolding): sticky
      //     bottom while user is at-bottom. Standard chat UX — user
      //     watches the answer arrive in real time.
      //   - User message echo (typed send OR chip tap): scroll to end
      //     only if user was already at the bottom. Mid-reading users
      //     don't get yanked.
      //   - Completed bot bubble (first-map section, post-map pause,
      //     headline, etc.): NEVER auto-scroll. Viewport stays where
      //     the user is looking.
      //
      // For ANY new content that lands below the user's current
      // viewport, surface the "Latest" pill so they have an explicit
      // jump-forward affordance (handleScroll only fires on user
      // gestures, not on programmatic content growth).
      const last = messagesRef.current[messagesRef.current.length - 1];

      // Check whether the new content extends beyond the viewport.
      const viewH = listHeightRef.current;
      const offY = scrollOffsetYRef.current;
      const distanceFromBottom = Math.max(0, height - viewH - offY);
      // Same threshold as handleScroll's "far from bottom" — the pill
      // only surfaces when the user is more than one full viewport
      // above the bottom (they've actively scrolled away to re-read).
      // Normal paginated section reveals don't trigger it.
      const farFromBottom =
        viewH > 0
        && distanceFromBottom > viewH
        && (last && messagesRef.current.length > 0);

      if (userOverrideRef.current) {
        if (farFromBottom) {
          isAtBottomRef.current = false;
          showPill(true);
        }
        return;
      }

      if (!last) return;
      if (last.streaming) {
        if (isAtBottomRef.current) {
          listRef.current?.scrollToEnd({ animated: true });
        } else if (farFromBottom) {
          showPill(true);
        }
        return;
      }
      if (last.role === "user") {
        if (isAtBottomRef.current) {
          listRef.current?.scrollToEnd({ animated: true });
        } else if (farFromBottom) {
          showPill(true);
        }
        return;
      }
      // Completed bot bubble — leave the viewport stable. Pill surfaces
      // ONLY if the user is far above (one full viewport up).
      if (farFromBottom) {
        isAtBottomRef.current = false;
        showPill(true);
      }
    },
    [showPill],
  );

  // No per-row scroll behavior. Auto-scroll runs purely off
  // handleContentSizeChange (sticky-bottom while at-bottom) so the
  // viewport stays where the user is looking when new bubbles land.

  const handleListLayout = useCallback((e: LayoutChangeEvent) => {
    listHeightRef.current = e.nativeEvent.layout.height;
  }, []);

  // The chips that are CURRENTLY actionable, rendered in a sticky row
  // above the Composer.
  //
  // Rule: chips only show when the most recent message in the chat is
  // a bot message with chips attached. Once the user replies (their
  // message becomes latest) or another bot text lands without chips,
  // the chips are conceptually superseded and we hide them. Searching
  // backward for the last message-with-chips was wrong — it kept stale
  // chips visible after /reset, after the user typed something new,
  // and across other "the chips don't apply anymore" transitions.
  const latestChipMessage = useMemo(() => {
    if (messages.length === 0) return null;
    const last = messages[messages.length - 1];
    if (last.role === "bot" && last.quickReplies && last.quickReplies.length > 0) {
      return last;
    }
    return null;
  }, [messages]);

  const jumpToLatest = useCallback(() => {
    userOverrideRef.current = false;
    showPill(false);
    listRef.current?.scrollToEnd({ animated: true });
  }, [showPill]);

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

  // (Auto-scroll is driven by FlatList.onContentSizeChange — see
  // handleContentSizeChange above. Sticky-bottom: only follows new
  // content when the user hasn't manually scrolled away.)

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
    // Sending also implies "I want to be at the latest" — clear any
    // earlier scroll override so the new exchange auto-follows.
    userOverrideRef.current = false;
    showPill(false);
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
    // Don't preemptively reset scroll state here. handleContentSizeChange
    // will compute the right pill state once the user-msg + the bot's
    // response land. Forcing showPill(false) before the new content
    // arrives meant a long incoming bubble landed off-screen with no
    // visible "↓ Latest" affordance.
    setMessages((m) => [...m, { id: uid(), role: "user", text: displayLabel }]);
    streamRef.current?.send({ text: sendValue });
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
        keyboardVerticalOffset={Platform.OS === "ios" ? 20 : 0}
      >
        <ChatHeader status={status} onOpenSettings={onOpenSettings} />

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
              <Bubble message={item} onImagePress={setLightboxUri} />
            )}
            ListFooterComponent={showTyping ? <TypingIndicator /> : null}
            keyboardShouldPersistTaps="handled"
            // Dismiss the keyboard when the user starts scrolling. On iOS
            // "interactive" lets the keyboard slide down with the scroll
            // gesture (the iMessage / ChatGPT feel); on Android this
            // falls back to no-op so we add it as a non-iOS hint too.
            keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
            onLayout={handleListLayout}
            onScroll={handleScroll}
            onScrollBeginDrag={handleScrollBeginDrag}
            onContentSizeChange={handleContentSizeChange}
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
          <JumpToLatest opacity={pillOpacity} onPress={jumpToLatest} />
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
          bottomInset={insets.bottom}
        />
      </KeyboardAvoidingView>

      <ImageLightbox uri={lightboxUri} onClose={() => setLightboxUri(null)} />

      {/* Admin-only one-shot build banner — fades in when a new deploy
          has landed since this user last opened the app. */}
      <AdminBuildBanner isAdmin={isAdmin} build={adminBuild} />
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
