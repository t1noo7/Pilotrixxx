import React, { useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Easing,
  Image,
  ScrollView,
} from "react-native";

interface Props {
  comment: string | null;
  loading: boolean;
  color?: string;
}

function LoadingDots() {
  const dots = [
    useRef(new Animated.Value(0)).current,
    useRef(new Animated.Value(0)).current,
    useRef(new Animated.Value(0)).current,
  ];

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
              opacity: dot.interpolate({
                inputRange: [0, 1],
                outputRange: [0.3, 1],
              }),
              transform: [
                {
                  translateY: dot.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, -4],
                  }),
                },
              ],
            },
          ]}
        />
      ))}
    </View>
  );
}

export default function AiRoastBubble({
  comment,
  loading,
  color = "#7c3aed",
}: Props) {
  const popAnim = useRef(new Animated.Value(0)).current;
  // Hieu ung "lua chay" quanh vien bubble - vien doi mau cam->vang->do
  // lien tuc + 1 lop glow mo phia sau nhap nhay theo. Chi bat khi DA CO
  // cau tra loi (khong chay luc dang loading, tranh roi mat).
  const flameAnim = useRef(new Animated.Value(0)).current;
  const showFlame = !loading && !!comment;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(flameAnim, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: false, // interpolate mau khong ho tro native driver
        }),
        Animated.timing(flameAnim, {
          toValue: 0,
          duration: 900,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: false,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, []);

  const flameColor = flameAnim.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: ["#f97316", "#facc15", "#ef4444"],
  });
  const flameGlowOpacity = flameAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.3, 0.6],
  });
  const flameGlowScale = flameAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.05],
  });

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

  const popScale = popAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.7, 1],
  });

  return (
    <View style={styles.row}>
      <Image
        source={require("../../assets/animations/duck-comment.gif")}
        style={styles.avatarGif}
      />
      <View style={styles.bubbleGlowWrap}>
        <Animated.View
          pointerEvents="none"
          style={[
            styles.flameGlow,
            {
              opacity: showFlame ? flameGlowOpacity : 0,
              transform: [{ scale: flameGlowScale }],
              backgroundColor: flameColor,
            },
          ]}
        />
        <Animated.View
          style={[
            styles.bubble,
            {
              backgroundColor: color + "16",
              borderColor: showFlame ? flameColor : color,
            },
          ]}
        >
          <Animated.View
            style={[
              styles.bubbleTail,
              { borderRightColor: showFlame ? "#f97316" : color },
            ]}
          />
          {loading || !comment ? (
            <LoadingDots />
          ) : (
            // Thanh cuon RIENG cho phan text - phong khi cau AI dai hon
            // du gian hien tai (radar 220 + rows ben duoi da chiem nhieu
            // cho), khong bi day het layout ben duoi ra khoi man hinh.
            <ScrollView
              style={styles.bubbleTextScroll}
              showsVerticalScrollIndicator
              nestedScrollEnabled
              persistentScrollbar
            >
              <Animated.Text
                style={[
                  styles.bubbleText,
                  { transform: [{ scale: popScale }] },
                ]}
              >
                {comment}
              </Animated.Text>
            </ScrollView>
          )}
        </Animated.View>
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
  avatarGif: { width: 52, height: 52, marginTop: 2, borderRadius: 26 },
  bubbleGlowWrap: { flex: 1, position: "relative" },
  flameGlow: {
    position: "absolute",
    top: -5,
    left: -5,
    right: -5,
    bottom: -5,
    borderRadius: 18,
  },
  bubble: {
    flex: 1,
    borderWidth: 1.5,
    borderRadius: 14,
    borderBottomLeftRadius: 2,
    paddingVertical: 8,
    paddingHorizontal: 12,
    position: "relative",
  },
  bubbleTextScroll: {
    maxHeight: 90,
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
    paddingRight: 4,
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
