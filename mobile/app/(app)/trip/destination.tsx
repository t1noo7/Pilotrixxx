import { useState, useCallback, useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  FlatList,
  ActivityIndicator,
  Alert,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import MapView, { Marker, MapPressEvent } from "react-native-maps";
import * as Location from "expo-location";
import { Ionicons } from "@expo/vector-icons";
import { searchAddresses, GeocodeResult } from "../../../src/api/geocode";
import type { VehicleType } from "../../../src/types";

type PickMode = "address" | "map";

// Trung tam Ha Noi - dung lam fallback can giua map neu chua lay duoc vi
// tri thuc (vd Simulator chua set Custom Location).
const HANOI_FALLBACK = { latitude: 21.0469, longitude: 105.7855 };

export default function DestinationScreen() {
  const { id: tripId, vehicleType: vehicleTypeParam } = useLocalSearchParams<{
    id: string;
    vehicleType?: string;
  }>();
  const vehicleType = (vehicleTypeParam as VehicleType) || "sedan";

  const [demoMode, setDemoMode] = useState(false);
  const [pickMode, setPickMode] = useState<PickMode>("address");

  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<GeocodeResult[]>([]);
  const [searching, setSearching] = useState(false);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [selected, setSelected] = useState<GeocodeResult | null>(null);
  const [mapCenter, setMapCenter] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);

  // Lay vi tri hien tai 1 lan de can giua map luc chuyen sang "cam moc"
  useEffect(() => {
    if (pickMode !== "map" || mapCenter) return;
    (async () => {
      try {
        const loc = await Location.getCurrentPositionAsync({});
        setMapCenter({
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
        });
      } catch {
        setMapCenter(HANOI_FALLBACK);
      }
    })();
  }, [pickMode, mapCenter]);

  // Debounce goi Nominatim - tranh spam API moi ky tu go (free-tier
  // ~1 req/giay), chi goi sau khi driver ngung go 500ms.
  const onQueryChange = useCallback((text: string) => {
    setQuery(text);
    setSelected(null);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (text.trim().length < 3) {
      setSuggestions([]);
      return;
    }
    searchTimerRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const results = await searchAddresses(text, 5);
        setSuggestions(results);
      } catch {
        setSuggestions([]);
      } finally {
        setSearching(false);
      }
    }, 500);
  }, []);

  const handlePickSuggestion = (item: GeocodeResult) => {
    setSelected(item);
    setQuery(item.displayName);
    setSuggestions([]);
  };

  const handleMapPress = (e: MapPressEvent) => {
    const { latitude, longitude } = e.nativeEvent.coordinate;
    setSelected({
      latitude,
      longitude,
      displayName: "Vị trí đã cắm mốc trên bản đồ",
    });
  };

  const handleContinue = () => {
    if (!tripId) return;

    if (!demoMode) {
      router.replace({
        pathname: "/(app)/trip/[id]",
        params: {
          id: tripId,
          vehicleType,
          startedAt: new Date().toISOString(),
        },
      });
      return;
    }

    if (!selected) {
      Alert.alert(
        "Chưa chọn điểm đến",
        "Nhập địa chỉ hoặc cắm mốc trên bản đồ trước nhé",
      );
      return;
    }

    router.replace({
      pathname: "/(app)/trip/[id]",
      params: {
        id: tripId,
        vehicleType,
        startedAt: new Date().toISOString(),
        demoMode: "1",
        destLat: String(selected.latitude),
        destLng: String(selected.longitude),
      },
    });
  };

  return (
    <View style={styles.container}>
      <Text style={styles.header}>Chuyến đi của bạn</Text>

      <View style={styles.modeRow}>
        <TouchableOpacity
          style={[styles.modeBtn, !demoMode && styles.modeBtnActive]}
          onPress={() => setDemoMode(false)}
        >
          <Ionicons
            name="navigate"
            size={16}
            color={!demoMode ? "#fff" : "#374151"}
          />
          <Text
            style={[styles.modeBtnText, !demoMode && styles.modeBtnTextActive]}
          >
            GPS thật
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.modeBtn, demoMode && styles.modeBtnActive]}
          onPress={() => setDemoMode(true)}
        >
          <Ionicons
            name="play-forward"
            size={16}
            color={demoMode ? "#fff" : "#374151"}
          />
          <Text
            style={[styles.modeBtnText, demoMode && styles.modeBtnTextActive]}
          >
            Chế độ demo
          </Text>
        </TouchableOpacity>
      </View>

      {demoMode && (
        <>
          <View style={styles.pickModeRow}>
            <TouchableOpacity
              style={[
                styles.pickModeBtn,
                pickMode === "address" && styles.pickModeBtnActive,
              ]}
              onPress={() => setPickMode("address")}
            >
              <Text
                style={[
                  styles.pickModeBtnText,
                  pickMode === "address" && styles.pickModeBtnTextActive,
                ]}
              >
                Nhập địa chỉ
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.pickModeBtn,
                pickMode === "map" && styles.pickModeBtnActive,
              ]}
              onPress={() => setPickMode("map")}
            >
              <Text
                style={[
                  styles.pickModeBtnText,
                  pickMode === "map" && styles.pickModeBtnTextActive,
                ]}
              >
                Cắm mốc trên bản đồ
              </Text>
            </TouchableOpacity>
          </View>

          {pickMode === "address" ? (
            <View style={styles.addressBox}>
              <TextInput
                style={styles.input}
                placeholder="Nhập địa chỉ điểm đến..."
                value={query}
                onChangeText={onQueryChange}
              />
              {searching && <ActivityIndicator style={{ marginTop: 8 }} />}
              {suggestions.length > 0 && (
                <FlatList
                  style={styles.suggestList}
                  data={suggestions}
                  keyExtractor={(item, idx) =>
                    `${item.latitude}-${item.longitude}-${idx}`
                  }
                  renderItem={({ item }) => (
                    <TouchableOpacity
                      style={styles.suggestItem}
                      onPress={() => handlePickSuggestion(item)}
                    >
                      <Ionicons
                        name="location-outline"
                        size={16}
                        color="#6b7280"
                      />
                      <Text style={styles.suggestText} numberOfLines={2}>
                        {item.displayName}
                      </Text>
                    </TouchableOpacity>
                  )}
                />
              )}
              {selected && (
                <Text style={styles.coordHint}>
                  📍 {selected.latitude.toFixed(5)},{" "}
                  {selected.longitude.toFixed(5)}
                </Text>
              )}
            </View>
          ) : (
            <View style={styles.mapBox}>
              {mapCenter && (
                <MapView
                  style={styles.map}
                  initialRegion={{
                    latitude: mapCenter.latitude,
                    longitude: mapCenter.longitude,
                    latitudeDelta: 0.02,
                    longitudeDelta: 0.02,
                  }}
                  onPress={handleMapPress}
                >
                  {selected && (
                    <Marker
                      coordinate={{
                        latitude: selected.latitude,
                        longitude: selected.longitude,
                      }}
                    />
                  )}
                </MapView>
              )}
              <Text style={styles.mapHint}>
                Chạm vào bản đồ để cắm mốc điểm đến
              </Text>
              {selected && (
                <Text style={styles.coordHint}>
                  📍 {selected.latitude.toFixed(5)},{" "}
                  {selected.longitude.toFixed(5)}
                </Text>
              )}
            </View>
          )}
        </>
      )}

      <TouchableOpacity style={styles.continueBtn} onPress={handleContinue}>
        <Ionicons name="arrow-forward-circle" size={22} color="#fff" />
        <Text style={styles.continueBtnText}>Bắt đầu chuyến đi</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f9fafb", padding: 20, paddingTop: 60 },
  header: { fontSize: 20, fontWeight: "700", color: "#111827", marginBottom: 16 },
  modeRow: { flexDirection: "row", gap: 10, marginBottom: 16 },
  modeBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: "#e5e7eb",
  },
  modeBtnActive: { backgroundColor: "#2563eb" },
  modeBtnText: { fontWeight: "600", color: "#374151" },
  modeBtnTextActive: { color: "#fff" },
  pickModeRow: { flexDirection: "row", gap: 10, marginBottom: 12 },
  pickModeBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#d1d5db",
    alignItems: "center",
  },
  pickModeBtnActive: { backgroundColor: "#111827", borderColor: "#111827" },
  pickModeBtnText: { fontWeight: "600", color: "#374151", fontSize: 13 },
  pickModeBtnTextActive: { color: "#fff" },
  addressBox: { flex: 1 },
  input: {
    backgroundColor: "#fff",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#d1d5db",
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
  },
  suggestList: { maxHeight: 220, marginTop: 8 },
  suggestItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#f3f4f6",
  },
  suggestText: { flex: 1, fontSize: 13, color: "#111827" },
  coordHint: { marginTop: 10, fontSize: 12, color: "#6b7280" },
  mapBox: { flex: 1, borderRadius: 12, overflow: "hidden" },
  map: { flex: 1, minHeight: 300, borderRadius: 12 },
  mapHint: { fontSize: 12, color: "#6b7280", marginTop: 8, textAlign: "center" },
  continueBtn: {
    marginTop: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#22c55e",
    paddingVertical: 14,
    borderRadius: 30,
  },
  continueBtnText: { color: "#fff", fontWeight: "700", fontSize: 15 },
});
