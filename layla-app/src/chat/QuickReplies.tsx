import React, { useEffect, useRef } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";

import { theme } from "../config/theme";
import { useReducedMotion } from "../lib/useReducedMotion";

interface Props {
  options: string[];
  onPick: (option: string) => void;
}

/**
 * Quick-reply chips. Stagger-fade in (40ms apart) so a row of options
 * doesn't snap into existence — feels invitational, not prescribed. Hover
 * (web) and press states tint the border to gold so it's obvious which
 * chip is being chosen.
 */
export function QuickReplies({ options, onPick }: Props) {
  if (!options.length) return null;
  return (
    <View style={styles.row}>
      {options.map((opt, i) => (
        <Chip key={opt} label={opt} onPress={() => onPick(opt)} index={i} />
      ))}
    </View>
  );
}

function Chip({
  label,
  onPress,
  index,
}: {
  label: string;
  onPress: () => void;
  index: number;
}) {
  const reduced = useReducedMotion();
  const fade = useRef(new Animated.Value(reduced ? 1 : 0)).current;
  const lift = useRef(new Animated.Value(reduced ? 0 : 6)).current;

  useEffect(() => {
    if (reduced) return;
    Animated.parallel([
      Animated.timing(fade, {
        toValue: 1,
        duration: 240,
        delay: index * 40,
        useNativeDriver: true,
      }),
      Animated.timing(lift, {
        toValue: 0,
        duration: 280,
        delay: index * 40,
        useNativeDriver: true,
      }),
    ]).start();
    // mount-only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Animated.View
      style={{ opacity: fade, transform: [{ translateY: lift }] }}
    >
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [
          styles.chip,
          pressed && styles.chipPressed,
        ]}
      >
        <Text style={styles.chipText}>{label}</Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    paddingLeft: theme.spacing + 6 + 17, // align with Layla's text body
    paddingRight: theme.spacing + 6,
    paddingTop: 4,
    paddingBottom: 14,
    gap: 8,
  },
  chip: {
    paddingVertical: 9,
    paddingHorizontal: 16,
    borderRadius: 999,
    backgroundColor: theme.chip,
    borderWidth: 1,
    borderColor: theme.chipBorder,
  },
  chipPressed: {
    backgroundColor: theme.surfaceRaised,
    borderColor: theme.accent,
    shadowColor: theme.accent,
    shadowOpacity: 0.4,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
    elevation: 2,
  },
  chipText: {
    color: theme.chipText,
    fontSize: 14,
    fontWeight: "500" as const,
    letterSpacing: 0.3,
  },
});
