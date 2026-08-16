import React, { useEffect, useRef } from "react";
import { View, Text, StyleSheet, Animated, Easing, Image } from "react-native";

interface Props {
  comment: string | null;
  loading: boolean;
  color?: string;
}

function LoadingDots() {
  const dots = [useRef(new Animated.Value(0)).current, useRef(new Animated.Value(0)).current, useRef(new Animated.Value(0)).current];

  useEffect(() => {
    const anims = dots.map((dot, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 150),
          Animated.timing(dot, {
            toValue: 1,
            duration: 350,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(dot, {
            toValue: 0,
            duration: 350,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.delay((2 - i) * 150),
        ]),
      ),
    );
    anims.forEach((a) => a.start());
    return () => anims.forEach((a) => a.stop());
  }, []);

  return (
    <View style={styles.dotsRow}>
      {dots.map((dot, i) => (
        <Animated.View
          key={i}
          style={[
            styles.dot,
            {
              opacity: dot.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }),
              transform: [
                {
                  translateY: dot.interpolate({ inputRange: [0, 1], outputRange: [0, -4] }),
                },
              ],
            },
          ]}
        />
      ))}
    </View>
  );
}

export default function AiRoastBubble({ comment, loading, color = "#7c3aed" }: Props) {
  const popAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (comment) {
      popAnim.setValue(0);
      Animated.spring(popAnim, {
        toValue: 1,
        friction: 5,
        tension: 80,
        useNativeDriver: true,
      }).start();
    }
  }, [comment]);

  const popScale = popAnim.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] });

  return (
    <View style={styles.row}>
      <Image
        source={require("../../assets/animations/duck-comment.gif")}
        style={styles.avatarGif}
      />
      <View
        style={[
          styles.bubble,
          { borderColor: color, backgroundColor: color + "16" },
        ]}
      >
        <View style={[styles.bubbleTail, { borderRightColor: color }]} />
        {loading || !comment ? (
          <LoadingDots />
        ) : (
          <Animated.Text
            style={[styles.bubbleText, { transform: [{ scale: popScale }] }]}
          >
            {comment}
          </Animated.Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
    marginVertical: 8,
    paddingHorizontal: 4,
  },
  avatarGif: { width: 34, height: 34, marginTop: 2, borderRadius: 17 },
  bubble: {
    flex: 1,
    borderWidth: 1.5,
    borderRadius: 14,
    borderBottomLeftRadius: 2,
    paddingVertical: 8,
    paddingHorizontal: 12,
    position: "relative",
  },
  bubbleTail: {
    position: "absolute",
    left: -7,
    top: 10,
    width: 0,
    height: 0,
    borderTopWidth: 5,
    borderBottomWidth: 5,
    borderRightWidth: 7,
    borderTopColor: "transparent",
    borderBottomColor: "transparent",
  },
  bubbleText: {
    fontSize: 13,
    color: "#374151",
    fontStyle: "italic",
    lineHeight: 18,
  },
  dotsRow: {
    flexDirection: "row",
    gap: 4,
    paddingVertical: 4,
    alignItems: "center",
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#9ca3af",
  },
});
