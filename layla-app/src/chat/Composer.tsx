import { LinearGradient } from "expo-linear-gradient";
import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { theme } from "../config/theme";
import { useReducedMotion } from "../lib/useReducedMotion";

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
  const [focused, setFocused] = useState(false);
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
        <View
          style={[
            styles.inputWrap,
            focused && styles.inputWrapFocused,
          ]}
        >
          <TextInput
            style={styles.input}
            value={recording ? "" : value}
            onChangeText={setValue}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
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
        </View>
        {voiceEnabled && !ready ? (
          <MicButton
            onPress={onToggleRecord}
            recording={!!recording}
            transcribing={!!transcribing}
          />
        ) : (
          <SendButton onPress={submit} ready={ready} />
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

function SendButton({
  onPress,
  ready,
}: {
  onPress: () => void;
  ready: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="send"
      onPress={onPress}
      disabled={!ready}
      style={({ pressed }) => [
        styles.sendShell,
        pressed && ready && { opacity: 0.85 },
      ]}
    >
      {ready ? (
        <LinearGradient
          colors={["#E5BD92", "#D4A574", "#B7884E"]}
          locations={[0, 0.55, 1]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.sendCore, styles.sendCoreActive]}
        >
          <SendIcon active />
        </LinearGradient>
      ) : (
        <View style={[styles.sendCore, styles.sendCoreDim]}>
          <SendIcon active={false} />
        </View>
      )}
    </Pressable>
  );
}

function MicButton({
  onPress,
  recording,
  transcribing,
}: {
  onPress?: () => void;
  recording: boolean;
  transcribing: boolean;
}) {
  const reduced = useReducedMotion();
  const ring = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!recording || reduced) {
      ring.stopAnimation();
      ring.setValue(recording && reduced ? 0.5 : 0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(ring, { toValue: 1, duration: 1100, useNativeDriver: true }),
        Animated.timing(ring, { toValue: 0, duration: 0, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [recording, reduced, ring]);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={recording ? "stop recording" : "record voice"}
      onPress={onPress}
      disabled={transcribing}
      style={({ pressed }) => [
        styles.sendShell,
        pressed && { opacity: 0.85 },
      ]}
    >
      {/* Pulse ring — only renders while recording. Scales 1 → 1.6 and
          fades 0.55 → 0 over 1.1s, on a loop. Reduced-motion users get
          a static ring at mid-opacity so the state is still legible. */}
      {recording ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.micRing,
            {
              opacity: ring.interpolate({
                inputRange: [0, 1],
                outputRange: [0.55, 0],
              }),
              transform: [
                {
                  scale: ring.interpolate({
                    inputRange: [0, 1],
                    outputRange: [1, 1.6],
                  }),
                },
              ],
            },
          ]}
        />
      ) : null}
      <View
        style={[
          styles.sendCore,
          recording ? styles.micCoreRecording : styles.micCoreIdle,
        ]}
      >
        <MicIcon active={recording} />
      </View>
    </Pressable>
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
    paddingTop: 10,
    paddingBottom: 14,
    backgroundColor: theme.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.border,
    gap: 10,
  },
  inputWrap: {
    flex: 1,
    backgroundColor: theme.bg,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 22,
    overflow: "hidden",
  },
  inputWrapFocused: {
    borderColor: theme.accentDim,
    shadowColor: theme.accent,
    shadowOpacity: 0.28,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
    elevation: 2,
  },
  input: {
    paddingVertical: 11,
    paddingHorizontal: 16,
    fontSize: 16,
    color: theme.text,
    maxHeight: 140,
    lineHeight: 22,
  },
  sendShell: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  sendCore: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
  },
  sendCoreActive: {
    shadowColor: theme.accent,
    shadowOpacity: 0.55,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  sendCoreDim: {
    backgroundColor: theme.surfaceRaised,
  },
  micCoreIdle: {
    backgroundColor: theme.surfaceRaised,
    borderWidth: 1,
    borderColor: theme.border,
  },
  micCoreRecording: {
    backgroundColor: theme.accent,
    shadowColor: theme.accent,
    shadowOpacity: 0.7,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
    elevation: 4,
  },
  micRing: {
    position: "absolute",
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 2,
    borderColor: theme.accent,
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
