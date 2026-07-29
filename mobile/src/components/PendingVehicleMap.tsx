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
};

// Ban do rut gon cho trang thai PENDING (xe dang toi don driver) - khac
// trip/[id].tsx o cho: khong doc GPS that, khong gui telemetry, chi HIEN
// THI vi tri xe nhan tu socket 'vehicle:position'.
// mobile/src/components/PendingVehicleMap.tsx
export default function PendingVehicleMap({
  vehicleType,
  latitude,
  longitude,
  heading,
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
  // Ghi lai moc thoi gian lan nhan vi tri truoc - dung de tinh duration
  // ANIMATION KHOP DUNG khoang cach thuc te giua 2 lan socket ban toi,
  // thay vi hardcode 900ms (gay dung hinh giua chung, teleport luc bat
  // theo diem moi).
  const lastUpdateAtRef = useRef<number>(Date.now());

  useEffect(() => {
    const now = Date.now();
    const elapsed = now - lastUpdateAtRef.current;
    // Clamp: toi thieu 300ms (tranh giat neu 2 event ban lien tiep qua
    // gan nhau), toi da 8000ms (tranh cho "treo" qua lau neu mat 1 nhip).
    const duration = Math.min(Math.max(elapsed, 300), 8000);
    lastUpdateAtRef.current = now;

    (animatedCoordRef.current.timing as any)({
      latitude,
      longitude,
      duration,
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
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { flex: 1 },
  map: { flex: 1 },
});
