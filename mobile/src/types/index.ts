export interface Driver {
  driverId: string;
  email: string;
  fullName: string;
}

export type VehicleType =
  | "sedan"
  | "truck"
  | "racecar"
  | "limousine"
  | "bus"
  | "tractor"
  | "duck";

export type VehicleStatus = "available" | "incoming" | "renting";

export interface Vehicle {
  vehicle_id: string;
  license_plate: string;
  model: string;
  vehicle_type: VehicleType;
  last_latitude: number | null;
  last_longitude: number | null;
  status: VehicleStatus;
}

export interface CurrentTrip {
  trip_id: string;
  vehicle_id: string;
  license_plate: string;
  model: string;
  vehicle_type: VehicleType;
  started_at: string;
  scenario: string;
  status: string; // 'pending' | 'ongoing' - dùng để phân biệt resume vào waiting.tsx hay trip/[id].tsx
}

export interface RiskScore {
  final: { risk_score: number; risk_level: "safe" | "medium" | "dangerous" };
}

export interface TripHistoryItem {
  trip_id: string;
  status: string;
  scenario: string;
  started_at: string;
  ended_at: string | null;
  license_plate: string;
  model: string;
  vehicle_type: VehicleType;
  final_risk_score: number | null;
  final_risk_level: "safe" | "medium" | "dangerous" | null;
}
