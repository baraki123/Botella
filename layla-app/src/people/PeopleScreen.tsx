/**
 * People — the user's Orbit, rendered as a celestial register.
 *
 * Design direction: not a contacts list. Each person is a body in the
 * user's orbit, presented as a typographic portrait. The list reuses
 * the chat canvas atmosphere — Starfield backdrop, soft gold gradient
 * hairlines, Cochin italic display type, and a small gold dot before
 * each name that visually rhymes with Layla's own message marker.
 *
 * Surfaces:
 *  - List: name (Cochin) + role (small-caps italic) + current dynamic.
 *    A right-aligned celestial glyph encodes birth-data depth (chart /
 *    partial / nothing). Rows fade in with a staggered hand instead
 *    of all-at-once.
 *  - Empty: a single sigil, a one-line invocation, and a quiet
 *    instruction. The + below is the ceremony.
 *  - FAB: a gold disc with a stacked-gradient halo. Breathing slow
 *    opacity loop so it feels alive rather than UI.
 *  - Detail: serif-italic name in negative space, plaque-style
 *    metadata, sections separated by soft gold hairlines. The primary
 *    CTA is a line of serif italic with an animated gold underline,
 *    not a button. The destructive action is whispered.
 *
 * Logic preserved from the prior version: long-press → confirm-delete,
 * pull-to-refresh, optimistic delete with rollback, onSendToChat deep-
 * link for the + button and the "Talk to Layla about X" line. testIDs
 * + accessibilityLabels intact.
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
  Alert,
  Animated,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";

import { deleteOrbitPerson, fetchOrbit, type OrbitPerson } from "../api/orbit";
import { Starfield } from "../chat/atmosphere/Starfield";
import { theme } from "../config/theme";
import { useReducedMotion } from "../lib/useReducedMotion";

export interface PeopleScreenProps {
  jwt: string;
  /** Tap "‹ Back" → return to the chat overlay. */
  onClose?: () => void;
  /** Host-provided deep-link helper. When invoked with a text string,
   * the host (App.tsx) switches to the chat route AND queues that text
   * to be sent to the WS once chat is mounted. Used by the floating +
   * button and the "Talk to Layla about X" affordance.
   *
   * Optional second arg `focusPersonId` — when set, the queued WS
   * frame also carries `callback_data: "__focus_person:<id>"` so the
   * brain pins THAT person as the chat's focus for the resulting
   * reply (the "Talk to Layla about Maya" path). Plain + button
   * doesn't pass it. */
  onSendToChat?: (text: string, focusPersonId?: string) => void;
}

export function PeopleScreen({ jwt, onClose, onSendToChat }: PeopleScreenProps) {
  const [people, setPeople] = useState<OrbitPerson[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const list = await fetchOrbit(jwt);
      setPeople(list);
    } catch (e: any) {
      setError(e?.message || "Couldn't reach your Orbit right now.");
      setPeople([]);
    }
  }, [jwt]);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const handleDelete = useCallback(
    async (person: OrbitPerson) => {
      const prior = people;
      setPeople((cur) => (cur ? cur.filter((p) => p.id !== person.id) : cur));
      setSelectedId(null);
      try {
        await deleteOrbitPerson(jwt, person.id);
      } catch (e: any) {
        Alert.alert(
          "Couldn't remove",
          e?.message || "Something went wrong. Pull to refresh.",
        );
        setPeople(prior);
      }
    },
    [jwt, people],
  );

  const handleAddPerson = useCallback(() => {
    if (!onSendToChat) {
      Alert.alert(
        "Adding people",
        "Mention someone in chat — a friend, family member, partner, colleague — and Layla will offer to add them.",
      );
      return;
    }
    onSendToChat("I want to add someone to my Orbit.");
  }, [onSendToChat]);

  const handleTalkAbout = useCallback(
    (person: OrbitPerson) => {
      if (!onSendToChat) {
        Alert.alert("Chat", `Go back to chat and ask about ${person.name}.`);
        return;
      }
      // Pass `person.id` so the queued WS frame carries
      // `callback_data: "__focus_person:<id>"`. The brain pins this
      // person as the focus for the resulting reply — Layla cites
      // their actual placements + synastry, not a generic orbit
      // summary.
      onSendToChat(`I want to talk about ${person.name}.`, person.id);
    },
    [onSendToChat],
  );

  const selected = useMemo(
    () => people?.find((p) => p.id === selectedId) || null,
    [people, selectedId],
  );

  if (selected) {
    return (
      <PersonDetailView
        person={selected}
        onBack={() => setSelectedId(null)}
        onDelete={() => handleDelete(selected)}
        onTalkAbout={() => handleTalkAbout(selected)}
      />
    );
  }

  return (
    <View style={styles.root}>
      <Starfield introDelay={120} />
      <ScreenHeader title="Your Orbit" onBack={onClose} backLabel="Back" />

      {people === null ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={theme.accent} />
        </View>
      ) : people.length === 0 ? (
        <EmptyState error={error} onRetry={load} />
      ) : (
        <FlatList
          data={people}
          keyExtractor={(p) => p.id}
          contentContainerStyle={styles.listContent}
          renderItem={({ item, index }) => (
            <PersonRow
              person={item}
              index={index}
              onPress={() => setSelectedId(item.id)}
              onDelete={() => handleDelete(item)}
            />
          )}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={theme.accent}
            />
          }
          ItemSeparatorComponent={SoftDivider}
          ListFooterComponent={people.length > 0 ? <ListCoda /> : null}
        />
      )}

      <AddOrbitButton onPress={handleAddPerson} />
    </View>
  );
}

