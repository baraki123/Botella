import React, { useEffect, useRef } from "react";
import { Animated, Image, Pressable, StyleSheet, Text, View } from "react-native";
// @ts-ignore — no shipped types
import Markdown from "react-native-markdown-display";

import { theme } from "../config/theme";
import { useReducedMotion } from "../lib/useReducedMotion";
import type { Message } from "./types";

interface Props {
  message: Message;
  /** Called when the user taps an inline image. Caller opens the
   * full-screen lightbox. */
  onImagePress?: (uri: string) => void;
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
export function Bubble({ message, onImagePress }: Props) {
  const isUser = message.role === "user";
  const text = stripHtml(message.text);
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
    return (
      <Animated.View
        style={[
          styles.row,
          styles.rowUser,
          { opacity: fade, transform: [{ translateY: lift }] },
        ]}
      >
        <View style={styles.userBubble}>
          <Text style={styles.userText}>
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

  return (
    <Animated.View
      style={[styles.row, { opacity: fade, transform: [{ translateY: lift }] }]}
    >
      <View style={styles.botRow}>
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
              <Text style={styles.botText}>
                {text}
                <Text style={styles.caret}>▍</Text>
              </Text>
            ) : (
              // Completed bot message: render markdown so GPT's natural
              // headers (`### Sun in Pisces`), bold (`**term**`), and
              // bulleted lists become properly styled instead of showing
              // raw syntax characters.
              <Markdown style={markdownStyles}>{text}</Markdown>
            )
          ) : null}
        </View>
      </View>
    </Animated.View>
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
