import { useEffect, useState } from "react";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { apiClient } from "../api/client.js";

const AXIS = "#94a3b8";
const GRID = "rgba(148,163,184,0.15)";
const RED = "#f87171";
const AMBER = "#fbbf24";

const tooltipStyle = {
  background: "#1e293b",
  border: "1px solid #334155",
  borderRadius: 6,
  fontSize: 12,
};

export default function AqiExposure() {
  const [weeks, setWeeks] = useState(8);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setError("");
    apiClient
      .get("/api/aqi-exposure/summary", { params: { weeks } })
      .then((res) => setData(res.data))
      .catch((err) =>
        setError(
          err.response?.data?.error || "Không tải được dữ liệu phơi nhiễm",
        ),
      )
      .finally(() => setLoading(false));
  }, [weeks]);

  const empty = data && data.drivers.length === 0;

  return (
    <div>
      <header
        style={{
          marginBottom: 20,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 16,
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: 20 }}>Phơi nhiễm ô nhiễm</h1>
          <p
            style={{
              color: "var(--text-secondary)",
              fontSize: 13,
              marginTop: 4,
            }}
          >
            Số lần đi qua vùng NO₂ cao (top 25% trong ngày, ảnh vệ tinh
            Sentinel-5P) — mỗi đoạn liên tục tính 1 lần
          </p>
        </div>
        <select
          value={weeks}
          onChange={(e) => setWeeks(Number(e.target.value))}
          style={{
            background: "var(--bg-surface)",
            color: "var(--text-primary)",
            border: "1px solid var(--border-strong)",
            borderRadius: "var(--radius-sm)",
            padding: "6px 10px",
            fontSize: 13,
          }}
        >
          <option value={4}>4 tuần gần nhất</option>
          <option value={8}>8 tuần gần nhất</option>
          <option value={12}>12 tuần gần nhất</option>
        </select>
      </header>

      {error && (
        <div
          className="card"
          style={{
            borderColor: "var(--risk-dangerous)",
            color: "var(--risk-dangerous)",
            marginBottom: 16,
          }}
        >
          {error}
        </div>
      )}

      {loading && <p style={{ color: "var(--text-secondary)" }}>Đang tải…</p>}

      {!loading && empty && !error && (
        <div
          className="card"
          style={{ color: "var(--text-secondary)", textAlign: "center" }}
        >
          Chưa có chuyến nào có dữ liệu phơi nhiễm trong {weeks} tuần gần nhất.
        </div>
      )}

      {!loading && data && !empty && (
        <>
          <div className="card" style={{ marginBottom: 16 }}>
            <h2 style={{ margin: "0 0 4px", fontSize: 15 }}>Xếp hạng tài xế</h2>
            <p
              style={{
                color: "var(--text-muted)",
                fontSize: 12,
                margin: "0 0 12px",
              }}
            >
              Số episode phơi nhiễm cao trung bình mỗi tuần
            </p>
            <ResponsiveContainer
              width="100%"
              height={Math.max(220, data.drivers.length * 34 + 40)}
            >
              <BarChart
                data={data.drivers}
                layout="vertical"
                margin={{ left: 16, right: 24 }}
              >
                <CartesianGrid stroke={GRID} horizontal={false} />
                <XAxis
                  type="number"
                  stroke={AXIS}
                  fontSize={12}
                  allowDecimals
                />
                <YAxis
                  type="category"
                  dataKey="fullName"
                  stroke={AXIS}
                  fontSize={12}
                  width={130}
                />
                <Tooltip
                  contentStyle={tooltipStyle}
                  formatter={(v, name) => [v, name]}
                  labelFormatter={(label, payload) => {
                    const d = payload?.[0]?.payload;
                    return d
                      ? `${label} · ${d.trips} chuyến · ${d.highMinutes} phút vùng cao`
                      : label;
                  }}
                />
                <Bar
                  dataKey="episodesPerWeek"
                  name="Episode/tuần"
                  fill={RED}
                  radius={[0, 4, 4, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="card">
            <h2 style={{ margin: "0 0 4px", fontSize: 15 }}>
              Xu hướng theo tuần (toàn fleet)
            </h2>
            <p
              style={{
                color: "var(--text-muted)",
                fontSize: 12,
                margin: "0 0 12px",
              }}
            >
              Số episode phơi nhiễm cao trung bình mỗi chuyến, mốc là ngày đầu
              tuần
            </p>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={data.trend} margin={{ left: 0, right: 24 }}>
                <CartesianGrid stroke={GRID} />
                <XAxis
                  dataKey="weekStart"
                  stroke={AXIS}
                  fontSize={12}
                  tickFormatter={(v) => String(v).slice(5, 10)}
                />
                <YAxis stroke={AXIS} fontSize={12} allowDecimals />
                <Tooltip
                  contentStyle={tooltipStyle}
                  labelFormatter={(v) =>
                    `Tuần bắt đầu ${String(v).slice(0, 10)}`
                  }
                />
                <Line
                  type="monotone"
                  dataKey="episodesPerTrip"
                  name="Episode/chuyến"
                  stroke={AMBER}
                  strokeWidth={2}
                  dot={{ r: 3 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </div>
  );
}
