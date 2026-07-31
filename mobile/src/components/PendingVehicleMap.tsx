import { useEffect, useRef, useState } from "react";
import { View, StyleSheet } from "react-native";
import MapView, { Marker, Region, AnimatedRegion } from "react-native-maps";
import { Ionicons } from "@expo/vector-icons";
import VehicleIcon from "./VehicleIcon";
import type { VehicleType } from "../types";

type Props = {
  vehicleType: VehicleType;
  latitude: number;
  longitude: number;
  heading: number | null;
  driverLatitude?: number | null;
  driverLongitude?: number | null;
};

const EDGE_PADDING = 28; // khoang cach tu icon toi vien container (px)
const ARROW_ICON_SIZE = 30;

// Goc (0 = Bac, thuan chieu kim dong ho) tu diem 1 den diem 2 - giong het
// _bearing_deg() ben route_generator.py, viet lai bang TS cho phia client.
function bearingDeg(lat1: number, lng1: number, lat2: number, lng2: number) {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const dLambda = toRad(lng2 - lng1);
  const y = Math.sin(dLambda) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

// Diem giao giua tia (tu tam container, huong theo bearingDeg) va vien
// hinh chu nhat container (co padding) - dung de dat icon "chi huong"
// dung sat rin man hinh khi toa do that nam ngoai khung nhin.
function edgePointForBearing(
  bearing: number,
  width: number,
  height: number,
  padding: number,
) {
  const rad = (bearing * Math.PI) / 180;
  // Man hinh: x sang phai, y xuong duoi. Bac (bearing=0) phai tro LEN
  // (y am) - nen dx dung sin, dy dung -cos.
  const dx = Math.sin(rad);
  const dy = -Math.cos(rad);
  const halfW = width / 2 - padding;
  const halfH = height / 2 - padding;
  const tX = dx !== 0 ? halfW / Math.abs(dx) : Infinity;
  const tY = dy !== 0 ? halfH / Math.abs(dy) : Infinity;
  const t = Math.min(tX, tY);
  return { x: width / 2 + dx * t, y: height / 2 + dy * t, angle: bearing };
}

function isWithinRegion(lat: number, lng: number, region: Region): boolean {
  const latHalf = region.latitudeDelta / 2;
  const lngHalf = region.longitudeDelta / 2;
  return (
    Math.abs(lat - region.latitude) <= latHalf &&
    Math.abs(lng - region.longitude) <= lngHalf
  );
}

export default function PendingVehicleMap({
  vehicleType,
  latitude,
  longitude,
  heading,
  driverLatitude,
  driverLongitude,
}: Props) {
  const [region, setRegion] = useState<Region>({
    latitude,
    longitude,
    latitudeDelta: 0.01,
    longitudeDelta: 0.01,
  });
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const animatedCoordRef = useRef(
    new AnimatedRegion({
      latitude,
      longitude,
      latitudeDelta: 0,
      longitudeDelta: 0,
    }),
  );
  const lastUpdateAtRef = useRef<number>(Date.now());

  useEffect(() => {
    const now = Date.now();
    const elapsed = now - lastUpdateAtRef.current;
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

  const hasDriverPos = driverLatitude != null && driverLongitude != null;
  const driverInView =
    hasDriverPos && isWithinRegion(driverLatitude!, driverLongitude!, region);

  let edgeIndicator: { x: number; y: number; angle: number } | null = null;
  if (hasDriverPos && !driverInView && containerSize.width > 0) {
    const bearing = bearingDeg(
      region.latitude,
      region.longitude,
      driverLatitude!,
      driverLongitude!,
    );
    edgeIndicator = edgePointForBearing(
      bearing,
      containerSize.width,
      containerSize.height,
      EDGE_PADDING,
    );
  }

  return (
    <View
      style={styles.wrapper}
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        setContainerSize({ width, height });
      }}
    >
      <MapView style={styles.map} region={region}>
        <Marker.Animated
          coordinate={animatedCoordRef.current as any}
          anchor={{ x: 0.5, y: 0.5 }}
          tracksViewChanges
        >
          <VehicleIcon type={vehicleType} height={36} rotation={heading ?? 0} />
        </Marker.Animated>

        {driverInView && (
          <Marker
            coordinate={{
              latitude: driverLatitude!,
              longitude: driverLongitude!,
            }}
            anchor={{ x: 0.5, y: 1 }}
          >
            <Ionicons name="location" size={32} color="#ef4444" />
          </Marker>
        )}
      </MapView>

      {edgeIndicator && (
        <View
          pointerEvents="none"
          style={[
            styles.edgeIndicator,
            {
              left: edgeIndicator.x - ARROW_ICON_SIZE / 2,
              top: edgeIndicator.y - ARROW_ICON_SIZE / 2,
              transform: [{ rotate: `${edgeIndicator.angle}deg` }],
            },
          ]}
        >
          <Ionicons name="navigate" size={ARROW_ICON_SIZE} color="#ef4444" />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { flex: 1 },
  map: { flex: 1 },
  edgeIndicator: {
    position: "absolute",
    width: ARROW_ICON_SIZE,
    height: ARROW_ICON_SIZE,
    alignItems: "center",
    justifyContent: "center",
  },
});
