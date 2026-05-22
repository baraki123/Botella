import { LinearGradient } from "expo-linear-gradient";
import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  InputAccessoryView,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

// Single, app-wide nativeID for the 0-height accessory view that hides
// iOS's QuickType bar without forcing autocomplete off. See the comment
// near the TextInput for why this is needed instead of toggling
// spellCheck.
const QUICKTYPE_HIDE_ACCESSORY_ID = "composer-hide-quicktype";

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
  /** Bottom safe-area inset to clear the home indicator when keyboard is
   * closed. KeyboardAvoidingView in the parent already handles the rise
   * when the keyboard appears. */
  bottomInset?: number;
  /** Active language — drives placeholder + status-banner copy + RTL
   * text alignment. Defaults to "en". */
  lang?: "en" | "he";
}

const STRINGS = {
  en: {
    idle: "Tell Layla…",
    recording: "Listening…",
    transcribing: "Transcribing…",
    reconnecting: "Reconnecting — keep typing, your messages will send.",
    offline: "Offline. Your messages will send when we're back.",
  },
  he: {
    idle: "ספרי ללילה…",
    recording: "מקשיבה…",
    transcribing: "מתמללת…",
    reconnecting: "מתחברת מחדש — אפשר להמשיך להקליד, ההודעות יישלחו.",
    offline: "במצב לא מקוון. ההודעות יישלחו כשנחזור.",
  },
} as const;

// Auto-dismiss the keyboard after this many ms of typing inactivity
// (no onChangeText fires for the duration). Re-armed on every keystroke.
// Source of truth lives in useChatScroll.ts (canonical scroll +
// keyboard contract). Importing the constant here so we don't have
// two different "3 seconds" living in two files.
import { IDLE_KEYBOARD_DISMISS_MS } from "./useChatScroll";


export function Composer({
  onSend,
  status = "open",
  voiceEnabled,
  onToggleRecord,
  recording,
  transcribing,
  bottomInset = 0,
  lang = "en",
}: Props) {
  const t = STRINGS[lang] ?? STRINGS.en;
  const isRTL = lang === "he";
  const [value, setValue] = useState("");
  const [focused, setFocused] = useState(false);
  const ready = !!value.trim();
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearIdleTimer = () => {
    if (idleTimerRef.current !== null) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
  };

  const armIdleTimer = () => {
    clearIdleTimer();
    idleTimerRef.current = setTimeout(() => {
      Keyboard.dismiss();
      idleTimerRef.current = null;
    }, IDLE_KEYBOARD_DISMISS_MS);
  };

  const handleChangeText = (next: string) => {
    setValue(next);
    armIdleTimer();
  };

  // Clean up timer on unmount.
  useEffect(() => () => clearIdleTimer(), []);

  const submit = () => {
    if (!ready) return;
    clearIdleTimer();
    onSend(value.trim());
    setValue("");
  };

  return (
    <View>
      {status !== "open" ? (
        <View style={styles.statusBanner}>
          <View style={styles.statusBannerDot} />
          <Text style={styles.statusBannerText}>
            {status === "connecting" ? t.reconnecting : t.offline}
          </Text>
        </View>
      ) : null}
      <View style={[styles.bar, { paddingBottom: 14 + bottomInset }]}>
        <View
          style={[
            styles.inputWrap,
            focused && styles.inputWrapFocused,
          ]}
        >
          <TextInput
            style={[styles.input, isRTL && styles.inputRTL]}
            testID="composer-input"
            accessibilityLabel="composer input"
            value={recording ? "" : value}
            onChangeText={handleChangeText}
            onFocus={() => {
              setFocused(true);
              // Don't dismiss immediately on focus — only after idle.
              // Arm the timer so simply opening the keyboard without
              // typing also closes it after 3s.
              armIdleTimer();
            }}
            onBlur={() => {
              setFocused(false);
              clearIdleTimer();
            }}
            placeholder={
              recording ? t.recording : transcribing ? t.transcribing : t.idle
            }
            placeholderTextColor={theme.textMuted}
            onSubmitEditing={submit}
            returnKeyType="send"
            editable={!recording && !transcribing}
            blurOnSubmit={false}
            multiline
            // Spell-check ON (red squiggle on misspelled names),
            // autocorrect OFF (no auto-replacement). On iOS, that combo
            // would normally leave an EMPTY QuickType suggestion bar
            // above the keyboard — the prediction infrastructure stays
            // on for spell-check, so the bar's chrome renders even when
            // it has nothing to show. We hide it by giving the
            // TextInput an inputAccessoryViewID pointing at a 0-height
            // accessory view (rendered below). iOS swaps QuickType out
            // for the accessory; height 0 = strip disappears entirely.
            autoCorrect={false}
            spellCheck
            autoComplete="off"
            inputAccessoryViewID={
              Platform.OS === "ios" ? QUICKTYPE_HIDE_ACCESSORY_ID : undefined
            }
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
      {/* iOS-only: empty accessory view that replaces the QuickType
          suggestion bar with nothing. See the TextInput's
          inputAccessoryViewID for why. Android ignores nativeID. */}
      {Platform.OS === "ios" ? (
        <InputAccessoryView nativeID={QUICKTYPE_HIDE_ACCESSORY_ID}>
          <View style={{ height: 0 }} />
        </InputAccessoryView>
      ) : null}
    </View>
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
      testID="send-button"
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
      testID="mic-button"
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
    fontSize: 17,
    color: theme.text,
    maxHeight: 140,
    lineHeight: 24,
    // RN-Web injects a browser focus ring on the underlying <textarea>;
    // suppress so our amber inputWrapFocused border is the only focus cue.
    ...(Platform.OS === "web" ? ({ outlineStyle: "none" } as any) : {}),
  },
  inputRTL: {
    // textAlign: "auto" lets iOS pick direction per-character based on
    // the first strongly-directional code-point typed. RTL Hebrew text
    // aligns right; LTR English text aligns left — even when the
    // session lang is Hebrew. Hardcoding "right" leaked Hebrew-session
    // alignment onto English-typed words (e.g. names, English brand
    // names mid-Hebrew sentence) which read backwards.
    textAlign: "auto",
    // writingDirection still RTL so the cursor placement on an empty
    // input follows the session's primary direction. Per-character
    // alignment overrides this once the user types anything.
    writingDirection: "rtl",
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
