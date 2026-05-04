/**
 * Soft golden glow anchor — a radial-feeling falloff in one corner of
 * the canvas. RN doesn't have radial-gradient natively, but two stacked
 * LinearGradients (one diagonal, one orthogonal) approximate it well at
 * low opacities and stay pixel-cheap.
 *
 * Defaults to top-left because the brand "Layla" mark sits there on
 * SignIn, and the chat header benefits from a quiet warm anchor.
 */
import { LinearGradient } from "expo-linear-gradient";
import React from "react";
import { StyleSheet, View, type ViewStyle } from "react-native";

interface Props {
  /** Where the glow originates. */
  corner?: "top-left" | "top-right" | "center" | "bottom";
  /** 0..1 — tunes the brightness. Default 0.25. */
  intensity?: number;
  color?: string;
  style?: ViewStyle;
}

export function Glow({
  corner = "top-left",
  intensity = 0.25,
  color = "#D4A574",
  style,
}: Props) {
  const a = clamp01(intensity);
  const stop = `${color}${alpha(a)}`;
  const stopMid = `${color}${alpha(a * 0.4)}`;
  const transparent = `${color}00`;

  if (corner === "center") {
    return (
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, style]}>
        <LinearGradient
          colors={[stop, stopMid, transparent]}
          locations={[0, 0.5, 1]}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        <LinearGradient
          colors={[transparent, stopMid, transparent]}
          locations={[0, 0.5, 1]}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={StyleSheet.absoluteFill}
        />
      </View>
    );
  }

  if (corner === "bottom") {
    return (
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, style]}>
        <LinearGradient
          colors={[transparent, stopMid, stop]}
          locations={[0, 0.7, 1]}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
      </View>
    );
  }

  const isLeft = corner === "top-left";
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, style]}>
      {/* Diagonal pass — main falloff */}
      <LinearGradient
        colors={[stop, stopMid, transparent]}
        locations={[0, 0.4, 1]}
        start={{ x: isLeft ? 0 : 1, y: 0 }}
        end={{ x: isLeft ? 1 : 0, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      {/* Orthogonal pass — tightens the corner so it reads round */}
      <LinearGradient
        colors={[`${color}${alpha(a * 0.35)}`, transparent]}
        locations={[0, 1]}
        start={{ x: isLeft ? 0 : 1, y: 0 }}
        end={{ x: isLeft ? 0 : 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

function alpha(n: number): string {
  // 0..1 → 2-char hex (00..ff)
  const v = Math.round(clamp01(n) * 255);
  return v.toString(16).padStart(2, "0");
}
