import { useCallback, useState, useMemo, useRef, useEffect } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  Alert,
  Modal,
  TextInput,
} from "react-native";
import { router, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import { getVehicles, reserveTrip } from "../../../src/api/driverTrips";
import { geocodeAddress } from "../../../src/api/geocode";
import LoadingOverlay from "../../../src/components/LoadingOverlay";
import VehicleIcon from "../../../src/components/VehicleIcon";
import { useTrip } from "../../../src/context/TripContext";
import type { Vehicle, VehicleStatus } from "../../../src/types";

const STATUS_LABEL: Record<VehicleStatus, string> = {
  available: "Sẵn sàng",
  incoming: "Đang tới đón khách",
  renting: "Đang được thuê",
};

const STATUS_COLOR: Record<VehicleStatus, string> = {
  available: "#22c55e",
  incoming: "#f59e0b",
  renting: "#ef4444",
};

function distanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

type Coords = { latitude: number; longitude: number };

export default function VehiclesScreen() {
  const { refreshOngoingTrip, lastKnownLocation, setLastKnownLocation } =
    useTrip();
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [starting, setStarting] = useState(false);

  const [driverLocation, setDriverLocation] = useState<Coords | null>(null);
  const [locating, setLocating] = useState(false);
  const [addressModalVisible, setAddressModalVisible] = useState(false);
  const [addressInput, setAddressInput] = useState("");
  const [geocoding, setGeocoding] = useState(false);

  const fetchGpsLocation = useCallback(async () => {
    setLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        Alert.alert(
          "Cần quyền vị trí",
          "Cho phép truy cập vị trí để xem khoảng cách tới từng xe, hoặc dùng nút 'Nhập địa chỉ' bên dưới thay thế.",
        );
        return;
      }
      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      setDriverLocation({
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
      });
    } catch (err: any) {
      console.log("fetchGpsLocation error:", err.message);
    } finally {
      setLocating(false);
    }
  }, []);

  const handleGeocodeSubmit = async () => {
    if (!addressInput.trim()) return;
    setGeocoding(true);
    try {
      const result = await geocodeAddress(addressInput.trim());
      if (!result) {
        Alert.alert("Không tìm thấy", "Thử nhập địa chỉ cụ thể hơn nhé");
        return;
      }
      setDriverLocation({
        latitude: result.latitude,
        longitude: result.longitude,
      });
      setAddressModalVisible(false);
      setAddressInput("");
    } catch (err: any) {
      Alert.alert("Lỗi", err.message || "Không tìm được địa chỉ");
    } finally {
      setGeocoding(false);
    }
  };

  const load = useCallback(
    async (isRefresh = false) => {
      if (!isRefresh) setLoading(true);
      try {
        const current = await refreshOngoingTrip();
        if (current) {
          if (current.status === "pending") {
            router.replace({
              pathname: "/(app)/trip/waiting",
              params: {
                id: current.trip_id,
                vehicleType: current.vehicle_type,
              },
            });
          } else {
            router.replace({
              pathname: "/(app)/trip/[id]",
              params: {
                id: current.trip_id,
                vehicleType: current.vehicle_type,
                startedAt: current.started_at,
              },
            });
          }
          return;
        }
        const list = await getVehicles();
        setVehicles(list);
      } catch (err: any) {
        console.log(
          "getVehicles error:",
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
    },
    [refreshOngoingTrip],
  );

  const lastKnownLocationRef = useRef(lastKnownLocation);
  useEffect(() => {
    lastKnownLocationRef.current = lastKnownLocation;
  }, [lastKnownLocation]);

  useFocusEffect(
    useCallback(() => {
      load();
      const loc = lastKnownLocationRef.current;
      if (loc) {
        setDriverLocation(loc);
        setLastKnownLocation(null);
      } else {
        fetchGpsLocation();
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [load]),
  );

  const onRefresh = () => {
    setRefreshing(true);
    load(true);
  };

  // Xe kem khoang cach da tinh, sap xep gan -> xa. Xe khong co
  // last_latitude/longitude (chua tung co telemetry) xep cuoi danh sach.
  const sortedVehicles = useMemo(() => {
    const withDistance = vehicles.map((v) => {
      const dist =
        driverLocation && v.last_latitude != null && v.last_longitude != null
          ? distanceKm(
              driverLocation.latitude,
              driverLocation.longitude,
              v.last_latitude,
              v.last_longitude,
            )
          : null;
      return { ...v, _distance: dist };
    });
    return withDistance.sort((a, b) => {
      if (a._distance == null && b._distance == null) return 0;
      if (a._distance == null) return 1;
      if (b._distance == null) return -1;
      return a._distance - b._distance;
    });
  }, [vehicles, driverLocation]);

  const handleSelect = async (
    vehicle: Vehicle & { _distance: number | null },
  ) => {
    if (vehicle.status === "renting") {
      Alert.alert("Xe đang bận", "Xe này đang trong chuyến của tài xế khác.");
      return;
    }
    if (vehicle.status === "incoming") {
      Alert.alert(
        "Xe đang bận",
        "Xe này vừa được tài xế khác đặt, đang trên đường tới đón họ. Chọn xe khác nhé.",
      );
      return;
    }
    if (!driverLocation) {
      Alert.alert(
        "Thiếu vị trí",
        "Cần biết vị trí của bạn trước khi đặt xe - bấm 'Dùng vị trí hiện tại' hoặc 'Nhập địa chỉ' phía trên.",
      );
      return;
    }

    setStarting(true);
    try {
      const { tripId } = await reserveTrip(
        vehicle.vehicle_id,
        driverLocation.latitude,
        driverLocation.longitude,
      );
      await refreshOngoingTrip();
      router.push({
        pathname: "/(app)/trip/waiting",
        params: { id: tripId, vehicleType: vehicle.vehicle_type },
      });
    } catch (err: any) {
      Alert.alert(
        "Không đặt được xe",
        err.response?.data?.error || "Có lỗi xảy ra, thử lại sau",
      );
      load();
    } finally {
      setStarting(false);
    }
  };

  if (loading)
    return <LoadingOverlay visible message="Đang tải danh sách xe..." />;

  return (
    <View style={styles.container}>
      {starting && <LoadingOverlay visible message="Đang đặt xe..." />}

      <View style={styles.locationBar}>
        <Ionicons name="location" size={16} color="#2563eb" />
        <Text style={styles.locationText} numberOfLines={1}>
          {locating
            ? "Đang lấy vị trí..."
            : driverLocation
              ? `Vị trí: ${driverLocation.latitude.toFixed(4)}, ${driverLocation.longitude.toFixed(4)}`
              : "Chưa có vị trí"}
        </Text>
        <TouchableOpacity onPress={fetchGpsLocation} disabled={locating}>
          <Ionicons name="refresh" size={18} color="#2563eb" />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setAddressModalVisible(true)}>
          <Ionicons name="create-outline" size={18} color="#2563eb" />
        </TouchableOpacity>
      </View>

      <FlatList
        data={sortedVehicles}
        keyExtractor={(item) => item.vehicle_id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="car-outline" size={40} color="#9ca3af" />
            <Text style={styles.emptyText}>Chưa có xe nào trong hệ thống</Text>
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
              <View style={styles.metaRow}>
                <View
                  style={[
                    styles.statusBadge,
                    { backgroundColor: STATUS_COLOR[item.status] },
                  ]}
                >
                  <Text style={styles.statusBadgeText}>
                    {STATUS_LABEL[item.status]}
                  </Text>
                </View>
                {item._distance != null && (
                  <Text style={styles.distanceText}>
                    {item._distance < 1
                      ? `${Math.round(item._distance * 1000)} m`
                      : `${item._distance.toFixed(1)} km`}
                  </Text>
                )}
              </View>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#9ca3af" />
          </TouchableOpacity>
        )}
      />

      <Modal visible={addressModalVisible} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Nhập địa chỉ của bạn</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="VD: 18 Hoàng Diệu, Ba Đình, Hà Nội"
              value={addressInput}
              onChangeText={setAddressInput}
              autoFocus
            />
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setAddressModalVisible(false)}
              >
                <Text style={styles.modalCancelText}>Huỷ</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalConfirmBtn}
                onPress={handleGeocodeSubmit}
                disabled={geocoding}
              >
                <Text style={styles.modalConfirmText}>
                  {geocoding ? "Đang tìm..." : "Xác nhận"}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f9fafb" },
  locationBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: "#eff6ff",
    borderBottomWidth: 1,
    borderBottomColor: "#dbeafe",
  },
  locationText: { flex: 1, fontSize: 12, color: "#1e40af" },
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
  metaRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 },
  statusBadge: { paddingVertical: 3, paddingHorizontal: 8, borderRadius: 10 },
  statusBadgeText: { color: "#fff", fontSize: 11, fontWeight: "700" },
  distanceText: { fontSize: 12, color: "#6b7280", fontWeight: "600" },
  empty: { alignItems: "center", marginTop: 80, gap: 8 },
  emptyText: { color: "#9ca3af", fontSize: 14 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "#00000099",
    justifyContent: "center",
    alignItems: "center",
  },
  modalCard: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 20,
    width: "85%",
    gap: 12,
  },
  modalTitle: { fontSize: 16, fontWeight: "700", color: "#111827" },
  modalInput: {
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  modalActions: { flexDirection: "row", justifyContent: "flex-end", gap: 12 },
  modalCancelBtn: { paddingVertical: 8, paddingHorizontal: 12 },
  modalCancelText: { color: "#6b7280", fontWeight: "600" },
  modalConfirmBtn: {
    backgroundColor: "#2563eb",
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  modalConfirmText: { color: "#fff", fontWeight: "700" },
});
