/**
 * Episodes — Layla's complex reads (your first map, your year ahead, a
 * relationship read) as narrated audio episodes with a podcast player.
 *
 * Design: same celestial register as the People (Orbit) screen — Starfield
 * backdrop, gold hairlines, Cochin italic display type, a gold dot before each
 * title. A full-screen shelf (list) swaps to a nested player on tap, mirroring
 * PeopleScreen → PersonDetailView.
 *
 * The player is built on the episode queue engine (voice/player.ts): one
 * chapter synthesized at a time via the existing TTS endpoint, the next
 * prefetched while the current plays. Controls: play/pause, prev/next chapter,
 * scrub (within the current chapter), playback speed, tap-to-jump chapter list,
 * and an "Ask Layla about this" line that returns to chat with a queued prompt.
 *
 * Playback progress (chapter + position) is persisted per user so reopening an
 * episode resumes where it left off.
 */
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Animated,
  FlatList,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { LinearGradient } from "expo-linear-gradient";

import { fetchEpisodes, type Episode } from "../api/episodes";
import { Starfield } from "../chat/atmosphere/Starfield";
import { theme } from "../config/theme";
import { useReducedMotion } from "../lib/useReducedMotion";
import { usePlayer } from "../voice/usePlayer";
import { stopOthers } from "../voice/coordinator";
import { episodePlayer, type ChapterRef } from "../voice/player";

function _t(lang: string, en: string, he: string): string {
  return lang === "he" ? he : en;
}

// ─── Progress persistence ────────────────────────────────────────────────

const PROGRESS_KEY = (userId: string) => `layla:episode_progress:${userId}`;
type ProgressMap = Record<
  string,
  { index: number; positionSec: number; updatedAt: number }
>;

async function loadProgress(userId: string): Promise<ProgressMap> {
  try {
    const raw = await AsyncStorage.getItem(PROGRESS_KEY(userId));
    return raw ? (JSON.parse(raw) as ProgressMap) : {};
  } catch {
    return {};
  }
}

async function saveProgress(
  userId: string,
  episodeId: string,
  index: number,
  positionSec: number,
): Promise<void> {
  try {
    const cur = await loadProgress(userId);
    cur[episodeId] = { index, positionSec, updatedAt: Date.now() };
    await AsyncStorage.setItem(PROGRESS_KEY(userId), JSON.stringify(cur));
  } catch {
    // best effort
  }
}

function mmss(sec: number): string {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// ─── Shared atmosphere bits (duplicated from PeopleScreen, same as it does) ──

function GoldHairline() {
  return (
    <LinearGradient
      colors={[
        "rgba(212,165,116,0)",
        "rgba(212,165,116,0.42)",
        "rgba(212,165,116,0)",
      ]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 0 }}
      style={styles.hairline}
    />
  );
}

function SoftDivider() {
  return (
    <LinearGradient
      colors={[
        "rgba(212,165,116,0)",
        "rgba(212,165,116,0.18)",
        "rgba(212,165,116,0)",
      ]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 0 }}
      style={styles.divider}
    />
  );
}

function ScreenHeader({
  title,
  onBack,
  backLabel,
}: {
  title: string;
  onBack?: () => void;
  backLabel: string;
}) {
  return (
    <View>
      <View style={styles.headerRow}>
        {onBack ? (
          <Pressable
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel={`${backLabel}`}
            style={({ pressed }) => [styles.backButton, pressed && { opacity: 0.55 }]}
            hitSlop={14}
          >
            <Text style={styles.backButtonText}>‹ {backLabel}</Text>
          </Pressable>
        ) : (
          <View style={styles.backButton} />
        )}
        <Text style={styles.heading} numberOfLines={1}>
          {title}
        </Text>
        <View style={styles.backButton} />
      </View>
      <GoldHairline />
    </View>
  );
}

// ─── Screen ────────────────────────────────────────────────────────────────

