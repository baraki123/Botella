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
  /** Show a microphone button (web only for now). */
  voiceEnabled?: boolean;
  onToggleRecord?: () => void;
  recording?: boolean;
  transcribing?: boolean;
}

export function Composer({
  onSend,
  disabled,
  voiceEnabled,
  onToggleRecord,
  recording,
  transcribing,
}: Props) {
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
          value={recording ? "" : value}
          onChangeText={setValue}
          placeholder={
            recording
              ? "Listening…"
              : transcribing
              ? "Transcribing…"
              : "Message"
          }
          placeholderTextColor={theme.textSubtle}
          onSubmitEditing={submit}
          returnKeyType="send"
          editable={!disabled && !recording && !transcribing}
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
        {voiceEnabled && !ready ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={recording ? "stop recording" : "record voice"}
            onPress={onToggleRecord}
            disabled={transcribing}
            style={({ pressed }) => [
              styles.send,
              recording && { backgroundColor: "#c85b6f" },
              pressed && { opacity: 0.7 },
            ]}
          >
            <MicIcon />
          </Pressable>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="send"
            onPress={submit}
            disabled={!ready}
            style={({ pressed }) => [
              styles.send,
              !ready && { opacity: 0.4 },
              pressed && { opacity: 0.7 },
            ]}
          >
            <SendIcon />
          </Pressable>
        )}
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

function MicIcon() {
  return (
    <View style={styles.iconWrap}>
      <View style={styles.micBody} />
      <View style={styles.micBase} />
      <View style={styles.micStem} />
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
  micBody: {
    position: "absolute",
    width: 6,
    height: 9,
    top: 1,
    borderRadius: 3,
    backgroundColor: "#FFFFFF",
  },
  micStem: {
    position: "absolute",
    width: 1.5,
    height: 3,
    bottom: 2,
    backgroundColor: "#FFFFFF",
  },
  micBase: {
    position: "absolute",
    width: 8,
    height: 1.5,
    bottom: 0,
    backgroundColor: "#FFFFFF",
  },
});
