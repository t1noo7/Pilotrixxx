import { useEffect, useState, useCallback, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Animated,
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

const DUCK_WAITING_GIF = require("../../../assets/animations/duck-waiting.gif");
const DUCK_SATISFIED_GIF = require("../../../assets/animations/duck-satisfied.gif");

function formatEta(etaSeconds: number | null): string | null {
  if (etaSeconds == null) return null;
  const minutes = Math.max(1, Math.ceil(etaSeconds / 60));
  return `~${minutes} phút nữa`;
}

export default function WaitingScreen() {
  const { id: tripId, vehicleType: vehicleTypeParam } = useLocalSearchParams<{
    id: string;
    vehicleType?: string;
  }>();
  const vehicleType = (vehicleTypeParam as VehicleType) || "sedan";
  const { refreshOngoingTrip } = useTrip();

  const [ready, setReady] = useState(false);
  const [activating, setActivating] = useState(false);
  const [hydrating, setHydrating] = useState(true);
  const [initialVehiclePos, setInitialVehiclePos] = useState<{
    latitude: number | null;
    longitude: number | null;
  } | null>(null);

  // Animation "bien mat dep mat" cho panel vit luc bam bat dau chuyen.
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
        if (current.vehicle_ready_at) setReady(true);
        setInitialVehiclePos({
          latitude: current.vehicle_latitude ?? null,
          longitude: current.vehicle_longitude ?? null,
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
      if (String(data.tripId) === String(tripId) && mounted) setReady(true);
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

  const livePosition = useVehicleLiveTracking(tripId, initialVehiclePos);
  const etaLabel = ready ? null : formatEta(livePosition?.etaSeconds ?? null);

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
      router.replace({
        pathname: "/(app)/trip/destination",
        params: { id: tripId, vehicleType },
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
            <Text style={styles.title}>Xe đã tới nơi! 🎉</Text>
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
      </Animated.View>

      <View style={styles.bottomPanel}>
        {livePosition ? (
          <PendingVehicleMap
            vehicleType={vehicleType}
            latitude={livePosition.latitude}
            longitude={livePosition.longitude}
            heading={livePosition.heading}
            etaSeconds={ready ? null : livePosition.etaSeconds}
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
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    gap: 12,
  },
  bottomPanel: { flex: 1 },
  mapPlaceholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#e5e7eb",
  },
  duck: { width: 180, height: 180 },
  title: {
    fontSize: 18,
    fontWeight: "700",
    color: "#111827",
    textAlign: "center",
  },
  subtitle: { fontSize: 14, color: "#6b7280", textAlign: "center" },
  startBtn: {
    marginTop: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#22c55e",
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 30,
  },
  startBtnText: { color: "#fff", fontWeight: "700", fontSize: 15 },
});