export interface EpisodeScreenProps {
  jwt: string;
  userId: string;
  /** Episode id to auto-open on mount (e.g. from the post-map chip). */
  autoOpenEpisodeId?: string | null;
  onClose?: () => void;
  /** Return to chat with a queued question about the episode. */
  onAskLayla?: (text: string) => void;
}

export function EpisodeScreen({
  jwt,
  userId,
  autoOpenEpisodeId,
  onClose,
  onAskLayla,
}: EpisodeScreenProps) {
  const [episodes, setEpisodes] = useState<Episode[] | null>(null);
  const [lang, setLang] = useState<string>("en");
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(
    autoOpenEpisodeId ?? null,
  );
  const [progress, setProgress] = useState<ProgressMap>({});

  const load = useCallback(async () => {
    try {
      setError(null);
      const [res, prog] = await Promise.all([
        fetchEpisodes(jwt),
        loadProgress(userId),
      ]);
      setEpisodes(res.episodes);
      setLang(res.lang);
      setProgress(prog);
    } catch (e: any) {
      setError(e?.message || "Couldn't reach your episodes right now.");
      setEpisodes([]);
    }
  }, [jwt, userId]);

  useEffect(() => {
    load();
  }, [load]);

  // Pause playback when the whole screen unmounts (back to chat) so audio
  // doesn't keep going without a visible control. Background audio is a
  // fast-follow.
  useEffect(() => {
    return () => {
      episodePlayer.pause();
    };
  }, []);

  const selected = useMemo(
    () => episodes?.find((e) => e.id === selectedId) || null,
    [episodes, selectedId],
  );

  if (selected) {
    return (
      <EpisodePlayerView
        episode={selected}
        lang={lang}
        userId={userId}
        jwt={jwt}
        resume={progress[selected.id]}
        onBack={() => setSelectedId(null)}
        onAskLayla={onAskLayla}
      />
    );
  }

  return (
    <View style={styles.root}>
      <Starfield />
      <ScreenHeader
        title={_t(lang, "Episodes", "פרקים")}
        onBack={onClose}
        backLabel={_t(lang, "Back", "חזרה")}
      />
      {episodes === null ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={theme.accent} />
          <Text style={styles.loadingText}>
            {_t(lang, "Gathering your episodes…", "אוספת את הפרקים שלך…")}
          </Text>
        </View>
      ) : error && episodes.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptySigil}>✦</Text>
          <Text style={styles.emptyBody}>{error}</Text>
          <Pressable
            onPress={load}
            accessibilityRole="button"
            testID="episodes-retry"
            style={({ pressed }) => [styles.retryBtn, pressed && { opacity: 0.6 }]}
          >
            <Text style={styles.retryText}>{_t(lang, "Try again", "לנסות שוב")}</Text>
          </Pressable>
        </View>
      ) : episodes.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptySigil}>✦</Text>
          <Text style={styles.emptyTitle}>
            {_t(lang, "No episodes yet", "אין עדיין פרקים")}
          </Text>
          <Text style={styles.emptyBody}>
            {_t(
              lang,
              "Your first map read becomes a narrated episode here. Ask for your year ahead, or add someone to your Orbit, and those become episodes too.",
              "המפה הראשונה שלך תהפוך כאן לפרק מוקרא. בקש/י את השנה הקרובה, או הוסף/י מישהו למסלול שלך, והם יהפכו גם לפרקים.",
            )}
          </Text>
        </View>
      ) : (
        <FlatList
          data={episodes}
          keyExtractor={(e) => e.id}
          contentContainerStyle={styles.listContent}
          ItemSeparatorComponent={SoftDivider}
          renderItem={({ item, index }) => (
            <EpisodeRow
              episode={item}
              index={index}
              lang={lang}
              resumed={!!progress[item.id]}
              onPress={() => setSelectedId(item.id)}
            />
          )}
        />
      )}
    </View>
  );
}

// ─── List row ────────────────────────────────────────────────────────────

