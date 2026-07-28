import { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import MapView, { Marker, Region, AnimatedRegion } from "react-native-maps";
import VehicleIcon from "./VehicleIcon";
import type { VehicleType } from "../types";

type Props = {
  vehicleType: VehicleType;
  latitude: number;
  longitude: number;
  heading: number | null;
  etaSeconds?: number | null;
};

// Ban do rut gon cho trang thai PENDING (xe dang toi don driver) - khac
// trip/[id].tsx o cho: khong doc GPS that, khong gui telemetry, chi HIEN
// THI vi tri xe nhan tu socket 'vehicle:position'.
export default function PendingVehicleMap({
  vehicleType,
  latitude,
  longitude,
  heading,
  etaSeconds = null,
}: Props) {
  const [region, setRegion] = useState<Region>({
    latitude,
    longitude,
    latitudeDelta: 0.01,
    longitudeDelta: 0.01,
  });
  const animatedCoordRef = useRef(
    new AnimatedRegion({
      latitude,
      longitude,
      latitudeDelta: 0,
      longitudeDelta: 0,
    }),
  );

  useEffect(() => {
    (animatedCoordRef.current.timing as any)({
      latitude,
      longitude,
      duration: 900,
      useNativeDriver: false,
    }).start();
    setRegion((prev) => ({ ...prev, latitude, longitude }));
  }, [latitude, longitude]);

  return (
    <View style={styles.wrapper}>
      <MapView style={styles.map} region={region}>
        <Marker.Animated
          coordinate={animatedCoordRef.current as any}
          anchor={{ x: 0.5, y: 0.5 }}
          tracksViewChanges
        >
          <VehicleIcon type={vehicleType} height={36} rotation={heading ?? 0} />
        </Marker.Animated>
      </MapView>
      {etaSeconds != null && (
        <View style={styles.etaBadge}>
          <Text style={styles.etaBadgeText}>
            Xe tới trong ~{Math.max(1, Math.ceil(etaSeconds / 60))} phút
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { flex: 1 },
  map: { flex: 1 },
  etaBadge: {
    position: "absolute",
    top: 10,
    alignSelf: "center",
    backgroundColor: "#fff",
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 16,
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
  },
  etaBadgeText: { fontSize: 12, fontWeight: "600", color: "#111827" },
});
