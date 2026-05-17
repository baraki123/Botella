/**
 * People — the user's Orbit, surfaced as a tab.
 *
 * Previously the only way a user knew their Orbit existed was when Layla
 * mentioned someone in chat. This screen makes Orbit a visible object:
 * see who's in it, see the cached synastry contacts that Layla uses on
 * every chat turn, swipe to remove someone.
 *
 * MVP scope (this commit):
 *  - Empty state ("no one in your Orbit yet — mention someone in chat")
 *  - List view with name, role, birth-data depth badge, recent dynamic line
 *  - Swipe-to-delete → DELETE /v1/orbit/:id
 *
 * Out of scope for this commit, slated for follow-up:
 *  - PersonDetailScreen — tap a row to see snapshot, compatibility, full synastry
 *  - Floating + button → deep-link into the conversational add flow in chat
 *  - Edit birth data after creation
 */
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { deleteOrbitPerson, fetchOrbit, type OrbitPerson } from "../api/orbit";
import { theme } from "../config/theme";

export interface PeopleScreenProps {
  jwt: string;
  /** Called when the user taps the back button to return to the chat. */
  onClose?: () => void;
}

export function PeopleScreen({ jwt, onClose }: PeopleScreenProps) {
  const [people, setPeople] = useState<OrbitPerson[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const list = await fetchOrbit(jwt);
      setPeople(list);
    } catch (e: any) {
      setError(e?.message || "Couldn't load your Orbit.");
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
      // Optimistic update — remove from list immediately so the swipe
      // animation completes without the row reappearing. Roll back on
      // server error.
      const prior = people;
      setPeople((cur) => (cur ? cur.filter((p) => p.id !== person.id) : cur));
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

  return (
    <View style={styles.root}>
      <View style={styles.headerRow}>
        {onClose ? (
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Back to chat"
            style={({ pressed }) => [
              styles.backButton,
              pressed && { opacity: 0.6 },
            ]}
            hitSlop={12}
          >
            <Text style={styles.backButtonText}>‹ Back</Text>
          </Pressable>
        ) : null}
        <Text style={styles.heading}>Your Orbit</Text>
      </View>

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
          renderItem={({ item }) => (
            <PersonRow person={item} onDelete={() => handleDelete(item)} />
          )}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={theme.accent}
            />
          }
          ItemSeparatorComponent={() => <View style={styles.separator} />}
        />
      )}
    </View>
  );
}

function EmptyState({
  error,
  onRetry,
}: {
  error: string | null;
  onRetry: () => void;
}) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyGlyph}>✦</Text>
      <Text style={styles.emptyTitle}>No one in your Orbit yet.</Text>
      <Text style={styles.emptyBody}>
        Mention someone in chat — a friend, family member, partner, colleague —
        and Layla will offer to add them. The more she knows about the people
        in your life and their charts, the more useful she becomes.
      </Text>
      {error ? (
        <Pressable
          onPress={onRetry}
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.retryBtn,
            pressed && { opacity: 0.7 },
          ]}
        >
          <Text style={styles.retryText}>Try again</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function PersonRow({
  person,
  onDelete,
}: {
  person: OrbitPerson;
  onDelete: () => void;
}) {
  const confirmAndDelete = () => {
    Alert.alert(
      `Remove ${person.name}?`,
      "They'll be removed from your Orbit. You can always add them again later.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Remove", style: "destructive", onPress: onDelete },
      ],
    );
  };

  // Long-press → confirm-and-delete. Universal native gesture, no extra
  // dependency required. Swipe-to-delete (gesture-handler Swipeable) is
  // a follow-up — adding the native module needs a fresh dev-client
  // build, which we don't want to force on every Expo Go iteration.
  return (
    <Pressable
      onLongPress={confirmAndDelete}
      delayLongPress={500}
      accessibilityLabel={`${person.name}, ${person.role || "in your Orbit"}. Long press to remove.`}
      style={({ pressed }) => [
        styles.row,
        pressed && { backgroundColor: theme.surfaceRaised },
      ]}
    >
      <View style={styles.rowMain}>
        <Text style={styles.rowName}>{person.name}</Text>
        <BirthDataBadge status={person.birth_data_status} />
      </View>
      {person.role ? (
        <Text style={styles.rowRole}>{person.role}</Text>
      ) : null}
      {person.current_dynamic ? (
        <Text style={styles.rowDynamic} numberOfLines={2}>
          {person.current_dynamic}
        </Text>
      ) : null}
    </Pressable>
  );
}

function BirthDataBadge({
  status,
}: {
  status: "none" | "partial" | "full";
}) {
  if (status === "full") {
    return (
      <View style={[styles.badge, styles.badgeFull]}>
        <Text style={styles.badgeText}>chart</Text>
      </View>
    );
  }
  if (status === "partial") {
    return (
      <View style={[styles.badge, styles.badgePartial]}>
        <Text style={styles.badgeText}>partial</Text>
      </View>
    );
  }
  return null;
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: theme.bg,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 18,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.border,
  },
  backButton: {
    paddingVertical: 4,
    paddingRight: 12,
  },
  backButtonText: {
    color: theme.accent,
    fontSize: 17,
  },
  heading: {
    color: theme.text,
    fontSize: 22,
    fontFamily: theme.fontSerif,
    flex: 1,
    textAlign: "center",
    marginRight: 48, // visually balance the Back button width
  },
  loadingWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  listContent: {
    paddingVertical: 8,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: theme.border,
    marginLeft: 16,
  },
  row: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: theme.bg,
  },
  rowMain: {
    flexDirection: "row",
    alignItems: "center",
  },
  rowName: {
    color: theme.text,
    fontSize: 17,
    fontFamily: theme.fontSerif,
    flex: 1,
  },
  rowRole: {
    color: theme.textSubtle,
    fontSize: 14,
    marginTop: 2,
  },
  rowDynamic: {
    color: theme.textMuted,
    fontSize: 13,
    marginTop: 6,
    lineHeight: 18,
  },
  badge: {
    borderRadius: 9,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginLeft: 8,
  },
  badgeFull: {
    backgroundColor: theme.accentSoft,
  },
  badgePartial: {
    backgroundColor: theme.surfaceRaised,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.borderStrong,
  },
  badgeText: {
    color: theme.accent,
    fontSize: 11,
    letterSpacing: 0.4,
  },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 36,
  },
  emptyGlyph: {
    color: theme.accent,
    fontSize: 32,
    marginBottom: 16,
  },
  emptyTitle: {
    color: theme.text,
    fontSize: 18,
    fontFamily: theme.fontSerif,
    marginBottom: 12,
    textAlign: "center",
  },
  emptyBody: {
    color: theme.textSubtle,
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
  },
  retryBtn: {
    marginTop: 20,
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.borderStrong,
  },
  retryText: {
    color: theme.accent,
    fontSize: 14,
  },
});