function EpisodeRow({
  episode,
  index,
  lang,
  resumed,
  onPress,
}: {
  episode: Episode;
  index: number;
  lang: string;
  resumed: boolean;
  onPress: () => void;
}) {
  const reduced = useReducedMotion();
  const opacity = useRef(new Animated.Value(reduced ? 1 : 0)).current;
  const translateY = useRef(new Animated.Value(reduced ? 0 : 8)).current;

  useEffect(() => {
    if (reduced) return;
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 460,
        delay: 60 + index * 70,
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration: 460,
        delay: 60 + index * 70,
        useNativeDriver: true,
      }),
    ]).start();
  }, [opacity, translateY, index, reduced]);

  return (
    <Animated.View style={{ opacity, transform: [{ translateY }] }}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`${episode.title}. ${episode.subtitle || ""}. Tap to listen.`}
        testID={`episode-row-${episode.type}`}
        style={({ pressed }) => [
          styles.row,
          pressed && { backgroundColor: "rgba(212,165,116,0.04)" },
        ]}
      >
        <View style={styles.rowInner}>
          <View style={styles.rowGutter}>
            <View style={styles.goldDot} />
          </View>
          <View style={styles.rowMain}>
            <Text style={styles.rowTitle}>{episode.title}</Text>
            {episode.subtitle ? (
              <Text style={styles.rowSub}>
                {episode.subtitle}
                {resumed ? _t(lang, "  ·  resume", "  ·  המשך") : ""}
              </Text>
            ) : null}
          </View>
          <Text style={styles.rowPlayGlyph}>▶</Text>
        </View>
      </Pressable>
    </Animated.View>
  );
}

// ─── Player ──────────────────────────────────────────────────────────────

