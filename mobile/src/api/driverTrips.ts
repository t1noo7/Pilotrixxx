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

export async function reserveTrip(vehicleId: string): Promise<{
  tripId: string;
  vehicleId: number;
  driverId: string;
  status: string;
}> {
  const { data } = await apiClient.post("/api/driver/trips/reserve", {
    vehicleId,
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
): Promise<void> {
  await apiClient.post(`/api/driver/trips/${tripId}/telemetry`, data);
}
