/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║                                                                  ║
 * ║   CANONICAL CHAT SCROLL + KEYBOARD CONTRACT                      ║
 * ║   botella mobile products                                        ║
 * ║                                                                  ║
 * ║   This hook owns ALL scroll behavior of the chat list AND        ║
 * ║   the keyboard-related layout response. They are inseparable:    ║
 * ║   a soft-keyboard event IS a scroll trigger.                     ║
 * ║                                                                  ║
 * ║   ── Scroll rules ─────────────────────────────────────────      ║
 * ║                                                                  ║
 * ║   1. Viewport stays where the user is looking when new bubbles   ║
 * ║      arrive — UNLESS the user is currently AT-BOTTOM, in which   ║
 * ║      case we sticky-follow new content.                          ║
 * ║                                                                  ║
 * ║   2. Sticky-bottom auto-follow fires for streaming tokens, user  ║
 * ║      message echoes, AND completed bot bubbles, but only while   ║
 * ║      the user is at-bottom (isAtBottomRef true). If the user has ║
 * ║      actively dragged the list away (userOverrideRef true), we   ║
 * ║      never auto-scroll — they're reading older content and a     ║
 * ║      yank would lose their place.                                ║
 * ║                                                                  ║
 * ║   3. The "↓ Latest" pill surfaces ONLY when the user has         ║
 * ║      actively scrolled MORE THAN ONE FULL VIEWPORT above the     ║
 * ║      bottom (driven by handleScroll only — never by programmatic ║
 * ║      content growth). Tap pill → scrollToEnd, hide pill.         ║
 * ║                                                                  ║
 * ║   ── Keyboard rules ───────────────────────────────────────      ║
 * ║                                                                  ║
 * ║   4. When the visible FlatList area SHRINKS (keyboard rising,    ║
 * ║      sticky chip row appearing, etc.) and the user was at-       ║
 * ║      bottom, we re-snap to bottom inside onLayout. Without this  ║
 * ║      the latest bubble can end up clipped behind the newly-      ║
 * ║      raised input.                                               ║
 * ║                                                                  ║
 * ║   5. On Keyboard.didShow / didHide we re-snap to bottom (with    ║
 * ║      a small post-layout delay) so any keyboard-driven height    ║
 * ║      change that didn't surface via onLayout still corrects.     ║
 * ║      Same gating: only when at-bottom, only when user hasn't     ║
 * ║      taken over via drag.                                        ║
 * ║                                                                  ║
 * ║   6. The KeyboardAvoidingView wrapping the chat MUST use         ║
 * ║      `behavior="padding"` on iOS, `"height"` on Android, and     ║
 * ║      `keyboardVerticalOffset = KEYBOARD_VERTICAL_OFFSET_IOS` on  ║
 * ║      iOS (exported from this file — see below). The constant     ║
 * ║      lives here so screens never re-decide it. Web is a no-op.   ║
 * ║                                                                  ║
 * ║   ── Discipline ───────────────────────────────────────────      ║
 * ║                                                                  ║
 * ║   This file is canonical. ChatScreen / Bubble / Composer must    ║
 * ║   NEVER add ad-hoc scrollToEnd / scrollToIndex / Keyboard event  ║
 * ║   listeners. If you change anything here, sync the file verbatim ║
 * ║   to every fork of botella/mobile-template (currently: layla-    ║
 * ║   app). Behavior shipped in the Laila redesign 2026-05-08 →      ║
 * ║   2026-05-10 after several rounds of user-feedback iteration.    ║
 * ║                                                                  ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */
import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import {
  Animated,
  FlatList,
  Keyboard,
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
} from "react-native";

interface MinimalMessage {
  role: "user" | "bot";
  streaming?: boolean;
}

export interface ChatScrollControls<T extends MinimalMessage> {
  /** Pass to <FlatList ref={listRef} … />. */
  listRef: React.RefObject<FlatList<T> | null>;
  /** Pass to <Animated.View style={{ opacity: pillOpacity }}>…</Animated.View>
   *  for the "↓ Latest" jump-to-bottom pill. */
  pillOpacity: Animated.Value;
  /** Pass to <FlatList onScroll={onScroll} scrollEventThrottle={32} …/>. */
  onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
  /** Pass to <FlatList onScrollBeginDrag={onScrollBeginDrag} …/>. */
  onScrollBeginDrag: () => void;
  /** Pass to <FlatList onContentSizeChange={onContentSizeChange} …/>. */
  onContentSizeChange: () => void;
  /** Pass to <FlatList onLayout={onLayout} …/>. */
  onLayout: (e: LayoutChangeEvent) => void;
  /** Wire to the pill's onPress — clears override + scrolls to bottom. */
  jumpToLatest: () => void;
}

const PILL_FADE_MS = 180;
// Threshold below the bottom under which we treat the user as "at the
// bottom of the conversation" for sticky-follow purposes. Small enough
// to tolerate scroll inertia; large enough that one-pixel float math
// doesn't flip-flop the state.
const AT_BOTTOM_PX = 60;

