import React, { useEffect, useRef, useState } from "react";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";

import { theme } from "../config/theme";
import { useReducedMotion } from "../lib/useReducedMotion";

/**
 * Three gold dots that breathe. After ~5s of typing, transition to a
 * "deep-read" mode: a slow filling gold hairline + rotating Layla-voiced
 * progress lines. Used for long beats (the first map read = 60s LLM).
 *
 * - dots only:      < 5s of typing
 * - dots + filling: 5-90s — gold line fills slowly L→R, rotating label
 *                   cycles every ~6s with a soft fade between
 * - if typing keeps going past 90s, the bar holds at ~95% (user knows
 *   we're still working but doesn't see "done" then nothing arrive).
 */
const PROGRESS_LABELS_EN = [
  "Looking at your luminaries…",
  "Reading the angles…",
  "Listening to your stelliums…",
  "Mapping the aspects…",
  "Tracing the shadow…",
  "Finding the through-line…",
  "Watching the patterns settle…",
  "Almost ready…",
];
const PROGRESS_LABELS_HE = [
  "מסתכלת על המאורות שלך…",
  "קוראת את הזוויות…",
  "מקשיבה לסטליום…",
  "מציירת את ההיבטים…",
  "מתחקה אחר הצל…",
  "מוצאת את החוט המקשר…",
  "מתבוננת איך הדפוסים מתיישבים…",
  "כמעט מוכנה…",
];

const ENTER_PROGRESS_AFTER_MS = 5_000;
const FILL_DURATION_MS = 60_000;
const LABEL_CYCLE_MS = 6_000;

export function TypingIndicator({ lang }: { lang?: string } = {}) {
  const reduced = useReducedMotion();
  const [showProgress, setShowProgress] = useState(false);
  const [labelIdx, setLabelIdx] = useState(0);
  const fill = useRef(new Animated.Value(0)).current;
  const labelOpacity = useRef(new Animated.Value(1)).current;

  const labels = lang === "he" ? PROGRESS_LABELS_HE : PROGRESS_LABELS_EN;

  useEffect(() => {
    const t = setTimeout(() => setShowProgress(true), ENTER_PROGRESS_AFTER_MS);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!showProgress || reduced) return;
    // Start the slow fill once we enter progress mode. Cap at 0.95 so the
    // user never sees "done" while still waiting.
    Animated.timing(fill, {
      toValue: 0.95,
      duration: FILL_DURATION_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [showProgress, reduced, fill]);

  useEffect(() => {
    if (!showProgress) return;
    const tick = setInterval(() => {
      // Crossfade label out → swap → fade in.
      Animated.sequence([
        Animated.timing(labelOpacity, { toValue: 0, duration: 280, useNativeDriver: true }),
      ]).start(() => {
        setLabelIdx((i) => (i + 1) % labels.length);
        Animated.timing(labelOpacity, { toValue: 1, duration: 320, useNativeDriver: true }).start();
      });
    }, LABEL_CYCLE_MS);
    return () => clearInterval(tick);
  }, [showProgress, labels.length, labelOpacity]);

  const fillWidth = fill.interpolate({
    inputRange: [0, 1],
    outputRange: ["0%", "100%"],
  });

  return (
    <View style={styles.row}>
      <Dot delay={0} />
      <Dot delay={280} />
      <Dot delay={560} />
      {showProgress ? (
        <View style={styles.progressWrap}>
          <View style={styles.barTrack}>
            <Animated.View style={[styles.barFill, { width: fillWidth }]} />
          </View>
          <Animated.Text style={[styles.label, { opacity: labelOpacity }]}>
            {labels[labelIdx]}
          </Animated.Text>
        </View>
      ) : null}
    </View>
  );
}

function Dot({ delay }: { delay: number }) {
  const reduced = useReducedMotion();
  const pulse = useRef(new Animated.Value(reduced ? 0.6 : 0.25)).current;

  useEffect(() => {
    if (reduced) {
      pulse.setValue(0.55);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.25, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [delay, pulse, reduced]);

  // pulse drives BOTH opacity (0.25→1) and scale (0.85→1.05). Native driver
  // handles both transforms in the same frame, so this stays free.
  const opacity = pulse;
  const scale = pulse.interpolate({
    inputRange: [0.25, 1],
    outputRange: [0.85, 1.05],
  });

  return (
    <Animated.View
      style={[styles.dot, { opacity, transform: [{ scale }] }]}
    />
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: theme.spacing + 6 + 17, // align with Layla's text body
    marginVertical: 12,
    gap: 8,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: theme.accent,
    shadowColor: theme.accent,
    shadowOpacity: 0.55,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 0 },
  },
  progressWrap: {
    flex: 1,
    marginLeft: 12,
    gap: 6,
    paddingRight: theme.spacing + 6,
  },
  barTrack: {
    height: 1,
    backgroundColor: theme.border,
    borderRadius: 0.5,
    overflow: "hidden",
  },
  barFill: {
    height: 1,
    backgroundColor: theme.accent,
    shadowColor: theme.accent,
    shadowOpacity: 0.6,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 0 },
  },
  label: {
    color: theme.textSubtle,
    fontFamily: theme.fontSerifItalic,
    fontSize: 13,
    letterSpacing: 0.3,
  },
});
