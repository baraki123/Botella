import React, { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Image, Pressable, StyleSheet, Text, View } from "react-native";
// @ts-ignore — no shipped types
import Markdown from "react-native-markdown-display";

import { theme } from "../config/theme";
import { useReducedMotion } from "../lib/useReducedMotion";
import {
  bubbleCacheKey,
  getCurrentJwt,
  getVoicePlaybackEnabled,
  subscribePlaybackState,
  togglePlay,
} from "../voice/playback";
import type { Message } from "./types";

// Long-form bot bubbles get a ▶ Listen affordance. Short replies don't —
// the play button on a one-line "I'm with you" would be visual noise.
// Exported so ChatScreen can use the same threshold when deciding which
// new bubbles to prefetch TTS audio for.
export const PLAY_BUTTON_MIN_CHARS = 220;

// The chart-sigil bubble emitted right after onboarding ("Avi — your
// chart's ready. ☀ Aries Sun · ☾ Leo Moon · …") crosses the 220-char
// threshold from sign names alone, so the Listen pill rendered on it.
// But a planet/sign list is not something you want spoken aloud — TTS
// reads "sun symbol" / "moon symbol" / one Unicode glyph at a time.
// Detect: contains "your chart's ready" OR 2+ astrology sigils, and
// suppress the pill.
const ASTRO_SIGILS = /[☀☾↑☿♀♂♃♄♅♆♇⚷]/g;
function isChartSigilBubble(text: string): boolean {
  if (/your chart['']?s ready|המפה שלך מוכנה/i.test(text)) return true;
  const sigilCount = (text.match(ASTRO_SIGILS) || []).length;
  return sigilCount >= 2;
}

interface Props {
  message: Message;
  /** Called when the user taps an inline image. Caller opens the
   * full-screen lightbox. */
  onImagePress?: (uri: string) => void;
  /** Active language. In Hebrew, flip the bot row's flex direction so the
   * gold dot leads at the right edge (where the reading eye starts in
   * RTL), and right-align text content. Defaults to "en". */
  lang?: "en" | "he";
  /** Long-press on a completed, substantial bot bubble (≥220 chars,
   * not a chart-sigil header) fires this with the stripped text. The
   * host (ChatScreen) opens the share-as-card preview. Streaming
   * bubbles never call this — the text is still growing. */
  onLongPressShare?: (text: string) => void;
}

/**
 * Layla messages: no bubble. Just her words on the dark canvas, prefixed
 * by a small gold dot — she feels ambient, present, like she's whispering
 * across the table rather than replying from a chat box.
 *
 * User messages: a quiet charcoal-rose pill so the conversation has
 * rhythm and you can scan your own thread.
 *
 * Each new message fades up from 8px below over ~280ms (ease-out). The
 * gold dot blooms in slightly after Layla's text starts settling — small
 * timing detail that makes her presence feel composed rather than abrupt.
 */
