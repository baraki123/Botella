/**
 * Full-screen image viewer triggered by tapping any image bubble in the
 * chat. Fades a black scrim in over the whole screen, springs the image
 * up from below to its centered, contain-fit position. Tap anywhere to
 * dismiss; on iOS the swipe-down gesture also closes via a small
 * touch-driven translation.
 */
import React, { useEffect, useRef } from "react";
import {
  Animated,
  Dimensions,
  Easing,
  Image,
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
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
            style={{ width: width * 0.96, height: height * 0.86 }}
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
      </Animated.View>
    </Modal>
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
});
