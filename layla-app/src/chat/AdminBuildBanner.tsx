/**
 * One-shot build banner for the admin user.
 *
 * On chat-screen mount we call /v1/me. If the user is_admin AND the
 * returned build.sha differs from the SHA we last showed them (cached
 * in AsyncStorage), we slide a small gold-bordered banner down from
 * the top with the build sha + commit subject. Auto-dismisses after
 * 6s; tap to dismiss early.
 *
 * Non-admin users never see anything; this component renders null.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { useEffect, useRef, useState } from "react";
import { Animated, Easing, Pressable, StyleSheet, Text, View } from "react-native";

import { theme } from "../config/theme";
import type { MeBuild } from "../api/me";

const SEEN_KEY = "layla.admin.lastBuildSha";

interface Props {
  isAdmin: boolean;
  build: MeBuild | null;
}

export function AdminBuildBanner({ isAdmin, build }: Props) {
  const [visibleBuild, setVisibleBuild] = useState<MeBuild | null>(null);
  const slide = useRef(new Animated.Value(-80)).current;
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!isAdmin || !build || !build.sha || build.sha === "dev") return;
    let cancelled = false;
    AsyncStorage.getItem(SEEN_KEY).then((seen) => {
      if (cancelled) return;
      if (seen === build.sha) return; // already shown for this build
      setVisibleBuild(build);
      AsyncStorage.setItem(SEEN_KEY, build.sha).catch(() => {});
    });
    return () => {
      cancelled = true;
    };
  }, [isAdmin, build?.sha]);

  useEffect(() => {
    if (!visibleBuild) return;
    Animated.parallel([
      Animated.timing(slide, {
        toValue: 0,
        duration: 320,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(fade, {
        toValue: 1,
        duration: 280,
        useNativeDriver: true,
      }),
    ]).start();

    const t = setTimeout(dismiss, 6000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleBuild]);

  function dismiss() {
    Animated.parallel([
      Animated.timing(slide, {
        toValue: -80,
        duration: 240,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(fade, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start(() => setVisibleBuild(null));
  }

  if (!visibleBuild) return null;

  const time = formatTime(visibleBuild.commit_time);

  return (
    <Animated.View
      style={[
        styles.wrap,
        { transform: [{ translateY: slide }], opacity: fade },
      ]}
      pointerEvents="box-none"
    >
      <Pressable onPress={dismiss} style={styles.pill}>
        <Text style={styles.title}>
          ✦ Layla{visibleBuild.sha ? `  ${visibleBuild.sha}` : ""}
          {time ? `  ·  ${time}` : ""}  is live
        </Text>
        {visibleBuild.note ? (
          <Text style={styles.note} numberOfLines={2}>
            {visibleBuild.note}
          </Text>
        ) : null}
      </Pressable>
    </Animated.View>
  );
}

function formatTime(iso: string): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    const hh = d.getHours().toString().padStart(2, "0");
    const mm = d.getMinutes().toString().padStart(2, "0");
    const day = d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
    return `${day} ${hh}:${mm}`;
  } catch {
    return "";
  }
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    top: 8,
    left: 12,
    right: 12,
    zIndex: 50,
  },
  pill: {
    backgroundColor: theme.surfaceRaised,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.accentDim,
    paddingHorizontal: 14,
    paddingVertical: 10,
    shadowColor: "#000",
    shadowOpacity: 0.45,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  title: {
    color: theme.text,
    fontSize: 13,
    fontWeight: "600" as const,
    letterSpacing: 0.4,
  },
  note: {
    color: theme.textSubtle,
    fontSize: 12,
    marginTop: 4,
    lineHeight: 16,
  },
});
