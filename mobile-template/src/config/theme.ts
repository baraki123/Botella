import { product } from "./product";

export const theme = {
  bg: "#FAFAF9",
  surface: "#FFFFFF",
  text: "#1A1A1A",
  textSubtle: "#6B7280",
  border: "#E5E7EB",
  accent: product.accent,
  bubbleUser: product.accent,
  bubbleUserText: "#FFFFFF",
  bubbleBot: "#F3F4F6",
  bubbleBotText: "#1A1A1A",
  chip: "#FFFFFF",
  chipBorder: product.accent,
  chipText: product.accent,
  radius: 18,
  spacing: 12,
} as const;

export type Theme = typeof theme;
