import { useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  PanResponder,
} from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import MapView, { Marker, Polyline, PROVIDER_DEFAULT } from "react-native-maps";
import { Ionicons } from "@expo/vector-icons";
import {
  getTripTelemetry,
  getTripRiskEvents,
  type TelemetryPoint,
  type RiskEventPoint,
} from "../../../src/api/driverTrips";
import LoadingOverlay from "../../../src/components/LoadingOverlay";
import {
  RISK_EVENT_STYLE,
  DEFAULT_EVENT_STYLE,
} from "../../../src/constants/riskEvents";

const PLAYBACK_SPEEDS = [1, 2, 4, 8];
// Toàn bộ chuyến (bất kể dài ngắn thật) được "nén" phát trong khoảng này
// ở tốc độ 1x - không dùng tốc độ thật vì chuyến dài sẽ replay quá lâu.
const TARGET_DURATION_MS = 40_000;
const TICK_MS = 80;

function clamp01(x: number) {
  return Math.max(0, Math.min(1, x));
}

function formatMMSS(totalSeconds: number) {
  const m = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0");
  const s = Math.floor(totalSeconds % 60)
    .toString()
    .padStart(2, "0");
  return `${m}:${s}`;
}

export default function ReplayScreen() {
  const { id: tripId } = useLocalSearchParams<{ id: string }>();
  const [telemetry, setTelemetry] = useState<TelemetryPoint[]>([]);
  const [events, setEvents] = useState<RiskEventPoint[]>([]);
  const [loading, setLoading] = useState(true);

  // progress: 0..1 theo TIMELINE THẬT của chuyến (không phải index điểm
  // telemetry) - đoạn dừng đèn đỏ lâu sẽ "đứng" lâu hơn khi replay, đúng
  // với thực tế thay vì mọi bước nhảy đều tốc.
  const [progress, setProgress] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speedMultiplier, setSpeedMultiplier] = useState(1);
  const mapRef = useRef<MapView>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const trackWidthRef = useRef(1);

  useEffect(() => {
    if (!tripId) return;
    Promise.all([getTripTelemetry(tripId), getTripRiskEvents(tripId)])
      .then(([tel, ev]) => {
        setTelemetry(tel.points);
        setEvents(ev.events);
        if (tel.points.length > 0) {
          setTimeout(() => {
            mapRef.current?.fitToCoordinates(
              tel.points.map((p) => ({ latitude: p.lat, longitude: p.lng })),
              {
                edgePadding: { top: 60, right: 60, bottom: 60, left: 60 },
                animated: false,
              },
            );
          }, 300);
        }
      })
      .catch((err) => {
        Alert.alert(
          "Lỗi",
          err.response?.data?.error || "Không tải được dữ liệu chuyến đi",
        );
        router.back();
      })
      .finally(() => setLoading(false));
  }, [tripId]);

  const timestamps = useMemo(
    () => telemetry.map((p) => new Date(p.ts).getTime()),
    [telemetry],
  );
  const t0 = timestamps[0] ?? 0;
  const totalRealMs =
    timestamps.length > 1 ? timestamps[timestamps.length - 1] - t0 : 0;

  useEffect(() => {
    if (!playing || totalRealMs === 0) return;
    tickRef.current = setInterval(() => {
      setProgress((p) => {
        const next = p + (TICK_MS * speedMultiplier) / TARGET_DURATION_MS;
        if (next >= 1) {
          setPlaying(false);
          return 1;
        }
        return next;
      });
    }, TICK_MS);
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, [playing, speedMultiplier, totalRealMs]);

  // Binary search theo timestamp thật -> nội suy tuyến tính vị trí giữa 2
  // điểm kề sát để marker trượt mượt. Known limitation: heading nội suy
  // thô, không xử lý wrap-around 0°/360° - chấp nhận được ở scope demo.
  function interpolateAt(ratio: number) {
    if (timestamps.length === 0) return null;
    if (timestamps.length === 1) return telemetry[0];
    const targetTime = t0 + ratio * totalRealMs;
    let lo = 0,
      hi = timestamps.length - 1;
    while (lo < hi - 1) {
      const mid = Math.floor((lo + hi) / 2);
      if (timestamps[mid] <= targetTime) lo = mid;
      else hi = mid;
    }
    const pLow = telemetry[lo];
    const pHigh = telemetry[hi];
    const span = timestamps[hi] - timestamps[lo];
    const fraction = span > 0 ? (targetTime - timestamps[lo]) / span : 0;
    return {
      ...pLow,
      lat: pLow.lat + (pHigh.lat - pLow.lat) * fraction,
      lng: pLow.lng + (pHigh.lng - pLow.lng) * fraction,
      speed:
        pLow.speed != null && pHigh.speed != null
          ? pLow.speed + (pHigh.speed - pLow.speed) * fraction
          : pLow.speed,
      heading:
        pLow.heading != null && pHigh.heading != null
          ? pLow.heading + (pHigh.heading - pLow.heading) * fraction
          : pLow.heading,
    };
  }

  const current = useMemo(() => interpolateAt(progress), [progress, telemetry]);
  const polylineCoords = useMemo(
    () => telemetry.map((p) => ({ latitude: p.lat, longitude: p.lng })),
    [telemetry],
  );

  function seekToRatio(ratio: number) {
    setPlaying(false);
    setProgress(clamp01(ratio));
  }

  function seekToEvent(ev: RiskEventPoint) {
    if (totalRealMs === 0) return;
    const evTime = new Date(ev.occurred_at).getTime();
    seekToRatio((evTime - t0) / totalRealMs);
  }

  // Keo tren thanh progress - dung PanResponder (React Native core, khong
  // can them package slider ngoai). locationX luon tinh tuong doi voi
  // chinh View da capture responder nen van dung du keo ra ngoai track 1
  // chut.
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        seekToRatio(evt.nativeEvent.locationX / trackWidthRef.current);
      },
      onPanResponderMove: (evt) => {
        seekToRatio(evt.nativeEvent.locationX / trackWidthRef.current);
      },
    }),
  ).current;

  if (loading)
    return <LoadingOverlay visible message="Đang tải lại chuyến đi..." />;

  if (telemetry.length === 0 || !current) {
    return (
      <View style={styles.emptyContainer}>
        <Ionicons name="map-outline" size={40} color="#9ca3af" />
        <Text style={styles.emptyText}>
          Chuyến này chưa có dữ liệu để xem lại
        </Text>
      </View>
    );
  }

  const elapsedRealSec = (progress * totalRealMs) / 1000;
  const totalRealSec = totalRealMs / 1000;

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        provider={PROVIDER_DEFAULT}
        style={styles.map}
        initialRegion={{
          latitude: telemetry[0].lat,
          longitude: telemetry[0].lng,
          latitudeDelta: 0.02,
          longitudeDelta: 0.02,
        }}
      >
        <Polyline
          coordinates={polylineCoords}
          strokeColor="#2563eb"
          strokeWidth={4}
        />
        {events.map((ev) => {
          const style = RISK_EVENT_STYLE[ev.event_type] || DEFAULT_EVENT_STYLE;
          return (
            <Marker
              key={ev.event_id}
              coordinate={{ latitude: ev.lat, longitude: ev.lng }}
              anchor={{ x: 0.5, y: 0.5 }}
              onPress={() => seekToEvent(ev)}
            >
              <View
                style={[styles.eventDot, { backgroundColor: style.color }]}
              />
            </Marker>
          );
        })}
        <Marker
          coordinate={{ latitude: current.lat, longitude: current.lng }}
          anchor={{ x: 0.5, y: 0.5 }}
          rotation={current.heading ?? 0}
          flat
        >
          <View style={styles.carMarker}>
            <Ionicons name="navigate" size={16} color="#fff" />
          </View>
        </Marker>
      </MapView>

      <View style={styles.legend}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {Object.entries(RISK_EVENT_STYLE).map(([type, style]) => (
            <View key={type} style={styles.legendItem}>
              <View
                style={[styles.legendDot, { backgroundColor: style.color }]}
              />
              <Text style={styles.legendText}>{style.label}</Text>
            </View>
          ))}
        </ScrollView>
      </View>

      <View style={styles.controls}>
        <View style={styles.statsRow}>
          <Text style={styles.statText}>
            {formatMMSS(elapsedRealSec)} / {formatMMSS(totalRealSec)}
          </Text>
          <Text style={styles.statText}>
            {current.speed != null
              ? `${Math.round(current.speed * 3.6)} km/h`
              : "-- km/h"}
          </Text>
        </View>

        <View
          style={styles.progressTrack}
          onLayout={(e) => {
            trackWidthRef.current = e.nativeEvent.layout.width || 1;
          }}
          {...panResponder.panHandlers}
        >
          <View style={styles.progressBg} />
          <View
            style={[styles.progressFill, { width: `${progress * 100}%` }]}
          />
          <View
            style={[styles.progressThumb, { left: `${progress * 100}%` }]}
          />
        </View>

        <View style={styles.playRow}>
          <TouchableOpacity
            onPress={() => setPlaying((p) => !p)}
            style={styles.playBtn}
          >
            <Ionicons
              name={playing ? "pause" : "play"}
              size={22}
              color="#fff"
            />
          </TouchableOpacity>

          <View style={styles.speedGroup}>
            {PLAYBACK_SPEEDS.map((s) => (
              <TouchableOpacity
                key={s}
                onPress={() => setSpeedMultiplier(s)}
                style={[
                  styles.speedChip,
                  speedMultiplier === s && styles.speedChipActive,
                ]}
              >
                <Text
                  style={[
                    styles.speedChipText,
                    speedMultiplier === s && styles.speedChipTextActive,
                  ]}
                >
                  {s}x
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1 },
  emptyContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  emptyText: { color: "#9ca3af", fontSize: 14 },
  carMarker: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: "#2563eb",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#fff",
  },
  eventDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: "#fff",
  },
  legend: { position: "absolute", top: 12, left: 12, right: 12 },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#ffffffee",
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 12,
    marginRight: 6,
  },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: 11, color: "#374151", fontWeight: "600" },
  controls: {
    backgroundColor: "#fff",
    padding: 16,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 4,
  },
  statsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 14,
  },
  statText: { fontSize: 13, fontWeight: "600", color: "#111827" },
  progressTrack: {
    height: 24,
    justifyContent: "center",
    marginBottom: 14,
  },
  progressBg: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 9,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#e5e7eb",
  },
  progressFill: {
    position: "absolute",
    left: 0,
    top: 9,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#2563eb",
  },
  progressThumb: {
    position: "absolute",
    top: 4,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: "#2563eb",
    borderWidth: 2,
    borderColor: "#fff",
    marginLeft: -8,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 3,
    elevation: 2,
  },
  playRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  playBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#2563eb",
    alignItems: "center",
    justifyContent: "center",
  },
  speedGroup: { flexDirection: "row", gap: 4, marginLeft: "auto" },
  speedChip: {
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 10,
    backgroundColor: "#f3f4f6",
  },
  speedChipActive: { backgroundColor: "#2563eb" },
  speedChipText: { fontSize: 11, fontWeight: "700", color: "#6b7280" },
  speedChipTextActive: { color: "#fff" },
});