function EpisodePlayerView({
  episode,
  lang,
  userId,
  jwt,
  resume,
  onBack,
  onAskLayla,
}: {
  episode: Episode;
  lang: string;
  userId: string;
  jwt: string;
  resume?: { index: number; positionSec: number };
  onBack: () => void;
  onAskLayla?: (text: string) => void;
}) {
  const reduced = useReducedMotion();
  const player = usePlayer();
  const fade = useRef(new Animated.Value(reduced ? 1 : 0)).current;
  const lift = useRef(new Animated.Value(reduced ? 0 : 14)).current;

  // Load the episode into the queue engine on mount (resume if we have
  // progress). The play disc starts playback (web blocks programmatic
  // autoplay outside a gesture).
  useEffect(() => {
    const chapters: ChapterRef[] = episode.chapters.map((c) => ({
      title: c.title,
      text: c.text,
      charCount: c.char_count,
    }));
    episodePlayer.load({
      episodeId: episode.id,
      episodeTitle: episode.title,
      chapters,
      voice: "shimmer",
      jwt,
      startIndex: resume?.index ?? 0,
      startPositionSec: resume?.positionSec ?? 0,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [episode.id]);

  useEffect(() => {
    if (reduced) return;
    Animated.parallel([
      Animated.timing(fade, { toValue: 1, duration: 520, useNativeDriver: true }),
      Animated.timing(lift, { toValue: 0, duration: 520, useNativeDriver: true }),
    ]).start();
  }, [fade, lift, reduced]);

  // Persist progress (debounced) whenever chapter/position move for THIS
  // episode.
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (player.episodeId !== episode.id) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveProgress(userId, episode.id, player.index, player.positionSec);
    }, 600);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [player.index, player.positionSec, player.episodeId, episode.id, userId]);

  const isThis = player.episodeId === episode.id;
  const status = isThis ? player.status : "idle";
  const curChapter = episode.chapters[isThis ? player.index : 0];
  const playing = status === "playing";
  const loading = status === "loading";

  const askText = _t(
    lang,
    `I just listened to "${episode.title}". I want to ask about it.`,
    `הרגע האזנתי ל"${episode.title}". אני רוצה לשאול על זה.`,
  );

  return (
    <View style={styles.root}>
      <Starfield />
      <ScreenHeader
        title=" "
        onBack={onBack}
        backLabel={_t(lang, "Episodes", "פרקים")}
      />
      <Animated.View
        style={[styles.playerWrap, { opacity: fade, transform: [{ translateY: lift }] }]}
      >
        <ScrollView contentContainerStyle={styles.playerScroll}>
          <Text style={styles.episodeTitle}>{episode.title}</Text>
          {episode.subtitle ? (
            <Text style={styles.episodeSub}>{episode.subtitle}</Text>
          ) : null}

          {/* Now playing */}
          <View style={styles.nowPlaying}>
            <Text style={styles.chapterTitle} numberOfLines={2}>
              {curChapter?.title || ""}
            </Text>
            <Text style={styles.chapterMeta}>
              {_t(lang, "Chapter", "פרק")} {(isThis ? player.index : 0) + 1}{" "}
              {_t(lang, "of", "מתוך")} {episode.chapters.length}
            </Text>
          </View>

          <Scrubber
            positionSec={isThis ? player.positionSec : 0}
            durationSec={isThis ? player.durationSec : 0}
            onSeek={(s) => episodePlayer.seekTo(s)}
          />

          {/* Transport */}
          <View style={styles.transport}>
            <Pressable
              onPress={() => episodePlayer.prev()}
              hitSlop={14}
              accessibilityRole="button"
              accessibilityLabel="Previous chapter"
              testID="player-prev"
              style={({ pressed }) => [styles.transportBtn, pressed && { opacity: 0.5 }]}
            >
              <Text style={styles.transportGlyph}>◀◀</Text>
            </Pressable>

            <PlayDisc
              playing={playing}
              loading={loading}
              onPress={() => episodePlayer.toggle()}
            />

            <Pressable
              onPress={() => episodePlayer.next()}
              hitSlop={14}
              accessibilityRole="button"
              accessibilityLabel="Next chapter"
              testID="player-next"
              style={({ pressed }) => [styles.transportBtn, pressed && { opacity: 0.5 }]}
            >
              <Text style={styles.transportGlyph}>▶▶</Text>
            </Pressable>
          </View>

          {/* Speed */}
          <View style={styles.speedRow}>
            <Pressable
              onPress={() => episodePlayer.cycleRate()}
              accessibilityRole="button"
              accessibilityLabel={`Playback speed ${player.rate}×`}
              testID="player-speed"
              style={({ pressed }) => [styles.speedPill, pressed && { opacity: 0.6 }]}
            >
              <Text style={styles.speedText}>{player.rate}×</Text>
            </Pressable>
          </View>

          {/* Chapter list */}
          <View style={styles.chapterList}>
            <View style={styles.chapterListHead}>
              <Text style={styles.chapterListTitle}>
                {_t(lang, "CHAPTERS", "פרקים")}
              </Text>
              <View style={styles.chapterListHairline}>
                <GoldHairline />
              </View>
            </View>
            {episode.chapters.map((c, i) => {
              const active = isThis && player.index === i;
              return (
                <Pressable
                  key={`${c.title}-${i}`}
                  onPress={() => episodePlayer.jumpTo(i)}
                  testID={`chapter-${i}`}
                  style={({ pressed }) => [
                    styles.chapterRow,
                    pressed && { opacity: 0.6 },
                  ]}
                >
                  <View style={styles.chapterDotCell}>
                    {active ? <View style={styles.chapterDotActive} /> : (
                      <Text style={styles.chapterNum}>{i + 1}</Text>
                    )}
                  </View>
                  <Text
                    style={[styles.chapterRowText, active && styles.chapterRowTextActive]}
                    numberOfLines={1}
                  >
                    {c.title}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* Ask Layla */}
          {onAskLayla ? (
            <AskLaylaCTA
              label={_t(lang, "Ask Layla about this", "שאל/י את לילה על זה")}
              onPress={() => onAskLayla(askText)}
            />
          ) : null}

          {status === "error" && player.error ? (
            <Text style={styles.errorText}>{player.error}</Text>
          ) : null}
        </ScrollView>
      </Animated.View>
    </View>
  );
}

function PlayDisc({
  playing,
  loading,
  onPress,
}: {
  playing: boolean;
  loading: boolean;
  onPress: () => void;
}) {
  const press = useRef(new Animated.Value(1)).current;
  return (
    <Pressable
      onPress={() => {
        stopOthers("episode");
        onPress();
      }}
      onPressIn={() =>
        Animated.spring(press, { toValue: 0.94, useNativeDriver: true, speed: 28, bounciness: 4 }).start()
      }
      onPressOut={() =>
        Animated.spring(press, { toValue: 1, useNativeDriver: true, speed: 18, bounciness: 6 }).start()
      }
      accessibilityRole="button"
      accessibilityLabel={playing ? "Pause" : "Play"}
      testID="player-playpause"
      hitSlop={10}
    >
      <Animated.View style={[styles.disc, { transform: [{ scale: press }] }]}>
        <LinearGradient
          colors={["#E5BA86", "#D4A574", "#9C7A57"]}
          start={{ x: 0.3, y: 0 }}
          end={{ x: 0.7, y: 1 }}
          style={styles.discFill}
        >
          {loading ? (
            <ActivityIndicator color={theme.textInverse} />
          ) : (
            <Text style={styles.discGlyph}>{playing ? "❙❙" : "▶"}</Text>
          )}
        </LinearGradient>
      </Animated.View>
    </Pressable>
  );
}

// PanResponder-driven scrub bar (no extra dependency; matches the codebase's
// Animated-only convention). Drag to a fraction, seek on release.
function Scrubber({
  positionSec,
  durationSec,
  onSeek,
}: {
  positionSec: number;
  durationSec: number;
  onSeek: (sec: number) => void;
}) {
  const [width, setWidth] = useState(0);
  const [dragFrac, setDragFrac] = useState<number | null>(null);

  const frac =
    dragFrac != null
      ? dragFrac
      : durationSec > 0
        ? Math.min(1, Math.max(0, positionSec / durationSec))
        : 0;

  const widthRef = useRef(0);
  widthRef.current = width;
  const durRef = useRef(0);
  durRef.current = durationSec;

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderMove: (_e, g) => {
        const w = widthRef.current;
        if (w <= 0) return;
        setDragFrac(Math.min(1, Math.max(0, g.x0 != null ? (g.moveX - (g.x0 - g.dx)) / w : g.dx / w)));
      },
      onPanResponderGrant: (e) => {
        const w = widthRef.current;
        if (w <= 0) return;
        setDragFrac(Math.min(1, Math.max(0, e.nativeEvent.locationX / w)));
      },
      onPanResponderRelease: (e) => {
        const w = widthRef.current;
        const f =
          w > 0 ? Math.min(1, Math.max(0, e.nativeEvent.locationX / w)) : 0;
        if (durRef.current > 0) onSeek(f * durRef.current);
        setDragFrac(null);
      },
      onPanResponderTerminate: () => setDragFrac(null),
    }),
  ).current;

  const remaining = Math.max(0, durationSec - frac * durationSec);

  return (
    <View style={styles.scrubWrap}>
      <View
        style={styles.scrubTrackHit}
        onLayout={(ev) => setWidth(ev.nativeEvent.layout.width)}
        {...pan.panHandlers}
      >
        <View style={styles.scrubTrack}>
          <View style={[styles.scrubFill, { width: `${frac * 100}%` }]} />
          <View style={[styles.scrubThumb, { left: `${frac * 100}%` }]} />
        </View>
      </View>
      <View style={styles.scrubLabels}>
        <Text style={styles.scrubTime}>{mmss(frac * durationSec)}</Text>
        <Text style={styles.scrubTime}>-{mmss(remaining)}</Text>
      </View>
    </View>
  );
}

