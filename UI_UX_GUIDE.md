# UI/UX Guide — Layla

Last updated: 2026-05-19.

This is the canonical typography + layout reference for Layla's UI. Brand-voice text (Layla's bubbles, display headers) follows the brand notes in `CLAUDE.md`; UI controls (chips, buttons, settings labels, form fields, captions) follow the rules below.

---

## Typography rules — high-clarity layout

Default rules for **UI controls** (chips, buttons, labels, settings, captions, form fields). For Layla's voice and display headers, see the brand-voice section further down.

- **Base body/input font size**: 14px or 15px.
- **Minimum text floor**: never generate text smaller than 12px.
- **Font weights**:
  - 400 for standard body text.
  - 500 (medium) for UI labels, buttons, and any text at 12px.
- **Contrast**: ensure all text colors have strong contrast. Do not use light grays for text on light backgrounds. On Layla's dark canvas, use `theme.text` (`#F5EAE3`) for body and `theme.accent` (`#D4A574`) for accents — both pass WCAG AA against `theme.bg` at 12px+.
- **Letter spacing**: apply `letter-spacing: 0.015em` (~`letterSpacing: 0.2` in RN at 13px) to any text at 12px or 13px to maximize clarity.
- **Typeface preference (UI controls)**: prefer high-legibility UI fonts like `Inter` or system defaults. **Exception**: when an element is part of Layla's *voice* (chat bubbles, lead-ins, narrative copy), use the brand serif — `theme.fontSerif` (Cochin on iOS, system serif elsewhere). The distinction is intent: *control* vs *voice*.

### Quick reference

| Element                              | Size  | Weight | Family            | Tracking          |
|--------------------------------------|-------|--------|-------------------|-------------------|
| Body text (UI)                       | 14-15 | 400    | Inter / system    | normal            |
| UI labels, buttons                   | 14-15 | 500    | Inter / system    | normal            |
| Captions / hints (12-13px)           | 12-13 | 500    | Inter / system    | 0.015em           |
| Layla's voice — chat bubble body     | 18    | 400    | Cochin / serif    | 0.1               |
| Layla's voice — display ("Layla")    | 24-48 | 500    | Fraunces italic   | -0.01em           |
| Tier labels (chart, sections)        | 12    | 600    | Cochin / serif    | 2px, uppercase    |

---

## Brand-voice exceptions (Layla's *voice*)

Layla speaks in a serif. The control rules above do NOT apply to her bubbles, the wordmark, or display headers — those use `theme.fontSerif` (Cochin/Fraunces) for the warm, candlelit feel that's part of the brand. If you find yourself styling a *voice* element with Inter, you're off-brand. Specifically:

- **Layla's chat bubble body**: 18px Cochin (existing `botText` style in `Bubble.tsx`)
- **The "Layla" wordmark + headers**: Fraunces italic (`theme.fontSerifItalic` if loaded)
- **Markdown headings inside Layla's bubbles**: gold serif, sized per the markdownStyles table in `Bubble.tsx`
- **Chart bubble tier labels (`### Luminaries`)**: 12px serif tracked uppercase gold — the manuscript treatment

User input fields (the composer "Tell Layla…", settings forms) follow the UI rules — Cochin works there too because it's part of the brand atmosphere, but never go below 14px for a tappable field.

---

## Color tokens (from `layla-app/src/config/theme.ts`)

Canonical names — use the token, not the hex. New surfaces that need their own token should add it to `theme.ts` rather than inline a hex.

- **Canvas**: `bg` `#15101A` · `surface` `#1E1623` · `surfaceRaised` `#241A2C`
- **Text**: `text` `#F5EAE3` · `textSubtle` `#A99B95` · `textMuted` `#7A6E72`
- **Gold accents**: `accent` `#D4A574` · `accentSoft` `#5C4338` · `accentDim` `#9C7A57`
- **Doorway-chip family**: `doorChipFillTop/Bot`, `doorChipRim/RimHi`, `doorChipLabel`, `doorCoinHi/Mid/Lo/Glyph`
- **Doorway-primary (staged for v2)**: `doorPrimaryFillHi/Lo`, `doorPrimaryText`

---

## Layout rules

- **Tap targets**: ≥ 44pt on iOS. Doorway chips ship at 46pt; generic chips at ~40pt with `paddingVertical: 11`. Never trim a tap target to save layout space — bump the parent.
- **Bubble width**: Layla's text + share-card threshold is 220 chars; below that, no action bar / Listen pill.
- **Chip-to-bubble alignment**: chip rows have `paddingLeft: theme.spacing + 6 + 17` so they align with the body of Layla's text (under the gold dot, not under the indent).
- **Scroll**: the canonical contract lives in the top-of-file banner of `mobile-template/src/chat/useChatScroll.ts`. Never add ad-hoc `scrollToEnd` calls in screen components — edit the hook + sync both copies.

---

## Motion

- **Entrance**: bot bubbles fade up 8px over ~280ms (ease-out). Doorway chips stagger 60ms apart.
- **Typewriter reveal**: long completed bot bubbles (≥240 chars, not chart-sigil) reveal word-by-word over ~3s with ease-out curve. Tap to skip.
- **Reduced motion**: every animated surface checks `useReducedMotion()` and skips/short-circuits when the OS signal is on. Never hardcode.

---

## Accessibility

- **WCAG**: cream-on-mauve combos pass AA at 12px+. Verify any new pairing with a contrast tool before shipping.
- **`accessibilityRole` + `accessibilityLabel`**: every tappable element gets both. The chip label after emoji-strip is the accessibility label.
- **VoiceOver**: chart-sigil bubbles suppress the Listen pill — TTS reads unicode planet symbols as "sun symbol, moon symbol…" which is junk. Detection in `isChartSigilBubble()`.
- **Spell-check on, autocorrect off** in the chat composer. The iOS QuickType bar steals ~50px and is off-brand for the advisor voice.

---

## When this guide doesn't have an answer

Defer to:
1. The brand notes in `CLAUDE.md` (working preferences, voice).
2. `spec.md` for product behavior + copy.
3. The `frontend-design` skill for a creative direction sketch (mockup → review → ship).
4. The `ui-ux-pro-max` skill for component-level decisions where the brand can absorb a generic option.

Update this file whenever a rule emerges from a design review that should outlive the conversation.
