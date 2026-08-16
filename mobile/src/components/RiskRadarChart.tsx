// RiskRadarChart - spider chart hiển thị breakdown điểm rủi ro theo từng
// hành vi lái xe. Viết bằng react-native-svg (KHÔNG dùng recharts - đó là
// thư viện web, không chạy được trên React Native/Expo).
//
// Nếu app chưa có react-native-svg, cài bằng:
//   npx expo install react-native-svg
//
// Số trục (axes.length) tự động chia đều góc quanh vòng tròn - khi thêm
// event thứ 5 (lấn làn) sau này, chỉ cần thêm 1 phần tử vào mảng axes
// truyền vào, component tự vẽ lại, không cần sửa gì trong file này.
import React from "react";
import { View, Text, StyleSheet } from "react-native";
import Svg, { Polygon, Line, Circle } from "react-native-svg";

export interface RadarAxis {
  key: string;
  label: string;
  emoji: string;
  score: number; // 0-100
}

interface Props {
  axes: RadarAxis[];
  size?: number;
  color?: string;
}

const RING_COUNT = 4; // 4 vòng lưới đồng tâm (25/50/75/100%)
const LABEL_RADIUS_RATIO = 1.32;

export default function RiskRadarChart({
  axes,
  size = 190,
  color = "#ef4444",
}: Props) {
  const center = size / 2;
  const maxRadius = size / 2 - 46; // chừa lề cho label quanh viền
  const angleStep = axes.length > 0 ? (2 * Math.PI) / axes.length : 0;

  function pointAt(index: number, radiusRatio: number) {
    const angle = -Math.PI / 2 + index * angleStep; // bắt đầu từ đỉnh (12h)
    const r = maxRadius * radiusRatio;
    return {
      x: center + r * Math.cos(angle),
      y: center + r * Math.sin(angle),
    };
  }

  if (axes.length === 0) return null;

  // Điểm 0 vẫn vẽ 1 chấm nhỏ cách tâm 4% - để không bị "biến mất" hoàn
  // toàn vào đúng tâm, nhìn dễ phân biệt "rất thấp" và "không có dữ liệu".
  const dataPoints = axes
    .map((axis, i) => {
      const p = pointAt(i, Math.max(axis.score, 4) / 100);
      return `${p.x},${p.y}`;
    })
    .join(" ");

  const LABEL_PADDING = 26; // giam tu 35 - vong tron 220 giu nguyen, chi
  // bot khoang lem quanh label, keo ca component len sat hon.
  const outerContainerSize = size + LABEL_PADDING * 2;

  return (
    <View
      style={[
        styles.container,
        { width: outerContainerSize, height: outerContainerSize },
      ]}
    >
      <View style={{ position: "absolute", left: LABEL_PADDING, top: LABEL_PADDING }}>
        <Svg width={size} height={size}>
          {Array.from({ length: RING_COUNT }).map((_, ringIdx) => {
            const ratio = (ringIdx + 1) / RING_COUNT;
            const ringPoints = axes
              .map((_, i) => {
                const p = pointAt(i, ratio);
                return `${p.x},${p.y}`;
              })
              .join(" ");
            return (
              <Polygon
                key={ringIdx}
                points={ringPoints}
                fill="none"
                stroke="#e5e7eb"
                strokeWidth={1}
              />
            );
          })}

          {axes.map((_, i) => {
            const p = pointAt(i, 1);
            return (
              <Line
                key={i}
                x1={center}
                y1={center}
                x2={p.x}
                y2={p.y}
                stroke="#e5e7eb"
                strokeWidth={1}
              />
            );
          })}

          <Polygon
            points={dataPoints}
            fill={color}
            fillOpacity={0.25}
            stroke={color}
            strokeWidth={2}
          />

          {axes.map((axis, i) => {
            const p = pointAt(i, Math.max(axis.score, 4) / 100);
            return <Circle key={axis.key} cx={p.x} cy={p.y} r={4} fill={color} />;
          })}
        </Svg>

        {axes.map((axis, i) => {
          const p = pointAt(i, LABEL_RADIUS_RATIO);
          return (
            <View
              key={axis.key}
              style={[styles.axisLabel, { left: p.x - 34, top: p.y - 16 }]}
            >
              <Text style={styles.axisLabelEmoji}>{axis.emoji}</Text>
              <Text style={styles.axisLabelText}>{axis.label}</Text>
              <Text style={styles.axisLabelScore}>{axis.score}%</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
  },
  axisLabel: {
    position: "absolute",
    width: 68,
    alignItems: "center",
  },
  axisLabelEmoji: { fontSize: 14 },
  axisLabelText: {
    fontSize: 10,
    color: "#374151",
    textAlign: "center",
    fontWeight: "600",
  },
  axisLabelScore: {
    fontSize: 9,
    color: "#9ca3af",
    fontWeight: "500",
  },
});
