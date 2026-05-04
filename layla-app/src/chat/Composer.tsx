import React, { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { theme } from "../config/theme";

interface Props {
  onSend: (text: string) => void;
  /** Connection status — for a small visual cue, NOT for blocking input.
   * Messages typed while not "open" are queued and flushed on reconnect. */
  status?: "open" | "connecting" | "closed";
  /** Show a microphone button (web only for now). */
  voiceEnabled?: boolean;
  /** Tap toggles record on/off. Caller owns the recording lifecycle. */
  onToggleRecord?: () => void;
  /** Indicates we're actively capturing audio. */
  recording?: boolean;
  /** True while the audio is uploading + transcribing. */
  transcribing?: boolean;
}

export function Composer({
  onSend,
  status = "open",
  voiceEnabled,
  onToggleRecord,
  recording,
  transcribing,
}: Props) {
  const [value, setValue] = useState("");
  const ready = !!value.trim();

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
      {status !== "open" ? (
        <View style={styles.statusBanner}>
          <View style={styles.statusBannerDot} />
          <Text style={styles.statusBannerText}>
            {status === "connecting"
              ? "Reconnecting — keep typing, your messages will send."
              : "Offline. Your messages will send when we're back."}
          </Text>
        </View>
      ) : null}
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
              : "Tell Layla…"
          }
          placeholderTextColor={theme.textMuted}
          onSubmitEditing={submit}
          returnKeyType="send"
          editable={!recording && !transcribing}
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
        {voiceEnabled && !ready ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={recording ? "stop recording" : "record voice"}
            onPress={onToggleRecord}
            disabled={transcribing}
            style={({ pressed }) => [
              styles.send,
              recording && styles.micRecording,
              !recording && styles.micIdle,
              pressed && styles.sendPressed,
            ]}
          >
            <MicIcon active={!!recording} />
          </Pressable>
        ) : (
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
        )}
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

function MicIcon({ active }: { active: boolean }) {
  // Minimal mic glyph — vertical capsule + base + stem. Stays simple so it
  // reads at 18px on mobile.
  const fg = active ? theme.bg : theme.text;
  return (
    <View style={styles.iconWrap}>
      <View style={[styles.micBody, { backgroundColor: fg }]} />
      <View style={[styles.micBase, { backgroundColor: fg }]} />
      <View style={[styles.micStem, { backgroundColor: fg }]} />
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
  micBody: {
    position: "absolute",
    width: 6,
    height: 9,
    top: 1,
    borderRadius: 3,
  },
  micStem: {
    position: "absolute",
    width: 1.5,
    height: 3,
    bottom: 2,
  },
  micBase: {
    position: "absolute",
    width: 8,
    height: 1.5,
    bottom: 0,
  },
  micIdle: {
    backgroundColor: theme.surfaceRaised,
  },
  micRecording: {
    backgroundColor: "#c85b6f",
  },
  statusBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: theme.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.border,
  },
  statusBannerDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: theme.statusConnecting,
  },
  statusBannerText: {
    flex: 1,
    color: theme.textSubtle,
    fontSize: 12,
    letterSpacing: 0.2,
  },
});
