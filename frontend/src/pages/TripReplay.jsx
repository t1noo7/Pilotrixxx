import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, Link } from "react-router-dom";
import {
  MapContainer,
  TileLayer,
  Polyline,
  CircleMarker,
  Marker,
  Tooltip,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { apiClient } from "../api/client.js";
import {
  RISK_EVENT_STYLE,
  DEFAULT_EVENT_STYLE,
} from "../constants/riskEvents.js";

const RISK_LABEL = {
  safe: "An toàn",
  medium: "Trung bình",
  dangerous: "Nguy hiểm",
};
const RISK_COLOR = { safe: "#34d399", medium: "#fbbf24", dangerous: "#f87171" };

const PLAYBACK_SPEEDS = [1, 2, 4, 8];
// Toàn bộ chuyến (bất kể dài ngắn thật - 5 phút hay 2 tiếng) được "nén"
// phát trong khoảng này ở tốc độ 1x. Không dùng tốc độ thật (vd 1 giây
// thật = 1 giây replay) vì chuyến dài sẽ replay lâu vô lý cho demo.
const TARGET_DURATION_MS = 40_000;
const TICK_MS = 80;

function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}

function formatMMSS(totalSeconds) {
  const m = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0");
  const s = Math.floor(totalSeconds % 60)
    .toString()
    .padStart(2, "0");
  return `${m}:${s}`;
}

function FitBounds({ positions }) {
  const map = useMap();
  useEffect(() => {
    if (positions.length === 0) return;
    map.fitBounds(positions, { padding: [40, 40] });
  }, [positions, map]);
  return null;
}

