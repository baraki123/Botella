import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, View } from "react-native";

import { theme } from "../config/theme";

export function TypingIndicator() {
  return (
    <View style={styles.row}>
      <View style={styles.bubble}>
        <Dot delay={0} />
        <Dot delay={150} />
        <Dot delay={300} />
      </View>
    </View>
  );
}

function Dot({ delay }: { delay: number }) {
  const opacity = useRef(new Animated.Value(0.3)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(opacity, { toValue: 1, duration: 400, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.3, duration: 400, useNativeDriver: true }),
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
    paddingHorizontal: theme.spacing,
    marginVertical: 4,
  },
  bubble: {
    flexDirection: "row",
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: theme.radius,
    borderBottomLeftRadius: 4,
    backgroundColor: theme.bubbleBot,
    gap: 4,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: theme.textSubtle,
  },
});
