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
 * ║      case we follow the new content using the "smart-snap" rule  ║
 * ║      in #2 below.                                                ║
 * ║                                                                  ║
 * ║   2. Smart-snap (new-bubble follow) — auto-follow new content    ║
 * ║      so the user always sees the START of the new block, never   ║
 * ║      mid-text. Two cases:                                        ║
 * ║                                                                  ║
 * ║         A. Latest message FITS in the visible area above the     ║
 * ║            keyboard → scrollToEnd. Whole block sits above the    ║
 * ║            keyboard; user reads it in one glance.                ║
 * ║                                                                  ║
 * ║         B. Latest message is TALLER than the visible area →     ║
 * ║            scrollToOffset so the message's top edge is one       ║
 * ║            line below the chrome (lastBubbleTop - ONE_LINE_PX).  ║
 * ║            User sees the START of the block plus one line of    ║
 * ║            prior context as a visual anchor that this is a new  ║
 * ║            message block.                                        ║
 * ║                                                                  ║
 * ║      2b. BIG-BLOCK REVEAL (first-map read section turned via the ║
 * ║          Continue chip): always anchor the new bubble's TOP to   ║
 * ║          the viewport (armSnapTopNextArrival → snapToLatestTop,   ║
 * ║          via scrollToIndex). Turning the page is a deliberate     ║
 * ║          "start the next section" action, so this fires even if  ║
 * ║          the user drifted off-bottom, and bypasses the Case A/B  ║
 * ║          fit test — that test mis-lands the user at the section's║
 * ║          END because tall Markdown measures its height late.     ║
 * ║                                                                  ║
 * ║      Smart-snap fires only while the user is at-bottom           ║
 * ║      (isAtBottomRef true) and hasn't dragged away                ║
 * ║      (userOverrideRef false). The trigger is bubble ARRIVAL —   ║
 * ║      a new item appended to the message list. Case A vs Case B ║
 * ║      is decided at arrival time against the bubble's height as ║
 * ║      it first lands. Bulk message arrivals (session restore /  ║
 * ║      history load) bypass smart-snap and use plain scrollToEnd ║
 * ║      — the user wants to be at the bottom of the loaded thread,║
 * ║      not at the top of the first message.                      ║
 * ║                                                                  ║
 * ║      Once a bubble has landed, INCREMENTAL height changes on    ║
 * ║      that same bubble (typewriter reveal of long text, chip-    ║
 * ║      row attaching via the empty-prompt path, deep-read footer  ║
 * ║      animations) DO NOT re-run snap. They sticky-bottom — i.e. ║
 * ║      if the user is still at-bottom, scrollToEnd; otherwise     ║
 * ║      leave them alone. Re-running snap here would yank the user║
 * ║      back to the bubble's top mid-read (Case B), making a long║
 * ║      typewriter bubble look like "one line + cursor" while text║
 * ║      streams into the area below the viewport.                  ║
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
 * ║      bottom, we re-run smart-snap inside onLayout. Without this  ║
 * ║      the latest bubble can end up clipped behind the newly-      ║
 * ║      raised input. Critically, smart-snap re-evaluates Case A    ║
 * ║      vs Case B with the NEW (smaller) viewport, so a message     ║
 * ║      that fit before the keyboard rose but no longer fits now    ║
 * ║      anchors to its top instead of jamming the user into the     ║
 * ║      tail end behind the keyboard.                               ║
 * ║                                                                  ║
 * ║   5. On Keyboard.didShow / didHide we re-run smart-snap (with    ║
 * ║      a small post-layout delay) so any keyboard-driven height    ║
 * ║      change that didn't surface via onLayout still corrects.     ║
 * ║      Same gating: only when at-bottom, only when user hasn't     ║
 * ║      taken over via drag. Same Case A vs Case B logic.           ║
 * ║                                                                  ║
 * ║   6. The KeyboardAvoidingView wrapping the chat MUST use         ║
 * ║      `behavior="padding"` on iOS, `"height"` on Android, and     ║
 * ║      `keyboardVerticalOffset = KEYBOARD_VERTICAL_OFFSET_IOS` on  ║
 * ║      iOS (exported from this file — see below). The constant     ║
 * ║      lives here so screens never re-decide it. Web is a no-op.   ║
 * ║                                                                  ║
 * ║   7. The Composer (and any bottom-anchored UI) MUST drop its     ║
 * ║      safe-area bottom padding while the keyboard is showing,     ║
 * ║      using `isKeyboardVisible` from this hook. Otherwise the     ║
 * ║      home-indicator inset re-applies on top of the raised        ║
 * ║      input, creating ~34px of dead space above the keyboard.     ║
 * ║                                                                  ║
 * ║   8. The keyboard auto-dismisses after IDLE_KEYBOARD_DISMISS_MS  ║
 * ║      of input inactivity (no focus, no typing). The Composer     ║
 * ║      arms a timer on focus + on every keystroke; it fires        ║
 * ║      Keyboard.dismiss() when the user has gone quiet. Constant   ║
 * ║      exported here so it stays in one place across forks.        ║
 * ║                                                                  ║
 * ║   ── Chip-tray invariant ──────────────────────────────────      ║
 * ║                                                                  ║
 * ║   9. The prompt that owns the current sticky chip row is         ║
 * ║      ALWAYS visible above the chip row at idle. When the chip    ║
 * ║      row mounts, swaps, or unmounts, the FlatList's last bubble  ║
 * ║      (which carries the prompt — possibly empty-prompt chips     ║
 * ║      attached to the previous bot bubble) MUST land above the    ║
 * ║      chip row, never behind it. ChatScreen calls                 ║
 * ║      `armSnapAfterChrome()` whenever `latestChipMessage.id`      ║
 * ║      changes; that one-shot flag tells the next `onLayout`       ║
 * ║      event to fire smart-snap REGARDLESS of `isAtBottomRef`.     ║
 * ║      This closes the race where the user drifted off-bottom      ║
 * ║      (keyboard rise, brief touch) right before the chip event    ║
 * ║      arrived. Without this, smart-snap would skip and leave      ║
 * ║      the prompt covered. The invariant is enforced; rule 1's     ║
 * ║      "never yank a reader" yields here because the chip tray's   ║
 * ║      affordance is meaningless without its prompt visible.       ║
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
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
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
  /** Call ONCE right before a sticky element above the Composer mounts,
   * swaps, or unmounts — i.e. the chrome around the FlatList is about
   * to change. Arms the next `onLayout` event to fire smart-snap
   * regardless of `isAtBottomRef`. Use this when a chip tray swap
   * happens while the user is mid-read above bottom: the contract owes
   * "the bubble the chip row answers must be visible," even if the
   * user wasn't following the tail at the moment the chip landed.
   * One-shot — clears after firing. */
  armSnapAfterChrome: () => void;
  /** Call ONCE right before appending a large read block (a first-map
   * read section, revealed by the Continue chip). The next new-bubble
   * arrival anchors that bubble's TOP to the viewport (start of the
   * section), instead of running the fit-based Case A/B decision which
   * mis-lands the user at the section's END. One-shot. */
  armSnapTopNextArrival: () => void;
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
  onContentSizeChange: (contentWidth: number, contentHeight: number) => void;
  /** Pass to <FlatList onLayout={onLayout} …/>. */
  onLayout: (e: LayoutChangeEvent) => void;
  /** Wire to the pill's onPress — clears override + scrolls to bottom. */
  jumpToLatest: () => void;
  /** True while the soft keyboard is showing (iOS + Android). Use this to
   * drop the safe-area bottom padding in the Composer (or any other
   * bottom-anchored UI) — the keyboard already covers the home-indicator
   * area, so adding `insets.bottom` on top of it just creates dead space
   * above the keyboard. Always-false on web. */
  isKeyboardVisible: boolean;
  /** ChatScreen flips this true on the first `token` event of a stream
   * and false ~300ms after the stream ends. The hook uses it to:
   *   1. Tighten the AT_BOTTOM_PX threshold so a 30px finger-nudge
   *      releases sticky-bottom (Claude-style "let me read").
   *   2. Switch sticky-bottom from `scrollToEnd({animated:true})` per
   *      tick to a rAF-coalesced `scrollToOffset({animated:false})` —
   *      no stacked iOS scroll animations during fast token bursts.
   *   3. Suppress the Keyboard.didShow re-snap (the per-frame scroll
   *      already keeps us at bottom; the Keyboard event would just
   *      double-animate). */
  setStreamActive: (active: boolean) => void;
  /** READ-ONLY ref to the current at-bottom state. ChatScreen uses this
   * to mark the FIRST bubble that landed while the user was scrolled
   * away (the "new beat" indicator in the gutter). Do NOT write to this;
   * the hook owns at-bottom truth. */
  isAtBottomRef: React.RefObject<boolean>;
}

