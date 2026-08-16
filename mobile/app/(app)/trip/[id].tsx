import { useEffect, useRef, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Modal,
  Animated,
  Image,
  ScrollView,
} from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import * as Location from "expo-location";
import MapView, { Marker, Region, AnimatedRegion } from "react-native-maps";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import {
  sendTelemetry,
  endTrip,
  rateTrip,
  getAqiHeatmap,
  simulateLaneDrift,
  getTripRoast,
} from "../../../src/api/driverTrips";
import { WebView } from "react-native-webview";
import { AQI_HEATMAP_HTML } from "../../../src/webview/aqiHeatmapHtml";
import LoadingOverlay from "../../../src/components/LoadingOverlay";
import VehicleIcon from "../../../src/components/VehicleIcon";
import { useTrip } from "../../../src/context/TripContext";
import type { RiskScore, TripSummary, VehicleType } from "../../../src/types";
import RiskRadarChart from "../../../src/components/RiskRadarChart";
import AiRoastBubble from "../../../src/components/AiRoastBubble";
import { buildRiskBreakdown } from "../../../src/utils/riskBreakdown";
import { Accelerometer } from "expo-sensors";
import { computeBearing, computeDistanceMeters } from "../../../src/utils/geo";
import {
  useDemoRouteSimulation,
  DemoStatus,
} from "../../../src/hooks/useDemoRouteSimulation";
import type { RoutePoint } from "../../../src/api/osrm";

const TELEMETRY_INTERVAL_MS = 8000;
// Vuot nguong nay (10%) so voi speedLimit tra ve tu backend moi tinh la
// "vuot toc do" - tranh bao dong lien tuc do sai so GPS/lam tron o muc
// vua sat nguong.
const OVERSPEED_TOLERANCE = 1.1;
// So lan gui telemetry LIEN TIEP vuot nguong moi thuc su bat canh bao
// (~2 lan x 8s = 16s) - tranh nhay canh bao do 1 lan doc GPS nhieu/loi
// thoang qua. Tat canh bao thi NGAY LAP TUC khi co 1 lan duoi nguong
// (khong can debounce chieu tat, uu tien an toan hon la muot mat).
const OVERSPEED_STREAK_THRESHOLD = 2;

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

// computeBearing / computeDistanceMeters da chuyen sang src/utils/geo.ts
// de dung lai duoc cho ca useDemoRouteSimulation (che do demo).

