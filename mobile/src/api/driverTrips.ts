import { apiClient } from "./client";
import type {
  Vehicle,
  CurrentTrip,
  TripHistoryItem,
  RiskScore,
} from "../types";

export async function getAvailableVehicles(): Promise<Vehicle[]> {
  const { data } = await apiClient.get("/api/driver/vehicles/available");
  return data;
}

export async function getCurrentTrip(): Promise<CurrentTrip | null> {
  const { data } = await apiClient.get("/api/driver/trips/current");
  return data;
}

export async function startTrip(
  vehicleId: string,
): Promise<{ tripId: string; vehicleId: number; driverId: string }> {
  const { data } = await apiClient.post("/api/driver/trips/start", {
    vehicleId,
  });
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
): Promise<void> {
  await apiClient.post(`/api/driver/trips/${tripId}/telemetry`, data);
}