const PILL_FADE_MS = 180;
// Threshold below the bottom under which we treat the user as "at the
// bottom of the conversation" for sticky-follow purposes. Small enough
// to tolerate scroll inertia; large enough that one-pixel float math
// doesn't flip-flop the state.
const AT_BOTTOM_PX_IDLE = 60;
// Tighter threshold while a stream is in flight. A 30px scroll-up
// (one finger nudge) should release sticky-bottom — Claude's reading-
// pause heuristic. After the stream settles, we revert to AT_BOTTOM_PX_IDLE
// so normal scrolling tolerates a little inertia overshoot.
const AT_BOTTOM_PX_STREAMING = 24;
// Smart-snap Case B anchor offset: when the latest message is taller
// than the viewport, scroll so its top sits ONE_LINE_PX below the top
// of the viewport. The one line of prior context is a visual anchor
// telling the user "this is the start of a new block." 24 ≈ body
// line-height in bubbles (fontSize 16, lineHeight 22) + a hair of
// padding, so we show roughly the bottom of the previous bubble.
const ONE_LINE_PX = 24;

/**
 * The vertical offset KeyboardAvoidingView must use on iOS so the
 * input clears the keyboard's top edge with breathing room.
 *
 * Why 44 (not 24):
 *  - Composer drops its safe-area bottom while keyboard is visible
 *    (rule 7 — home indicator is covered), so paddingBottom
 *    inside the bar collapses to 14px.
 *  - 14 + 24 = 38, which on real iPhone hardware leaves the input
 *    bottom edge ~half-clipped by the keyboard's top.
 *  - 14 + 44 ≈ 58, enough to fully clear the keyboard's top stroke
 *    plus a hair of breathing room.
 *
 * Why not larger (the previous 56 caused "tons of empty space"):
 *  - 14 + 56 + insets.bottom (34, before we dropped that) = 104.
 *    Now that we drop insets.bottom on keyboard show, 56 alone is
 *    too generous. 44 is the sweet spot.
 *
 * If you find a screen that needs a different value, you have a layout
 * bug, not a knob — surface it here.
 */
