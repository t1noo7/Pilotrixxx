import { apiClient } from "./client";
import type {
  Vehicle,
  CurrentTrip,
  TripHistoryItem,
  RiskScore,
} from "../types";

export async function getVehicles(): Promise<Vehicle[]> {
  const { data } = await apiClient.get("/api/driver/vehicles");
  return data;
}

export async function getCurrentTrip(): Promise<CurrentTrip | null> {
  const { data } = await apiClient.get("/api/driver/trips/current");
  return data;
}

export async function reserveTrip(
  vehicleId: string,
  pickupLatitude: number,
  pickupLongitude: number,
): Promise<{
  tripId: string;
  vehicleId: number;
  driverId: string;
  status: string;
}> {
  const { data } = await apiClient.post("/api/driver/trips/reserve", {
    vehicleId,
    pickupLatitude,
    pickupLongitude,
  });
  return data;
}

export async function activateTrip(
  tripId: string,
): Promise<{ trip_id: string; vehicle_id: number; started_at: string }> {
  const { data } = await apiClient.post(`/api/driver/trips/${tripId}/activate`);
  return data;
}

export async function endTrip(tripId: string): Promise<{
  tripId: string;
  status: string;
  summary: unknown;
  riskScore: RiskScore | null;
}> {
  const { data } = await apiClient.post(`/api/driver/trips/${tripId}/end`);
  return data;
}

export async function rateTrip(
  tripId: string,
  rating: number,
): Promise<{ trip_id: string; driver_rating: number }> {
  const { data } = await apiClient.post(`/api/driver/trips/${tripId}/rate`, {
    rating,
  });
  return data;
}

export async function getTripHistory(limit = 20): Promise<TripHistoryItem[]> {
  const { data } = await apiClient.get("/api/driver/trips/history", {
    params: { limit },
  });
  return data;
}

export async function sendTelemetry(
  tripId: string,
  data: {
    latitude: number;
    longitude: number;
    speed: number | null;
    heading: number | null;
    accuracy?: number | null;
    accelX?: number;
    accelY?: number;
    brakeIntensity?: number;
  },
): Promise<{ received: boolean; speedLimit: number | null }> {
  const { data: res } = await apiClient.post(
    `/api/driver/trips/${tripId}/telemetry`,
    data,
  );
  return res;
}

export async function setRouteMode(
  tripId: string,
  demoMode: boolean,
  destLatitude?: number,
  destLongitude?: number,
): Promise<{
  trip_id: string;
  demo_mode: boolean;
  dest_latitude: number | null;
  dest_longitude: number | null;
}> {
  const { data } = await apiClient.patch(
    `/api/driver/trips/${tripId}/route-mode`,
    {
      demoMode,
      destLatitude,
      destLongitude,
    },
  );
  return data;
}

export async function getAqiHeatmap(
  lat: number,
  lng: number,
): Promise<{
  center: { lat: number; lng: number };
  points: [number, number, number][];
  currentAqi: number | null;
  noStationsNearby: boolean;
}> {
  const { data } = await apiClient.get("/api/aqi/heatmap", {
    params: { lat, lng },
  });
  return data;
}
