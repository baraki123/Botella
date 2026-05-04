/**
 * Quiet starfield: ~14 sparse SVG sparkles scattered across the canvas,
 * each pulsing on its own slow phase. Absolutely positioned, pointer-events
 * none, sits behind everything. Gold and cream tinted — never blue/white,
 * which would push the warm dusk-purple toward generic mystic-tech.
 *
 * Performance: native driver on opacity, no layout writes. Reduced-motion
 * users get the stars at fixed mid-opacity (no animation).
 */
import React, { useEffect, useMemo, useRef } from "react";
import { Animated, Dimensions, StyleSheet, View } from "react-native";
import Svg, { Path } from "react-native-svg";

import { theme } from "../../config/theme";
import { useReducedMotion } from "../../lib/useReducedMotion";

interface SparkleSpec {
  x: number; // 0..1 of canvas width
  y: number; // 0..1 of canvas height
  size: number;
  delay: number;
  duration: number;
  color: string;
  base: number; // resting opacity
  peak: number;
}

// Hand-tuned. Feels "designed" instead of stochastic-noisy because positions
// don't cluster and sizes alternate. Tune with care — randomness here looks
// cheap.
const SPECS: SparkleSpec[] = [
  { x: 0.08, y: 0.10, size: 7, delay: 0,    duration: 2400, color: theme.accent,    base: 0.15, peak: 0.55 },
  { x: 0.22, y: 0.32, size: 4, delay: 800,  duration: 1800, color: theme.text,      base: 0.05, peak: 0.18 },
  { x: 0.85, y: 0.06, size: 5, delay: 1300, duration: 2100, color: theme.accent,    base: 0.10, peak: 0.45 },
  { x: 0.92, y: 0.22, size: 3, delay: 400,  duration: 1500, color: theme.text,      base: 0.04, peak: 0.16 },
  { x: 0.50, y: 0.14, size: 4, delay: 1700, duration: 2600, color: theme.text,      base: 0.05, peak: 0.20 },
  { x: 0.14, y: 0.58, size: 3, delay: 600,  duration: 2000, color: theme.accent,    base: 0.10, peak: 0.30 },
  { x: 0.32, y: 0.74, size: 4, delay: 200,  duration: 2200, color: theme.text,      base: 0.04, peak: 0.18 },
  { x: 0.58, y: 0.46, size: 5, delay: 1100, duration: 2700, color: theme.accent,    base: 0.10, peak: 0.40 },
  { x: 0.78, y: 0.62, size: 3, delay: 1900, duration: 1700, color: theme.text,      base: 0.05, peak: 0.22 },
  { x: 0.66, y: 0.86, size: 4, delay: 500,  duration: 2400, color: theme.accent,    base: 0.10, peak: 0.32 },
  { x: 0.18, y: 0.92, size: 3, delay: 1500, duration: 1900, color: theme.text,      base: 0.04, peak: 0.16 },
  { x: 0.46, y: 0.96, size: 5, delay: 900,  duration: 2300, color: theme.accent,    base: 0.10, peak: 0.38 },
  { x: 0.04, y: 0.42, size: 3, delay: 2000, duration: 1800, color: theme.text,      base: 0.04, peak: 0.18 },
  { x: 0.96, y: 0.50, size: 4, delay: 700,  duration: 2200, color: theme.accent,    base: 0.10, peak: 0.30 },
];

interface Props {
  /** Override fade-in delay so the field doesn't pop on mount. Default 200. */
  introDelay?: number;
}

export function Starfield({ introDelay = 200 }: Props) {
  const reduced = useReducedMotion();
  const { width, height } = useMemo(() => Dimensions.get("window"), []);
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fade, {
      toValue: 1,
      duration: 1200,
      delay: introDelay,
      useNativeDriver: true,
    }).start();
  }, [fade, introDelay]);

  return (
    <Animated.View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { opacity: fade }]}
    >
      {SPECS.map((s, i) => (
        <Sparkle
          key={i}
          spec={s}
          left={s.x * width}
          top={s.y * height}
          reduced={reduced}
        />
      ))}
    </Animated.View>
  );
}

function Sparkle({
  spec,
  left,
  top,
  reduced,
}: {
  spec: SparkleSpec;
  left: number;
  top: number;
  reduced: boolean;
}) {
  const opacity = useRef(new Animated.Value(spec.base)).current;

  useEffect(() => {
    if (reduced) {
      opacity.setValue((spec.base + spec.peak) / 2);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(spec.delay),
        Animated.timing(opacity, {
          toValue: spec.peak,
          duration: spec.duration,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: spec.base,
          duration: spec.duration,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity, reduced, spec.base, spec.peak, spec.delay, spec.duration]);

  // 4-point sparkle path: classic "twinkle" star, sharp on the long axis,
  // narrow on the short axis. Centered at (s, s) in a 2s viewBox.
  const s = spec.size;
  const d = `M${s} 0 L${s + s * 0.18} ${s - s * 0.18} L${s * 2} ${s} L${s + s * 0.18} ${s + s * 0.18} L${s} ${s * 2} L${s - s * 0.18} ${s + s * 0.18} L0 ${s} L${s - s * 0.18} ${s - s * 0.18} Z`;

  return (
    <Animated.View
      style={[
        styles.sparkle,
        { left: left - s, top: top - s, opacity },
      ]}
    >
      <Svg width={s * 2} height={s * 2} viewBox={`0 0 ${s * 2} ${s * 2}`}>
        <Path d={d} fill={spec.color} />
      </Svg>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  sparkle: { position: "absolute" },
});
