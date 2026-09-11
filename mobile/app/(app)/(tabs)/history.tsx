import { useCallback, useState } from "react";
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  RefreshControl,
  TouchableOpacity,
} from "react-native";
import { useFocusEffect, router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { getTripHistory } from "../../../src/api/driverTrips";
import LoadingOverlay from "../../../src/components/LoadingOverlay";
import VehicleIcon from "../../../src/components/VehicleIcon";
import type { TripHistoryItem } from "../../../src/types";

const RISK_LABEL: Record<string, string> = {
  safe: "An toàn",
  medium: "Trung bình",
  dangerous: "Nguy hiểm",
};

const RISK_COLOR: Record<string, string> = {
  safe: "#22c55e",
  medium: "#f59e0b",
  dangerous: "#ef4444",
};

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const hours = String(d.getHours()).padStart(2, "0");
  const minutes = String(d.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes} - ${day}/${month}`;
}

function formatDuration(startIso: string, endIso: string): string {
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  const totalMinutes = Math.max(0, Math.round(ms / 60000));
  if (totalMinutes < 60) return `${totalMinutes} phút`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes > 0 ? `${hours} giờ ${minutes} phút` : `${hours} giờ`;
}

export default function HistoryScreen() {
  const [trips, setTrips] = useState<TripHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (isRefresh = false) => {
    if (!isRefresh) setLoading(true);
    try {
      const list = await getTripHistory();
      setTrips(list);
    } catch (err: any) {
      console.log("getTripHistory error:", err.response?.data || err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [load]),
  );

  const onRefresh = () => {
    setRefreshing(true);
    load(true);
  };

  if (loading) return <LoadingOverlay visible message="Đang tải lịch sử..." />;

  return (
    <View style={styles.container}>
      <FlatList
        data={trips}
        keyExtractor={(item) => item.trip_id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="time-outline" size={40} color="#9ca3af" />
            <Text style={styles.emptyText}>Chưa có chuyến đi nào</Text>
          </View>
        }
        renderItem={({ item }) => {
          const isAborted = item.status === "aborted" || !item.final_risk_level;
          return (
            <TouchableOpacity
              style={styles.card}
              activeOpacity={isAborted ? 1 : 0.7}
              disabled={isAborted}
              onPress={() => router.push(`/(app)/replay/${item.trip_id}`)}
            >
              <View style={styles.iconCircle}>
                <VehicleIcon type={item.vehicle_type} height={30} />
              </View>
              <View style={styles.info}>
                <Text style={styles.plate}>{item.license_plate}</Text>
                <Text style={styles.model}>{item.model}</Text>
                <View style={styles.metaRow}>
                  <Text style={styles.dateText}>
                    {formatDateTime(item.started_at)}
                  </Text>
                  {item.ended_at && (
                    <Text style={styles.durationText}>
                      · {formatDuration(item.started_at, item.ended_at)}
                    </Text>
                  )}
                </View>
              </View>
              {isAborted ? (
                <View style={[styles.badge, { backgroundColor: "#9ca3af" }]}>
                  <Text style={styles.badgeText}>Đã huỷ</Text>
                </View>
              ) : (
                <View
                  style={[
                    styles.badge,
                    { backgroundColor: RISK_COLOR[item.final_risk_level!] },
                  ]}
                >
                  <Text style={styles.badgeText}>
                    {RISK_LABEL[item.final_risk_level!]}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f9fafb" },
  list: { padding: 16, gap: 12 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 14,
    gap: 12,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#eff6ff",
    alignItems: "center",
    justifyContent: "center",
  },
  info: { flex: 1 },
  plate: { fontSize: 15, fontWeight: "600", color: "#111827" },
  model: { fontSize: 12, color: "#6b7280", marginTop: 2 },
  metaRow: { flexDirection: "row", alignItems: "center", marginTop: 6 },
  dateText: { fontSize: 12, color: "#9ca3af" },
  durationText: { fontSize: 12, color: "#9ca3af", marginLeft: 2 },
  badge: { paddingVertical: 4, paddingHorizontal: 10, borderRadius: 10 },
  badgeText: { color: "#fff", fontSize: 11, fontWeight: "700" },
  empty: { alignItems: "center", marginTop: 80, gap: 8 },
  emptyText: { color: "#9ca3af", fontSize: 14 },
});
