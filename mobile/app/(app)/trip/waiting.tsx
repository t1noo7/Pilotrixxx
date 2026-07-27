import { useEffect, useState, useCallback } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Alert } from "react-native";
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
  const [hydrating, setHydrating] = useState(true);

  // Hydrate trang thai THAT tu API luc mount - truoc day 'ready' chi duoc
  // set true bang cach bat dung 1 lan socket event 'vehicle:ready' dang
  // song. Neu app bi kill/mo lai dung luc event do da ban ra roi (hoac
  // socket chua kip connect), tin hieu mat vinh vien va man hinh ket o
  // "dang tren duong" mai mai du DB/thuc te da khac tu lau. Gio goi
  // getCurrentTrip() (nguon su that ben vung) truoc, chi con cho socket
  // xu ly cap nhat REALTIME trong luc man hinh dang mo.
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const current = await getCurrentTrip();
        if (!mounted) return;
        if (!current || String(current.trip_id) !== String(tripId)) {
          // Trip nay khong con pending/ongoing nua (vd bi 'aborted' luc
          // app dang dong, hoac driver da huy o may khac) - khong con gi
          // de cho o day nua, quay ve man chon xe.
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

  const handleStart = useCallback(async () => {
    if (!tripId) return;
    setActivating(true);
    try {
      await activateTrip(tripId);
      await clearPendingTripId();
      await refreshOngoingTrip();
      // Khong vao thang trip/[id] nua - qua man "chon diem den" truoc,
      // man do se tu quyet dinh dung GPS that hay che do demo roi moi
      // dieu huong tiep vao trip/[id].
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
    }
  }, [tripId, vehicleType]);

  return (
    <View style={styles.container}>
      <Image source={DUCK_GIF} style={styles.duck} contentFit="contain" />
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
