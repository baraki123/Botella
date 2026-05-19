import * as Clipboard from "expo-clipboard";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Image, Platform, Pressable, Share, StyleSheet, Text, View } from "react-native";
// @ts-ignore — no shipped types
import Markdown from "react-native-markdown-display";
import Svg, { Path } from "react-native-svg";

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

// Typewriter reveal kicks in on long completed bot bubbles. Tuned so a
// typical section (~800 chars) reveals in ~3 seconds — fast enough to
// not feel laborious, slow enough to read "Layla is writing." Tap the
// bubble to skip to the full text instantly.
const TYPEWRITER_MIN_CHARS = 240;
const TYPEWRITER_TARGET_DURATION_MS = 3000;
const TYPEWRITER_MIN_DURATION_MS = 900;
const TYPEWRITER_MAX_DURATION_MS = 4500;

// Module-scope ID sets so component re-mounts (list virtualization, key
// reuse) don't replay the typewriter. Once a message has been streamed
// OR fully revealed once, it stays settled forever.
const STREAMED_BUBBLE_IDS = new Set<string>();
const REVEALED_BUBBLE_IDS = new Set<string>();

// The chart-sigil bubble emitted right after onboarding ("Avi — your
// chart's ready. ☀ Aries Sun · ☾ Leo Moon · …") crosses the 220-char
// threshold from sign names alone, so the Listen pill rendered on it.
// But a planet/sign list is not something you want spoken aloud — TTS
// reads "sun symbol" / "moon symbol" / one Unicode glyph at a time.
// Detect: contains "your chart's ready" OR 2+ astrology sigils, and
// suppress the pill.
const ASTRO_SIGILS = /[☀☾↑☿♀♂♃♄♅♆♇⚷]/g;
function isChartSigilBubble(text: string): boolean {
  // Lead-in phrases the brain emits with the sigil block. New format
  // ("here's your map") replaced the old ("your chart's ready"); we
  // match both so older sessions still suppress the Listen pill. As a
  // safety net we also count astrology sigils — two or more = sigil
  // block even when the lead-in copy drifts again.
  if (/here['']?s your map|your chart['']?s ready|הנה המפה שלך|המפה שלך מוכנה/i.test(text)) return true;
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
  // Memoize per-bubble so streaming-token re-renders + chat-state
  // updates don't re-walk the regex chain on every paint of every row.
  const text = useMemo(() => stripHtml(message.text), [message.text]);
  // Direction is per-bubble, not per-session. An English bot reply
  // inside a Hebrew session was rendering RTL — gold dot on the right,
  // text right-aligned, markdown headings flipped — because the
  // previous check was `lang === "he"`. Detect Hebrew chars in THIS
  // bubble's text instead. The `lang` prop is kept for the few
  // structural fallbacks that still need it but no longer drives RTL.
  const isRTL = useMemo(
    () => /[֐-׿]/.test(text),
    [text],
  );
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

  // Typewriter reveal for completed long bubbles (first-map sections,
  // long chat replies that didn't stream). Disabled for sigil bubbles
  // (planet-symbol writing-out reads as junk) and for anything that
  // already streamed (the stream IS the reveal).
  const typewriterEligible =
    !message.streaming
    && text.length >= TYPEWRITER_MIN_CHARS
    && !isChartSigilBubble(text);
  const { revealed, isRevealing, skip } = useTypewriter(
    text,
    message.id,
    typewriterEligible,
    !!message.streaming,
  );
  // Tap-to-skip is wired to the same outer Pressable used for share.
  // While revealing, plain tap skips. After revealing, plain tap is a
  // no-op (long-press still handles share where eligible).
  const handlePress = isRevealing ? skip : undefined;

  return (
    <Animated.View
      testID={message.streaming ? "bubble-bot-streaming" : "bubble-bot"}
      style={[styles.row, { opacity: fade, transform: [{ translateY: lift }] }]}
    >
      <Pressable
        onPress={handlePress}
        onLongPress={handleLongPress}
        delayLongPress={550}
        // Plain tap is a no-op except while typewriting (skip). Long
        // press handles share when eligible. We never `disabled` the
        // pressable so the typewriter-skip can always fire.
        accessibilityHint={
          isRevealing
            ? "Tap to reveal the full message"
            : shareEligible
              ? "Long press to share this reading as a card"
              : undefined
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
            ) : isRevealing ? (
              // Typewriter reveal in progress. Render plain Text with a
              // caret so partial markdown (mid-heading, mid-bold) doesn't
              // render as broken syntax. When the reveal finishes, this
              // branch falls through to the Markdown render below.
              <Text style={[styles.botText, isRTL && styles.textRTL]}>
                {revealed}
                <Text style={styles.caret}>▍</Text>
              </Text>
            ) : (
              // Completed bot message: render markdown so GPT's natural
              // headers (`### Sun in Pisces`), bold (`**term**`), and
              // bulleted lists become properly styled instead of showing
              // raw syntax characters. For Hebrew, apply RTL to every
              // text-bearing markdown style — body alone wasn't enough
              // for the chart-sigil bubble (tier headers, planet rows)
              // and long sections (h2 titles, paragraphs, bullets).
              <Markdown
                style={isRTL ? rtlMarkdownStyles : markdownStyles}
              >
                {text}
              </Markdown>
            )
          ) : null}
          {!message.streaming
            && !isRevealing
            && text.length >= PLAY_BUTTON_MIN_CHARS
            && !isChartSigilBubble(text) ? (
            <ActionBar text={text} />
          ) : null}
        </View>
      </Pressable>
    </Animated.View>
  );
}


