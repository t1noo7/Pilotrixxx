import { useEffect, useRef, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Modal,
} from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import * as Location from "expo-location";
import MapView, { Marker, Region } from "react-native-maps";
import { Ionicons } from "@expo/vector-icons";
import { sendTelemetry, endTrip } from "../../../src/api/driverTrips";
import LoadingOverlay from "../../../src/components/LoadingOverlay";
import VehicleIcon from "../../../src/components/VehicleIcon";
import { useTrip } from "../../../src/context/TripContext";
import type { RiskScore, VehicleType } from "../../../src/types";

const TELEMETRY_INTERVAL_MS = 8000;

const RISK_COLOR: Record<string, string> = {
  safe: "#22c55e",
  medium: "#f59e0b",
  dangerous: "#ef4444",
};

const RISK_LABEL: Record<string, string> = {
  safe: "An toàn",
  medium: "Trung bình",
  dangerous: "Nguy hiểm",
};

export default function TripScreen() {
  const { id: tripId, vehicleType: vehicleTypeParam, startedAt } =
    useLocalSearchParams<{
      id: string;
      vehicleType?: string;
      startedAt?: string;
    }>();
  const vehicleType: VehicleType =
    (vehicleTypeParam as VehicleType) || "sedan";
  const { clearOngoingTrip } = useTrip();

  const [permissionGranted, setPermissionGranted] = useState<boolean | null>(
    null,
  );
  const [region, setRegion] = useState<Region | null>(null);
  const [speed, setSpeed] = useState<number | null>(null);
  const [heading, setHeading] = useState<number>(0);
  const [trackViewChanges, setTrackViewChanges] = useState(true);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [ending, setEnding] = useState(false);
  const [result, setResult] = useState<{
    riskScore: RiskScore | null;
  } | null>(null);

  const startTimeRef = useRef(
    startedAt && !Number.isNaN(new Date(startedAt).getTime())
      ? new Date(startedAt).getTime()
      : Date.now(),
  );
  const watchSubRef = useRef<Location.LocationSubscription | null>(null);
  const lastCoordsRef = useRef<{
    latitude: number;
    longitude: number;
    speed: number | null;
    heading: number | null;
    accuracy: number | null;
  } | null>(null);
  const telemetryTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Xin quyền vị trí + bắt đầu theo dõi GPS liên tục
  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        setPermissionGranted(false);
        Alert.alert(
          "Cần quyền vị trí",
          "Ứng dụng cần quyền truy cập vị trí để ghi nhận chuyến đi. Vui lòng bật lại trong Cài đặt.",
          [{ text: "OK", onPress: () => router.back() }],
        );
        return;
      }
      setPermissionGranted(true);

      watchSubRef.current = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.High,
          timeInterval: 2000,
          distanceInterval: 5,
        },
        (loc) => {
          const {
            latitude,
            longitude,
            speed: spd,
            heading,
            accuracy,
          } = loc.coords;
          lastCoordsRef.current = {
            latitude,
            longitude,
            speed: spd,
            heading,
            accuracy,
          };
          setSpeed(spd);
          // Heading GPS không đáng tin khi gần đứng yên (dưới ~1.5 km/h) -
          // bỏ qua để tránh đầu xe quay loạn xạ, giữ nguyên hướng cũ.
          const MIN_SPEED_FOR_HEADING = 0.4; // m/s ~ 1.5 km/h
          if (
            heading != null &&
            !Number.isNaN(heading) &&
            spd != null &&
            spd > MIN_SPEED_FOR_HEADING
          ) {
            setHeading(heading);
          }
          setRegion((prev) => ({
            latitude,
            longitude,
            latitudeDelta: prev?.latitudeDelta ?? 0.01,
            longitudeDelta: prev?.longitudeDelta ?? 0.01,
          }));
        },
      );
    })();

    return () => {
      watchSubRef.current?.remove();
    };
  }, []);

  // Timer đếm thời gian chạy chuyến
  useEffect(() => {
    elapsedTimerRef.current = setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 1000);
    return () => {
      if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
    };
  }, []);

  // Marker custom (SVG) chỉ cần "tracksViewChanges" đúng lần đầu để chụp
  // đúng hình - sau đó TẮT ĐI, không thì mỗi lần rotation/coordinate đổi
  // (mỗi 2s) thư viện lại vẽ lại bitmap marker -> giật khựng trên map.
  // rotation/coordinate vẫn cập nhật mượt ở tầng native dù tắt cờ này.
  useEffect(() => {
    const t = setTimeout(() => setTrackViewChanges(false), 500);
    return () => clearTimeout(t);
  }, []);

  // Gửi telemetry định kỳ lên backend
  useEffect(() => {
    if (!tripId) return;
    telemetryTimerRef.current = setInterval(() => {
      const coords = lastCoordsRef.current;
      if (!coords) return;
      sendTelemetry(tripId, {
        latitude: coords.latitude,
        longitude: coords.longitude,
        speed: coords.speed,
        heading: coords.heading,
        accuracy: coords.accuracy,
      }).catch((err) => {
        console.log(
          "sendTelemetry error:",
          err.response?.status,
          err.response?.data,
          err.message,
        );
      });
    }, TELEMETRY_INTERVAL_MS);

    return () => {
      if (telemetryTimerRef.current) clearInterval(telemetryTimerRef.current);
    };
  }, [tripId]);

  const formatElapsed = (sec: number) => {
    const m = Math.floor(sec / 60)
      .toString()
      .padStart(2, "0");
    const s = (sec % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  };

  const handleEndTrip = useCallback(() => {
    Alert.alert("Kết thúc chuyến", "Bạn có chắc muốn kết thúc chuyến đi này?", [
      { text: "Huỷ", style: "cancel" },
      {
        text: "Kết thúc",
        style: "destructive",
        onPress: async () => {
          if (!tripId) return;
          setEnding(true);
          watchSubRef.current?.remove();
          if (telemetryTimerRef.current)
            clearInterval(telemetryTimerRef.current);
          if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
          try {
            const res = await endTrip(tripId);
            clearOngoingTrip();
            setResult({ riskScore: res.riskScore });
          } catch (err: any) {
            Alert.alert(
              "Lỗi",
              err.response?.data?.error ||
                "Không kết thúc được chuyến, thử lại sau",
            );
            setEnding(false);
          }
        },
      },
    ]);
  }, [tripId]);

  const closeResultAndGoBack = () => {
    setResult(null);
    setEnding(false);
    router.replace("/(app)/vehicles");
  };

  if (permissionGranted === null) {
    return <LoadingOverlay visible message="Đang xin quyền vị trí..." />;
  }

  if (!region) {
    return <LoadingOverlay visible message="Đang lấy vị trí GPS..." />;
  }

  const riskLevel = result?.riskScore?.final?.risk_level;

  return (
    <View style={styles.container}>
      <MapView style={styles.map} region={region}>
        <Marker
          coordinate={region}
          anchor={{ x: 0.5, y: 0.5 }}
          rotation={heading}
          flat
          tracksViewChanges={trackViewChanges}
        >
          <VehicleIcon type={vehicleType} height={40} />
        </Marker>
      </MapView>

      <View style={styles.overlayTop}>
        <View style={styles.statBox}>
          <Ionicons name="speedometer-outline" size={18} color="#2563eb" />
          <Text style={styles.statValue}>
            {speed !== null ? Math.max(0, Math.round(speed * 3.6)) : "--"} km/h
          </Text>
        </View>
        <View style={styles.statBox}>
          <Ionicons name="time-outline" size={18} color="#2563eb" />
          <Text style={styles.statValue}>{formatElapsed(elapsedSec)}</Text>
        </View>
      </View>

      <TouchableOpacity
        style={styles.endBtn}
        onPress={handleEndTrip}
        disabled={ending}
      >
        <Ionicons name="stop-circle" size={22} color="#fff" />
        <Text style={styles.endBtnText}>Kết thúc chuyến</Text>
      </TouchableOpacity>

      {ending && !result && (
        <LoadingOverlay visible message="Đang xử lý kết quả chuyến đi..." />
      )}

      <Modal visible={!!result} transparent animationType="fade">
        <View style={styles.resultBackdrop}>
          <View style={styles.resultCard}>
            <VehicleIcon type={vehicleType} height={56} />
            <Ionicons name="checkmark-circle" size={32} color="#22c55e" />
            <Text style={styles.resultTitle}>Đã kết thúc chuyến</Text>
            {riskLevel ? (
              <View
                style={[
                  styles.riskBadge,
                  { backgroundColor: RISK_COLOR[riskLevel] ?? "#9ca3af" },
                ]}
              >
                <Text style={styles.riskBadgeText}>
                  {RISK_LABEL[riskLevel] ?? riskLevel}
                  {result?.riskScore?.final?.risk_score !== undefined
                    ? ` · ${Math.round(result.riskScore.final.risk_score)} điểm`
                    : ""}
                </Text>
              </View>
            ) : (
              <Text style={styles.resultSub}>Đang chờ tính điểm rủi ro...</Text>
            )}
            <TouchableOpacity
              style={styles.resultBtn}
              onPress={closeResultAndGoBack}
            >
              <Text style={styles.resultBtnText}>Về danh sách xe</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1 },
  overlayTop: {
    position: "absolute",
    top: 16,
    left: 16,
    right: 16,
    flexDirection: "row",
    gap: 12,
  },
  statBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#fff",
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 10,
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  statValue: { fontSize: 14, fontWeight: "600", color: "#111827" },
  endBtn: {
    position: "absolute",
    bottom: 32,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#ef4444",
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 30,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  endBtnText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  resultBackdrop: {
    flex: 1,
    backgroundColor: "#00000099",
    justifyContent: "center",
    alignItems: "center",
  },
  resultCard: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 28,
    alignItems: "center",
    gap: 12,
    width: "80%",
  },
  resultTitle: { fontSize: 18, fontWeight: "700", color: "#111827" },
  resultSub: { fontSize: 13, color: "#6b7280" },
  riskBadge: { paddingVertical: 8, paddingHorizontal: 16, borderRadius: 20 },
  riskBadgeText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  resultBtn: {
    marginTop: 8,
    backgroundColor: "#2563eb",
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 10,
  },
  resultBtnText: { color: "#fff", fontWeight: "600", fontSize: 14 },
});
