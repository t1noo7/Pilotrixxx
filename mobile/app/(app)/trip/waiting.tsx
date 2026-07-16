import { useEffect, useState, useCallback } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Alert } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { activateTrip } from "../../../src/api/driverTrips";
import {
  connectDriverSocket,
  disconnectDriverSocket,
  driverSocket,
} from "../../../src/api/socket";
import { useTrip } from "../../../src/context/TripContext";
import type { VehicleType } from "../../../src/types";

const DUCK_GIF = require("../../../assets/animations/duck-waiting.gif");

export default function WaitingScreen() {
  const { id: tripId, vehicleType: vehicleTypeParam } = useLocalSearchParams<{
    id: string;
    vehicleType?: string;
  }>();
  const vehicleType = (vehicleTypeParam as VehicleType) || "sedan";
  const { refreshOngoingTrip } = useTrip();

  const [ready, setReady] = useState(false);
  const [activating, setActivating] = useState(false);

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

  const handleStart = useCallback(async () => {
    if (!tripId) return;
    setActivating(true);
    try {
      await activateTrip(tripId);
      await refreshOngoingTrip();
      router.replace({
        pathname: "/(app)/trip/[id]",
        params: {
          id: tripId,
          vehicleType,
          startedAt: new Date().toISOString(),
        },
      });
    } catch (err: any) {
      Alert.alert(
        "Không bắt đầu được",
        err.response?.data?.error || "Có lỗi xảy ra, thử lại sau",
      );
      setActivating(false);
    }
  }, [tripId, vehicleType]);

  return (
    <View style={styles.container}>
      <Image source={DUCK_GIF} style={styles.duck} contentFit="contain" />
      {ready ? (
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
          <Text style={styles.subtitle}>Vui lòng đợi trong giây lát 🦆</Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f9fafb",
    padding: 24,
    gap: 12,
  },
  duck: { width: 240, height: 240 },
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
