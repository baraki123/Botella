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
          testID={`chip-${opt}`}
          accessibilityRole="button"
          accessibilityLabel={opt}
          onPress={() => onPick(opt)}
          style={({ pressed }) => [
            styles.chip,
            pressed && { opacity: 0.7 },
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
    paddingHorizontal: theme.spacing,
    paddingTop: 4,
    paddingBottom: 8,
    gap: 8,
  },
  chip: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: theme.chip,
    borderWidth: 1,
    borderColor: theme.chipBorder,
  },
  chipText: {
    color: theme.chipText,
    fontSize: 15,
    fontWeight: "500",
  },
});
