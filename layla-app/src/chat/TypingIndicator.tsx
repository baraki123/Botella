import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, View } from "react-native";

import { theme } from "../config/theme";

/**
 * Slow-pulsing trio of gold dots, no bubble — matches Layla's bubble-less
 * message style. Slower than typical chat dots; she's thinking, not typing.
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
  const opacity = useRef(new Animated.Value(0.25)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(opacity, { toValue: 0.85, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.25, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [delay, opacity]);
  return <Animated.View style={[styles.dot, { opacity }]} />;
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: theme.spacing + 6,
    marginVertical: 10,
    gap: 7,
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: theme.accent,
  },
});
