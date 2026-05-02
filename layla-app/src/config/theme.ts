import { Platform } from "react-native";

import { product } from "./product";

/**
 * Layla theme — warm, mysterious, sexy, enticing.
 *
 * Direction: not generic mystic-purple-stars. Dark by default, but the
 * dark is *warm* — deep aubergine + sienna undertones, not cold blue.
 * Like a candlelit conversation at 11pm at the kitchen table. The accent
 * is a warm gold (NOT neon, NOT yellow) — restrained, jewelry-quality.
 *
 * Layla messages render WITHOUT a bubble — just text on the canvas with
 * a tiny gold accent dot before each one. She feels ambient, present,
 * not "responding from a chat box." User messages stay contained in a
 * quiet charcoal-rose pill so the conversation has rhythm.
 */
export const theme = {
  // Canvas
  bg: "#15101A",            // deep aubergine, warmer than black
  surface: "#1E1623",       // header strip, composer bar — barely lifted
  surfaceRaised: "#241A2C", // cards (settings rows, chips)

  // Text
  text: "#F5EAE3",          // warm cream, candlelight on paper
  textSubtle: "#A99B95",    // dusty mauve-gray
  textMuted: "#7A6E72",
  textInverse: "#15101A",

  // Lines
  border: "#2D2330",
  borderStrong: "#3D2F44",

  // Accent — restrained warm gold. Used sparingly: send button, brand
  // accents, the tiny dot before Layla's messages, the status indicator.
  accent: "#D4A574",
  accentSoft: "#5C4338",    // deep sienna — backgrounds where gold would shout
  accentDim: "#9C7A57",     // pressed state for accent buttons

  // Bubbles
  bubbleUser: "#2C212F",    // charcoal-rose, contained
  bubbleUserText: "#F5EAE3",
  // Layla messages have no bubble — these tokens kept for parity but unused.
  bubbleBot: "transparent",
  bubbleBotText: "#F5EAE3",

  // Quick-reply chips
  chip: "#1E1623",
  chipBorder: "#3D2F44",
  chipText: "#D4A574",

  // Status (header dot)
  statusOpen: "#D4A574",    // gold "I'm here"
  statusConnecting: "#A99B95",
  statusClosed: "#8B5252",  // muted brick — not screaming red

  radius: 18,
  spacing: 12,

  // Typography. iOS ships Cochin / Didot / Charter; Android falls back to
  // its serif default. Layla uses the serif for the brand mark + section
  // headings; body stays system sans for legibility on small screens.
  fontSerif: Platform.select({
    ios: "Cochin",
    android: "serif",
    default: "Cochin, Charter, Georgia, serif",
  }) as string,
  fontSerifItalic: Platform.select({
    ios: "Cochin-Italic",
    android: "serif",
    default: "Cochin-Italic, Charter Italic, Georgia, serif",
  }) as string,
} as const;

export type Theme = typeof theme;

// Re-export so SignIn / Settings screens can compose without a second
// import of the same product config.
export { product };
