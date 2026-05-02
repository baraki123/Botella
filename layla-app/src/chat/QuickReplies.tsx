import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { theme } from "../config/theme";

interface Props {
  options: string[];
  onPick: (option: string) => void;
}

export function QuickReplies({ options, onPick }: Props) {
  if (!options.length) return null;
  return (
    <View style={styles.row}>
      {options.map((opt) => (
        <Pressable
          key={opt}
          onPress={() => onPick(opt)}
          style={({ pressed }) => [
            styles.chip,
            pressed && styles.chipPressed,
          ]}
        >
          <Text style={styles.chipText}>{opt}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    paddingLeft: theme.spacing + 6 + 17, // align with Layla's text (after the gold dot)
    paddingRight: theme.spacing + 6,
    paddingTop: 2,
    paddingBottom: 12,
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
  },
  chipText: {
    color: theme.chipText,
    fontSize: 14,
    fontWeight: "500" as const,
    letterSpacing: 0.2,
  },
});
