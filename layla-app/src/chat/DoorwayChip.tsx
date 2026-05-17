/**
 * Doorway chip — the "coin & tag" CTA for post-map-read pivots.
 *
 * The pill ("tag") stays dark + refined to preserve the brand mood. The
 * leading medallion ("coin") is a solid gold disc with a dark knockout
 * glyph — the high-contrast focal point that pulls the eye and the thumb.
 *
 * Token → glyph map is closed to the four stable `__doorway_*` values
 * emitted by the brain repo (services/laila_state.py). Unknown tokens
 * fall back to the generic chip via QuickReplies.tsx — the caller decides
 * whether to render us at all.
 */
import React, { useEffect, useRef } from "react";
import {
  Animated,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Svg, { Circle, Defs, RadialGradient, Stop } from "react-native-svg";

import { theme } from "../config/theme";
import { useReducedMotion } from "../lib/useReducedMotion";
import { Astrolabe, Crescent, Glyph, Spiral, Vesica } from "./glyphs";

export type DoorwayToken =
  | "__doorway_question"
  | "__doorway_situation"
  | "__doorway_person"
  | "__doorway_reflect";

const GLYPH: Record<DoorwayToken, Glyph> = {
  __doorway_question: Astrolabe, // "Go deeper on the map"
  __doorway_situation: Spiral, // "Something on my mind"
  __doorway_person: Vesica, // "Add someone"
  __doorway_reflect: Crescent, // "Just let me sit with this"
};

/** True if a value matches one of the four known doorway tokens. */
export function isKnownDoorwayToken(value: string): value is DoorwayToken {
  return Object.prototype.hasOwnProperty.call(GLYPH, value);
}

/** Strip a leading emoji + whitespace from a label. The brain repo
 *  currently sends labels like "✦ Go deeper on the map", "🐚 Something
 *  on my mind", "☾ Sit with this" — the coin replaces those, so we
 *  remove the prefix. Pattern covers:
 *    · supplementary-plane emoji (🐚, 👨‍👩‍👧, etc) via
 *      \p{Extended_Pictographic}
 *    · BMP "Misc Symbols" block U+2600–U+26FF (☀ ☁ ☾ ☽ ♀ ♂ etc)
 *    · BMP "Dingbats" block U+2700–U+27BF (✦ ✸ ✺ ❀ etc)
 *    · variation-selector U+FE0F that follows some emoji presentations
 *    · zero-width-joiner U+200D used in compound emoji
 *
 *  If the backend ever stops prefixing emoji, this is a no-op. */
const EMOJI_PREFIX =
  /^(?:[☀-➿]|\p{Extended_Pictographic})[️‍]*(?:[☀-➿]|\p{Extended_Pictographic})*[️‍]*\s*/u;

export function stripLeadingEmoji(label: string): string {
  const stripped = label.replace(EMOJI_PREFIX, "").trim();
  return stripped || label;
}

interface Props {
  token: DoorwayToken;
  /** Already-emoji-stripped label. */
  label: string;
  /** Position in the row — drives the entrance stagger. */
  index: number;
  onPress: () => void;
  /** When true, the chip fills its parent's cross-axis width (used by
   *  the 2-col grid). When false, the chip hugs its content (used when
   *  doorway chips are mixed with other chips in a flex-wrap row). */
  stretch?: boolean;
  /** When true, the chip renders as the filled-gold lean-forward CTA:
   *  gold pill with dark text and a reversed coin (dark medallion with
   *  gold glyph). The backend marks exactly one chip per row as
   *  primary per turn. */
  primary?: boolean;
  /** testID stem; we'll append the token for stability across re-renders. */
  testID?: string;
}

export function DoorwayChip({
  token,
  label,
  index,
  onPress,
  stretch,
  primary,
  testID,
}: Props) {
  const reduced = useReducedMotion();
  const fade = useRef(new Animated.Value(reduced ? 1 : 0)).current;
  const lift = useRef(new Animated.Value(reduced ? 0 : 8)).current;

  useEffect(() => {
    if (reduced) return;
    Animated.parallel([
      Animated.timing(fade, {
        toValue: 1,
        duration: 280,
        delay: index * 60,
        useNativeDriver: true,
      }),
      Animated.timing(lift, {
        toValue: 0,
        duration: 320,
        delay: index * 60,
        useNativeDriver: true,
      }),
    ]).start();
    // mount-only entrance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const GlyphComp = GLYPH[token];

  return (
    <Animated.View
      style={[
        styles.outer,
        stretch && styles.outerStretch,
        { opacity: fade, transform: [{ translateY: lift }] },
      ]}
    >
      <Pressable
        testID={testID ?? `doorway-${token}`}
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={onPress}
        style={({ pressed }) => [
          styles.chip,
          primary && styles.chipPrimary,
          stretch && styles.chipStretch,
          pressed && (primary ? styles.chipPrimaryPressed : styles.chipPressed),
        ]}
      >
        {({ pressed }) => (
          <>
            <Coin pressed={pressed} primary={primary}>
              <GlyphComp
                size={20}
                color={primary ? theme.doorCoinHi : theme.doorCoinGlyph}
              />
            </Coin>
            <Text
              style={[styles.label, primary && styles.labelPrimary]}
              numberOfLines={1}
            >
              {label}
            </Text>
          </>
        )}
      </Pressable>
    </Animated.View>
  );
}

/** The disc. Radial gradient via react-native-svg so iOS and web render
 *  the same way (RN's StyleSheet doesn't support radial gradients
 *  cross-platform). The hairline inner ring under the rim gives the
 *  disc its "minted" feel.
 *
 *  Default → gold disc (gold gradient) with dark glyph.
 *  Primary → reversed: dark mauve disc with the glyph in gold. Reads as
 *  a black seal pressed into a gold pill. */
function Coin({
  pressed,
  primary,
  children,
}: {
  pressed: boolean;
  primary?: boolean;
  children: React.ReactNode;
}) {
  // SVG gradient stops differ by variant. iOS reads stopColor as a
  // string and ignores opacity unless we explicitly set it.
  const [hi, mid, lo] = primary
    ? ["#4a2236", "#2a1422", "#160910"]
    : [theme.doorCoinHi, theme.doorCoinMid, theme.doorCoinLo];
  return (
    <View
      style={[
        styles.coin,
        primary && styles.coinPrimary,
        pressed && styles.coinPressed,
      ]}
    >
      <Svg
        width={COIN}
        height={COIN}
        viewBox="0 0 38 38"
        style={StyleSheet.absoluteFill}
      >
        <Defs>
          <RadialGradient id={primary ? "coinFillP" : "coinFill"} cx="32%" cy="28%" r="78%">
            <Stop offset="0%" stopColor={hi} stopOpacity={1} />
            <Stop offset="55%" stopColor={mid} stopOpacity={1} />
            <Stop offset="100%" stopColor={lo} stopOpacity={1} />
          </RadialGradient>
        </Defs>
        <Circle
          cx={19}
          cy={19}
          r={18.5}
          fill={`url(#${primary ? "coinFillP" : "coinFill"})`}
        />
        <Circle
          cx={19}
          cy={19}
          r={17}
          stroke={primary ? "rgba(234,208,142,0.35)" : "rgba(0,0,0,0.18)"}
          strokeWidth={0.6}
          fill="none"
        />
      </Svg>
      <View style={styles.coinGlyphWrap}>{children}</View>
    </View>
  );
}

const COIN = 38;
const CHIP_H = 56;

const styles = StyleSheet.create({
  outer: {
    // each chip is its own animated wrapper so the stagger works
    // independently per chip without sharing a parent driver.
  },
  outerStretch: { alignSelf: "stretch" },
  chipStretch: { alignSelf: "stretch" },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    height: CHIP_H,
    paddingLeft: 9,
    paddingRight: 20,
    borderRadius: 999,
    backgroundColor: theme.doorChipFillBot,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.doorChipRim,
    // subtle warm halo to lift the chip off the canvas. iOS reads the
    // shadow tokens; Android needs elevation.
    shadowColor: theme.accent,
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: Platform.OS === "android" ? 2 : 0,
  },
  chipPressed: {
    backgroundColor: theme.doorChipFillTop,
    borderColor: theme.doorChipRimHi,
    shadowOpacity: 0.42,
    shadowRadius: 12,
  },
  // Primary variant — one chip per row, marked by the brain with
  // `primary: true`. Filled gold pill, dark text, reversed coin.
  chipPrimary: {
    backgroundColor: theme.doorPrimaryFillLo,
    borderColor: "rgba(255,245,200,0.45)",
    shadowColor: theme.accent,
    shadowOpacity: 0.45,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 2 },
    elevation: Platform.OS === "android" ? 4 : 0,
  },
  chipPrimaryPressed: {
    backgroundColor: theme.doorPrimaryFillHi,
    shadowOpacity: 0.6,
    shadowRadius: 18,
  },
  coin: {
    width: COIN,
    height: COIN,
    borderRadius: COIN / 2,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    shadowColor: "#000",
    shadowOpacity: 0.45,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: Platform.OS === "android" ? 1 : 0,
  },
  coinPressed: {
    transform: [{ scale: 0.96 }],
  },
  coinPrimary: {
    // The reversed coin sits inside a gold pill, so its halo doesn't
    // need to fight a dark background — soften the drop shadow.
    shadowOpacity: 0.3,
  },
  coinGlyphWrap: {
    // Stack the glyph above the SVG fill. zIndex matters on web; on
    // native, draw-order suffices, but it's harmless to be explicit.
    zIndex: 1,
  },
  label: {
    color: theme.doorChipLabel,
    fontFamily: theme.fontSerif,
    fontSize: 17,
    fontWeight: "700" as const,
    letterSpacing: 0.1,
    // Cochin sits slightly low on the baseline — nudge up so it
    // optically centers with the coin.
    paddingBottom: Platform.OS === "ios" ? 1 : 0,
  },
  labelPrimary: {
    color: theme.doorPrimaryText,
  },
});
