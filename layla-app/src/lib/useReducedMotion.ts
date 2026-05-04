/**
 * Reduced-motion preference hook.
 *
 * Wraps RN's AccessibilityInfo so atmospheric effects (twinkle, fade-in,
 * pulse) can softly downgrade themselves when the user has asked the OS
 * for less motion. We default to FALSE on web (matchMedia kicks in only
 * after first paint anyway, and we prefer to ship the rich experience).
 */
import { useEffect, useState } from "react";
import { AccessibilityInfo, Platform } from "react-native";

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(false);

  useEffect(() => {
    let cancelled = false;

    if (Platform.OS === "web") {
      if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
        const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
        const apply = () => !cancelled && setReduced(mq.matches);
        apply();
        mq.addEventListener?.("change", apply);
        return () => {
          cancelled = true;
          mq.removeEventListener?.("change", apply);
        };
      }
      return;
    }

    AccessibilityInfo.isReduceMotionEnabled?.()
      .then((v: boolean) => !cancelled && setReduced(!!v))
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener?.(
      "reduceMotionChanged",
      (v: boolean) => !cancelled && setReduced(!!v),
    );
    return () => {
      cancelled = true;
      sub?.remove?.();
    };
  }, []);

  return reduced;
}
