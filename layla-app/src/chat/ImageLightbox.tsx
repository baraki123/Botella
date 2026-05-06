/**
 * Full-screen image viewer triggered by tapping any image bubble in the
 * chat. Fades a black scrim in over the whole screen, springs the image
 * up from below to its centered, contain-fit position. Tap anywhere to
 * dismiss; on iOS the swipe-down gesture also closes via a small
 * touch-driven translation. A bottom action bar offers "Save" (writes
 * the chart to the user's Photos) and "Share" (system share sheet).
 */
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
  Easing,
  Image,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Svg, { Path } from "react-native-svg";

import { theme } from "../config/theme";

interface Props {
  uri: string | null;
  onClose: () => void;
}

export function ImageLightbox({ uri, onClose }: Props) {
  const visible = uri != null;
  const fade = useRef(new Animated.Value(0)).current;
  const lift = useRef(new Animated.Value(20)).current;
  const dragY = useRef(new Animated.Value(0)).current;
  const [busy, setBusy] = useState<"save" | "share" | null>(null);

  useEffect(() => {
    if (!visible) return;
    fade.setValue(0);
    lift.setValue(20);
    dragY.setValue(0);
    Animated.parallel([
      Animated.timing(fade, {
        toValue: 1,
        duration: 220,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.spring(lift, {
        toValue: 0,
        damping: 14,
        stiffness: 160,
        mass: 0.8,
        useNativeDriver: true,
      }),
    ]).start();
  }, [visible, fade, lift, dragY]);

  const close = () => {
    Animated.timing(fade, {
      toValue: 0,
      duration: 180,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
      onClose();
    });
  };

  // Materializes the (possibly base64) image as a real local file URI so
  // expo-sharing / expo-media-library can act on it. data: URLs aren't
  // accepted by either API. Returns the file URI on success, null on
  // failure (caller surfaces the error).
  const materializeFile = async (sourceUri: string): Promise<string | null> => {
    try {
      const FileSystem: any = await import("expo-file-system");
      const dir = FileSystem.cacheDirectory || FileSystem.documentDirectory;
      if (!dir) return sourceUri;
      const ts = Date.now();
      const target = `${dir}layla-chart-${ts}.png`;
      if (sourceUri.startsWith("data:")) {
        const comma = sourceUri.indexOf(",");
        const b64 = comma >= 0 ? sourceUri.slice(comma + 1) : sourceUri;
        await FileSystem.writeAsStringAsync(target, b64, {
          encoding: FileSystem.EncodingType.Base64,
        });
        return target;
      }
      // Remote URL — download to cache.
      const dl = await FileSystem.downloadAsync(sourceUri, target);
      return dl?.uri ?? null;
    } catch {
      return null;
    }
  };

  const handleSave = async () => {
    if (!uri || busy) return;
    setBusy("save");
    try {
      if (Platform.OS === "web") {
        // Web: trigger a download of the data: URL.
        // @ts-ignore
        const a = document.createElement("a");
        a.href = uri;
        a.download = "layla-chart.png";
        a.click();
        return;
      }
      const MediaLibrary: any = await import("expo-media-library");
      const perm = await MediaLibrary.requestPermissionsAsync(false);
      if (!perm.granted) {
        Alert.alert(
          "Photos access",
          "Allow Photos access in Settings to save your chart.",
        );
        return;
      }
      const fileUri = await materializeFile(uri);
      if (!fileUri) {
        Alert.alert("Couldn't save", "Failed to materialize the image.");
        return;
      }
      const asset = await MediaLibrary.createAssetAsync(fileUri);
      try {
        await MediaLibrary.createAlbumAsync("Layla", asset, false);
      } catch {
        // Album creation is nice-to-have; the asset is in the camera roll
        // either way.
      }
      Alert.alert("Saved", "Your chart is in Photos.");
    } catch (e: any) {
      Alert.alert("Couldn't save", String(e?.message ?? e));
    } finally {
      setBusy(null);
    }
  };

  const handleShare = async () => {
    if (!uri || busy) return;
    setBusy("share");
    try {
      if (Platform.OS === "web") {
        // Web fallback: open the data URL in a new tab so the user can
        // save it via the browser's native UI.
        // @ts-ignore
        window.open(uri, "_blank");
        return;
      }
      const Sharing: any = await import("expo-sharing");
      const available = await Sharing.isAvailableAsync();
      if (!available) {
        Alert.alert("Sharing unavailable on this device.");
        return;
      }
      const fileUri = await materializeFile(uri);
      if (!fileUri) {
        Alert.alert("Couldn't share", "Failed to materialize the image.");
        return;
      }
      await Sharing.shareAsync(fileUri, {
        mimeType: "image/png",
        dialogTitle: "Share your chart",
        UTI: "public.png",
      });
    } catch (e: any) {
      // expo-sharing throws on user-cancel on some versions; treat any
      // string containing "cancel" as a no-op.
      const msg = String(e?.message ?? e);
      if (!/cancel/i.test(msg)) {
        Alert.alert("Couldn't share", msg);
      }
    } finally {
      setBusy(null);
    }
  };

  // Vertical drag-to-dismiss. Threshold ≈ 120pt.
  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 8,
      onPanResponderMove: Animated.event([null, { dy: dragY }], {
        useNativeDriver: false,
      }),
      onPanResponderRelease: (_, g) => {
        if (Math.abs(g.dy) > 120) {
          close();
        } else {
          Animated.spring(dragY, {
            toValue: 0,
            damping: 15,
            stiffness: 160,
            useNativeDriver: true,
          }).start();
        }
      },
    }),
  ).current;

  if (!visible) return null;

  const { width, height } = Dimensions.get("window");

  return (
    <Modal
      transparent
      visible={visible}
      animationType="none"
      onRequestClose={close}
      statusBarTranslucent
    >
      <Animated.View
        style={[StyleSheet.absoluteFill, { opacity: fade }]}
        pointerEvents="box-none"
      >
        {/* Scrim — tap anywhere outside the image to dismiss. */}
        <Pressable style={styles.scrim} onPress={close} />

        <Animated.View
          {...pan.panHandlers}
          style={[
            styles.imageWrap,
            {
              width,
              height,
              transform: [{ translateY: Animated.add(lift, dragY) }],
            },
          ]}
        >
          <Image
            source={{ uri: uri! }}
            style={{ width, height }}
            resizeMode="contain"
            accessibilityIgnoresInvertColors
          />
        </Animated.View>

        {/* Close affordance — small gold-bordered chip in the top-right.
            Pure visual cue; the scrim Pressable is what handles dismiss. */}
        <Pressable
          accessibilityLabel="Close"
          onPress={close}
          style={({ pressed }) => [
            styles.closeBtn,
            pressed && { opacity: 0.6 },
          ]}
          hitSlop={12}
        >
          <Svg width={16} height={16} viewBox="0 0 16 16">
            <Path
              d="M3 3 L13 13 M13 3 L3 13"
              stroke={theme.text}
              strokeWidth={1.8}
              strokeLinecap="round"
            />
          </Svg>
        </Pressable>

        {/* Action bar — Save + Share. Floats above the home indicator
            with breathing room; a tap on a button stops propagation so
            the scrim Pressable doesn't see it as a dismiss. */}
        <View style={styles.actionBar} pointerEvents="box-none">
          <ActionButton
            label="Save"
            busy={busy === "save"}
            onPress={handleSave}
            icon={
              <Svg width={16} height={16} viewBox="0 0 16 16">
                <Path
                  d="M8 1 V11 M4 7 L8 11 L12 7 M2 13 H14"
                  stroke={theme.accent}
                  strokeWidth={1.7}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                />
              </Svg>
            }
          />
          <ActionButton
            label="Share"
            busy={busy === "share"}
            onPress={handleShare}
            icon={
              <Svg width={16} height={16} viewBox="0 0 16 16">
                <Path
                  d="M8 1 V10 M5 4 L8 1 L11 4 M3 8 V14 H13 V8"
                  stroke={theme.accent}
                  strokeWidth={1.7}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                />
              </Svg>
            }
          />
        </View>
      </Animated.View>
    </Modal>
  );
}

