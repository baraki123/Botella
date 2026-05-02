import React, { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from "react-native";

import { theme } from "../config/theme";

interface Props {
  onSend: (text: string) => void;
  disabled?: boolean;
}

export function Composer({ onSend, disabled }: Props) {
  const [value, setValue] = useState("");

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue("");
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={0}
    >
      <View style={styles.bar}>
        <TextInput
          style={styles.input}
          value={value}
          onChangeText={setValue}
          placeholder="Message"
          placeholderTextColor={theme.textSubtle}
          onSubmitEditing={submit}
          returnKeyType="send"
          editable={!disabled}
          blurOnSubmit={false}
          multiline
          // Web: with multiline, Enter normally inserts a newline. For a chat
          // composer the standard UX is Enter=send, Shift+Enter=newline.
          onKeyPress={
            Platform.OS === "web"
              ? (e: any) => {
                  const ne = e.nativeEvent || {};
                  if (ne.key === "Enter" && !ne.shiftKey) {
                    e.preventDefault?.();
                    submit();
                  }
                }
              : undefined
          }
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="send"
          onPress={submit}
          disabled={!value.trim() || disabled}
          style={({ pressed }) => [
            styles.send,
            (!value.trim() || disabled) && { opacity: 0.4 },
            pressed && { opacity: 0.7 },
          ]}
        >
          <SendIcon />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

function SendIcon() {
  // Simple unicode arrow keeps the template font-free.
  return (
    <View style={styles.iconWrap}>
      <View style={styles.iconArrow} />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "flex-end",
    padding: 8,
    backgroundColor: theme.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.border,
    gap: 8,
  },
  input: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 14,
    backgroundColor: theme.bg,
    borderRadius: 22,
    fontSize: 16,
    color: theme.text,
    maxHeight: 120,
  },
  send: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: theme.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  iconWrap: { width: 18, height: 18, alignItems: "center", justifyContent: "center" },
  iconArrow: {
    width: 0,
    height: 0,
    borderLeftWidth: 9,
    borderRightWidth: 0,
    borderTopWidth: 6,
    borderBottomWidth: 6,
    borderLeftColor: "#FFFFFF",
    borderTopColor: "transparent",
    borderBottomColor: "transparent",
    transform: [{ translateX: -2 }],
  },
});