function carIcon(heading) {
  return L.divIcon({
    className: "",
    html: `<div style="
      width: 22px; height: 22px; border-radius: 50%;
      background: #3dd6c4; border: 2px solid #0b1220;
      display: flex; align-items: center; justify-content: center;
      transform: rotate(${heading || 0}deg);
      box-shadow: 0 0 8px rgba(61,214,196,0.7);
    ">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="#0b1220">
        <path d="M12 2 L19 20 L12 16 L5 20 Z" />
      </svg>
    </div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
}

export default function TripReplay() {
  const { id } = useParams();
  const [trip, setTrip] = useState(null);
  const [telemetry, setTelemetry] = useState([]);
  const [riskEvents, setRiskEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // progress: 0..1 theo TIMELINE THẬT của chuyến (không phải theo index
  // điểm telemetry) - để tốc độ marker di chuyển phản ánh đúng khoảng
  // cách thời gian thật giữa các lần gửi telemetry (đoạn dừng đèn đỏ lâu
  // hơn sẽ "đứng" lâu hơn khi replay, thay vì mọi bước nhảy đều tốc).
  const [progress, setProgress] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speedMultiplier, setSpeedMultiplier] = useState(1);
  const tickRef = useRef(null);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      apiClient.get(`/api/trips/${id}`),
      apiClient.get(`/api/trips/${id}/telemetry`, { params: { limit: 1000 } }),
      apiClient.get(`/api/trips/${id}/risk-events`),
    ])
      .then(([tripRes, telRes, evRes]) => {
        setTrip(tripRes.data);
        setTelemetry(telRes.data.points);
        setRiskEvents(evRes.data.events);
      })
      .catch((err) =>
        setError(
          err.response?.data?.error || "Không tải được dữ liệu chuyến đi",
        ),
      )
      .finally(() => setLoading(false));
  }, [id]);

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
    return () => clearInterval(tickRef.current);
  }, [playing, speedMultiplier, totalRealMs]);

  // Binary search theo timestamp thật -> tìm 2 điểm kề sát, nội suy tuyến
  // tính vị trí giữa chúng để marker trượt mượt (không nhảy cóc theo từng
  // điểm GPS rời rạc). Nhược điểm nhỏ đã biết: heading nội suy tuyến tính
  // thô (không xử lý wrap-around 0°/360°) - hiếm khi gây lệch rõ rệt ở
  // scope demo này nên chưa cần xử lý phức tạp hơn.
  function interpolateAt(ratio) {
    if (timestamps.length === 0) return null;
    if (timestamps.length === 1) return { ...telemetry[0], lowerIndex: 0 };
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
      lat: pLow.lat + (pHigh.lat - pLow.lat) * fraction,
      lng: pLow.lng + (pHigh.lng - pLow.lng) * fraction,
      speed:
        pLow.speed != null && pHigh.speed != null
          ? pLow.speed + (pHigh.speed - pLow.speed) * fraction
          : pLow.speed,
      speed_limit: pLow.speed_limit,
      heading:
        pLow.heading != null && pHigh.heading != null
          ? pLow.heading + (pHigh.heading - pLow.heading) * fraction
          : pLow.heading,
      lowerIndex: lo,
    };
  }

  const current = useMemo(() => interpolateAt(progress), [progress, telemetry]);
  const positions = useMemo(
    () => telemetry.map((p) => [p.lat, p.lng]),
    [telemetry],
  );

  function seekToRatio(ratio) {
    setPlaying(false);
    setProgress(clamp01(ratio));
  }

  function seekToEvent(ev) {
    if (totalRealMs === 0) return;
    const evTime = new Date(ev.occurred_at).getTime();
    seekToRatio((evTime - t0) / totalRealMs);
  }

  if (loading)
    return <p style={{ color: "var(--text-secondary)" }}>Đang tải...</p>;
  if (error) {
    return (
      <div
        className="card"
        style={{
          borderColor: "var(--risk-dangerous)",
          color: "var(--risk-dangerous)",
        }}
      >
        {error}
      </div>
    );
  }
  if (telemetry.length === 0) {
    return (
      <div
        className="card"
        style={{ textAlign: "center", color: "var(--text-secondary)" }}
      >
        Chuyến #{id} chưa có dữ liệu telemetry để replay.
      </div>
    );
  }

  const elapsedRealSec = (progress * totalRealMs) / 1000;
  const totalRealSec = totalRealMs / 1000;

  return (
    <div>
      <header style={{ marginBottom: 20 }}>
        <Link
          to="/alerts"
          style={{
            color: "var(--text-secondary)",
            fontSize: 13,
            textDecoration: "none",
          }}
        >
          ‹ Quay lại Cảnh báo
        </Link>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
            marginTop: 8,
          }}
        >
          <div>
            <h1 style={{ margin: 0, fontSize: 20 }}>
              Trip Replay — #{trip.trip_id}
            </h1>
            <p
              style={{
                color: "var(--text-secondary)",
                fontSize: 13,
                marginTop: 4,
              }}
            >
              {trip.license_plate} — {trip.driver_name}
            </p>
          </div>
          {trip.final_risk_level && (
            <span
              style={{
                background: RISK_COLOR[trip.final_risk_level],
                color: "#0b1220",
                padding: "6px 14px",
                borderRadius: 20,
                fontWeight: 700,
                fontSize: 13,
              }}
            >
              {RISK_LABEL[trip.final_risk_level]} ·{" "}
              {(trip.final_risk_score * 100).toFixed(0)}đ
            </span>
          )}
        </div>
      </header>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "12px 20px",
          fontSize: 12,
          color: "var(--text-secondary)",
          marginBottom: 16,
        }}
      >
        <span style={{ fontWeight: 600 }}>
          Sự kiện nguy hiểm (bấm để tua tới):
        </span>
        {Object.entries(RISK_EVENT_STYLE).map(([type, style]) => (
          <span
            key={type}
            style={{ display: "flex", alignItems: "center", gap: 6 }}
          >
            <span
              style={{
                width: 9,
                height: 9,
                borderRadius: "50%",
                background: style.color,
                border: "1px solid rgba(0,0,0,0.25)",
              }}
            />
            {style.label}
          </span>
        ))}
      </div>

      <div
        style={{
          minHeight: 440,
          borderRadius: "var(--radius)",
          overflow: "hidden",
          border: "1px solid var(--border-subtle)",
          marginBottom: 16,
        }}
      >
        <MapContainer
          center={positions[0]}
          zoom={14}
          style={{ width: "100%", height: 440 }}
        >
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution="&copy; OpenStreetMap contributors"
          />
          <FitBounds positions={positions} />
          <Polyline
            positions={positions}
            pathOptions={{ color: "#3dd6c4", weight: 3, opacity: 0.6 }}
          />
          {riskEvents.map((ev) => {
            const style =
              RISK_EVENT_STYLE[ev.event_type] || DEFAULT_EVENT_STYLE;
            return (
              <CircleMarker
                key={ev.event_id}
                center={[ev.lat, ev.lng]}
                radius={6}
                pathOptions={{
                  color: style.color,
                  fillColor: style.color,
                  fillOpacity: 0.8,
                  weight: 1,
                }}
                eventHandlers={{ click: () => seekToEvent(ev) }}
              >
                <Tooltip direction="top">
                  {style.label} —{" "}
                  {new Date(ev.occurred_at).toLocaleTimeString("vi-VN")}
                </Tooltip>
              </CircleMarker>
            );
          })}
          {current && (
            <Marker
              position={[current.lat, current.lng]}
              icon={carIcon(current.heading)}
            />
          )}
        </MapContainer>
      </div>

      <div
        className="card"
        style={{ display: "flex", flexDirection: "column", gap: 12 }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button
            onClick={() => setPlaying((p) => !p)}
            style={{
              width: 36,
              height: 36,
              borderRadius: "50%",
              border: "1px solid var(--border-strong)",
              background: "var(--bg-surface-raised)",
              color: "var(--text-primary)",
              cursor: "pointer",
              fontSize: 14,
            }}
          >
            {playing ? "❚❚" : "▶"}
          </button>

          <input
            type="range"
            min={0}
            max={1}
            step={0.0005}
            value={progress}
            onChange={(e) => seekToRatio(Number(e.target.value))}
            style={{ flex: 1 }}
          />

          <div style={{ display: "flex", gap: 4 }}>
            {PLAYBACK_SPEEDS.map((s) => (
              <button
                key={s}
                onClick={() => setSpeedMultiplier(s)}
                style={{
                  padding: "4px 10px",
                  fontSize: 12,
                  borderRadius: "var(--radius-sm)",
                  border: "1px solid var(--border-subtle)",
                  cursor: "pointer",
                  background:
                    speedMultiplier === s
                      ? "var(--bg-surface-raised)"
                      : "transparent",
                  color:
                    speedMultiplier === s
                      ? "var(--text-primary)"
                      : "var(--text-secondary)",
                }}
              >
                {s}x
              </button>
            ))}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            gap: 20,
            fontSize: 13,
            color: "var(--text-secondary)",
            fontFamily: "var(--font-mono)",
          }}
        >
          <span>
            {formatMMSS(elapsedRealSec)} / {formatMMSS(totalRealSec)}
          </span>
          <span>
            {current.speed != null
              ? `${Math.round(current.speed * 3.6)} km/h`
              : "-- km/h"}
          </span>
          {current.speed_limit != null && (
            <span>Giới hạn: {Math.round(current.speed_limit)} km/h</span>
          )}
        </div>
      </div>
    </div>
  );
}