// ─── Header ────────────────────────────────────────────────────────────────

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
            accessibilityLabel={`${backLabel} to chat`}
            style={({ pressed }) => [
              styles.backButton,
              pressed && { opacity: 0.55 },
            ]}
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

// ─── List ──────────────────────────────────────────────────────────────────

function PersonRow({
  person,
  index,
  onPress,
  onDelete,
}: {
  person: OrbitPerson;
  index: number;
  onPress: () => void;
  onDelete: () => void;
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

  const confirmAndDelete = () => {
    Alert.alert(
      `Remove ${person.name}?`,
      "They'll leave your Orbit. You can always bring them back later.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Remove", style: "destructive", onPress: onDelete },
      ],
    );
  };

  return (
    <Animated.View style={{ opacity, transform: [{ translateY }] }}>
      <Pressable
        onPress={onPress}
        onLongPress={confirmAndDelete}
        delayLongPress={500}
        accessibilityRole="button"
        accessibilityLabel={`${person.name}, ${person.role || "in your Orbit"}. Tap to open, long-press to remove.`}
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
            <Text style={styles.rowName}>{person.name}</Text>
            {person.role ? (
              <Text style={styles.rowRole}>
                {`In your orbit · ${person.role.toLowerCase()}`}
              </Text>
            ) : (
              <Text style={styles.rowRole}>In your orbit</Text>
            )}
            {person.current_dynamic ? (
              <Text style={styles.rowDynamic} numberOfLines={2}>
                {stripBasicHtml(person.current_dynamic)}
              </Text>
            ) : null}
          </View>
          <BirthDataGlyph status={person.birth_data_status} />
        </View>
      </Pressable>
    </Animated.View>
  );
}

function BirthDataGlyph({ status }: { status: "none" | "partial" | "full" }) {
  if (status === "full") {
    return (
      <View style={styles.glyphCell}>
        <Text style={styles.glyphFull}>✺</Text>
        <Text style={styles.glyphCaption}>chart</Text>
      </View>
    );
  }
  if (status === "partial") {
    return (
      <View style={styles.glyphCell}>
        <Text style={styles.glyphPartial}>◐</Text>
        <Text style={styles.glyphCaption}>partial</Text>
      </View>
    );
  }
  return <View style={styles.glyphCell} />;
}

function ListCoda() {
  return (
    <View style={styles.coda}>
      <GoldHairline />
      <Text style={styles.codaText}>
        The more I know of who you orbit, the closer I see you.
      </Text>
    </View>
  );
}

// ─── Empty state ───────────────────────────────────────────────────────────