function AskLaylaCTA({ label, onPress }: { label: string; onPress: () => void }) {
  const underline = useRef(new Animated.Value(0)).current;
  return (
    <Pressable
      onPress={onPress}
      onPressIn={() =>
        Animated.timing(underline, { toValue: 1, duration: 220, useNativeDriver: false }).start()
      }
      onPressOut={() =>
        Animated.timing(underline, { toValue: 0, duration: 320, useNativeDriver: false }).start()
      }
      accessibilityRole="button"
      accessibilityLabel={label}
      testID="player-ask-layla"
      style={styles.askBtn}
    >
      <Text style={styles.askArrow}>→ </Text>
      <View style={styles.askLabelWrap}>
        <Text style={styles.askLabel}>{label}</Text>
        <Animated.View
          style={[
            styles.askUnderline,
            { width: underline.interpolate({ inputRange: [0, 1], outputRange: ["28%", "100%"] }) },
          ]}
        />
      </View>
    </Pressable>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },

  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 16,
  },
  backButton: { width: 92, paddingVertical: 4 },
  backButtonText: {
    color: theme.accent,
    fontSize: 15,
    fontFamily: theme.fontSerifItalic,
    letterSpacing: 0.4,
  },
  heading: {
    flex: 1,
    color: theme.text,
    fontSize: 23,
    fontFamily: theme.fontSerifItalic,
    letterSpacing: 1.0,
    textAlign: "center",
  },
  hairline: { height: 1, width: "100%" },
  divider: { height: 1, width: "82%", alignSelf: "center" },

  loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 40 },
  loadingText: {
    color: theme.textMuted,
    fontSize: 14,
    fontFamily: theme.fontSerifItalic,
    letterSpacing: 0.4,
    marginTop: 16,
    textAlign: "center",
  },
  retryBtn: {
    marginTop: 22,
    paddingHorizontal: 22,
    paddingVertical: 10,
    borderRadius: 18,
    backgroundColor: theme.surfaceRaised,
    borderWidth: 1,
    borderColor: theme.doorChipRim,
  },
  retryText: {
    color: theme.accent,
    fontSize: 15,
    fontFamily: theme.fontSerifItalic,
    letterSpacing: 0.4,
  },

  // List
  listContent: { paddingTop: 8, paddingBottom: 120 },
  row: { paddingHorizontal: 18, paddingVertical: 20 },
  rowInner: { flexDirection: "row", alignItems: "center" },
  rowGutter: { width: 24, paddingTop: 2 },
  goldDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: theme.accent,
    shadowColor: theme.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.85,
    shadowRadius: 5,
  },
  rowMain: { flex: 1, paddingRight: 12 },
  rowTitle: {
    color: theme.text,
    fontSize: 22,
    fontFamily: theme.fontSerif,
    letterSpacing: 0.4,
  },
  rowSub: {
    color: theme.textMuted,
    fontSize: 12,
    fontFamily: theme.fontSerifItalic,
    letterSpacing: 0.6,
    marginTop: 4,
  },
  rowPlayGlyph: { color: theme.accent, fontSize: 16, paddingLeft: 8 },

  // Empty
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 40,
    paddingBottom: 80,
  },
  emptySigil: { color: theme.accent, fontSize: 30, marginBottom: 18 },
  emptyTitle: {
    color: theme.text,
    fontSize: 22,
    fontFamily: theme.fontSerifItalic,
    marginBottom: 12,
  },
  emptyBody: {
    color: theme.textSubtle,
    fontSize: 14,
    lineHeight: 21,
    textAlign: "center",
  },
  errorText: {
    color: theme.statusClosed,
    fontSize: 13,
    textAlign: "center",
    marginTop: 16,
  },

  // Player
  playerWrap: { flex: 1 },
  playerScroll: { paddingHorizontal: 28, paddingTop: 18, paddingBottom: 80 },
  episodeTitle: {
    color: theme.text,
    fontSize: 34,
    fontFamily: theme.fontSerifItalic,
    letterSpacing: 0.4,
    lineHeight: 40,
  },
  episodeSub: {
    color: theme.textMuted,
    fontSize: 13,
    fontFamily: theme.fontSerifItalic,
    letterSpacing: 0.6,
    marginTop: 6,
  },
  nowPlaying: { marginTop: 28 },
  chapterTitle: {
    color: theme.accent,
    fontSize: 21,
    fontFamily: theme.fontSerifItalic,
    letterSpacing: 0.3,
  },
  chapterMeta: {
    color: theme.textMuted,
    fontSize: 12,
    letterSpacing: 1.4,
    marginTop: 6,
    fontFamily: theme.fontSerifItalic,
  },

  // Scrubber
  scrubWrap: { marginTop: 22 },
  scrubTrackHit: { paddingVertical: 12, justifyContent: "center" },
  scrubTrack: {
    height: 3,
    borderRadius: 2,
    backgroundColor: theme.border,
    justifyContent: "center",
  },
  scrubFill: {
    position: "absolute",
    left: 0,
    height: 3,
    borderRadius: 2,
    backgroundColor: theme.accent,
  },
  scrubThumb: {
    position: "absolute",
    width: 12,
    height: 12,
    borderRadius: 6,
    marginLeft: -6,
    backgroundColor: theme.accent,
    shadowColor: theme.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 4,
  },
  scrubLabels: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 4,
  },
  scrubTime: {
    color: theme.textMuted,
    fontSize: 12,
    fontFamily: theme.fontSerifItalic,
    letterSpacing: 0.4,
  },

  // Transport
  transport: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 26,
  },
  transportBtn: {
    width: 52,
    height: 52,
    borderRadius: 26,
    marginHorizontal: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.surfaceRaised,
    borderWidth: 1,
    borderColor: theme.doorChipRim,
  },
  transportGlyph: {
    color: theme.accent,
    fontSize: 15,
    lineHeight: 18,
    letterSpacing: -1,
    textShadowColor: theme.accent,
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 5,
  },
  disc: {
    width: 76,
    height: 76,
    borderRadius: 38,
    shadowColor: theme.accent,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.5,
    shadowRadius: 12,
  },
  discFill: {
    flex: 1,
    borderRadius: 38,
    alignItems: "center",
    justifyContent: "center",
  },
  discGlyph: {
    color: theme.textInverse,
    fontSize: 26,
    fontWeight: "700",
    marginLeft: 2,
  },

  // Speed
  speedRow: { alignItems: "center", marginTop: 22 },
  speedPill: {
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 16,
    backgroundColor: theme.surfaceRaised,
    borderWidth: 1,
    borderColor: theme.chipBorder,
  },
  speedText: {
    color: theme.chipText,
    fontSize: 14,
    letterSpacing: 0.6,
  },

  // Chapter list
  chapterList: { marginTop: 34 },
  chapterListHead: { marginBottom: 8 },
  chapterListTitle: {
    color: theme.accent,
    fontSize: 12,
    letterSpacing: 2,
    fontFamily: theme.fontSerifItalic,
    marginBottom: 6,
  },
  chapterListHairline: { width: "100%" },
  chapterRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 13,
  },
  chapterDotCell: {
    width: 28,
    alignItems: "center",
  },
  chapterDotActive: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: theme.accent,
    shadowColor: theme.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 5,
  },
  chapterNum: {
    color: theme.textMuted,
    fontSize: 13,
    fontFamily: theme.fontSerifItalic,
  },
  chapterRowText: {
    flex: 1,
    color: theme.textSubtle,
    fontSize: 16,
    fontFamily: theme.fontSerif,
  },
  chapterRowTextActive: { color: theme.accent },

  // Ask Layla
  askBtn: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 36,
    paddingVertical: 8,
  },
  askArrow: { color: theme.accent, fontSize: 17, fontFamily: theme.fontSerifItalic },
  askLabelWrap: { alignItems: "flex-start" },
  askLabel: {
    color: theme.accent,
    fontSize: 17,
    fontFamily: theme.fontSerifItalic,
    letterSpacing: 0.3,
  },
  askUnderline: {
    height: 1,
    backgroundColor: theme.accentDim,
    marginTop: 2,
  },
});