export const KEYBOARD_VERTICAL_OFFSET_IOS = 50;

/**
 * Time the soft keyboard stays open without user input before
 * Composer auto-dismisses it. 7 seconds: long enough that a user
 * pausing to think (re-reading a long prompt, looking up a birth
 * detail on another tab) doesn't lose their keyboard, short enough
 * that a tap-on-input-but-walked-away state self-cleans before the
 * next bot bubble lands and competes with the raised input.
 *
 * Was 3000ms — bumped 2026-05-31 after the user reported the
 * dismiss firing while they were still composing a thought during
 * the get_to_know reflection questions.
 *
 * Single source of truth for every product fork — Composer reads
 * from here, not a local constant.
 */
export const IDLE_KEYBOARD_DISMISS_MS = 7000;

export function useChatScroll<T extends MinimalMessage>(
  messages: T[],
): ChatScrollControls<T> {
  const listRef = useRef<FlatList<T>>(null);

  // Mirror of `messages` for callbacks that must read the latest array
  // without re-rendering. useLayoutEffect (not useEffect) so the mirror
  // is in sync BEFORE paint — critical because onLayout / onContentSize
  // fire synchronously after setMessages re-render.
  const messagesRef = useRef<T[]>([]);

  const isAtBottomRef = useRef(true);
  const userOverrideRef = useRef(false);
  const scrollOffsetYRef = useRef(0);
  const listHeightRef = useRef(0);
  const pillOpacity = useRef(new Animated.Value(0)).current;

  // Smart-snap state (see contract rule 2 above).
  // - prevContentHeightRef: total content height as of the last
  //   onContentSizeChange. Captured at useLayoutEffect time so that
  //   when a new bubble lands, we know where its TOP is in content
  //   coords (the previous bottom = new bubble's top).
  // - lastBubbleTopRef: y-position of the most recent bubble's top
  //   edge in content coords. Used by snapToLatest to compute Case A
  //   vs Case B.
  // - prevMessageCountRef: detects single-message arrival vs bulk
  //   (session restore / history load).
  // - isBulkArrivalRef: tells onContentSizeChange to bypass smart-snap
  //   and use plain scrollToEnd. Cleared after one use.
  const prevContentHeightRef = useRef(0);
  const lastBubbleTopRef = useRef(0);
  const prevMessageCountRef = useRef(0);
  const isBulkArrivalRef = useRef(false);

  // Set when this render pass appended a NEW bubble. Read + cleared by
  // the next onContentSizeChange so it can distinguish bubble-arrival
  // height changes (always snap, including Case B) from footer-only
  // height changes (typing indicator mount/unmount + its internal
  // deep-read mode animations) — those should NEVER yank a reader who
  // happens to be mid-thread.
  const pendingNewBubbleRef = useRef(false);

  // Set by ChatScreen via `armSnapAfterChrome()` when the sticky chip
  // tray is about to mount/swap/unmount. Tells the next onLayout shrink
  // OR grow to fire smart-snap regardless of `isAtBottomRef` — see rule
  // 9. Cleared after firing.
  const snapAfterChromeRef = useRef(false);
  const armSnapAfterChrome = useCallback(() => {
    snapAfterChromeRef.current = true;
  }, []);

  // Set by ChatScreen via `armSnapTopNextArrival()` right before it
  // appends a big read block (a first-map section via the Continue
  // chip). Tells the next NEW-bubble onContentSizeChange to anchor that
  // bubble's TOP to the viewport (snapToLatestTop) instead of running
  // the fit-based Case A/B decision — see rule 2b. One-shot.
  const snapTopNextArrivalRef = useRef(false);
  const armSnapTopNextArrival = useCallback(() => {
    snapTopNextArrivalRef.current = true;
  }, []);

  // True while a real LLM token stream is in flight, set by ChatScreen
  // via setStreamActive(). Three behaviors flip while true:
  //  · sticky-bottom uses rAF-coalesced scrollToOffset(animated:false)
  //    instead of scrollToEnd(animated:true), so iOS doesn't stack
  //    animations across token bursts (smoother follow of the cursor).
  //  · AT_BOTTOM_PX tightens to 24 — a 30px finger nudge releases
  //    sticky-bottom (lets the user read while Layla keeps writing).
  //  · Keyboard.didShow / onLayout re-snaps suppressed (the per-frame
  //    scroll already keeps us pinned to the bottom).
  const streamActiveRef = useRef(false);
  // rAF coalescing for sticky-bottom during streaming. We only need
  // ONE scroll per frame regardless of how many setMessages tokens
  // landed — onContentSizeChange schedules a frame, the frame reads
  // the latest content height and scrolls there.
  const pendingScrollRef = useRef(false);
  const stickyBottom = useCallback(() => {
    if (pendingScrollRef.current) return;
    pendingScrollRef.current = true;
    requestAnimationFrame(() => {
      pendingScrollRef.current = false;
      const list = listRef.current;
      if (!list) return;
      const viewportH = listHeightRef.current;
      const contentH = prevContentHeightRef.current;
      const offset = Math.max(0, contentH - viewportH);
      list.scrollToOffset({ offset, animated: false });
    });
  }, []);

  useLayoutEffect(() => {
    messagesRef.current = messages;
    // Smart-snap bookkeeping: detect single new bubble vs bulk arrival.
    // Runs BEFORE the FlatList's onContentSizeChange for this render
    // pass, so we capture the OLD content height as the new bubble's
    // top before it changes.
    const prev = prevMessageCountRef.current;
    const curr = messages.length;
    if (curr === prev + 1) {
      // Single new bubble: its top sits at the previous bottom.
      lastBubbleTopRef.current = prevContentHeightRef.current;
      pendingNewBubbleRef.current = true;
    } else if (curr !== prev) {
      // Bulk change (session restore, history load, clear): user
      // wants to be at the bottom of the whole loaded thread, not
      // anchored to the start of the first message. Force scrollToEnd
      // on the next onContentSizeChange and skip smart-snap.
      isBulkArrivalRef.current = true;
    }
    prevMessageCountRef.current = curr;
  }, [messages]);

  // Force the latest bubble's TOP to the viewport top (plus one line of
  // prior context), regardless of whether it fits. Used for explicit
  // "reveal a big block" actions — the first-map read's section
  // pagination — where the user is turning the page and wants to START
  // reading at the top of the new block, never be dropped at its end.
  //
  // Uses scrollToIndex (not the contentHeight math snapToLatest relies
  // on) because a tall Markdown section measures its height late on web:
  // by the time the height-comparison runs, contentH is still short, so
  // Case A (scrollToEnd) wins and the user lands at the BOTTOM of the
  // section. scrollToIndex asks the list for the item's own offset, which
  // is correct independent of when the Markdown finishes measuring.
  // viewOffset shows ONE_LINE_PX of the previous block as a "this is a
  // new section" anchor. onScrollToIndexFailed (wired in the screen)
  // rescues the rare case where the row isn't measured yet.
  const snapToLatestTop = useCallback((animated: boolean) => {
    const list = listRef.current;
    if (!list) return;
    const lastIndex = messagesRef.current.length - 1;
    if (lastIndex < 0) return;
    list.scrollToIndex({
      index: lastIndex,
      viewPosition: 0,
      viewOffset: ONE_LINE_PX,
      animated,
    });
  }, []);

  // Run the smart-snap rule: Case A (fits) → scrollToEnd; Case B
  // (overflows) → scroll so the new bubble's top is one line below
  // the viewport top. Always gated by isAtBottomRef + userOverrideRef
  // at the call sites; this helper just decides WHICH scroll to do.
  const snapToLatest = useCallback((animated: boolean) => {
    const list = listRef.current;
    if (!list) return;
    const viewportH = listHeightRef.current;
    const contentH = prevContentHeightRef.current;
    const lastTop = lastBubbleTopRef.current;
    const lastBlockH = Math.max(0, contentH - lastTop);
    // viewportH not measured yet OR latest block fits → sticky-bottom.
    if (viewportH <= 0 || lastBlockH <= viewportH) {
      list.scrollToEnd({ animated });
      return;
    }
    // Case B: scroll so the new block's top is one line below the top
    // of the viewport.
    const offset = Math.max(0, lastTop - ONE_LINE_PX);
    list.scrollToOffset({ offset, animated });
  }, []);

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
      // Tighter threshold while streaming — a small finger nudge
      // releases sticky-bottom so the user can read at their pace
      // while Layla keeps writing. Reverts to the lenient 60px once
      // the stream settles.
      const threshold = streamActiveRef.current
        ? AT_BOTTOM_PX_STREAMING
        : AT_BOTTOM_PX_IDLE;
      const atBottom = distanceFromBottom < threshold;
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

  const onContentSizeChange = useCallback(
    (_contentWidth: number, contentHeight: number) => {
      // Update the canonical content-height *before* dispatching the
      // scroll — snapToLatest reads it.
      prevContentHeightRef.current = contentHeight;
      if (messagesRef.current.length === 0) return;
      // Rule 2b: an explicit big-block reveal (a first-map read section
      // turned via the Continue chip) anchors the new bubble's TOP to the
      // viewport, even if the user had drifted off-bottom — turning the
      // page is a deliberate "take me to the start of the next section"
      // action, and the fit-based Case A/B test mis-fires here because the
      // tall Markdown section measures its height late (lands the user at
      // the section's END). One-shot; fires only on the new-bubble pass.
      if (snapTopNextArrivalRef.current && pendingNewBubbleRef.current) {
        snapTopNextArrivalRef.current = false;
        pendingNewBubbleRef.current = false;
        userOverrideRef.current = false;
        snapToLatestTop(true);
        requestAnimationFrame(() => {
          if (!userOverrideRef.current) snapToLatestTop(false);
        });
        return;
      }
      if (userOverrideRef.current) return;
      // Bulk arrival path: jump to bottom of the whole loaded thread
      // without smart-snap (which would otherwise anchor to the top
      // of the FIRST message for a very tall loaded thread).
      if (isBulkArrivalRef.current) {
        isBulkArrivalRef.current = false;
        listRef.current?.scrollToEnd({ animated: false });
        // Re-fire after a frame in case the first call hit a stale
        // viewport (iOS UIScrollView layout settles async).
        requestAnimationFrame(() =>
          listRef.current?.scrollToEnd({ animated: false }),
        );
        return;
      }
      // Distinguish bubble-arrival vs incremental-growth height
      // changes:
      //   · New bubble this render → snap (Case A/B as usual). The
      //     reader expects the new block to be framed correctly.
      //   · Same bubble grew (typewriter reveal expanding a long bot
      //     bubble line by line, chips attaching to the previous bot
      //     bubble via the empty-prompt path, typing indicator
      //     mount/unmount, deep-read footer cycles) → sticky-bottom
      //     ONLY. Snap-to-top here would jerk a reader away from
      //     content they are watching grow, which is exactly the
      //     "only one line + cursor" bug the typewriter exhibited
      //     when its bubble crossed the viewport threshold mid-reveal.
      const isNewBubble = pendingNewBubbleRef.current;
      pendingNewBubbleRef.current = false;
      if (!isNewBubble) {
        if (isAtBottomRef.current) {
          // During streaming, the latest bubble grows every ~16ms as
          // tokens arrive. Per-tick `scrollToEnd({animated:true})`
          // stacks iOS scroll animations and the bottom wobbles.
          // Use rAF-coalesced `scrollToOffset({animated:false})`:
          // one scroll per frame, no animation, perfectly glued to
          // the cursor. Outside streaming (chip-row attach, typing
          // indicator mount), keep the animated scrollToEnd — that
          // single discrete event reads better animated.
          if (streamActiveRef.current) {
            stickyBottom();
          } else {
            listRef.current?.scrollToEnd({ animated: true });
          }
        }
        return;
      }
      snapToLatest(true);
      // Defensive re-fire: on iOS, the FlatList sometimes reports
      // contentHeight before its child views have finished measuring
      // (especially during token streaming and inside a
      // KeyboardAvoidingView resize). Re-running snapToLatest one
      // frame later catches the case where the first scroll landed
      // short of the actual final content edge — so a reply that
      // FITS still appears in full, and a reply that OVERFLOWS still
      // anchors cleanly to its top + 1 line.
      requestAnimationFrame(() => {
        if (!userOverrideRef.current && isAtBottomRef.current) {
          snapToLatest(false);
        }
      });
    },
    [snapToLatest, snapToLatestTop],
  );

  const onLayout = useCallback(
    (e: LayoutChangeEvent) => {
      const newHeight = e.nativeEvent.layout.height;
      const prevHeight = listHeightRef.current;
      listHeightRef.current = newHeight;
      const heightChanged = Math.abs(newHeight - prevHeight) > 1;
      const shrank = prevHeight > 0 && newHeight + 1 < prevHeight;

      // Rule 9: a chip-tray mount/swap was just armed. Smart-snap fires
      // on ANY height change (shrink or grow) regardless of at-bottom or
      // override — the prompt that owns the new chip row MUST be
      // visible above it. One-shot.
      if (snapAfterChromeRef.current && heightChanged && messagesRef.current.length > 0) {
        snapAfterChromeRef.current = false;
        userOverrideRef.current = false;
        isAtBottomRef.current = true;
        requestAnimationFrame(() => {
          snapToLatest(false);
          // Re-fire one frame later in case the chip tray's measure
          // settled after the first snap.
          requestAnimationFrame(() => snapToLatest(false));
        });
        return;
      }

      // Default: when the FlatList's visible height shrinks (keyboard
      // rising, sticky chip row appearing) and the user was at-bottom,
      // re-run smart-snap against the new viewport. Without this, an
      // in-flight bot bubble that was just rendered at the previous
      // bottom edge ends up clipped behind the newly-raised input or
      // chip row. Smart-snap (not raw scrollToEnd) also handles the
      // "fit before, doesn't fit now" case: a bubble that fit before
      // the keyboard rose may overflow the smaller viewport, in which
      // case we anchor to its top instead of jamming the user behind
      // the keyboard.
      if (
        shrank
        && isAtBottomRef.current
        && !userOverrideRef.current
        && messagesRef.current.length > 0
      ) {
        requestAnimationFrame(() => snapToLatest(false));
      }
    },
    [snapToLatest],
  );

  // Keyboard visibility: tracked so consumers (Composer, etc.) can drop
  // safe-area bottom padding while keyboard is showing — the keyboard
  // already covers the home-indicator strip, so re-applying it just
  // creates dead space.
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);

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
        setIsKeyboardVisible(true);
        // Skip the snap during streaming — the per-frame stickyBottom
        // already keeps us pinned to the cursor, and this would just
        // double-animate against the keyboard's rise.
        if (streamActiveRef.current) return;
        if (
          isAtBottomRef.current
          && !userOverrideRef.current
          && messagesRef.current.length > 0
        ) {
          // Slight delay so the keyboard animation completes its first
          // frame before we scroll — otherwise the scroll happens to
          // the pre-resize content edge.
          setTimeout(() => snapToLatest(true), 50);
        }
      },
    );
    const hideSub = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide",
      () => {
        setIsKeyboardVisible(false);
        if (streamActiveRef.current) return;
        if (isAtBottomRef.current && !userOverrideRef.current) {
          setTimeout(() => snapToLatest(true), 50);
        }
      },
    );
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [snapToLatest]);

  const jumpToLatest = useCallback(() => {
    userOverrideRef.current = false;
    setPill(false);
    // Explicit user request — always go to the bottom, not the smart-
    // snap top-of-latest. They tapped a "↓ Latest" pill; they want
    // the tail of the conversation, not the start of the most-recent
    // long message.
    listRef.current?.scrollToEnd({ animated: true });
  }, [setPill]);

  const setStreamActive = useCallback((active: boolean) => {
    streamActiveRef.current = active;
    // When a stream ends, do ONE final smooth scroll-to-bottom if the
    // user was still at the bottom. The rAF-coalesced scrolls during
    // streaming were `animated: false` (intentional — no wobble); the
    // closing scroll gets `animated: true` so the bubble settles with
    // a single soft easing. Skip if the user has scrolled away — they
    // chose to read above, and the pill is already showing.
    if (!active) {
      if (isAtBottomRef.current && !userOverrideRef.current) {
        listRef.current?.scrollToEnd({ animated: true });
      }
    }
  }, []);

  return {
    armSnapAfterChrome,
    armSnapTopNextArrival,
    listRef,
    pillOpacity,
    onScroll,
    onScrollBeginDrag,
    onContentSizeChange,
    onLayout,
    jumpToLatest,
    isKeyboardVisible,
    setStreamActive,
    isAtBottomRef,
  };
}