function EmptyState({
  error,
  onRetry,
}: {
  error: string | null;
  onRetry: () => void;
}) {
  const reduced = useReducedMotion();
  const fade = useRef(new Animated.Value(reduced ? 1 : 0)).current;

  useEffect(() => {
    if (reduced) return;
    Animated.timing(fade, {
      toValue: 1,
      duration: 900,
      delay: 240,
      useNativeDriver: true,
    }).start();
  }, [fade, reduced]);

  return (
    <Animated.View style={[styles.empty, { opacity: fade }]}>
      <View style={styles.emptySigilWrap}>
        <View style={styles.emptySigilHalo} />
        <Text style={styles.emptySigil}>✶</Text>
      </View>
      <Text style={styles.emptyInvocation}>
        Your sky, yours alone — for now.
      </Text>
      <Text style={styles.emptyBody}>
        Tap the + below to bring someone in. The more I know of who you love and
        how you move with them, the closer I see you.
      </Text>
      {error ? (
        <Pressable
          onPress={onRetry}
          accessibilityRole="button"
          accessibilityLabel="Try loading your Orbit again"
          style={({ pressed }) => [
            styles.retryBtn,
            pressed && { opacity: 0.7 },
          ]}
        >
          <Text style={styles.retryText}>Try again</Text>
        </Pressable>
      ) : null}
    </Animated.View>
  );
}

// ─── Floating add button ───────────────────────────────────────────────────

function AddOrbitButton({ onPress }: { onPress: () => void }) {
  const reduced = useReducedMotion();
  const breath = useRef(new Animated.Value(0)).current;
  const press = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (reduced) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breath, {
          toValue: 1,
          duration: 1900,
          useNativeDriver: true,
        }),
        Animated.timing(breath, {
          toValue: 0,
          duration: 1900,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [breath, reduced]);

  const haloScale = breath.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.18],
  });
  const haloOpacity = breath.interpolate({
    inputRange: [0, 1],
    outputRange: [0.42, 0.16],
  });

  return (
    <Pressable
      onPress={onPress}
      onPressIn={() =>
        Animated.spring(press, {
          toValue: 0.94,
          useNativeDriver: true,
          speed: 28,
          bounciness: 4,
        }).start()
      }
      onPressOut={() =>
        Animated.spring(press, {
          toValue: 1,
          useNativeDriver: true,
          speed: 18,
          bounciness: 6,
        }).start()
      }
      style={styles.fabWrap}
      accessibilityRole="button"
      accessibilityLabel="Add someone to your Orbit"
      testID="people-add-button"
      hitSlop={10}
    >
      <Animated.View
        pointerEvents="none"
        style={[
          styles.fabHalo,
          {
            opacity: haloOpacity,
            transform: [{ scale: haloScale }],
          },
        ]}
      />
      <Animated.View style={[styles.fab, { transform: [{ scale: press }] }]}>
        <LinearGradient
          colors={["#E5BA86", "#D4A574", "#9C7A57"]}
          start={{ x: 0.3, y: 0 }}
          end={{ x: 0.7, y: 1 }}
          style={styles.fabFill}
        >
          <Text style={styles.fabPlus}>+</Text>
        </LinearGradient>
      </Animated.View>
    </Pressable>
  );
}

// ─── Detail view ───────────────────────────────────────────────────────────

