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
import MapView, { Marker, Region, AnimatedRegion } from "react-native-maps";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { sendTelemetry, endTrip, rateTrip } from "../../../src/api/driverTrips";
import LoadingOverlay from "../../../src/components/LoadingOverlay";
import VehicleIcon from "../../../src/components/VehicleIcon";
import { useTrip } from "../../../src/context/TripContext";
import type { RiskScore, VehicleType } from "../../../src/types";
import { Accelerometer } from "expo-sensors";

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

// Tính hướng di chuyển (độ, 0-360, 0=Bắc) từ 2 toạ độ liên tiếp - đáng tin
// hơn heading do GPS/Simulator báo về (dễ bị nhiễu, đặc biệt lúc vào cua ở
// nút giao hoặc lúc mô phỏng route trên Simulator).
function computeBearing(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const dLon = toRad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
  const brng = toDeg(Math.atan2(y, x));
  return (brng + 360) % 360;
}

// Tính khoảng cách (mét) giữa 2 toạ độ - dùng làm fallback tự tính tốc độ
// khi coords.speed do he thong tra ve khong dang tin (null/am - hay gap
// tren Simulator dung xcrun simctl location set, vi lenh nay chi "day"
// toa do tuc thoi, khong mo phong truong speed nhu GPS that).
function computeDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export default function TripScreen() {
  const {
    id: tripId,
    vehicleType: vehicleTypeParam,
    startedAt,
  } = useLocalSearchParams<{
    id: string;
    vehicleType?: string;
    startedAt?: string;
  }>();
  const vehicleType: VehicleType = (vehicleTypeParam as VehicleType) || "sedan";
  const { clearOngoingTrip } = useTrip();

  const [permissionGranted, setPermissionGranted] = useState<boolean | null>(
    null,
  );
  const [region, setRegion] = useState<Region | null>(null);
  const [speed, setSpeed] = useState<number | null>(null);
  const [heading, setHeading] = useState<number>(0);
  const [trackViewChanges, setTrackViewChanges] = useState(true);
  const insets = useSafeAreaInsets();
  const [elapsedSec, setElapsedSec] = useState(0);
  const [ending, setEnding] = useState(false);
  const [result, setResult] = useState<{
    riskScore: RiskScore | null;
  } | null>(null);
  const [rating, setRating] = useState(0);
  const [ratingSubmitting, setRatingSubmitting] = useState(false);

  const startTimeRef = useRef(
    startedAt && !Number.isNaN(new Date(startedAt).getTime())
      ? new Date(startedAt).getTime()
      : Date.now(),
  );
  const watchSubRef = useRef<Location.LocationSubscription | null>(null);
  // Điểm GPS liền trước - dùng để tự tính bearing (hướng di chuyển thật)
  // thay vì tin heading do Simulator/GPS báo về.
  const prevPointRef = useRef<{ latitude: number; longitude: number } | null>(
    null,
  );
  // Mốc thoi gian cua lan doc GPS truoc - dung cung prevPointRef de tu tinh
  // toc do fallback (khoang cach / delta-time) khi coords.speed khong dang tin.
  const prevFixTimeRef = useRef<number | null>(null);
  // Toạ độ marker dạng animated - cho phép marker "trượt" mượt giữa 2 lần
  // GPS ping thay vì nhảy cóc tức thời (gây cảm giác giật khi 2 điểm cách
  // xa nhau lúc xe chạy nhanh).
  const animatedCoordRef = useRef<AnimatedRegion | null>(null);
  const lastCoordsRef = useRef<{
    latitude: number;
    longitude: number;
    speed: number | null;
    heading: number | null;
    accuracy: number | null;
  } | null>(null);
  const telemetryTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Giá trị đỉnh (peak) gia tốc ghi nhận được TRONG khoảng thời gian giữa
  // 2 lần gửi telemetry (8s) - accelerometer lấy mẫu ~10Hz, nhanh hơn
  // nhiều so với tần suất gửi, nếu chỉ đọc giá trị tức thời lúc gửi sẽ bỏ
  // lỡ cú phanh gấp/cua gắt xảy ra ở giữa khoảng. Reset về 0 sau mỗi lần gửi.
  const accelPeakRef = useRef({
    forwardAccel: 0,
    forwardBrake: 0,
    lateral: 0,
  });

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
            heading: gpsHeading,
            accuracy,
          } = loc.coords;

          // coords.speed co the null/am khi khong dang tin (thiet bi that GPS yeu,
          // hoac Simulator dung simctl set khong mo phong truong nay) - fallback
          // tu tinh bang khoang cach/delta-time giua 2 lan doc GPS lien tiep.
          let effectiveSpeed = spd;
          if (
            (effectiveSpeed == null || effectiveSpeed < 0) &&
            prevPointRef.current &&
            prevFixTimeRef.current != null
          ) {
            const dist = computeDistanceMeters(
              prevPointRef.current.latitude,
              prevPointRef.current.longitude,
              latitude,
              longitude,
            );
            const dtSec = (loc.timestamp - prevFixTimeRef.current) / 1000;
            if (dtSec > 0) {
              effectiveSpeed = dist / dtSec;
            }
          }

          lastCoordsRef.current = {
            latitude,
            longitude,
            speed: effectiveSpeed,
            heading: gpsHeading,
            accuracy,
          };
          setSpeed(effectiveSpeed);

          const MIN_SPEED_FOR_HEADING = 0.4; // m/s ~ 1.5 km/h
          if (
            prevPointRef.current &&
            effectiveSpeed != null &&
            effectiveSpeed > MIN_SPEED_FOR_HEADING
          ) {
            const bearing = computeBearing(
              prevPointRef.current.latitude,
              prevPointRef.current.longitude,
              latitude,
              longitude,
            );
            setHeading(bearing);
          }
          prevPointRef.current = { latitude, longitude };
          prevFixTimeRef.current = loc.timestamp;

          // ... phần animatedCoordRef.current / setRegion giữ nguyên, không đổi

          if (animatedCoordRef.current) {
            (animatedCoordRef.current.timing as any)({
              latitude,
              longitude,
              duration: 1800, // hơi ngắn hơn timeInterval (2000ms) để trượt xong trước lần cập nhật tiếp theo
              useNativeDriver: false,
            }).start();
          } else {
            animatedCoordRef.current = new AnimatedRegion({
              latitude,
              longitude,
              latitudeDelta: 0,
              longitudeDelta: 0,
            });
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

  // Đọc accelerometer điện thoại - giả định điện thoại gắn cố định trên
  // táp-lô (dashboard mount), tư thế đứng (portrait), màn hình hướng về
  // tài xế, giống cách thiết bị dashcam/định vị thường lắp thật. Trục y
  // (portrait) ~ hướng tiến/lùi của xe -> rapid_accel/brake_intensity.
  // Trục x ~ hướng ngang (trái/phải) -> sharp_turn. Đây là giả định hợp lý
  // cho scope đồ án, khác với thiết bị IoT bắt vít cố định vào khung xe.
  useEffect(() => {
    Accelerometer.setUpdateInterval(100); // 10Hz

    const GRAVITY_G = 1.0; // trừ trọng lực để chỉ còn gia tốc do chuyển động
    const sub = Accelerometer.addListener(({ x, y }) => {
      // accel_y dương = đang tăng tốc về phía trước, âm = đang giảm tốc (phanh)
      const forward = y;
      const lateral = x;

      if (forward > accelPeakRef.current.forwardAccel) {
        accelPeakRef.current.forwardAccel = forward;
      }
      if (-forward > accelPeakRef.current.forwardBrake) {
        accelPeakRef.current.forwardBrake = -forward;
      }
      if (Math.abs(lateral) > Math.abs(accelPeakRef.current.lateral)) {
        accelPeakRef.current.lateral = lateral;
      }
    });

    return () => sub.remove();
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

      const peak = accelPeakRef.current;
      const brakeIntensity = Math.min(1, peak.forwardBrake / 1.0);

      sendTelemetry(tripId, {
        latitude: coords.latitude,
        longitude: coords.longitude,
        speed: coords.speed,
        heading: coords.heading,
        accuracy: coords.accuracy,
        accelX: Math.round(peak.lateral * 1000) / 1000,
        accelY: Math.round(peak.forwardAccel * 1000) / 1000,
        brakeIntensity: Math.round(brakeIntensity * 1000) / 1000,
      }).catch((err) => {
        console.log(
          "sendTelemetry error:",
          err.response?.status,
          err.response?.data,
          err.message,
        );
      });

      // Reset peak cho cửa sổ 8s tiếp theo
      accelPeakRef.current = { forwardAccel: 0, forwardBrake: 0, lateral: 0 };
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
            setEnding(false);
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

  const handleRate = useCallback(
    async (value: number) => {
      if (!tripId) return;
      setRating(value);
      setRatingSubmitting(true);
      try {
        await rateTrip(tripId, value);
      } catch (err: any) {
        console.log("rateTrip error:", err.response?.data, err.message);
        // Không Alert - đánh giá là phụ, lỗi ở đây không nên chặn driver
        // rời màn hình kết quả.
      } finally {
        setRatingSubmitting(false);
      }
    },
    [tripId],
  );

  const closeResultAndGoBack = () => {
    setResult(null); // đóng Modal component, animation fade tự chạy hết
    setTimeout(() => {
      router.dismissTo("/(app)/vehicles"); // thay router.replace
    }, 300);
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
        {animatedCoordRef.current && (
          <Marker.Animated
            coordinate={animatedCoordRef.current as any}
            anchor={{ x: 0.5, y: 0.5 }}
            tracksViewChanges={trackViewChanges}
          >
            <VehicleIcon type={vehicleType} height={40} rotation={heading} />
          </Marker.Animated>
        )}
      </MapView>

      <View style={[styles.overlayTop, { top: insets.top + 8 }]}>
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

      {__DEV__ && (
        <TouchableOpacity
          style={styles.debugBtn}
          onPress={() => {
            accelPeakRef.current = {
              forwardAccel: 0,
              forwardBrake: 0.35,
              lateral: 0.45,
            };
            Alert.alert(
              "Debug",
              "Đã set giả lập phanh gấp + cua gắt, đợi lần gửi telemetry tiếp theo (~8s) rồi check DB",
            );
          }}
        >
          <Text style={styles.endBtnText}>🧪 Giả lập sự kiện</Text>
        </TouchableOpacity>
      )}

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
                    ? ` · ${Math.round(result.riskScore.final.risk_score * 100)} điểm`
                    : ""}
                </Text>
              </View>
            ) : (
              <Text style={styles.resultSub}>Đang chờ tính điểm rủi ro...</Text>
            )}

            <View style={styles.starRow}>
              {[1, 2, 3, 4, 5].map((n) => (
                <TouchableOpacity
                  key={n}
                  onPress={() => handleRate(n)}
                  disabled={ratingSubmitting}
                  hitSlop={8}
                >
                  <Ionicons
                    name={n <= rating ? "star" : "star-outline"}
                    size={32}
                    color="#f59e0b"
                  />
                </TouchableOpacity>
              ))}
            </View>
            <Text style={styles.ratingHint}>
              {rating > 0
                ? "Cảm ơn bạn đã đánh giá!"
                : "Chuyến đi này thế nào?"}
            </Text>

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
  debugBtn: {
    position: "absolute",
    bottom: 96,
    alignSelf: "center",
    backgroundColor: "#7c3aed",
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 24,
  },
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
  starRow: { flexDirection: "row", gap: 6, marginTop: 4 },
  ratingHint: { fontSize: 12, color: "#6b7280" },
  resultBtnText: { color: "#fff", fontWeight: "600", fontSize: 14 },
});
