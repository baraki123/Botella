/**
 * NewBeatMark — the "fresh text lives here" gutter indicator.
 *
 * Renders a hair-thin gold rule tracing upward from where Layla's gold
 * dot already sits, on the FIRST bubble that arrived while the user was
 * scrolled away. Calm and bookmark-like: peripheral vision catches the
 * mark, the user knows where the new beat starts, no CTA. Once they
 * return to the bottom of the conversation, the mark fades out and the
 * bubble looks identical to every other.
 *
 * Design choice: re-use the gold dot's existing position so the mark
 * doesn't add any layout width. The rule sits absolutely above the
 * dot; the dot itself gets a brief halo bloom on first appearance.
 *
 * Brand: `theme.accent` (#D4A574 — Layla's gold).
 */

import React, { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";

import { theme } from "../config/theme";

export const NEW_BEAT_RULE_HEIGHT = 18;

interface Props {
  /** When the parent bubble is the first unseen one. Drives in/out. */
  visible: boolean;
  /** RTL flips the mark to the right edge of the bubble (where Layla's
   * dot leads in Hebrew). Defaults to LTR (left gutter). */
  rtl?: boolean;
}

export function NewBeatMark({ visible, rtl = false }: Props) {
  const fade = useRef(new Animated.Value(0)).current;
  const traceHeight = useRef(new Animated.Value(0)).current;
  const dotBloom = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) {
      Animated.parallel([
        Animated.timing(fade, {
          toValue: 0,
          duration: 700,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: false,
        }),
        Animated.timing(traceHeight, {
          toValue: 0,
          duration: 500,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: false,
        }),
      ]).start();
      return;
    }
    // Sequenced reveal: rule traces in over ~520ms (like an ink stroke),
    // then the existing gold dot blooms once. Reads as "a small mark
    // was placed here while you were away."
    fade.setValue(0);
    traceHeight.setValue(0);
    dotBloom.setValue(0);
    Animated.parallel([
      Animated.timing(fade, {
        toValue: 1,
        duration: 380,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }),
      Animated.timing(traceHeight, {
        toValue: NEW_BEAT_RULE_HEIGHT,
        duration: 520,
        delay: 80,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }),
      Animated.sequence([
        Animated.delay(140),
        Animated.timing(dotBloom, {
          toValue: 1,
          duration: 520,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: false,
        }),
        Animated.timing(dotBloom, {
          toValue: 0.55,
          duration: 700,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: false,
        }),
      ]),
    ]).start();
  }, [visible, fade, traceHeight, dotBloom]);

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.wrap,
        rtl ? styles.wrapRTL : styles.wrapLTR,
        { opacity: fade },
      ]}
    >
      <Animated.View style={[styles.rule, { height: traceHeight }]} />
      <Animated.View
        style={[
          styles.haloDot,
          {
            shadowOpacity: dotBloom.interpolate({
              inputRange: [0, 1],
              outputRange: [0.35, 0.95],
            }),
            transform: [
              {
                scale: dotBloom.interpolate({
                  inputRange: [0, 1],
                  outputRange: [1, 1.45],
                }),
              },
            ],
          },
        ]}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // Sits behind the existing botDot in the same gutter slot. The wrap
  // is zero-width so it doesn't push botContent — the dot + rule float.
  wrap: {
    position: "absolute",
    top: 0,
    width: 6, // same as the botDot width
    alignItems: "center",
  },
  wrapLTR: { left: 0 },
  wrapRTL: { right: 0 },
  rule: {
    width: StyleSheet.hairlineWidth + 0.5,
    backgroundColor: theme.accent,
    opacity: 0.55,
    marginBottom: 3,
  },
  // A second dot stacked under the existing botDot — sole purpose is to
  // give the bloom its own animated shadow without re-animating the
  // bubble's primary dot (which has its own enter-scale already).
  haloDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: theme.accent,
    marginTop: 8, // aligns under where the botDot sits (botDot.marginTop = 11)
    shadowColor: theme.accent,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
  },
});