export default function TripScreen() {
  const {
    id: tripId,
    vehicleType: vehicleTypeParam,
    startedAt,
    demoMode: demoModeParam,
    destLat: destLatParam,
    destLng: destLngParam,
    resumeLat: resumeLatParam,
    resumeLng: resumeLngParam,
    startLat: startLatParam,
    startLng: startLngParam,
  } = useLocalSearchParams<{
    id: string;
    vehicleType?: string;
    startedAt?: string;
    demoMode?: string;
    destLat?: string;
    destLng?: string;
    resumeLat?: string;
    resumeLng?: string;
    startLat?: string;
    startLng?: string;
  }>();
  const vehicleType: VehicleType = (vehicleTypeParam as VehicleType) || "sedan";
  const { clearOngoingTrip, setLastKnownLocation } = useTrip();

  // Che do demo: man "chon diem den" (truoc man nay) da chon san diem
  // den + bat demoMode="1" - man nay khong dung GPS that nua, thay bang
  // route mo phong (useDemoRouteSimulation) chay hoan toan tren app.
  const demoMode = demoModeParam === "1";
  const destination: RoutePoint | null =
    demoMode && destLatParam && destLngParam
      ? {
          latitude: parseFloat(destLatParam),
          longitude: parseFloat(destLngParam),
        }
      : null;

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
    summary: TripSummary | null;
  } | null>(null);
  // Mac dinh thu gon (chi hien badge nhu truoc) - bam moi mo radar
  // breakdown, tranh Modal ket qua qua rop thong tin ngay tu dau.
  const [breakdownExpanded, setBreakdownExpanded] = useState(false);
  // Cau nhan xet AI - null = chua fetch (se fallback ve cau tinh trong
  // buildRiskBreakdown neu fetch cuoi cung that bai / khong goi duoc mang
  // toi backend). Tach rieng loading de biet luc nao dang cho vs da xong
  // ma khong co ket qua.
  const [aiComment, setAiComment] = useState<string | null>(null);
  const [aiCommentLoading, setAiCommentLoading] = useState(false);
  const [rating, setRating] = useState(0);
  const [ratingSubmitting, setRatingSubmitting] = useState(false);
  // Diem xuat phat cho route mo phong - lay 1 lan qua getCurrentPositionAsync
  // (khong can theo doi lien tuc nhu GPS that, vi vi tri xe se do route
  // simulator tu tinh tiep, khong phai do may that di chuyen).
  const [demoStart, setDemoStart] = useState<RoutePoint | null>(null);
  const [aqiModalVisible, setAqiModalVisible] = useState(false);
  const [aqiLoading, setAqiLoading] = useState(false);
  const [aqiData, setAqiData] = useState<{
    center: { lat: number; lng: number };
    points: [number, number, number][];
    currentAqi: number | null;
    noStationsNearby: boolean;
  } | null>(null);
  const [webViewLoaded, setWebViewLoaded] = useState(false);
  const aqiWebViewRef = useRef<WebView>(null);
  const aqiRenderedRef = useRef(false); // true sau khi renderData() đã chạy lần đầu trong WebView
  const lastAqiPosSentRef = useRef(0); // throttle timestamp
  const lastAqiFetchRef = useRef<{
    lat: number;
    lng: number;
    time: number;
  } | null>(null);
  const AQI_CACHE_STALE_MS = 30 * 60 * 1000; // khop CACHE_FRESH_MS ben backend - giu lau hon vo nghia
  const AQI_CELL_PRECISION = 1000; // lam tron toa do ve ~100m/o de gom trung diem giua cac lan fetch khac center

  function aqiCellKey(lat: number, lng: number) {
    return `${Math.round(lat * AQI_CELL_PRECISION)}_${Math.round(lng * AQI_CELL_PRECISION)}`;
  }

  // Tich luy AQI theo tung "o" toa do doc suot ca chuyen (khong bi xoa khi
  // dong/mo lai modal - chi mat khi roi han man hinh trip). Value luu ca
  // updatedAt de biet o nao da qua cu (>30p) can cho refetch de.
  const aqiTrailRef = useRef<
    Map<string, { lat: number; lng: number; aqi: number; updatedAt: number }>
  >(new Map());

  function mergeAqiTrailPoints(points: [number, number, number][]) {
    const trail = aqiTrailRef.current;
    const now = Date.now();
    const delta: [number, number, number][] = [];
    for (const [lat, lng, aqi] of points) {
      const key = aqiCellKey(lat, lng);
      const existing = trail.get(key);
      if (!existing || now - existing.updatedAt > AQI_CACHE_STALE_MS) {
        trail.set(key, { lat, lng, aqi, updatedAt: now });
        delta.push([lat, lng, aqi]);
      }
    }
    while (trail.size > 500) {
      const oldestKey = trail.keys().next().value;
      if (oldestKey === undefined) break;
      trail.delete(oldestKey);
    }
    return delta;
  }
  const headingRef = useRef(0);

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

  // SOS overspeed (trip manual): speedLimit tra ve tu moi lan sendTelemetry
  // (backend tra cuu OSM theo toa do hien tai). null = dang cho lan
  // telemetry dau tien hoac backend khong xac dinh duoc.
  const [overspeedLimit, setOverspeedLimit] = useState<number | null>(null);
  const overspeedStreakRef = useRef(0);
  const overspeedPulse = useRef(new Animated.Value(0.15)).current;
  // Dev-only: nhan gia toc hien thi/gui len de test canh bao vuot toc do
  // (che do demo chay deu 1 toc do co dinh, kho tu nhien vuot nguong).
  // Dung ref de doc duoc gia tri moi nhat trong closure applyPositionUpdate
  // (deps rong), state chi de cap nhat mau/chu nut.
  const speedTestMultiplierRef = useRef(1);
  const [speedTestActive, setSpeedTestActive] = useState(false);

  // Ham cap nhat vi tri DUNG CHUNG cho ca 2 nguon: GPS that (watchPositionAsync)
  // va route mo phong (useDemoRouteSimulation). Truoc day logic nay nam
  // thang trong callback cua watchPositionAsync - tach ra de tai dung.
  const applyPositionUpdate = useCallback(
    (
      latitude: number,
      longitude: number,
      rawSpeed: number | null,
      rawHeading: number | null,
      accuracy: number | null,
    ) => {
      // coords.speed co the null/am khi khong dang tin (thiet bi that GPS yeu,
      // hoac Simulator dung simctl set khong mo phong truong nay) - fallback
      // tu tinh bang khoang cach/delta-time giua 2 lan cap nhat lien tiep.
      let effectiveSpeed = rawSpeed;
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
        const dtSec = (Date.now() - prevFixTimeRef.current) / 1000;
        if (dtSec > 0) {
          effectiveSpeed = dist / dtSec;
        }
      }

      // Dev-only: nhan toc do de test canh bao overspeed (xem nut "Gia
      // lap vuot toc do"). Multiplier = 1 (mac dinh) khong doi gi ca.
      if (effectiveSpeed != null && speedTestMultiplierRef.current !== 1) {
        effectiveSpeed = effectiveSpeed * speedTestMultiplierRef.current;
      }

      lastCoordsRef.current = {
        latitude,
        longitude,
        speed: effectiveSpeed,
        heading: rawHeading,
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
        headingRef.current = bearing;
      } else if (rawHeading != null) {
        // Che do demo: route simulator da tinh san huong tu doan polyline
        // OSRM, dung truc tiep thay vi doi toc do vuot MIN_SPEED_FOR_HEADING.
        setHeading(rawHeading);
        headingRef.current = rawHeading;
      }
      prevPointRef.current = { latitude, longitude };
      prevFixTimeRef.current = Date.now();

      if (animatedCoordRef.current) {
        (animatedCoordRef.current.timing as any)({
          latitude,
          longitude,
          duration: 900,
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
    [],
  );

  // Route mo phong (chi hoat dong khi demoMode + da co diem xuat phat) -
  // tu goi OSRM, tu noi suy vi tri moi giay, giam toc o khuc cua, bao
  // ETA/khoang cach con lai. Khi khong phai demoMode, start/destination
  // deu null nen hook nay khong lam gi ca (an toan, khong anh huong GPS that).
  const {
    status: demoStatus,
    distanceRemainingKm,
    etaSeconds,
    triggerEvent,
  } = useDemoRouteSimulation(
    demoMode ? demoStart : null,
    demoMode ? destination : null,
    ({ latitude, longitude, speedMps, headingDeg }) => {
      applyPositionUpdate(latitude, longitude, speedMps, headingDeg, null);
    },
    () => {
      Alert.alert(
        "Đã tới nơi 🎉",
        'Chuyến đi demo đã hoàn tất, bấm "Kết thúc chuyến" để xem kết quả nhé.',
      );
    },
  );

  // Xin quyen vi tri. Che do that: bat watchPositionAsync theo doi lien
  // tuc. Che do demo: chi can xin quyen + lay vi tri 1 LAN de lam diem
  // xuat phat cho route simulator, KHONG bat watchPositionAsync.
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

      if (demoMode) {
        if (resumeLatParam && resumeLngParam) {
          // Resume sau khi app bi kill giua trip demo - dung vi tri XE
          // cuoi cung backend ghi nhan qua telemetry, KHONG goi GPS that
          // cua dien thoai luc nay (dien thoai co the dung yen/khac hoan
          // toan vi tri xe dang "di" tren route demo).
          setDemoStart({
            latitude: parseFloat(resumeLatParam),
            longitude: parseFloat(resumeLngParam),
          });
          return;
        }
        if (startLatParam && startLngParam) {
          // Chuyen MOI (dat xe -> chon diem den) - dung vi tri XE tai thoi
          // diem bat dau (da tiep noi dung dispatch tu destination.tsx),
          // KHONG goi GPS dien thoai nua - tranh animation route demo bi
          // "nhay" ve GPS tinh cua may test truoc khi chay toi diem den
          // that su duoc chon.
          setDemoStart({
            latitude: parseFloat(startLatParam),
            longitude: parseFloat(startLngParam),
          });
          return;
        }
        try {
          const loc = await Location.getCurrentPositionAsync({});
          setDemoStart({
            latitude: loc.coords.latitude,
            longitude: loc.coords.longitude,
          });
        } catch {
          Alert.alert(
            "Không lấy được vị trí xuất phát",
            "Thử lại hoặc quay lại chọn GPS thật",
          );
        }
        return;
      }

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
          applyPositionUpdate(latitude, longitude, spd, gpsHeading, accuracy);
        },
      );
    })();

    return () => {
      watchSubRef.current?.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demoMode]);

  // Đọc accelerometer điện thoại - giả định điện thoại gắn cố định trên
  // táp-lô (dashboard mount), tư thế đứng (portrait), màn hình hướng về
  // tài xế, giống cách thiết bị dashcam/định vị thường lắp thật. Trục y
  // (portrait) ~ hướng tiến/lùi của xe -> rapid_accel/brake_intensity.
  // Trục x ~ hướng ngang (trái/phải) -> sharp_turn. Đây là giả định hợp lý
  // cho scope đồ án, khác với thiết bị IoT bắt vít cố định vào khung xe.
  // Luu y (che do demo): dien thoai thuong dat yen 1 cho trong luc demo,
  // nen accelerometer se gan nhu bang 0 - rapid_accel/hard_brake se KHONG
  // duoc ghi nhan trong che do nay (han che da biet, ghi vao bao cao).
  useEffect(() => {
    Accelerometer.setUpdateInterval(100); // 10Hz

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

  // Gửi telemetry định kỳ lên backend - khong quan tam nguon (GPS that
  // hay route mo phong), luon doc tu lastCoordsRef (applyPositionUpdate
  // ghi vao do cho ca 2 nguon).
  // Fetch cau nhan xet AI CHI 1 LAN dau tien khi mo breakdown (khong fetch
  // lai moi lan dong/mo lai) - tranh spam API tra phi/free-tier vo ich.
  useEffect(() => {
    if (!breakdownExpanded || !result?.summary || !tripId) return;
    if (aiComment !== null || aiCommentLoading) return; // da fetch roi
    setAiCommentLoading(true);
    getTripRoast(tripId)
      .then((res) => setAiComment(res.comment))
      .catch((e) => {
        console.error("[roast] fetch failed, fallback ve cau tinh:", e.message);
        setAiComment(null); // giu null - JSX se tu fallback ve finalComment tinh
      })
      .finally(() => setAiCommentLoading(false));
  }, [breakdownExpanded, result?.summary, tripId]);

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
      })
        .then(({ speedLimit }) => {
          const speedKmh = coords.speed != null ? coords.speed * 3.6 : null;
          const isOver =
            speedLimit != null &&
            speedKmh != null &&
            speedKmh > speedLimit * OVERSPEED_TOLERANCE;

          if (isOver) {
            overspeedStreakRef.current += 1;
            if (overspeedStreakRef.current >= OVERSPEED_STREAK_THRESHOLD) {
              setOverspeedLimit(speedLimit);
            }
          } else {
            overspeedStreakRef.current = 0;
            setOverspeedLimit(null);
          }
        })
        .catch((err) => {
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

  // Nhap nhay overlay do trong luc dang vuot toc do - dung ca khi
  // overspeedLimit doi gia tri (vd 50 -> 40 luc xe di qua khu vuc khac
  // van dang vuot) vi effect nay chi phu thuoc "co dang bat hay khong".
  useEffect(() => {
    if (overspeedLimit == null) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(overspeedPulse, {
          toValue: 0.4,
          duration: 450,
          useNativeDriver: true,
        }),
        Animated.timing(overspeedPulse, {
          toValue: 0.1,
          duration: 450,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => {
      loop.stop();
      overspeedPulse.setValue(0.15);
    };
  }, [overspeedLimit != null]);

  useEffect(() => {
    if (webViewLoaded && aqiData && !aqiRenderedRef.current) {
      aqiWebViewRef.current?.postMessage(
        JSON.stringify({
          type: "initial",
          ...aqiData,
          vehicleType,
          heading: headingRef.current,
        }),
      );
      aqiRenderedRef.current = true;

      mergeAqiTrailPoints(aqiData.points);
      const restored = Array.from(aqiTrailRef.current.values()).map(
        (p) => [p.lat, p.lng, p.aqi] as [number, number, number],
      );
      if (restored.length > 0) {
        aqiWebViewRef.current?.postMessage(
          JSON.stringify({ type: "trail", points: restored }),
        );
      }
    }
  }, [webViewLoaded, aqiData, vehicleType]);

  // Cap nhat vi tri + huong xe tren map AQI theo thoi gian thuc, tan dung
  // lastCoordsRef/headingRef dang duoc GPS/route simulator cap nhat san
  // cho map chinh - khong goi lai backend AQI. Throttle ~2000ms giong
  // cadence GPS ping hien co.
  useEffect(() => {
    if (!aqiModalVisible || !aqiRenderedRef.current) return;
    const now = Date.now();
    if (now - lastAqiPosSentRef.current < 2000) return;
    const coords = lastCoordsRef.current;
    if (!coords) return;
    lastAqiPosSentRef.current = now;
    aqiWebViewRef.current?.postMessage(
      JSON.stringify({
        type: "position",
        lat: coords.latitude,
        lng: coords.longitude,
        heading: headingRef.current,
      }),
    );
  }, [region, aqiModalVisible]);

  // Refetch chunk NHO quanh vi tri moi khi xe di > 400m VA > 15s tu lan
  // fetch truoc - gui rieng type "trail" de WebView GOP THEM diem thay vi
  // thay the toan bo heatmap (tao hieu ung "ve doc theo duong di"). Chi
  // cap nhat currentAqi/noStationsNearby cho badge, KHONG dong bo lai
  // points/center vao aqiData chinh (tranh trigger lai effect gui "initial"
  // va tao lai marker o (a)).
  useEffect(() => {
    if (!aqiModalVisible || !aqiRenderedRef.current) return;
    const coords = lastCoordsRef.current;
    const last = lastAqiFetchRef.current;
    if (!coords || !last) return;

    const now = Date.now();
    const movedMeters = computeDistanceMeters(
      last.lat,
      last.lng,
      coords.latitude,
      coords.longitude,
    );
    if (movedMeters < 250 || now - last.time < 15000) return;

    lastAqiFetchRef.current = {
      lat: coords.latitude,
      lng: coords.longitude,
      time: now,
    };

    getAqiHeatmap(coords.latitude, coords.longitude, {
      gridRadiusKm: 0.4,
      step: 0.15,
    })
      .then((data) => {
        const delta = mergeAqiTrailPoints(data.points);
        if (delta.length > 0) {
          aqiWebViewRef.current?.postMessage(
            JSON.stringify({ type: "trail", points: delta }),
          );
        }
        setAqiData((prev) =>
          prev
            ? {
                ...prev,
                currentAqi: data.currentAqi,
                noStationsNearby: data.noStationsNearby,
              }
            : prev,
        );
      })
      .catch(() => {});
  }, [region, aqiModalVisible]);

  const formatElapsed = (sec: number) => {
    const m = Math.floor(sec / 60)
      .toString()
      .padStart(2, "0");
    const s = (sec % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  };

  const openAqiModal = async () => {
    setAqiModalVisible(true);
    setAqiLoading(true);
    try {
      const lat = lastCoordsRef.current?.latitude ?? region!.latitude;
      const lng = lastCoordsRef.current?.longitude ?? region!.longitude;
      const data = await getAqiHeatmap(lat, lng);
      setAqiData(data);
      lastAqiFetchRef.current = { lat, lng, time: Date.now() }; // + dong nay
    } catch (err) {
      Alert.alert("Lỗi", "Không lấy được dữ liệu chất lượng không khí");
      setAqiModalVisible(false);
    } finally {
      setAqiLoading(false);
    }
  };

  const closeAqiModal = () => {
    setAqiModalVisible(false);
    setAqiData(null);
    setWebViewLoaded(false);
    aqiRenderedRef.current = false;
    lastAqiFetchRef.current = null;
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
            if (lastCoordsRef.current) {
              setLastKnownLocation({
                latitude: lastCoordsRef.current.latitude,
                longitude: lastCoordsRef.current.longitude,
              });
            }
            setResult({ riskScore: res.riskScore, summary: res.summary });
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
    setBreakdownExpanded(false); // reset cho lần kết thúc chuyến tiếp theo
    setTimeout(() => {
      router.dismissTo("/(app)/vehicles"); // thay router.replace
    }, 300);
  };

  if (permissionGranted === null) {
    return <LoadingOverlay visible message="Đang xin quyền vị trí..." />;
  }

  if (demoMode && (demoStatus === "loading" || demoStatus === "idle")) {
    return (
      <LoadingOverlay visible message="Đang tính lộ trình demo qua OSRM..." />
    );
  }

  if (demoMode && demoStatus === "error") {
    return (
      <View style={styles.errorContainer}>
        <Ionicons name="warning-outline" size={40} color="#ef4444" />
        <Text style={styles.errorText}>
          Không lấy được lộ trình demo (OSRM lỗi hoặc mất mạng)
        </Text>
        <TouchableOpacity
          style={styles.resultBtn}
          onPress={() => router.back()}
        >
          <Text style={styles.resultBtnText}>Quay lại chọn điểm đến</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!region) {
    return (
      <LoadingOverlay
        visible
        message={
          demoMode ? "Đang lấy vị trí xuất phát..." : "Đang lấy vị trí GPS..."
        }
      />
    );
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
        {demoMode && distanceRemainingKm != null && (
          <View style={styles.statBox}>
            <Ionicons name="navigate-outline" size={18} color="#2563eb" />
            <Text style={styles.statValue}>
              {distanceRemainingKm.toFixed(1)} km
              {etaSeconds != null ? ` · ${Math.ceil(etaSeconds / 60)}p` : ""}
            </Text>
          </View>
        )}
        <TouchableOpacity style={styles.aqiButton} onPress={openAqiModal}>
          <Ionicons name="cloud-outline" size={18} color="#fff" />
          <Text style={styles.aqiButtonText}>Không khí</Text>
        </TouchableOpacity>
      </View>

      {overspeedLimit != null && (
        // Nen do mo nhap nhay phu toan man hinh - dieu khien bang
        // overspeedPulse (Animated.Value), khong lien quan animation
        // rieng cua GIF ben duoi (GIF tu no da co flicker).
        <Animated.View
          pointerEvents="none"
          style={[styles.overspeedBg, { opacity: overspeedPulse }]}
        />
      )}
      {overspeedLimit != null && (
        <View
          pointerEvents="none"
          style={[styles.overspeedBanner, { top: insets.top + 64 }]}
        >
          <Image
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            source={require("../../../assets/animations/ovspeed-alert.gif")}
            style={styles.overspeedGif}
            resizeMode="contain"
          />
          <Text style={styles.overspeedText}>
            Đoạn đường bạn đang đi giới hạn tốc độ {overspeedLimit}km/h, hãy chú
            ý nếu không muốn bị vặt lông 🤬‼️
          </Text>
        </View>
      )}

      {__DEV__ && (
        <View style={styles.debugEventRow}>
          <TouchableOpacity
            style={styles.debugChip}
            onPress={() => {
              // Nguong high hard_brake = 0.75 (ruleEngine.js) - dat 0.85
              // de chac chan vuot, du thap hon 1 xiu vi accel that thinh
              // thoang co the vuot 1.0 nhe do rung tay.
              accelPeakRef.current.forwardBrake = 0.85;
              triggerEvent("hard_brake");
            }}
          >
            <Text style={styles.debugChipText}>🤬 Phanh gấp</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.debugChip}
            onPress={() => {
              // Nguong high rapid_accel = 0.4 (accel_y, g) - dat 0.55
              accelPeakRef.current.forwardAccel = 0.55;
              triggerEvent("rapid_accel");
            }}
          >
            <Text style={styles.debugChipText}>😌 Tăng tốc</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.debugChip}
            onPress={() => {
              // Nguong high sharp_turn = 0.5 (|accel_x|, g) - dat 0.65
              accelPeakRef.current.lateral = 0.65;
              triggerEvent("sharp_turn");
            }}
          >
            <Text style={styles.debugChipText}>😁 Cua gắt</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.debugChip}
            onPress={async () => {
              // Hieu ung marker chay ngay (khong cho mang) - request nen
              // chi de GHI NHAN event vao DB, khong phai dieu kien de
              // marker lech ngang.
              triggerEvent("lane_drift");
              if (!tripId) return;
              try {
                await simulateLaneDrift(tripId);
              } catch (e) {
                console.error("[debug] simulate-lane-drift failed:", e);
              }
            }}
          >
            <Text style={styles.debugChipText}>🥸🐶 Lấn làn</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.debugChip}
            onPress={() => {
              // Khong can fake accel/speed rieng - triggerEvent tu lam
              // toc do noi suy tang that (x3), telemetry gui len tu
              // lastCoordsRef se tu mang dung gia tri cao do, rule-engine
              // tinh ratio = speed/speed_limit tu vuot nguong binh thuong,
              // khong can can thiep gi them o day.
              triggerEvent("overspeed");
            }}
          >
            <Text style={styles.debugChipText}>🥹 Vượt tốc</Text>
          </TouchableOpacity>
        </View>
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

      {aqiModalVisible && (
        <Modal visible animationType="slide" onRequestClose={closeAqiModal}>
          <View style={styles.aqiModalContainer}>
            <View
              style={[styles.aqiModalHeader, { paddingTop: insets.top + 8 }]}
            >
              <View style={styles.aqiModalTitleGroup}>
                <Text style={styles.aqiModalTitle}>
                  Chất lượng không khí quanh xe
                </Text>
                <Text style={styles.aqiModalSubtitle}>
                  {aqiData?.noStationsNearby
                    ? "Không có trạm quan trắc gần khu vực này"
                    : aqiData?.currentAqi != null
                      ? `AQI hiện tại: ${Math.round(aqiData.currentAqi)}`
                      : ""}
                </Text>
              </View>
              <TouchableOpacity
                onPress={closeAqiModal}
                hitSlop={12}
                style={styles.aqiCloseBtn}
              >
                <Ionicons name="close" size={24} color="#111827" />
              </TouchableOpacity>
            </View>
            <WebView
              ref={aqiWebViewRef}
              originWhitelist={["*"]}
              source={{ html: AQI_HEATMAP_HTML }}
              onLoadEnd={() => setWebViewLoaded(true)}
            />
            {aqiLoading && (
              <LoadingOverlay
                visible
                message="Đang tải dữ liệu chất lượng không khí..."
              />
            )}
          </View>
        </Modal>
      )}

      <Modal visible={!!result} transparent animationType="fade">
        <View style={styles.resultBackdrop}>
          <View style={styles.resultCard}>
            <View style={styles.resultHeaderRow}>
              <VehicleIcon type={vehicleType} height={44} />
              <Ionicons name="checkmark-circle" size={26} color="#22c55e" />
            </View>
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
                    ? // Dao nguoc risk_score (0=an toan, 1=nguy hiem - dung
                      // cho model/backend) thanh "diem tai xe /10" (cao =
                      // tot) - de hieu voi driver, khong doi gi ben model.
                      ` · ${Math.round(
                        (1 - result.riskScore.final.risk_score) * 10,
                      )}/10 điểm`
                    : ""}
                </Text>
              </View>
            ) : (
              <Text style={styles.resultSub}>Đang chờ tính điểm rủi ro...</Text>
            )}

            {result?.summary && (
              <TouchableOpacity
                style={styles.breakdownToggle}
                onPress={() => setBreakdownExpanded((v) => !v)}
              >
                <Text style={styles.breakdownToggleText}>
                  {breakdownExpanded ? "Ẩn chi tiết ▲" : "Xem điểm chi tiết ▼"}
                </Text>
              </TouchableOpacity>
            )}

            {breakdownExpanded &&
              result?.summary &&
              (() => {
                const { axes, finalComment } = buildRiskBreakdown(
                  result.summary!,
                  riskLevel,
                );
                return (
                  <ScrollView
                    style={styles.breakdownScroll}
                    showsVerticalScrollIndicator={false}
                  >
                    <RiskRadarChart
                      axes={axes}
                      color={RISK_COLOR[riskLevel ?? "safe"]}
                    />
                    <AiRoastBubble
                      comment={
                        aiComment ?? (aiCommentLoading ? null : finalComment)
                      }
                      loading={aiCommentLoading}
                      color={RISK_COLOR[riskLevel ?? "safe"]}
                    />
                    {axes.map((a) => (
                      <View key={a.key} style={styles.breakdownRow}>
                        <View style={styles.breakdownRowHeader}>
                          <Text style={styles.breakdownRowLabel}>
                            {a.emoji} {a.label}
                          </Text>
                          <Text style={styles.breakdownRowValue}>
                            {a.rawValue} {a.unit}
                          </Text>
                        </View>
                        <Text style={styles.breakdownRowComment}>
                          {a.comment}
                        </Text>
                      </View>
                    ))}
                    {result.summary.gps_invalid_count > 0 && (
                      <Text style={styles.breakdownGpsNote}>
                        📡 Mất tín hiệu GPS {result.summary.gps_invalid_count}{" "}
                        lần trong chuyến — lỗi thiết bị/mạng, không tính vào
                        điểm rủi ro.
                      </Text>
                    )}
                  </ScrollView>
                );
              })()}

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
    flexWrap: "wrap",
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
  errorContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    gap: 12,
    backgroundColor: "#f9fafb",
  },
  errorText: { fontSize: 14, color: "#374151", textAlign: "center" },
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
  debugEventRow: {
    position: "absolute",
    bottom: 96,
    left: 16,
    right: 16,
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 8,
  },
  debugChip: {
    backgroundColor: "#7c3aed",
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
  },
  debugChipText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  overspeedBg: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "#ef4444",
  },
  overspeedBanner: {
    position: "absolute",
    left: 16,
    right: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#00000099",
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 14,
  },
  overspeedText: {
    flex: 1,
    color: "#fff",
    fontWeight: "700",
    fontSize: 13,
  },
  overspeedGif: {
    width: 32,
    height: 32,
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
    paddingTop: 20,
    paddingBottom: 24,
    paddingHorizontal: 24,
    alignItems: "center",
    gap: 8,
    width: "80%",
  },
  resultHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
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
  breakdownToggle: {
    marginTop: 4,
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 20,
    backgroundColor: "#f3f4f6",
  },
  breakdownToggleText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#374151",
  },
  breakdownScroll: {
    maxHeight: 480,
    width: "100%",
  },
  breakdownFinalComment: {
    fontSize: 12,
    color: "#374151",
    textAlign: "center",
    fontStyle: "italic",
    marginTop: 4,
    marginBottom: 8,
    paddingHorizontal: 8,
  },
  breakdownRow: {
    width: "100%",
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: "#f3f4f6",
  },
  breakdownRowHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  breakdownRowLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: "#111827",
  },
  breakdownRowValue: {
    fontSize: 12,
    color: "#6b7280",
  },
  breakdownRowComment: {
    fontSize: 12,
    color: "#4b5563",
    marginTop: 2,
  },
  breakdownGpsNote: {
    fontSize: 11,
    color: "#9ca3af",
    marginTop: 8,
    fontStyle: "italic",
  },
  starRow: { flexDirection: "row", gap: 6, marginTop: 4 },
  ratingHint: { fontSize: 12, color: "#6b7280" },
  resultBtnText: { color: "#fff", fontWeight: "600", fontSize: 14 },
  aqiModalContainer: { flex: 1, backgroundColor: "#fff" },
  aqiModalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb",
  },
  aqiModalTitleGroup: { flex: 1, marginRight: 12 },
  aqiModalTitle: { fontSize: 16, fontWeight: "700", color: "#111827" },
  aqiModalSubtitle: { fontSize: 12, color: "#6b7280", marginTop: 2 },
  aqiButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#0891b2",
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 10,
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  aqiButtonText: { fontSize: 14, fontWeight: "600", color: "#fff" },
  aqiCloseBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#f3f4f6",
    alignItems: "center",
    justifyContent: "center",
  },
});
