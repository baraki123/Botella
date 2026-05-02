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
  const ready = !!value.trim() && !disabled;

  const submit = () => {
    if (!ready) return;
    onSend(value.trim());
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
          placeholder="Tell Layla…"
          placeholderTextColor={theme.textMuted}
          onSubmitEditing={submit}
          returnKeyType="send"
          editable={!disabled}
          blurOnSubmit={false}
          multiline
          // Web: Enter sends, Shift+Enter newlines.
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
          disabled={!ready}
          style={({ pressed }) => [
            styles.send,
            !ready && styles.sendDim,
            pressed && ready && styles.sendPressed,
          ]}
        >
          <SendIcon active={ready} />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

function SendIcon({ active }: { active: boolean }) {
  return (
    <View style={styles.iconWrap}>
      <View
        style={[
          styles.iconArrow,
          { borderLeftColor: active ? theme.bg : theme.textMuted },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 12,
    backgroundColor: theme.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.border,
    gap: 10,
  },
  input: {
    flex: 1,
    paddingVertical: 11,
    paddingHorizontal: 16,
    backgroundColor: theme.bg,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 22,
    fontSize: 16,
    color: theme.text,
    maxHeight: 140,
  },
  send: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: theme.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  sendDim: {
    backgroundColor: theme.surfaceRaised,
  },
  sendPressed: {
    backgroundColor: theme.accentDim,
  },
  iconWrap: { width: 18, height: 18, alignItems: "center", justifyContent: "center" },
  iconArrow: {
    width: 0,
    height: 0,
    borderLeftWidth: 9,
    borderRightWidth: 0,
    borderTopWidth: 6,
    borderBottomWidth: 6,
    borderTopColor: "transparent",
    borderBottomColor: "transparent",
    transform: [{ translateX: -2 }],
  },
});
