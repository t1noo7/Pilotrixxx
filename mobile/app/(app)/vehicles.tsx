import { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  Alert,
} from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import {
  getAvailableVehicles,
  getCurrentTrip,
  startTrip,
} from "../../src/api/driverTrips";
import LoadingOverlay from "../../src/components/LoadingOverlay";
import VehicleIcon from "../../src/components/VehicleIcon";
import type { Vehicle } from "../../src/types";

export default function VehiclesScreen() {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [starting, setStarting] = useState(false);

  const load = useCallback(async () => {
    try {
      // Check trip đang chạy trước - resume state nếu app từng bị tắt giữa chuyến
      const current = await getCurrentTrip();
      if (current) {
        router.replace({
          pathname: "/(app)/trip/[id]",
          params: { id: current.trip_id, vehicleType: current.vehicle_type },
        });
        return;
      }
      const list = await getAvailableVehicles();
      setVehicles(list);
    } catch (err: any) {
      console.log(
        "getAvailableVehicles error:",
        err.response?.status,
        err.response?.data,
        err.message,
      );
      Alert.alert(
        "Lỗi",
        err.response?.data?.error || "Không tải được danh sách xe",
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  const handleSelect = async (vehicle: Vehicle) => {
    setStarting(true);
    try {
      const { tripId } = await startTrip(vehicle.vehicle_id);
      router.push({
        pathname: "/(app)/trip/[id]",
        params: { id: tripId, vehicleType: vehicle.vehicle_type },
      });
    } catch (err: any) {
      Alert.alert(
        "Không bắt đầu được chuyến",
        err.response?.data?.error || "Có lỗi xảy ra, thử lại sau",
      );
      // Xe vừa bị người khác đặt -> load lại danh sách cho khớp thực tế
      load();
    } finally {
      setStarting(false);
    }
  };

  if (loading)
    return <LoadingOverlay visible message="Đang tải danh sách xe..." />;

  return (
    <View style={styles.container}>
      {starting && <LoadingOverlay visible message="Đang bắt đầu chuyến..." />}
      <FlatList
        data={vehicles}
        keyExtractor={(item) => item.vehicle_id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="car-outline" size={40} color="#9ca3af" />
            <Text style={styles.emptyText}>Hiện không có xe trống</Text>
          </View>
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.card}
            onPress={() => handleSelect(item)}
            disabled={starting}
          >
            <View style={styles.iconCircle}>
              <VehicleIcon type={item.vehicle_type} height={34} />
            </View>
            <View style={styles.info}>
              <Text style={styles.plate}>{item.license_plate}</Text>
              <Text style={styles.model}>{item.model}</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#9ca3af" />
          </TouchableOpacity>
        )}
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
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#eff6ff",
    alignItems: "center",
    justifyContent: "center",
  },
  info: { flex: 1 },
  plate: { fontSize: 16, fontWeight: "600", color: "#111827" },
  model: { fontSize: 13, color: "#6b7280", marginTop: 2 },
  empty: { alignItems: "center", marginTop: 80, gap: 8 },
  emptyText: { color: "#9ca3af", fontSize: 14 },
});
