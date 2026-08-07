import { useEffect, useState, useCallback, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Animated,
  Easing,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { activateTrip, getCurrentTrip } from "../../../src/api/driverTrips";
import {
  connectDriverSocket,
  disconnectDriverSocket,
  driverSocket,
} from "../../../src/api/socket";
import { useTrip } from "../../../src/context/TripContext";
import {
  savePendingTripId,
  clearPendingTripId,
} from "../../../src/utils/pendingTrip";
import type { VehicleType } from "../../../src/types";
import { buildTripScreenParams } from "../../../src/utils/tripNav";
import PendingVehicleMap from "../../../src/components/PendingVehicleMap";
import { useVehicleLiveTracking } from "../../../src/hooks/useVehicleLiveTracking";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";

const DUCK_WAITING_GIF = require("../../../assets/animations/duck-waiting.gif");
const DUCK_SATISFIED_GIF = require("../../../assets/animations/duck-satisfied.gif");

const SPINNER_FRAMES = ["𒅒", "𒈔", "𒅒", "𒇫", "𒄆"];

function useCyclingFrame(frames: string[], intervalMs: number) {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => {
      setIndex((i) => (i + 1) % frames.length);
    }, intervalMs);
    return () => clearInterval(timer);
  }, [frames, intervalMs]);
  return frames[index];
}

function formatEta(etaSeconds: number | null): string | null {
  if (etaSeconds == null) return null;
  const minutes = Math.max(1, Math.ceil(etaSeconds / 60));
  return `~${minutes} phút nữa`;
}

const BURST_POINT_RATIOS = [
  1.0, 0.5, 0.85, 0.45, 1.05, 0.55, 0.78, 0.42, 0.95, 0.5, 1.0, 0.48, 0.88,
  0.52, 1.02, 0.46, 0.8, 0.5, 0.92, 0.44,
];
const BURST_VIEWBOX = { width: 300, height: 110 };