export function Bubble({ message, onImagePress, lang = "en", onLongPressShare }: Props) {
  const isUser = message.role === "user";
  const isRTL = lang === "he";
  // Memoize per-bubble so streaming-token re-renders + chat-state
  // updates don't re-walk the regex chain on every paint of every row.
  const text = useMemo(() => stripHtml(message.text), [message.text]);
  // Image-only Layla messages render edge-to-edge (no gold dot, no
  // text-bubble padding) so the chart fills the chat width and feels
  // like a centerpiece, not a thumbnail tucked next to a paragraph.
  const isImageOnly = !isUser && !!message.imageUrl && !text;
  const reduced = useReducedMotion();

  const fade = useRef(new Animated.Value(reduced ? 1 : 0)).current;
  const lift = useRef(new Animated.Value(reduced ? 0 : 8)).current;
  const dotScale = useRef(new Animated.Value(reduced ? 1 : 0.5)).current;

  useEffect(() => {
    if (reduced) {
      fade.setValue(1);
      lift.setValue(0);
      dotScale.setValue(1);
      return;
    }
    Animated.parallel([
      Animated.timing(fade, { toValue: 1, duration: 280, useNativeDriver: true }),
      Animated.timing(lift, { toValue: 0, duration: 320, useNativeDriver: true }),
      Animated.spring(dotScale, {
        toValue: 1,
        delay: 120,
        damping: 9,
        stiffness: 140,
        mass: 0.5,
        useNativeDriver: true,
      }),
    ]).start();
    // mount-only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (isUser) {
    // User pill: in LTR, hug the right edge; in RTL the user is on the
    // left of the row. justifyContent flips accordingly.
    return (
      <Animated.View
        testID="bubble-user"
        style={[
          styles.row,
          isRTL ? styles.rowUserRTL : styles.rowUser,
          { opacity: fade, transform: [{ translateY: lift }] },
        ]}
      >
        <View style={[styles.userBubble, isRTL && styles.userBubbleRTL]}>
          <Text style={[styles.userText, isRTL && styles.textRTL]}>
            {text}
            {message.streaming ? <Text style={styles.caret}>▍</Text> : null}
          </Text>
        </View>
      </Animated.View>
    );
  }

  if (isImageOnly) {
    return (
      <Animated.View
        style={[
          styles.imageOnlyRow,
          { opacity: fade, transform: [{ translateY: lift }] },
        ]}
      >
        <Pressable
          onPress={() => onImagePress?.(message.imageUrl!)}
          accessibilityRole="imagebutton"
          accessibilityLabel="Open full-size chart"
          style={({ pressed }) => [pressed && { opacity: 0.88 }]}
        >
          <Image
            source={{ uri: message.imageUrl }}
            style={styles.imageFull}
            resizeMode="contain"
          />
        </Pressable>
      </Animated.View>
    );
  }

  // Long-press is gated to substantial completed bot bubbles — same
  // threshold as the Listen pill, with chart-sigil headers excluded
  // (those don't render well as a quote card). The host receives the
  // stripped text so the card matches what the user sees on screen.
  const shareEligible =
    !message.streaming
    && text.length >= PLAY_BUTTON_MIN_CHARS
    && !isChartSigilBubble(text)
    && !!onLongPressShare;
  const handleLongPress = shareEligible
    ? () => onLongPressShare!(text)
    : undefined;

  return (
    <Animated.View
      testID={message.streaming ? "bubble-bot-streaming" : "bubble-bot"}
      style={[styles.row, { opacity: fade, transform: [{ translateY: lift }] }]}
    >
      <Pressable
        onLongPress={handleLongPress}
        delayLongPress={550}
        // Plain tap stays a no-op so we don't accidentally fire on
        // brushes; only long-press triggers the share affordance.
        disabled={!shareEligible}
        accessibilityHint={
          shareEligible ? "Long press to share this reading as a card" : undefined
        }
        style={[styles.botRow, isRTL && styles.botRowRTL]}
      >
        <Animated.View
          style={[styles.botDot, { transform: [{ scale: dotScale }] }]}
        />
        <View style={styles.botContent}>
          {message.imageUrl ? (
            <Pressable
              onPress={() => onImagePress?.(message.imageUrl!)}
              accessibilityRole="imagebutton"
              accessibilityLabel="Open full-size chart"
              style={({ pressed }) => [pressed && { opacity: 0.85 }]}
            >
              <Image
                source={{ uri: message.imageUrl }}
                style={styles.image}
                resizeMode="contain"
              />
            </Pressable>
          ) : null}
          {text ? (
            message.streaming ? (
              // Streaming chat replies: keep plain Text + caret for the
              // tight token-tail UX. Markdown library can't easily append
              // a non-markdown caret element mid-render.
              <Text style={[styles.botText, isRTL && styles.textRTL]}>
                {text}
                <Text style={styles.caret}>▍</Text>
              </Text>
            ) : (
              // Completed bot message: render markdown so GPT's natural
              // headers (`### Sun in Pisces`), bold (`**term**`), and
              // bulleted lists become properly styled instead of showing
              // raw syntax characters. For Hebrew, layer an RTL-aware
              // body style on top of the canonical markdownStyles.
              <Markdown
                style={
                  isRTL
                    ? { ...markdownStyles, body: { ...markdownStyles.body, textAlign: "right", writingDirection: "rtl" } }
                    : markdownStyles
                }
              >
                {text}
              </Markdown>
            )
          ) : null}
          {!message.streaming
            && text.length >= PLAY_BUTTON_MIN_CHARS
            && !isChartSigilBubble(text) ? (
            <PlayButton text={text} />
          ) : null}
        </View>
      </Pressable>
    </Animated.View>
  );
}


// ─── ▶ Listen affordance ──────────────────────────────────────────────────
//
// Renders a small gold play/pause control under long bot bubbles. State
// is owned by the playback module so multiple bubbles correctly reflect
// "this one is playing right now". Tap-to-stop on the active bubble;
// tap on a different bubble stops the active one and starts this one.

function playButtonLabel(playing: boolean, busy: boolean, errLabel: string | null): string {
  if (playing) return "Playing…";
  if (busy) return "Loading…";
  if (errLabel) return errLabel;
  return "Listen";
}


function PlayButton({ text }: { text: string }) {
  const cacheKey = useMemo(() => bubbleCacheKey(text), [text]);
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState(false);
  // Last error surfaced on the button label so failures don't go
  // silent — better to show "TTS error" than have the user wonder
  // why nothing's happening. Cleared on the next successful tap.
  const [errLabel, setErrLabel] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = subscribePlaybackState((activeKey) => {
      setPlaying(activeKey === cacheKey);
    });
    return unsubscribe;
  }, [cacheKey]);

  const onPress = async () => {
    if (busy) return;
    setErrLabel(null);
    const enabled = await getVoicePlaybackEnabled();
    if (!enabled) {
      setErrLabel("Voice off (Settings)");
      return;
    }
    const jwt = await getCurrentJwt();
    if (!jwt) {
      setErrLabel("Not signed in");
      return;
    }
    setBusy(true);
    try {
      await togglePlay({ text, jwt });
    } catch (e: any) {
      const msg = String(e?.message || e || "error").slice(0, 40);
      console.warn("[tts] togglePlay threw:", e);
      setErrLabel(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={playing ? "Stop playback" : "Listen to this reading"}
      accessibilityState={{ busy, selected: playing }}
      style={({ pressed }) => [
        styles.playButton,
        pressed && { opacity: 0.7 },
      ]}
    >
      <Text style={styles.playGlyph}>{playing ? "⏸" : "▶"}</Text>
      <Text style={styles.playLabel}>{playButtonLabel(playing, busy, errLabel)}</Text>
    </Pressable>
  );
}

function stripHtml(s: string): string {
  // Server emits a mix of Telegram-flavored HTML (`<b>`, `<i>`) and
  // markdown (`**bold**`, `## Heading`) depending on the surface. Telegram
  // renders HTML natively; the iOS Markdown component renders markdown.
  // Convert the simple HTML emphases into their markdown equivalents
  // BEFORE stripping the rest, so Layla's emphasis survives both paths.
  return s
    .replace(/<b>([\s\S]*?)<\/b>/gi, "**$1**")
    .replace(/<strong>([\s\S]*?)<\/strong>/gi, "**$1**")
    .replace(/<i>([\s\S]*?)<\/i>/gi, "*$1*")
    .replace(/<em>([\s\S]*?)<\/em>/gi, "*$1*")
    .replace(/<\/?[^>]+>/g, "");
}

const styles = StyleSheet.create({
  row: {
    paddingHorizontal: theme.spacing + 6,
    marginVertical: 8,
  },
  rowUser: {
    flexDirection: "row",
    justifyContent: "flex-end",
  },
  // In Hebrew/RTL, the user (you) is on the LEFT of the row, mirroring the
  // left-aligned user pill convention of native RTL chat apps (WhatsApp,
  // iMessage Hebrew).
  rowUserRTL: {
    flexDirection: "row",
    justifyContent: "flex-start",
  },
  userBubbleRTL: {
    // Pin the speech-tail corner to the bottom-LEFT so the pill mirrors
    // the LTR variant.
    borderBottomRightRadius: theme.radius,
    borderBottomLeftRadius: 6,
  },
  textRTL: {
    textAlign: "right",
    writingDirection: "rtl",
  },
  userBubble: {
    maxWidth: "80%",
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: theme.radius,
    borderBottomRightRadius: 6,
    backgroundColor: theme.bubbleUser,
    borderWidth: 1,
    borderColor: theme.borderStrong,
    // Faint warm shadow so the user pill feels inset against the canvas
    // rather than pasted on. Cheap on RN — no native overdraw beyond what
    // the border already costs.
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  userText: {
    color: theme.bubbleUserText,
    fontSize: 17,
    lineHeight: 24,
  },
  botRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    paddingRight: 28,
  },
  // In Hebrew/RTL, flip the row so the gold dot leads at the right edge
  // (where the reading eye starts) and the body breathes to the left.
  botRowRTL: {
    flexDirection: "row-reverse",
    paddingRight: 0,
    paddingLeft: 28,
  },
  botDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: theme.accent,
    marginTop: 11,
    // Soft halo around the gold dot — barely-there glow that catches the
    // eye without making the dot look "lit up".
    shadowColor: theme.accent,
    shadowOpacity: 0.6,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 0 },
    elevation: 0,
  },
  botContent: {
    flex: 1,
    gap: 8,
  },
  botText: {
    color: theme.bubbleBotText,
    fontSize: 18,
    lineHeight: 27,
    letterSpacing: 0.1,
  },
  image: {
    width: "100%",
    aspectRatio: 1,
    borderRadius: 14,
    backgroundColor: "#0006",
  },
  imageOnlyRow: {
    paddingHorizontal: 8,
    paddingVertical: 10,
    alignItems: "stretch",
  },
  imageFull: {
    width: "100%",
    // The new chart is 760x1023 → ~0.743 aspect ratio. Hard-coded so the
    // bubble reserves the right amount of vertical space before the
    // image loads (no layout jump on stream-arrival).
    aspectRatio: 760 / 1023,
    borderRadius: 16,
    backgroundColor: "#15101A",
  },
  caret: { opacity: 0.5, color: theme.accent },
  playButton: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 8,
    paddingVertical: 6,
    paddingHorizontal: 12,
    marginTop: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.borderStrong,
    // Faint gold-tinted fill so the button reads as "Layla's voice" not a
    // generic media control. Soft enough not to compete with the text
    // it sits under.
    backgroundColor: "rgba(212, 175, 90, 0.08)",
  },
  playGlyph: {
    color: theme.accent,
    fontSize: 14,
    lineHeight: 16,
  },
  playLabel: {
    color: theme.accent,
    fontSize: 13,
    fontWeight: "500",
    letterSpacing: 0.3,
  },
});


