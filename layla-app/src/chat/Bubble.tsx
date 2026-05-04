import React, { useEffect, useRef } from "react";
import { Animated, Image, StyleSheet, Text, View } from "react-native";

import { theme } from "../config/theme";
import { useReducedMotion } from "../lib/useReducedMotion";
import type { Message } from "./types";

interface Props {
  message: Message;
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
export function Bubble({ message }: Props) {
  const isUser = message.role === "user";
  const text = stripHtml(message.text);
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
            <Image
              source={{ uri: message.imageUrl }}
              style={styles.image}
              resizeMode="contain"
            />
          ) : null}
          {text ? (
            <Text style={styles.botText}>
              {text}
              {message.streaming ? <Text style={styles.caret}>▍</Text> : null}
            </Text>
          ) : null}
        </View>
      </View>
    </Animated.View>
  );
}

function stripHtml(s: string): string {
  return s.replace(/<\/?[^>]+>/g, "");
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
    fontSize: 16,
    lineHeight: 23,
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
    fontSize: 17,
    lineHeight: 26,
    letterSpacing: 0.1,
  },
  image: {
    width: "100%",
    aspectRatio: 1,
    borderRadius: 14,
    backgroundColor: "#0006",
  },
  caret: { opacity: 0.5, color: theme.accent },
});
