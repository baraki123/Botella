import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { theme } from "../config/theme";
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
 */
export function Bubble({ message }: Props) {
  const isUser = message.role === "user";
  const text = stripHtml(message.text);

  if (isUser) {
    return (
      <View style={[styles.row, styles.rowUser]}>
        <View style={styles.userBubble}>
          <Text style={styles.userText}>
            {text}
            {message.streaming ? <Text style={styles.caret}>▍</Text> : null}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.row}>
      <View style={styles.botRow}>
        <View style={styles.botDot} />
        <Text style={styles.botText}>
          {text}
          {message.streaming ? <Text style={styles.caret}>▍</Text> : null}
        </Text>
      </View>
    </View>
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
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: theme.radius,
    borderBottomRightRadius: 6,
    backgroundColor: theme.bubbleUser,
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
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: theme.accent,
    marginTop: 11, // visual-align with first line of text
  },
  botText: {
    flex: 1,
    color: theme.bubbleBotText,
    fontSize: 17,
    lineHeight: 26,
    letterSpacing: 0.1,
  },
  caret: { opacity: 0.5, color: theme.accent },
});