/**
 * The vertical offset KeyboardAvoidingView must use on iOS so the
 * input + sticky chip row clear the QuickType suggestions bar with
 * breathing room. Exported here so every screen in every product fork
 * uses the same value — there is no good reason for a chat screen to
 * pick its own number, and tuning this in two places drifts.
 *
 * If you find a screen that needs a different value, you have a layout
 * bug, not a knob — surface it here.
 */
export const KEYBOARD_VERTICAL_OFFSET_IOS = 56;

export function useChatScroll<T extends MinimalMessage>(
  messages: T[],
): ChatScrollControls<T> {
  const listRef = useRef<FlatList<T>>(null);

  // Mirror of `messages` for callbacks that must read the latest array
  // without re-rendering. useLayoutEffect (not useEffect) so the mirror
  // is in sync BEFORE paint — critical because onLayout / onContentSize
  // fire synchronously after setMessages re-render.
  const messagesRef = useRef<T[]>([]);
  useLayoutEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const isAtBottomRef = useRef(true);
  const userOverrideRef = useRef(false);
  const scrollOffsetYRef = useRef(0);
  const listHeightRef = useRef(0);
  const pillOpacity = useRef(new Animated.Value(0)).current;

  const setPill = useCallback(
    (visible: boolean) => {
      Animated.timing(pillOpacity, {
        toValue: visible ? 1 : 0,
        duration: PILL_FADE_MS,
        useNativeDriver: true,
      }).start();
    },
    [pillOpacity],
  );

  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
      scrollOffsetYRef.current = contentOffset.y;
      const distanceFromBottom = Math.max(
        0,
        contentSize.height - layoutMeasurement.height - contentOffset.y,
      );
      const atBottom = distanceFromBottom < AT_BOTTOM_PX;
      isAtBottomRef.current = atBottom;
      if (atBottom) userOverrideRef.current = false;
      // Pill surfaces ONLY when the user is more than one full viewport
      // above the bottom — see contract rule 3 above.
      const farFromBottom = distanceFromBottom > layoutMeasurement.height;
      setPill(farFromBottom && messages.length > 0);
    },
    [messages.length, setPill],
  );

  const onScrollBeginDrag = useCallback(() => {
    // User-initiated drag = they're taking control. Stop auto-follow
    // until they explicitly tap the pill (which clears the override)
    // or scroll back to within AT_BOTTOM_PX of the bottom.
    userOverrideRef.current = true;
  }, []);

  const onContentSizeChange = useCallback(() => {
    // Auto-follow new content with scrollToEnd — so the user sees
    // what just arrived without manually scrolling. The exception:
    // userOverrideRef true means they're actively reading older
    // content; never yank them.
    if (userOverrideRef.current) return;
    if (messagesRef.current.length === 0) return;
    listRef.current?.scrollToEnd({ animated: true });
  }, []);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const newHeight = e.nativeEvent.layout.height;
    const prevHeight = listHeightRef.current;
    listHeightRef.current = newHeight;
    // When the FlatList's visible height shrinks (keyboard rising,
    // sticky-chip row appearing) and the user was at-bottom, keep them
    // at-bottom. Without this, an in-flight bot bubble that was just
    // rendered at the previous bottom edge ends up clipped behind the
    // newly-raised input/keyboard. Only re-snap when the height
    // actually shrunk and the user hasn't scrolled away.
    if (
      prevHeight > 0
      && newHeight + 1 < prevHeight
      && isAtBottomRef.current
      && !userOverrideRef.current
      && messagesRef.current.length > 0
    ) {
      // Use requestAnimationFrame so the layout pass completes before
      // we issue the scroll — otherwise scrollToEnd uses the stale
      // height for its target offset.
      requestAnimationFrame(() => {
        listRef.current?.scrollToEnd({ animated: false });
      });
    }
  }, []);

  // Keyboard show/hide on iOS specifically: KeyboardAvoidingView shrinks
  // the FlatList AFTER the keyboard animation begins, but the new bottom
  // isn't always picked up by onLayout in time for the user to see the
  // most recent bubble. Re-snap to bottom on didShow + didHide so the
  // visible-area always frames the latest content while the user is
  // at-bottom. iOS only — Android handles this via softInputMode.
  useEffect(() => {
    if (Platform.OS === "web") return;
    const showSub = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow",
      () => {
        if (
          isAtBottomRef.current
          && !userOverrideRef.current
          && messagesRef.current.length > 0
        ) {
          // Slight delay so the keyboard animation completes its first
          // frame before we scroll — otherwise the scroll happens to
          // the pre-resize content edge.
          setTimeout(() => {
            listRef.current?.scrollToEnd({ animated: true });
          }, 50);
        }
      },
    );
    const hideSub = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide",
      () => {
        if (isAtBottomRef.current && !userOverrideRef.current) {
          setTimeout(() => {
            listRef.current?.scrollToEnd({ animated: true });
          }, 50);
        }
      },
    );
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const jumpToLatest = useCallback(() => {
    userOverrideRef.current = false;
    setPill(false);
    listRef.current?.scrollToEnd({ animated: true });
  }, [setPill]);

  return {
    listRef,
    pillOpacity,
    onScroll,
    onScrollBeginDrag,
    onContentSizeChange,
    onLayout,
    jumpToLatest,
  };
}
