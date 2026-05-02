import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { theme } from "../config/theme";
import type { Message } from "./types";

interface Props {
  message: Message;
}

export function Bubble({ message }: Props) {
  const isUser = message.role === "user";
  return (
    <View
      style={[
        styles.row,
        { justifyContent: isUser ? "flex-end" : "flex-start" },
      ]}
    >
      <View
        style={[
          styles.bubble,
          isUser ? styles.bubbleUser : styles.bubbleBot,
          isUser
            ? { borderBottomRightRadius: 4 }
            : { borderBottomLeftRadius: 4 },
        ]}
      >
        <Text
          style={isUser ? styles.textUser : styles.textBot}
          // The server sometimes emits HTML (<b>, <i>) for Telegram parity.
          // For a v0 demo we strip HTML to keep things readable on mobile.
        >
          {stripHtml(message.text)}
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
    flexDirection: "row",
    paddingHorizontal: theme.spacing,
    marginVertical: 4,
  },
  bubble: {
    maxWidth: "85%",
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: theme.radius,
  },
  bubbleUser: { backgroundColor: theme.bubbleUser },
  bubbleBot: { backgroundColor: theme.bubbleBot },
  textUser: { color: theme.bubbleUserText, fontSize: 16, lineHeight: 22 },
  textBot: { color: theme.bubbleBotText, fontSize: 16, lineHeight: 22 },
  caret: { opacity: 0.5 },
});