function ActionButton({
  label,
  icon,
  busy,
  onPress,
}: {
  label: string;
  icon: React.ReactNode;
  busy: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.actionBtn,
        pressed && { opacity: 0.65 },
      ]}
    >
      {busy ? (
        <ActivityIndicator color={theme.accent} />
      ) : (
        <>
          {icon}
          <Text style={styles.actionLabel}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(8, 6, 12, 0.94)",
  },
  imageWrap: {
    alignItems: "center",
    justifyContent: "center",
  },
  closeBtn: {
    position: "absolute",
    top: 56,
    right: 18,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.surfaceRaised,
    borderWidth: 1,
    borderColor: theme.accentDim,
    shadowColor: "#000",
    shadowOpacity: 0.5,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 6,
  },
  actionBar: {
    position: "absolute",
    bottom: 36,
    left: 0,
    right: 0,
    flexDirection: "row",
    justifyContent: "center",
    gap: 12,
  },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 11,
    paddingHorizontal: 22,
    borderRadius: 999,
    backgroundColor: theme.surfaceRaised,
    borderWidth: 1,
    borderColor: theme.accentDim,
    minWidth: 110,
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.5,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  actionLabel: {
    color: theme.text,
    fontSize: 14,
    fontWeight: "500" as const,
    letterSpacing: 0.4,
  },
});
