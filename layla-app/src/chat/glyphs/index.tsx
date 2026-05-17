/**
 * Doorway-chip glyph library — four marks built on the same 24-unit grid
 * and the same stroke weight. Each glyph maps to one of the stable
 * `__doorway_*` value tokens emitted by the brain repo. Knocked out of
 * the gold coin (default render color = #1a0d16, the dark mauve).
 *
 * If you add a new doorway token, add a glyph here and wire it into
 * GLYPH in `DoorwayChip.tsx`.
 */
import React from "react";
import Svg, { Circle, Line, Path } from "react-native-svg";

interface GlyphProps {
  size?: number;
  color?: string;
}

const STROKE = 1.7;
const DEFAULT_COLOR = "#1a0d16";

/** __doorway_question — "Go deeper on the map".
 *  Astrolabe / compass-rose: outer ring, inner pupil, four cardinal ticks.
 *  Reads as "the chart itself, look inward." */
export function Astrolabe({ size = 22, color = DEFAULT_COLOR }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle cx={12} cy={12} r={9} stroke={color} strokeWidth={STROKE} fill="none" />
      <Circle cx={12} cy={12} r={2.4} stroke={color} strokeWidth={STROKE} fill="none" />
      <Line x1={12} y1={3.4} x2={12} y2={5.6} stroke={color} strokeWidth={STROKE} strokeLinecap="round" />
      <Line x1={12} y1={18.4} x2={12} y2={20.6} stroke={color} strokeWidth={STROKE} strokeLinecap="round" />
      <Line x1={3.4} y1={12} x2={5.6} y2={12} stroke={color} strokeWidth={STROKE} strokeLinecap="round" />
      <Line x1={18.4} y1={12} x2={20.6} y2={12} stroke={color} strokeWidth={STROKE} strokeLinecap="round" />
    </Svg>
  );
}

/** __doorway_situation — "Something on my mind".
 *  Logarithmic spiral, ~2.5 revolutions. A thought circling itself. */
export function Spiral({ size = 22, color = DEFAULT_COLOR }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M12 12 m 0 0 a 1 1 0 1 1 1 -1 a 2.2 2.2 0 1 1 -2.2 -2.2 a 3.6 3.6 0 1 1 3.6 -3.6 a 5.4 5.4 0 1 1 -5.4 -5.4"
        transform="translate(-0.6 0.6)"
        stroke={color}
        strokeWidth={STROKE}
        strokeLinecap="round"
        fill="none"
      />
    </Svg>
  );
}

/** __doorway_person — "Add someone".
 *  Two overlapping circles — the vesica piscis, the ancient symbol for
 *  two souls / two charts meeting. The synastry glyph. */
export function Vesica({ size = 22, color = DEFAULT_COLOR }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle cx={9} cy={12} r={5.6} stroke={color} strokeWidth={STROKE} fill="none" />
      <Circle cx={15} cy={12} r={5.6} stroke={color} strokeWidth={STROKE} fill="none" />
    </Svg>
  );
}

/** __doorway_reflect — "Just let me sit with this".
 *  Waning crescent + a small witness star. Stillness with a quiet companion. */
export function Crescent({ size = 22, color = DEFAULT_COLOR }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M16.5 4.5 A 9 9 0 1 0 16.5 19.5 A 7 8.5 0 1 1 16.5 4.5 Z"
        stroke={color}
        strokeWidth={STROKE}
        strokeLinejoin="round"
        fill="none"
      />
      <Circle cx={19.5} cy={6.5} r={0.85} fill={color} />
    </Svg>
  );
}

export type Glyph = React.ComponentType<GlyphProps>;
