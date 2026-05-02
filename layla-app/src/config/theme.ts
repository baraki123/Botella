import { product } from "./product";

/**
 * Layla theme — placeholder values, NOT final brand.
 *
 * Calibration TODOs (mark them off as the designer locks them in):
 *  - Final brand purple / accent gradient
 *  - Custom typography (Cormorant Garamond or similar — Layla doc points to a
 *    celestial/elegant serif)
 *  - Dark mode counterpart
 *
 * What this file IS doing right now: keep the same shape as
 * mobile-template/src/config/theme.ts so ChatScreen / Bubble /
 * QuickReplies / Composer / SignInScreen all render unchanged. The only
 * intentional Layla-flavored tweak is the bot bubble background — moved
 * a touch warmer to feel less Slack-y.
 */
export const theme = {
  bg: "#FAFAF9",
  surface: "#FFFFFF",
  text: "#1A1A1A",
  textSubtle: "#6B7280",
  border: "#E7E2F0",
  accent: product.accent,
  bubbleUser: product.accent,
  bubbleUserText: "#FFFFFF",
  bubbleBot: "#F4EFFA", // warm dusk-tint instead of grey
  bubbleBotText: "#1A1A1A",
  chip: "#FFFFFF",
  chipBorder: product.accent,
  chipText: product.accent,
  radius: 18,
  spacing: 12,
} as const;

export type Theme = typeof theme;