function PersonDetailView({
  person,
  onBack,
  onDelete,
  onTalkAbout,
}: {
  person: OrbitPerson;
  onBack: () => void;
  onDelete: () => void;
  onTalkAbout: () => void;
}) {
  const reduced = useReducedMotion();
  const fade = useRef(new Animated.Value(reduced ? 1 : 0)).current;
  const lift = useRef(new Animated.Value(reduced ? 0 : 14)).current;

  useEffect(() => {
    if (reduced) return;
    Animated.parallel([
      Animated.timing(fade, {
        toValue: 1,
        duration: 520,
        useNativeDriver: true,
      }),
      Animated.timing(lift, {
        toValue: 0,
        duration: 520,
        useNativeDriver: true,
      }),
    ]).start();
  }, [fade, lift, reduced]);

  const confirmAndDelete = () => {
    Alert.alert(
      `Remove ${person.name}?`,
      "They'll leave your Orbit. You can always bring them back later.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Remove", style: "destructive", onPress: onDelete },
      ],
    );
  };

  const subtitle =
    [person.role && person.role.toLowerCase()]
      .filter(Boolean)
      .join(" · ") || "in your orbit";

  return (
    <View style={styles.root}>
      <Starfield introDelay={80} />
      <ScreenHeader title=" " onBack={onBack} backLabel="Orbit" />

      <Animated.View
        style={{ flex: 1, opacity: fade, transform: [{ translateY: lift }] }}
      >
        <ScrollView contentContainerStyle={styles.detailContent}>
          <View style={styles.portraitHead}>
            <Text style={styles.portraitName}>{person.name}</Text>
            <Text style={styles.portraitSub}>{subtitle}</Text>
          </View>

          {person.current_dynamic ? (
            <DetailSection title="Current dynamic">
              <Text style={styles.detailBody}>
                {stripBasicHtml(person.current_dynamic)}
              </Text>
            </DetailSection>
          ) : null}

          {person.snapshot ? (
            <DetailSection title="Who they are">
              <Text style={styles.detailBody}>
                {stripBasicHtml(person.snapshot)}
              </Text>
            </DetailSection>
          ) : null}

          {person.compatibility_reading ? (
            <DetailSection title="You together">
              <Text style={styles.detailBody}>
                {stripBasicHtml(person.compatibility_reading)}
              </Text>
            </DetailSection>
          ) : null}

          {person.synastry_aspects.length > 0 ? (
            <DetailSection title="Cross-chart contacts">
              {person.synastry_aspects.map((a, i) => (
                <View key={i} style={styles.aspectRow}>
                  <Text style={styles.aspectHead}>
                    <Text style={styles.aspectPlanet}>{a.a || "?"}</Text>
                    <Text style={styles.aspectGlue}>
                      {"  "}
                      {aspectGlyph(a.aspect)} {a.aspect || ""}
                      {"  "}
                    </Text>
                    <Text style={styles.aspectPlanet}>{a.b || "?"}</Text>
                    {typeof a.orb === "number" ? (
                      <Text style={styles.aspectOrb}>
                        {"   "}
                        {a.orb.toFixed(1)}°
                      </Text>
                    ) : null}
                  </Text>
                  {a.meaning ? (
                    <Text style={styles.aspectMeaning}>
                      {stripBasicHtml(a.meaning)}
                    </Text>
                  ) : null}
                </View>
              ))}
            </DetailSection>
          ) : null}

          {person.birth_date || person.birth_time || person.birth_place ? (
            <DetailSection title="Birth data">
              {person.birth_date ? (
                <DataRow label="Date" value={person.birth_date} />
              ) : null}
              {person.birth_time ? (
                <DataRow label="Time" value={person.birth_time} />
              ) : null}
              {person.birth_place ? (
                <DataRow label="Place" value={person.birth_place} />
              ) : null}
            </DetailSection>
          ) : null}

          <View style={styles.actions}>
            <TalkCTA
              label={`Talk to Layla about ${person.name}`}
              onPress={onTalkAbout}
            />
            <Pressable
              onPress={confirmAndDelete}
              style={({ pressed }) => [
                styles.removeLink,
                pressed && { opacity: 0.6 },
              ]}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${person.name} from Orbit`}
              testID="person-detail-remove-button"
            >
              <Text style={styles.removeLinkText}>
                Remove {person.name} from your Orbit
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      </Animated.View>
    </View>
  );
}

function DetailSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle}>{title.toUpperCase()}</Text>
        <View style={styles.sectionHairlineWrap}>
          <GoldHairline />
        </View>
      </View>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

function DataRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.dataRow}>
      <Text style={styles.dataLabel}>{label.toUpperCase()}</Text>
      <Text style={styles.dataValue}>{value}</Text>
    </View>
  );
}

function TalkCTA({ label, onPress }: { label: string; onPress: () => void }) {
  const underline = useRef(new Animated.Value(0)).current;

  return (
    <Pressable
      onPress={onPress}
      onPressIn={() =>
        Animated.timing(underline, {
          toValue: 1,
          duration: 220,
          useNativeDriver: false,
        }).start()
      }
      onPressOut={() =>
        Animated.timing(underline, {
          toValue: 0,
          duration: 320,
          useNativeDriver: false,
        }).start()
      }
      accessibilityRole="button"
      accessibilityLabel={label}
      testID="person-detail-talk-button"
      style={styles.talkBtn}
    >
      <Text style={styles.talkArrow}>→ </Text>
      <View style={styles.talkLabelWrap}>
        <Text style={styles.talkLabel}>{label}</Text>
        <Animated.View
          style={[
            styles.talkUnderline,
            {
              width: underline.interpolate({
                inputRange: [0, 1],
                outputRange: ["28%", "100%"],
              }),
            },
          ]}
        />
      </View>
    </Pressable>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Map an aspect name to a small typographic glyph. Unknown → bullet. */
function aspectGlyph(aspect: string | undefined): string {
  switch ((aspect || "").toLowerCase()) {
    case "conjunction":
      return "☌";
    case "opposition":
      return "☍";
    case "trine":
      return "△";
    case "square":
      return "□";
    case "sextile":
      return "⚹";
    case "quincunx":
    case "inconjunct":
      return "⚻";
    default:
      return "·";
  }
}

/** Strip raw HTML tags from cached LLM output so the detail screen
 *  renders naturally — those tags were inserted for Telegram's HTML
 *  renderer; Bubble.tsx handles them in chat but Text doesn't. */
function stripBasicHtml(s: string): string {
  return s
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/?[a-z][^>]*>/gi, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .trim();
}

// ─── Styles ────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: theme.bg,
  },

  // Header
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 16,
  },
  backButton: {
    width: 84,
    paddingVertical: 4,
  },
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
  hairline: {
    height: 1,
    width: "100%",
  },
  divider: {
    height: 1,
    width: "82%",
    alignSelf: "center",
  },

  loadingWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },

  // List
  listContent: {
    paddingTop: 8,
    paddingBottom: 140,
  },
  row: {
    paddingHorizontal: 18,
    paddingVertical: 18,
  },
  rowInner: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  rowGutter: {
    width: 24,
    paddingTop: 9,
  },
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
  rowMain: {
    flex: 1,
    paddingRight: 12,
  },
  rowName: {
    color: theme.text,
    fontSize: 21,
    fontFamily: theme.fontSerif,
    letterSpacing: 0.4,
  },
  rowRole: {
    color: theme.textMuted,
    fontSize: 11,
    fontFamily: theme.fontSerifItalic,
    letterSpacing: 1.5,
    marginTop: 2,
  },
  rowDynamic: {
    color: theme.textSubtle,
    fontSize: 14,
    fontStyle: "italic",
    lineHeight: 20,
    marginTop: 8,
  },
  glyphCell: {
    width: 56,
    alignItems: "center",
    justifyContent: "flex-start",
    paddingTop: 4,
  },
  glyphFull: {
    color: theme.accent,
    fontSize: 18,
    textShadowColor: theme.accent,
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 6,
  },
  glyphPartial: {
    color: theme.accentDim,
    fontSize: 17,
  },
  glyphCaption: {
    color: theme.textMuted,
    fontSize: 9,
    letterSpacing: 1.4,
    marginTop: 4,
    fontFamily: theme.fontSerifItalic,
  },

  // List coda (footer beneath rows)
  coda: {
    paddingTop: 28,
    paddingHorizontal: 40,
    paddingBottom: 40,
  },
  codaText: {
    color: theme.textMuted,
    fontSize: 13,
    fontFamily: theme.fontSerifItalic,
    textAlign: "center",
    marginTop: 18,
    lineHeight: 20,
  },

  // Empty state
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 40,
    paddingBottom: 80,
  },
  emptySigilWrap: {
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 28,
  },
  emptySigilHalo: {
    position: "absolute",
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: theme.accent,
    opacity: 0.08,
  },
  emptySigil: {
    color: theme.accent,
    fontSize: 38,
    textShadowColor: theme.accent,
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 16,
  },
  emptyInvocation: {
    color: theme.text,
    fontSize: 20,
    fontFamily: theme.fontSerifItalic,
    textAlign: "center",
    letterSpacing: 0.4,
    lineHeight: 28,
    marginBottom: 14,
  },
  emptyBody: {
    color: theme.textSubtle,
    fontSize: 14,
    lineHeight: 22,
    textAlign: "center",
    maxWidth: 320,
  },
  retryBtn: {
    marginTop: 26,
    paddingHorizontal: 18,
    paddingVertical: 8,
  },
  retryText: {
    color: theme.accent,
    fontSize: 13,
    letterSpacing: 1.3,
    fontFamily: theme.fontSerifItalic,
  },

  // Floating add button
  fabWrap: {
    position: "absolute",
    right: 24,
    bottom: 32,
    width: 64,
    height: 64,
    alignItems: "center",
    justifyContent: "center",
  },
  fabHalo: {
    position: "absolute",
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: theme.accent,
  },
  fab: {
    width: 60,
    height: 60,
    borderRadius: 30,
    shadowColor: theme.accent,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.55,
    shadowRadius: 16,
    elevation: 8,
  },
  fabFill: {
    flex: 1,
    borderRadius: 30,
    alignItems: "center",
    justifyContent: "center",
  },
  fabPlus: {
    color: "#1B0E12",
    fontSize: 32,
    fontFamily: theme.fontSerif,
    lineHeight: 34,
    marginTop: -2,
  },

  // Detail view
  detailContent: {
    paddingHorizontal: 24,
    paddingTop: 6,
    paddingBottom: 56,
  },
  portraitHead: {
    alignItems: "center",
    paddingTop: 22,
    paddingBottom: 34,
  },
  portraitName: {
    color: theme.text,
    fontSize: 38,
    fontFamily: theme.fontSerifItalic,
    letterSpacing: 0.5,
    textAlign: "center",
  },
  portraitSub: {
    color: theme.textMuted,
    fontSize: 11,
    letterSpacing: 2.4,
    marginTop: 10,
    fontFamily: theme.fontSerifItalic,
    textAlign: "center",
  },
  section: {
    marginBottom: 28,
  },
  sectionHead: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 14,
  },
  sectionTitle: {
    color: theme.accent,
    fontSize: 10,
    letterSpacing: 2.6,
    fontFamily: theme.fontSerifItalic,
    paddingRight: 12,
  },
  sectionHairlineWrap: {
    flex: 1,
    height: 1,
    overflow: "hidden",
  },
  sectionBody: {
    paddingHorizontal: 2,
  },
  detailBody: {
    color: theme.text,
    fontSize: 15,
    lineHeight: 24,
    fontFamily: theme.fontSerif,
  },
  aspectRow: {
    marginBottom: 18,
  },
  aspectHead: {
    color: theme.text,
    fontSize: 16,
    fontFamily: theme.fontSerif,
    letterSpacing: 0.3,
  },
  aspectPlanet: {
    color: theme.text,
    fontFamily: theme.fontSerifItalic,
  },
  aspectGlue: {
    color: theme.accent,
    fontFamily: theme.fontSerif,
  },
  aspectOrb: {
    color: theme.textMuted,
    fontSize: 13,
    fontFamily: theme.fontSerifItalic,
  },
  aspectMeaning: {
    color: theme.textSubtle,
    fontSize: 13.5,
    lineHeight: 20,
    marginTop: 6,
    fontStyle: "italic",
  },
  dataRow: {
    flexDirection: "row",
    paddingVertical: 6,
  },
  dataLabel: {
    color: theme.textMuted,
    width: 70,
    fontSize: 10,
    letterSpacing: 2,
    fontFamily: theme.fontSerifItalic,
    paddingTop: 3,
  },
  dataValue: {
    color: theme.text,
    flex: 1,
    fontSize: 15,
    fontFamily: theme.fontSerif,
  },

  // Actions
  actions: {
    marginTop: 20,
    alignItems: "center",
  },
  talkBtn: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingVertical: 14,
    paddingHorizontal: 4,
  },
  talkArrow: {
    color: theme.accent,
    fontSize: 17,
    fontFamily: theme.fontSerifItalic,
    lineHeight: 22,
  },
  talkLabelWrap: {
    paddingBottom: 4,
  },
  talkLabel: {
    color: theme.text,
    fontSize: 17,
    fontFamily: theme.fontSerifItalic,
    letterSpacing: 0.4,
    lineHeight: 22,
  },
  talkUnderline: {
    height: 1,
    backgroundColor: theme.accent,
    marginTop: 4,
    shadowColor: theme.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.7,
    shadowRadius: 4,
  },
  removeLink: {
    marginTop: 28,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  removeLinkText: {
    color: theme.textMuted,
    fontSize: 12,
    letterSpacing: 1.4,
    fontFamily: theme.fontSerifItalic,
  },
});
