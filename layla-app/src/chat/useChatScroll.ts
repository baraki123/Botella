/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║                                                                  ║
 * ║   CANONICAL CHAT SCROLL CONTRACT — botella mobile products       ║
 * ║                                                                  ║
 * ║   This hook owns ALL scroll behavior of the chat list. The       ║
 * ║   contract is:                                                   ║
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
 * ║   This matches the behavior shipped in the Laila / Layla         ║
 * ║   redesign 2026-05-08 to 2026-05-09 after several user-feedback  ║
 * ║   iterations. DO NOT modify the contract in product forks. If    ║
 * ║   you change anything here, sync the file to all forks of        ║
 * ║   botella/mobile-template (currently: layla-app).                ║
 * ║                                                                  ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */
import { useCallback, useLayoutEffect, useRef } from "react";
import {
  Animated,
  FlatList,
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
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
    listHeightRef.current = e.nativeEvent.layout.height;
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
