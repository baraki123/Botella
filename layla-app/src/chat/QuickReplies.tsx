import React, { useEffect, useRef } from "react";
import { Animated, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";

import { theme } from "../config/theme";
import { useReducedMotion } from "../lib/useReducedMotion";
import {
  DoorwayChip,
  isKnownDoorwayToken,
  stripLeadingEmoji,
  type DoorwayToken,
} from "./DoorwayChip";
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

  // Separate doorway chips (rendered as gold coins on a 2-col grid) from
  // everything else (URL chips, value chips, plain-string chips —
  // unchanged "Chip" render). When the row is doorway-only and ≥2 chips
  // long, lay them out 2 × 2; otherwise fall back to the flex-wrap row
  // that's served the app since v1.
  const partitioned = options.map((opt) => {
    const token = doorwayTokenOf(opt);
    return token ? { kind: "doorway" as const, opt, token } : { kind: "chip" as const, opt };
  });
  const doorwayCount = partitioned.filter((p) => p.kind === "doorway").length;
  const allDoorway = doorwayCount === options.length && doorwayCount >= 2;

  // Detect Hebrew from any chip label so the chip row aligns from the
  // right edge in RTL languages (same pattern as the per-bubble RTL
  // detection in Bubble.tsx). Per-row, not per-chip — flex layouts
  // need a single direction for the whole flex container.
  const rowIsRTL = options.some((opt) => {
    const label =
      typeof opt === "string" ? opt : (opt as any).label || "";
    return /[֐-׿]/.test(label);
  });

  return (
    <View
      style={[
        styles.row,
        allDoorway && styles.rowGrid,
        rowIsRTL && styles.rowRTL,
      ]}
    >
      {partitioned.map((p, i) => {
        if (p.kind === "doorway") {
          const label = stripLeadingEmoji(
            typeof p.opt === "string" ? p.opt : p.opt.label,
          );
          const wireValue =
            typeof p.opt === "string"
              ? p.opt
              : "value" in p.opt
              ? p.opt.value
              : p.opt.label;
          const primary =
            typeof p.opt !== "string" &&
            "value" in p.opt &&
            p.opt.primary === true;
          return (
            <View
              key={chipKey(p.opt, i)}
              style={allDoorway ? styles.gridCell : undefined}
            >
              <DoorwayChip
                token={p.token}
                label={label}
                index={i}
                stretch={allDoorway}
                primary={primary}
                onPress={() => onPick(wireValue, label)}
              />
            </View>
          );
        }
        return <Chip key={chipKey(p.opt, i)} option={p.opt} onPick={onPick} index={i} />;
      })}
    </View>
  );
}

/** Returns the doorway token if `opt` is a known doorway value-chip,
 *  otherwise null. Centralised so QuickReplies and Chip both detect
 *  doorways the same way. */
function doorwayTokenOf(opt: QuickReplyOption): DoorwayToken | null {
  if (typeof opt === "string") return null;
  if (!("value" in opt)) return null;
  return isKnownDoorwayToken(opt.value) ? opt.value : null;
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
  // NOTE: known `__doorway_*` value chips are handled by `DoorwayChip`
  // via the parent. Unknown doorway tokens (or any future value chip)
  // still fall through here so they render as the generic chip rather
  // than disappear.

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

  // testID is the wire value (or label fallback) so MCP can target a
  // specific chip across re-renders — value tokens like `__doorway_situation`
  // stay stable even when the localized label changes.
  const stableId =
    typeof option === "string"
      ? option
      : "value" in option
      ? option.value
      : option.url;
  return (
    <Animated.View
      style={{ opacity: fade, transform: [{ translateY: lift }] }}
    >
      <Pressable
        testID={`chip-${stableId}`}
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={handlePress}
        style={({ pressed }) => [
          styles.chip,
          isUrl && styles.chipUrl,
          pressed && styles.chipPressed,
        ]}
      >
        <Text style={styles.chipText}>{label}</Text>
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
    // Generic value + string chips inherit the same legibility pass as
    // the doorway chips (cream serif label, hairline gold rim, warmer
    // fill) but WITHOUT the gold-coin medallion — the coin stays
    // exclusive to doorway moments so they keep their hierarchy.
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingVertical: 11,
    paddingHorizontal: 16,
    borderRadius: 999,
    backgroundColor: theme.doorChipFillBot,
    borderWidth: 1,
    borderColor: theme.doorChipRim,
  },
  chipUrl: {
    // URL options stay slightly quieter on purpose — they navigate AWAY
    // (share to WhatsApp/Telegram) so they shouldn't compete with
    // in-app CTAs. Cream text + external-arrow glyph still tell the
    // story; the dimmer rim keeps them subordinate.
    backgroundColor: theme.surfaceRaised,
    borderColor: theme.accentDim,
  },
  chipPressed: {
    backgroundColor: theme.doorChipFillTop,
    borderColor: theme.doorChipRimHi,
    shadowColor: theme.accent,
    shadowOpacity: 0.4,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
    elevation: 2,
  },
  chipText: {
    // Back to the brand gold (theme.chipText). Cream-on-mauve read as
    // "system label" — the user prefers the warm gold voice on the
    // generic chips, with the doorway chips still doing the heavy lift
    // via the coin medallion rather than via label color.
    color: theme.chipText,
    fontFamily: theme.fontSerif,
    fontSize: 17,
    fontWeight: "600" as const,
    letterSpacing: 0.1,
  },
  arrowWrap: { width: 11, height: 11 },
  // 2 × 2 grid layout — engaged only when the entire row is doorway
  // chips. Each cell takes half the available width minus the gap so
  // the chips align on a clean line.
  rowGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  // RTL chip row — chips wrap from the right edge so the lean-forward
  // (primary) chip lands where the user's eye naturally lands in
  // Hebrew. Also flips the padding so the chips don't slam into the
  // gold dot's column on the right.
  rowRTL: {
    flexDirection: "row-reverse",
    paddingLeft: theme.spacing + 6,
    paddingRight: theme.spacing + 6 + 17,
  },
  gridCell: {
    width: "50%",
    // The chip itself is full-width within the cell; the half-gap on
    // each side gives us the 8px gutter between columns.
    paddingHorizontal: 4,
    paddingVertical: 4,
  },
});