function buildBurstPath(
  radiusX: number,
  radiusY: number,
  ratios: number[],
  cx: number,
  cy: number,
): string {
  const n = ratios.length;
  const points = ratios.map((ratio, i) => {
    const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
    const x = cx + Math.cos(angle) * radiusX * ratio;
    const y = cy + Math.sin(angle) * radiusY * ratio;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return `M ${points[0]} L ${points.slice(1).join(" L ")} Z`;
}

const BURST_PATH_D = buildBurstPath(
  140,
  50,
  BURST_POINT_RATIOS,
  BURST_VIEWBOX.width / 2,
  BURST_VIEWBOX.height / 2,
);
const SPIKE_TIP_INDEXES = [0, 2, 4, 6, 8, 10, 12, 14, 16, 18];

export default function WaitingScreen() {
  const { id: tripId, vehicleType: vehicleTypeParam } = useLocalSearchParams<{
    id: string;
    vehicleType?: string;
  }>();
  const vehicleType = (vehicleTypeParam as VehicleType) || "sedan";
  const insets = useSafeAreaInsets();
  const { refreshOngoingTrip } = useTrip();

  const [ready, setReady] = useState(false);
  const [activating, setActivating] = useState(false);
  const [hydrating, setHydrating] = useState(true);
  const [initialVehiclePos, setInitialVehiclePos] = useState<{
    latitude: number | null;
    longitude: number | null;
  } | null>(null);
  const [driverPos, setDriverPos] = useState<{
    latitude: number | null;
    longitude: number | null;
  } | null>(null);
  const vehicleReadyAtMsRef = useRef<number | null>(null);

  const topPanelOpacity = useRef(new Animated.Value(1)).current;
  const topPanelTranslateY = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const current = await getCurrentTrip();
        if (!mounted) return;
        if (!current || String(current.trip_id) !== String(tripId)) {
          await clearPendingTripId();
          Alert.alert(
            "Chuyến không còn hợp lệ",
            "Chuyến này đã kết thúc hoặc bị huỷ, vui lòng chọn xe khác.",
            [{ text: "OK", onPress: () => router.replace("/(app)/vehicles") }],
          );
          return;
        }
        if (current.status === "ongoing") {
          router.replace({
            pathname: "/(app)/trip/[id]",
            params: buildTripScreenParams(current),
          });
          return;
        }
        await savePendingTripId(current.trip_id);
        if (current.vehicle_ready_at) {
          setReady(true);
          vehicleReadyAtMsRef.current = new Date(
            current.vehicle_ready_at,
          ).getTime();
        }
        setInitialVehiclePos({
          latitude: current.vehicle_latitude ?? null,
          longitude: current.vehicle_longitude ?? null,
        });
        setInitialVehiclePos({
          latitude: current.vehicle_latitude ?? null,
          longitude: current.vehicle_longitude ?? null,
        });
        setDriverPos({
          latitude: current.pickup_latitude ?? null,
          longitude: current.pickup_longitude ?? null,
        });
      } catch (err: any) {
        console.log("getCurrentTrip hydrate error:", err.message);
      } finally {
        if (mounted) setHydrating(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [tripId, vehicleType]);

  useEffect(() => {
    let mounted = true;

    (async () => {
      await connectDriverSocket();
    })();

    const onReady = (data: { tripId: number }) => {
      if (String(data.tripId) === String(tripId) && mounted) {
        setReady(true);
        vehicleReadyAtMsRef.current = Date.now();
      }
    };
    const onFailed = (data: { tripId: number; reason: string }) => {
      if (String(data.tripId) !== String(tripId) || !mounted) return;
      Alert.alert(
        "Không lấy được xe",
        "Xe gặp sự cố khi quay về gara, vui lòng chọn xe khác.",
        [{ text: "OK", onPress: () => router.replace("/(app)/vehicles") }],
      );
    };

    driverSocket.on("vehicle:ready", onReady);
    driverSocket.on("vehicle:failed", onFailed);

    return () => {
      mounted = false;
      driverSocket.off("vehicle:ready", onReady);
      driverSocket.off("vehicle:failed", onFailed);
      disconnectDriverSocket();
    };
  }, [tripId]);

  // Hen 1 LAN DUY NHAT dung luc backend se coi la "qua han" - khong
  // polling lien tuc, vi client da biet chinh xac vehicle_ready_at.
  const PICKUP_WAIT_TIMEOUT_MS = 10 * 60_000; // khop PICKUP_WAIT_TIMEOUT_MINUTES ben backend
  const CHECK_BUFFER_MS = 5_000;

  useEffect(() => {
    if (!ready || vehicleReadyAtMsRef.current == null) return;
    let mounted = true;

    const fireAt =
      vehicleReadyAtMsRef.current + PICKUP_WAIT_TIMEOUT_MS + CHECK_BUFFER_MS;
    const delay = Math.max(0, fireAt - Date.now());

    const timer = setTimeout(async () => {
      try {
        const current = await getCurrentTrip();
        if (!mounted) return;
        if (!current || String(current.trip_id) !== String(tripId)) {
          await clearPendingTripId();
          Alert.alert(
            "Đã quá thời gian nhận xe",
            "Xe đã tới điểm đón nhưng bạn chưa xác nhận trong thời gian quy định. Vui lòng đặt xe khác.",
            [{ text: "OK", onPress: () => router.replace("/(app)/vehicles") }],
          );
        }
      } catch (err: any) {
        console.log("pickup-timeout check error:", err.message);
      }
    }, delay);

    return () => {
      mounted = false;
      clearTimeout(timer);
    };
  }, [ready, tripId]);

  const livePosition = useVehicleLiveTracking(tripId, initialVehiclePos);
  const livePositionRef = useRef(livePosition);
  useEffect(() => {
    livePositionRef.current = livePosition;
  }, [livePosition]);
  const etaLabel = ready ? null : formatEta(livePosition?.etaSeconds ?? null);
  const spinnerFrame = useCyclingFrame(SPINNER_FRAMES, 180);

  const burstAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!ready) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(burstAnim, {
          toValue: 1,
          duration: 550,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(burstAnim, {
          toValue: 0,
          duration: 550,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [ready]);

  const [burstPathD, setBurstPathD] = useState(BURST_PATH_D);
  const burstRafRef = useRef<number | null>(null);
  const burstStartRef = useRef(0);

  useEffect(() => {
    if (!ready) return;
    burstStartRef.current = Date.now();

    const tick = () => {
      const elapsed = Date.now() - burstStartRef.current;
      const ratios = BURST_POINT_RATIOS.map((base, i) => {
        if (!SPIKE_TIP_INDEXES.includes(i)) return base;
        const phase = i * 0.7;
        const wave = Math.sin(elapsed / 260 + phase);
        return base * (1 + wave * 0.22);
      });
      setBurstPathD(
        buildBurstPath(
          140,
          50,
          ratios,
          BURST_VIEWBOX.width / 2,
          BURST_VIEWBOX.height / 2,
        ),
      );
      burstRafRef.current = requestAnimationFrame(tick);
    };
    burstRafRef.current = requestAnimationFrame(tick);

    return () => {
      if (burstRafRef.current != null)
        cancelAnimationFrame(burstRafRef.current);
    };
  }, [ready]);

  const haloAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!ready) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(haloAnim, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(haloAnim, {
          toValue: 0,
          duration: 900,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [ready]);

  const haloOuterScale = haloAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.9, 1.25],
  });
  const haloOuterOpacity = haloAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.28, 0.08],
  });
  const haloInnerScale = haloAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.15],
  });
  const haloInnerOpacity = haloAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.4, 0.2],
  });
  const haloFarScale = haloAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.85, 1.5],
  });
  const haloFarOpacity = haloAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.18, 0],
  });

  const burstScale = burstAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.94, 1.08],
  });
  const burstOpacity = burstAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.75, 1],
  });

  const handleStart = useCallback(async () => {
    if (!tripId) return;
    setActivating(true);

    Animated.parallel([
      Animated.timing(topPanelOpacity, {
        toValue: 0,
        duration: 350,
        useNativeDriver: true,
      }),
      Animated.timing(topPanelTranslateY, {
        toValue: -40,
        duration: 350,
        useNativeDriver: true,
      }),
    ]).start();

    try {
      await activateTrip(tripId);
      await clearPendingTripId();
      await refreshOngoingTrip();
      const vehiclePos = livePositionRef.current;
      router.replace({
        pathname: "/(app)/trip/destination",
        params: {
          id: tripId,
          vehicleType,
          ...(vehiclePos?.latitude != null && vehiclePos?.longitude != null
            ? {
                vehicleLat: String(vehiclePos.latitude),
                vehicleLng: String(vehiclePos.longitude),
              }
            : {}),
        },
      });
    } catch (err: any) {
      Alert.alert(
        "Không bắt đầu được",
        err.response?.data?.error || "Có lỗi xảy ra, thử lại sau",
      );
      setActivating(false);
      topPanelOpacity.setValue(1);
      topPanelTranslateY.setValue(0);
    }
  }, [tripId, vehicleType]);

  return (
    <View style={styles.container}>
      <Animated.View
        style={[
          styles.topPanel,
          { paddingTop: insets.top + 4 },
          {
            opacity: topPanelOpacity,
            transform: [{ translateY: topPanelTranslateY }],
          },
        ]}
      >
        <Image
          source={ready ? DUCK_SATISFIED_GIF : DUCK_WAITING_GIF}
          style={styles.duck}
          contentFit="contain"
          transition={400}
        />
        {hydrating ? (
          <Text style={styles.subtitle}>Đang kiểm tra trạng thái xe...</Text>
        ) : ready ? (
          <>
            <View style={styles.titleWrapper}>
              <Animated.View
                style={[
                  styles.burstWrapper,
                  { opacity: burstOpacity, transform: [{ scale: burstScale }] },
                ]}
              >
                <Svg
                  width="100%"
                  height="100%"
                  viewBox={`0 0 ${BURST_VIEWBOX.width} ${BURST_VIEWBOX.height}`}
                >
                  <Path
                    d={burstPathD}
                    fill="#fde68a"
                    stroke="#fbbf24"
                    strokeWidth={2}
                    strokeLinejoin="round"
                  />
                </Svg>
              </Animated.View>
              <Text style={styles.title}>Xe đã tới nơi! 🎉</Text>
            </View>
            <Text style={styles.subtitle}>
              Sẵn sàng bắt đầu chuyến đi của bạn
            </Text>
            <TouchableOpacity
              style={styles.startBtn}
              onPress={handleStart}
              disabled={activating}
            >
              <Ionicons name="play-circle" size={22} color="#fff" />
              <Text style={styles.startBtnText}>
                {activating ? "Đang bắt đầu..." : "Bắt đầu chuyến đi"}
              </Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <Text style={styles.title}>Xe đang trên đường tới chỗ bạn...</Text>
            <Text style={styles.subtitle}>
              {etaLabel
                ? `Dự kiến ${etaLabel} 🦆`
                : "Vui lòng đợi trong giây lát 🦆"}
            </Text>
          </>
        )}
        <View style={styles.dividerHaloContainer}>
          <Animated.View
            style={[
              styles.haloRingFar,
              { opacity: haloFarOpacity, transform: [{ scale: haloFarScale }] },
            ]}
          />
          <Animated.View
            style={[
              styles.haloRingOuter,
              {
                opacity: haloOuterOpacity,
                transform: [{ scale: haloOuterScale }],
              },
            ]}
          />
          <Animated.View
            style={[
              styles.haloRingInner,
              {
                opacity: haloInnerOpacity,
                transform: [{ scale: haloInnerScale }],
              },
            ]}
          />
          <View style={styles.dividerBadge}>
            <Text style={styles.dividerBadgeIcon}>{spinnerFrame}</Text>
          </View>
        </View>
      </Animated.View>

      <View style={styles.bottomPanel}>
        {livePosition ? (
          <PendingVehicleMap
            vehicleType={vehicleType}
            latitude={livePosition.latitude}
            longitude={livePosition.longitude}
            heading={livePosition.heading}
            driverLatitude={driverPos?.latitude ?? null}
            driverLongitude={driverPos?.longitude ?? null}
          />
        ) : (
          <View style={styles.mapPlaceholder}>
            <Text style={styles.subtitle}>Đang định vị xe...</Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f9fafb" },
  topPanel: {
    flex: 0.85,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    paddingBottom: 34,
    gap: 4,
    backgroundColor: "#fffbea",
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
    zIndex: 2,
  },
  bottomPanel: {
    flex: 2.15,
    marginTop: -20,
    zIndex: 1,
    overflow: "hidden",
  },
  dividerHaloContainer: {
    position: "absolute",
    bottom: -96,
    alignSelf: "center",
    width: 160,
    height: 160,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 3,
  },
  haloRingFar: {
    position: "absolute",
    width: 124,
    height: 124,
    borderRadius: 62,
    backgroundColor: "#fbbf24",
  },
  haloRingOuter: {
    position: "absolute",
    width: 104,
    height: 104,
    borderRadius: 52,
    backgroundColor: "#fde68a",
  },
  haloRingInner: {
    position: "absolute",
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: "#fbbf24",
  },
  dividerBadge: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "#111827",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#fde68a",
    shadowColor: "#fbbf24",
    shadowOpacity: 0.7,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 0 },
    elevation: 10,
  },
  dividerBadgeIcon: {
    fontSize: 22,
    lineHeight: 44,
    width: 64,
    textAlign: "center",
    includeFontPadding: false,
    color: "#f59e0b",
  },
  mapPlaceholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#e5e7eb",
  },
  duck: { width: 120, height: 120 },
  title: {
    fontSize: 16,
    fontWeight: "700",
    color: "#111827",
    textAlign: "center",
  },
  subtitle: { fontSize: 13, color: "#6b7280", textAlign: "center" },
  startBtn: {
    marginTop: -4,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#22c55e",
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 30,
  },
  startBtnText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  titleWrapper: {
    width: 280,
    height: 90,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 2,
  },
  burstWrapper: {
    position: "absolute",
    width: 280,
    height: 100,
    alignItems: "center",
    justifyContent: "center",
  },
});
