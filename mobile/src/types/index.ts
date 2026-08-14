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
  | "duck"
  | "tank";

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
  vehicle_ready_at: string | null; // null = xe chưa tới; có giá trị = đã tới, sẵn sàng cho driver bấm bắt đầu
  demo_mode: boolean;
  dest_latitude: number | null;
  dest_longitude: number | null;
  // Vi tri xe cuoi cung tu telemetry, chi khac null neu telemetry moi hon
  // started_at cua trip nay - dung de noi tiep route demo dung mach luc
  // resume sau kill app, thay vi bat dau lai tu GPS that cua dien thoai.
  resume_latitude: number | null;
  resume_longitude: number | null;
  vehicle_latitude: number | null;
  vehicle_longitude: number | null;
  pickup_latitude: number | null;
  pickup_longitude: number | null;
}

export interface RiskScore {
  final: { risk_score: number; risk_level: "safe" | "medium" | "dangerous" };
}

// Khớp CHÍNH XÁC field trả về bởi generateTripSummary()
// (backend/src/services/tripSummaryService.js) - không thêm/bớt field
// tự ý, vì đây cũng chính là input cho ML (xem FEATURES trong ml/train.py).
export interface TripSummary {
  duration_seconds: number;
  distance_km: number;
  avg_speed: number;
  max_speed: number;
  max_accel: number;
  max_brake_intensity: number;
  hard_brake_count: number;
  rapid_accel_count: number;
  sharp_turn_count: number;
  overspeed_count: number;
  overspeed_duration_seconds: number;
  hard_brake_per_min: number;
  rapid_accel_per_min: number;
  sharp_turn_per_min: number;
  overspeed_ratio: number;
  gps_invalid_count: number;
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
