import React, { useEffect, useRef } from "react";
import { Animated, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";

import { theme } from "../config/theme";
import { useReducedMotion } from "../lib/useReducedMotion";
import type { QuickReplyOption } from "./types";

interface Props {
  options: QuickReplyOption[];
  /** Called when a "value" or string-form option is tapped. The caller
   *  decides what to send to the server (`sendValue`) and what to show
   *  in the user-message bubble (`displayLabel`). They differ when the
   *  option is `{ label: "Continue →", value: "Continue →" }`-style or
   *  `{ label: "♃ My Jupiter", value: "Tell me about my Jupiter" }`-style
   *  — the chip shows the label, the user bubble may match either, and
   *  the server gets the value. URL-form options are NOT routed here;
   *  they open externally via Linking. */
  onPick: (sendValue: string, displayLabel: string) => void;
}

/**
 * Quick-reply chips. Stagger-fade in (40ms apart) so a row of options
 * doesn't snap into existence — feels invitational, not prescribed. URL
 * options render with a small arrow glyph and open the link externally
 * (e.g. WhatsApp / Telegram share sheets).
 */
export function QuickReplies({ options, onPick }: Props) {
  if (!options.length) return null;
  return (
    <View style={styles.row}>
      {options.map((opt, i) => (
        <Chip key={chipKey(opt, i)} option={opt} onPick={onPick} index={i} />
      ))}
    </View>
  );
}

function chipKey(opt: QuickReplyOption, i: number): string {
  if (typeof opt === "string") return `s:${opt}:${i}`;
  if ("url" in opt) return `u:${opt.url}:${i}`;
  return `v:${opt.value}:${i}`;
}

function Chip({
  option,
  onPick,
  index,
}: {
  option: QuickReplyOption;
  onPick: (sendValue: string, displayLabel: string) => void;
  index: number;
}) {
  const reduced = useReducedMotion();
  const fade = useRef(new Animated.Value(reduced ? 1 : 0)).current;
  const lift = useRef(new Animated.Value(reduced ? 0 : 6)).current;

  useEffect(() => {
    if (reduced) return;
    Animated.parallel([
      Animated.timing(fade, {
        toValue: 1,
        duration: 240,
        delay: index * 40,
        useNativeDriver: true,
      }),
      Animated.timing(lift, {
        toValue: 0,
        duration: 280,
        delay: index * 40,
        useNativeDriver: true,
      }),
    ]).start();
    // mount-only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isUrl = typeof option !== "string" && "url" in option;
  const label =
    typeof option === "string" ? option : option.label;
  // Doorway chips (post-map-read pivot) get a more contemplative
  // styling — softer glow, serif label, larger touch target. Recognised
  // by the stable `__doorway_*` value tokens emitted by the server.
  const isDoorway =
    typeof option !== "string" &&
    "value" in option &&
    typeof option.value === "string" &&
    option.value.startsWith("__doorway_");

  const handlePress = () => {
    if (typeof option === "string") {
      // Plain-string option — same value on the wire and in the bubble.
      onPick(option, option);
      return;
    }
    if ("url" in option) {
      Linking.openURL(option.url).catch(() => {});
      return;
    }
    // {label, value} — server gets value; user bubble shows label.
    onPick(option.value, option.label);
  };

  return (
    <Animated.View
      style={{ opacity: fade, transform: [{ translateY: lift }] }}
    >
      <Pressable
        onPress={handlePress}
        style={({ pressed }) => [
          styles.chip,
          isUrl && styles.chipUrl,
          isDoorway && styles.chipDoorway,
          pressed && styles.chipPressed,
          pressed && isDoorway && styles.chipDoorwayPressed,
        ]}
      >
        <Text style={[styles.chipText, isDoorway && styles.chipDoorwayText]}>
          {label}
        </Text>
        {isUrl ? <ExternalArrow /> : null}
      </Pressable>
    </Animated.View>
  );
}

function ExternalArrow() {
  // Outbound-arrow glyph — small, gold, sits to the right of the label.
  return (
    <View style={styles.arrowWrap}>
      <Svg width={11} height={11} viewBox="0 0 11 11">
        <Path
          d="M3 2 H9 V8 M9 2 L2 9"
          stroke={theme.accent}
          strokeWidth={1.6}
          strokeLinecap="round"
          fill="none"
        />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    paddingLeft: theme.spacing + 6 + 17, // align with Layla's text body
    paddingRight: theme.spacing + 6,
    paddingTop: 4,
    paddingBottom: 14,
    gap: 8,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingVertical: 9,
    paddingHorizontal: 16,
    borderRadius: 999,
    backgroundColor: theme.chip,
    borderWidth: 1,
    borderColor: theme.chipBorder,
  },
  chipUrl: {
    // URL options get a slightly warmer background so they read as
    // "this leaves the app" without losing the chip family resemblance.
    backgroundColor: theme.surfaceRaised,
    borderColor: theme.accentDim,
  },
  chipPressed: {
    backgroundColor: theme.surfaceRaised,
    borderColor: theme.accent,
    shadowColor: theme.accent,
    shadowOpacity: 0.4,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
    elevation: 2,
  },
  chipText: {
    color: theme.chipText,
    fontSize: 14,
    fontWeight: "500" as const,
    letterSpacing: 0.3,
  },
  // Doorway chips — bigger, more contemplative. Appears once after the
  // first map read; shouldn't blend in with chat-flow chips. Soft gold
  // halo on rest, brighter halo on press.
  chipDoorway: {
    paddingVertical: 13,
    paddingHorizontal: 18,
    borderRadius: 14,
    backgroundColor: theme.surfaceRaised,
    borderColor: theme.accentDim,
    shadowColor: theme.accent,
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
  },
  chipDoorwayPressed: {
    shadowOpacity: 0.55,
    shadowRadius: 12,
  },
  chipDoorwayText: {
    fontFamily: theme.fontSerif,
    fontSize: 16,
    fontWeight: "500" as const,
    letterSpacing: 0.35,
  },
  arrowWrap: { width: 11, height: 11 },
});
