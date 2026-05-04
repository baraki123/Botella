import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, View } from "react-native";

import { theme } from "../config/theme";
import { useReducedMotion } from "../lib/useReducedMotion";

/**
 * Three gold dots that breathe — opacity AND a tiny scale pulse on each,
 * with a soft halo so the trio reads like quiet candle-flames rather than
 * the universal "typing" cliché. Slower than typical chat dots: she's
 * thinking, not typing. Reduced-motion users get the dots at fixed
 * mid-opacity, no animation.
 */
export function TypingIndicator() {
  return (
    <View style={styles.row}>
      <Dot delay={0} />
      <Dot delay={280} />
      <Dot delay={560} />
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
});