// ─── Message action bar ───────────────────────────────────────────────────
//
// Renders a row of gold icon buttons under each substantial Layla bubble —
// like the action row under a ChatGPT message. Order: Copy · Listen · 👍 ·
// 👎 · Share. Listen keeps its label + visible state ("Playing…", "Loading…")
// because the user needs to know whether their tap took. The other actions
// fire-and-confirm via short toast-style "Copied" / "Thanks" labels that
// fade out after ~1.4s.

const ICON_SIZE = 17;
const ICON_STROKE = 1.7;

function CopyIcon({ color }: { color: string }) {
  return (
    <Svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 24 24" fill="none">
      <Path
        d="M9 9V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-4"
        stroke={color}
        strokeWidth={ICON_STROKE}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M5 9h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2Z"
        stroke={color}
        strokeWidth={ICON_STROKE}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function ThumbsUpIcon({ filled, color }: { filled: boolean; color: string }) {
  return (
    <Svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 24 24" fill="none">
      <Path
        d="M7 22V11M2 13v7a2 2 0 0 0 2 2h13.5a3 3 0 0 0 2.95-2.46l1.4-7A3 3 0 0 0 18.9 9H14V5a3 3 0 0 0-3-3l-4 9"
        stroke={color}
        strokeWidth={ICON_STROKE}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill={filled ? color : "none"}
        fillOpacity={filled ? 0.18 : 0}
      />
    </Svg>
  );
}

function ThumbsDownIcon({ filled, color }: { filled: boolean; color: string }) {
  return (
    <Svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 24 24" fill="none">
      <Path
        d="M17 2v11M22 11V4a2 2 0 0 0-2-2H6.5a3 3 0 0 0-2.95 2.46l-1.4 7A3 3 0 0 0 5.1 15H10v4a3 3 0 0 0 3 3l4-9"
        stroke={color}
        strokeWidth={ICON_STROKE}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill={filled ? color : "none"}
        fillOpacity={filled ? 0.18 : 0}
      />
    </Svg>
  );
}

function ShareIcon({ color }: { color: string }) {
  return (
    <Svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 3v13M8 7l4-4 4 4M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"
        stroke={color}
        strokeWidth={ICON_STROKE}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function PlayGlyph({ playing }: { playing: boolean }) {
  // Solid play/pause glyph in gold. Used inline next to the "Listen" /
  // "Playing…" label so state is visible at a glance.
  return playing ? (
    <Svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 24 24">
      <Path d="M6 4h4v16H6zM14 4h4v16h-4z" fill={theme.accent} />
    </Svg>
  ) : (
    <Svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 24 24">
      <Path d="M7 4v16l13-8Z" fill={theme.accent} />
    </Svg>
  );
}

function playButtonLabel(playing: boolean, busy: boolean, errLabel: string | null): string {
  if (playing) return "Playing…";
  if (busy) return "Loading…";
  if (errLabel) return errLabel;
  return "Listen";
}

type Vote = "up" | "down" | null;

function ActionBar({ text }: { text: string }) {
  const cacheKey = useMemo(() => bubbleCacheKey(text), [text]);
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errLabel, setErrLabel] = useState<string | null>(null);
  const [vote, setVote] = useState<Vote>(null);
  // Brief confirmation label ("Copied", "Thanks", "Noted") that fades
  // in next to the action row, then fades out ~1.4s later. Keeps the
  // bar from needing toasts or modal feedback.
  const [confirm, setConfirm] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = subscribePlaybackState((activeKey) => {
      setPlaying(activeKey === cacheKey);
    });
    return unsubscribe;
  }, [cacheKey]);

  // Auto-clear the transient confirmation chip.
  useEffect(() => {
    if (!confirm) return;
    const t = setTimeout(() => setConfirm(null), 1400);
    return () => clearTimeout(t);
  }, [confirm]);

  const onListen = async () => {
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

  const onCopy = async () => {
    try {
      await Clipboard.setStringAsync(text);
      setConfirm("Copied");
    } catch (e) {
      console.warn("[copy] failed", e);
      setConfirm("Copy failed");
    }
  };

  const onShare = async () => {
    try {
      await Share.share(
        Platform.OS === "ios" ? { message: text } : { message: text, title: "From Layla" },
      );
    } catch (e) {
      // user-cancelled share counts as a no-op; iOS throws on dismiss
      console.warn("[share] failed/cancelled", e);
    }
  };

  const onVote = (next: Exclude<Vote, null>) => {
    // Toggle off when re-tapping the same vote.
    const final = vote === next ? null : next;
    setVote(final);
    if (final === "up") setConfirm("Thanks");
    else if (final === "down") setConfirm("Noted");
    else setConfirm(null);
    // TODO(brain): when a feedback endpoint lands, POST {vote: final, text-hash}.
    // For now the local state + console signal is enough to design around.
    console.log("[feedback]", final, cacheKey);
  };

  const listenLabel = playButtonLabel(playing, busy, errLabel);
  const goldDim = theme.accent;

  return (
    <View style={styles.actionRow}>
      <ActionButton accessibilityLabel="Copy message" onPress={onCopy}>
        <CopyIcon color={goldDim} />
      </ActionButton>

      <Pressable
        onPress={onListen}
        accessibilityRole="button"
        accessibilityLabel={playing ? "Stop playback" : "Listen to this reading"}
        accessibilityState={{ busy, selected: playing }}
        style={({ pressed }) => [
          styles.listenButton,
          (playing || busy) && styles.listenButtonActive,
          pressed && { opacity: 0.7 },
        ]}
      >
        <PlayGlyph playing={playing} />
        <Text style={styles.listenLabel}>{listenLabel}</Text>
      </Pressable>

      <ActionButton
        accessibilityLabel="Good response"
        onPress={() => onVote("up")}
        selected={vote === "up"}
      >
        <ThumbsUpIcon filled={vote === "up"} color={goldDim} />
      </ActionButton>

      <ActionButton
        accessibilityLabel="Bad response"
        onPress={() => onVote("down")}
        selected={vote === "down"}
      >
        <ThumbsDownIcon filled={vote === "down"} color={goldDim} />
      </ActionButton>

      <ActionButton accessibilityLabel="Share message" onPress={onShare}>
        <ShareIcon color={goldDim} />
      </ActionButton>

      {confirm ? <Text style={styles.confirm}>{confirm}</Text> : null}
    </View>
  );
}

function ActionButton({
  children,
  onPress,
  accessibilityLabel,
  selected,
}: {
  children: React.ReactNode;
  onPress: () => void;
  accessibilityLabel: string;
  selected?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [
        styles.iconButton,
        selected && styles.iconButtonSelected,
        pressed && { opacity: 0.7 },
      ]}
      hitSlop={4}
    >
      {children}
    </Pressable>
  );
}

/**
 * Typewriter reveal for a completed bot bubble. Returns the
 * progressively-revealed text + a `skip` function that jumps to the
 * end. Idempotent across re-mounts — once `messageId` has been
 * revealed once, future calls return the full text immediately.
 *
 * `wasStreaming` short-circuits the reveal for bubbles that have
 * already streamed in token-by-token — the LLM stream IS the reveal
 * for those, no need to re-animate after the streaming caret turns off.
 */
function useTypewriter(
  text: string,
  messageId: string,
  enabled: boolean,
  wasStreaming: boolean,
): { revealed: string; isRevealing: boolean; skip: () => void } {
  // If this bubble streamed (now or in any past render), it stays
  // settled — the user already watched it appear.
  if (wasStreaming) STREAMED_BUBBLE_IDS.add(messageId);

  const shouldReveal =
    enabled &&
    !STREAMED_BUBBLE_IDS.has(messageId) &&
    !REVEALED_BUBBLE_IDS.has(messageId);

  const [revealed, setRevealed] = useState<string>(() =>
    shouldReveal ? "" : text,
  );
  const skipRef = useRef(false);

  useEffect(() => {
    if (!shouldReveal) {
      setRevealed(text);
      return;
    }
    REVEALED_BUBBLE_IDS.add(messageId);
    skipRef.current = false;

    // Duration scales with length but stays inside the readable band.
    // ~3.75ms/char baseline → 800 chars in 3s.
    const duration = Math.min(
      TYPEWRITER_MAX_DURATION_MS,
      Math.max(TYPEWRITER_MIN_DURATION_MS, text.length * 3.75),
    );
    // Clamp to TARGET if length exceeds it so super-long bubbles still
    // wrap within ~3-3.5s — readers should not have to wait > 5s for
    // a bubble to settle.
    const totalDuration = Math.min(duration, TYPEWRITER_TARGET_DURATION_MS + 1500);
    const start = Date.now();
    let rafId = 0;

    const tick = () => {
      if (skipRef.current) {
        setRevealed(text);
        return;
      }
      const elapsed = Date.now() - start;
      const progress = Math.min(1, elapsed / totalDuration);
      // Ease-out so the reveal slows toward the end — feels deliberate
      // rather than mechanical.
      const eased = 1 - Math.pow(1 - progress, 1.6);
      const len = Math.floor(text.length * eased);
      setRevealed(text.slice(0, len));
      if (progress < 1) {
        rafId = requestAnimationFrame(tick);
      } else {
        setRevealed(text);
      }
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messageId, shouldReveal]);

  return {
    revealed,
    isRevealing: revealed.length < text.length,
    skip: () => {
      skipRef.current = true;
      setRevealed(text);
    },
  };
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
  // ─── Action bar (copy · listen · 👍 · 👎 · share) ──────────────────────
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 8,
    // align with the bubble's text inset; row hugs the leading edge.
    alignSelf: "flex-start",
  },
  iconButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.borderStrong,
    backgroundColor: "rgba(212, 175, 90, 0.05)",
  },
  iconButtonSelected: {
    backgroundColor: "rgba(212, 175, 90, 0.18)",
    borderColor: theme.accent,
  },
  listenButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    height: 32,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.borderStrong,
    backgroundColor: "rgba(212, 175, 90, 0.08)",
  },
  listenButtonActive: {
    borderColor: theme.accent,
    backgroundColor: "rgba(212, 175, 90, 0.18)",
  },
  listenLabel: {
    color: theme.accent,
    fontSize: 13,
    fontWeight: "500",
    letterSpacing: 0.2,
  },
  confirm: {
    marginLeft: 6,
    color: theme.accent,
    fontSize: 12,
    fontFamily: theme.fontSerif,
    fontStyle: "italic",
    opacity: 0.75,
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
    // Used as a "section label" — appears on the chart-sigil bubble's
    // tier headers (Luminaries / Personal / Social / Outer / Points)
    // and occasionally on chat replies. Tracked-caps gold treatment
    // gives the manuscript-page feel the brand calls for. Smaller than
    // h1/h2 because it's a label, not a title.
    color: theme.accent,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "600" as const,
    marginTop: 14,
    marginBottom: 6,
    letterSpacing: 2,
    textTransform: "uppercase" as const,
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

// ─── RTL variant ──────────────────────────────────────────────────────────
//
// For Hebrew bubbles, apply textAlign: "right" + writingDirection: "rtl"
// to every text-bearing markdown style. Body alone wasn't enough for the
// chart-sigil bubble (tier headers + planet rows mixed glyphs/numbers
// with Hebrew text) and the deep-read sections (h2 titles, paragraphs,
// bullets). RN's bidi algorithm handles mixed-direction text fine when
// the container's primary direction is set per style.
const _rtl = <T extends object>(s: T): T => ({
  ...s,
  textAlign: "right",
  writingDirection: "rtl",
}) as unknown as T;

const rtlMarkdownStyles = {
  ...markdownStyles,
  body: _rtl(markdownStyles.body),
  paragraph: _rtl(markdownStyles.paragraph),
  heading1: _rtl(markdownStyles.heading1),
  heading2: _rtl(markdownStyles.heading2),
  heading3: _rtl(markdownStyles.heading3),
  heading4: _rtl(markdownStyles.heading4),
  blockquote: {
    ...markdownStyles.blockquote,
    // Mirror the left rule to the right edge for RTL.
    borderLeftWidth: 0,
    borderRightWidth: 2,
    borderRightColor: theme.accentDim,
    paddingLeft: 0,
    paddingRight: 12,
  },
  list_item: {
    ...markdownStyles.list_item,
    flexDirection: "row-reverse" as const,
  },
  bullet_list_icon: {
    ...markdownStyles.bullet_list_icon,
    marginRight: 0,
    marginLeft: 8,
  },
  ordered_list_icon: {
    ...markdownStyles.ordered_list_icon,
    marginRight: 0,
    marginLeft: 8,
  },
};