// ─── Markdown theme — Layla palette ──────────────────────────────────────
//
// `react-native-markdown-display` styles pass through to RN Text /View
// components for each markdown node type. We only override the nodes the
// natal reading actually uses (headings, paragraphs, strong/em, bullets,
// horizontal rule). Anything else falls back to the library's defaults.
//
// Headings render in gold; body in the same ink as plain bot text so a
// reading reads as one continuous voice; bullets get a gold bullet
// marker instead of the default dash.
const markdownStyles = {
  body: {
    color: theme.bubbleBotText,
    fontSize: 18,
    lineHeight: 27,
    letterSpacing: 0.1,
  },
  paragraph: {
    marginTop: 0,
    marginBottom: 12,
  },
  heading1: {
    color: theme.accent,
    fontSize: 24,
    lineHeight: 32,
    fontWeight: "600" as const,
    marginTop: 6,
    marginBottom: 12,
    letterSpacing: 0.4,
  },
  heading2: {
    // The first map read uses ## headers ("Deep Realization", "Executive
    // Summary", "Core Instruction" …). Serif display face + warmer line
    // height gives them ceremony — they read as chapter titles, not
    // chat-section headers.
    color: theme.accent,
    fontFamily: theme.fontSerif,
    fontSize: 22,
    lineHeight: 30,
    fontWeight: "500" as const,
    marginTop: 14,
    marginBottom: 12,
    letterSpacing: 0.5,
  },
  heading3: {
    color: theme.accent,
    fontSize: 17,
    lineHeight: 24,
    fontWeight: "600" as const,
    marginTop: 4,
    marginBottom: 8,
    letterSpacing: 0.25,
  },
  heading4: {
    color: theme.accent,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "600" as const,
    marginTop: 2,
    marginBottom: 6,
  },
  strong: {
    fontWeight: "700" as const,
    // Bold tokens (placement names, key claims) tinted toward warm gold
    // so they catch the eye without yelling. Slightly less saturated
    // than the chip / heading gold so body text doesn't shimmer.
    color: "#E5C28F",
  },
  em: {
    fontStyle: "italic" as const,
    color: theme.bubbleBotText,
  },
  bullet_list: {
    marginBottom: 8,
  },
  ordered_list: {
    marginBottom: 8,
  },
  list_item: {
    marginBottom: 4,
    flexDirection: "row" as const,
  },
  bullet_list_icon: {
    color: theme.accent,
    marginRight: 8,
    fontSize: 18,
    lineHeight: 27,
  },
  ordered_list_icon: {
    color: theme.accent,
    marginRight: 8,
    fontSize: 18,
    lineHeight: 27,
  },
  hr: {
    backgroundColor: theme.border,
    height: StyleSheet.hairlineWidth,
    marginVertical: 14,
  },
  blockquote: {
    backgroundColor: "transparent",
    borderLeftWidth: 2,
    borderLeftColor: theme.accentDim,
    paddingLeft: 12,
    marginVertical: 8,
  },
  code_inline: {
    backgroundColor: theme.surfaceRaised,
    color: theme.bubbleBotText,
    fontSize: 16,
    paddingHorizontal: 4,
    borderRadius: 3,
  },
  link: {
    color: theme.accent,
    textDecorationLine: "underline" as const,
  },
};
