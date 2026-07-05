# MQTT Payload Schema

## 1. Vong doi mot Trip - Luong Simulator <-> Backend (Cach A)

Quyet dinh: Simulator KHONG tu sinh `trip_id`. Truoc khi bat dau publish
telemetry cho 1 chuyen di, Simulator phai "dang ky trip" voi Backend qua
REST API, giong cach mot thiet bi AVL/GPS that khoi tao session voi server.

### Buoc 1 - Bat dau trip (REST)

```
POST /api/trips/start
Body: { "deviceIdent": "865413056621427", "scenario": "moderate" }

Response: { "tripId": 42, "vehicleId": 3, "driverId": 7 }
```

Backend:

- Tra `device_ident` -> `vehicle_id` (bang `vehicles`)
- Chon/gan `driver_id` cho trip nay
- INSERT vao `trips` voi `status = 'ongoing'`, `scenario`, `started_at = now()`
- Tra ve `trip_id` (BIGINT that, do DB sinh) cho Simulator

### Buoc 2 - Publish telemetry (MQTT)

Simulator dung `trip_id` (so nguyen, vd `42`) nhan duoc o Buoc 1 de dien
vao field `tripId` cua moi message telemetry:

```json
{
  "vehicleId": 3,
  "tripId": 42,
  "ts": "2026-06-11T10:15:30.000Z",
  "position": { ... },
  ...
}
```

(Khong can gui `driverId` trong telemetry nua - Backend da biet
`driver_id` qua `trips.trip_id`.)

### Buoc 3 - Ket thuc trip (REST)

```
POST /api/trips/{tripId}/end
Response: { "tripId": 42, "status": "completed" }
```

Backend:

1. UPDATE `trips.status = 'completed'`, `trips.ended_at = now()`
2. Trigger Trip Summary Generator (tinh `trip_summary` tu `telemetry_raw` + `driver_events`)
3. Trigger ML Risk Scoring (doc `trip_summary` -> goi model `.pkl` -> ghi `risk_scores`)

### Vi sao chon cach nay

- Don gian hoa MQTT payload: bo het van de mapping ID string <-> BIGINT
- Sat voi thuc te thiet bi AVL: thiet bi luon "dang nhap phien" voi server
  truoc khi gui du lieu lien tuc
- Backend co diem entry ro rang de validate **theo tung xe** (vd: tu choi
  neu xe nay (cung `vehicle_id`) dang co 1 trip 'ongoing' khac chua ket
  thuc - vi 1 thiet bi GPS vat ly khong the o 2 trip cung luc) va de
  trigger Trip Summary + ML Risk Scoring dung 1 lan, dung thoi diem
  (`/trips/{id}/end`), khong phai doan tu MQTT status message
- topic `vehicles/{vehicleId}/status` (MQTT) tro nen khong can thiet
  cho luong chinh -> loai bo, giam so luong topic phai code

**Luu y - he thong VAN xu ly nhieu xe dong thoi**: validate o tren chi
ap dung trong pham vi 1 `vehicle_id`. Nhieu xe khac nhau co the co trip
'ongoing' cung luc, hoan toan doc lap - MQTT Consumer cua Backend nhan
va xu ly telemetry tu tat ca topic `vehicles/{vehicleId}/telemetry` song
song (Node.js non-blocking I/O). Demo thuc te nen chay nhieu instance
Simulator dong thoi (mo phong 1 doi xe) de the hien ro dieu nay tren
Dashboard.

(REST API endpoints day du - bao gom `/api/trips/start`, `/api/trips/{id}/end`
va cac endpoint con lai cho Dashboard - se thiet ke chi tiet o buoc rieng.)

---

## 2. Topic: `vehicles/{vehicleId}/telemetry`

QoS: 1 (at-least-once — chap nhan trung lap nho, khong chap nhan mat du lieu)
Tan suat: 5 giay/lan
Retain: false

### JSON Schema

```json
{
  "vehicleId": 3,
  "tripId": 42,
  "ts": "2026-06-11T10:15:30.000Z",

  "position": {
    "latitude": 21.028511,
    "longitude": 105.804817,
    "valid": true,
    "satellites": 9,
    "speed": 45.2,
    "speedLimit": 50,
    "heading": 187.5
  },

  "acceleration": {
    "x": 0.02,
    "y": -0.15,
    "z": 0.98
  },

  "brakeIntensity": 0.12,

  "engine": {
    "ignitionStatus": true,
    "rpm": 1850
  },

  "device": {
    "batteryLevel": 87,
    "gsmSignal": 76
  }
}
```

Ghi chu: `vehicleId` va `tripId` la ID so nguyen (BIGINT) lay tu response
cua `POST /api/trips/start` (xem Muc 1) - khong phai chuoi tu sinh.
`driverId` va `scenario` KHONG nam trong telemetry payload, vi Backend
da biet ca hai thong qua `trips.trip_id` (tra bang JOIN khi can).

### Field mapping -> telemetry_raw

| JSON path               | Cot DB                | Ghi chu                                    |
| ----------------------- | --------------------- | ------------------------------------------ |
| `vehicleId`             | `vehicle_id`          | BIGINT, lay tu response `/api/trips/start` |
| `tripId`                | `trip_id`             | BIGINT, lay tu response `/api/trips/start` |
| `ts`                    | `ts`                  | ISO 8601 UTC                               |
| `position.latitude`     | `latitude`            |                                            |
| `position.longitude`    | `longitude`           |                                            |
| `position.valid`        | `position_valid`      | mo phong GPS loi (~2-3% so ban ghi)        |
| `position.satellites`   | `satellites`          | 0 khi `valid=false`                        |
| `position.speed`        | `speed`               | km/h                                       |
| `position.speedLimit`   | `speed_limit`         | gia lap theo "doan duong"                  |
| `position.heading`      | `heading`             | 0-360 do                                   |
| `acceleration.x/y/z`    | `accel_x/y/z`         | don vi g                                   |
| `brakeIntensity`        | `brake_intensity`     | 0.0 - 1.0, simulator tu tinh               |
| `engine.ignitionStatus` | `ignition_status`     |                                            |
| `engine.rpm`            | `engine_rpm`          |                                            |
| `device.batteryLevel`   | `battery_level`       | 0-100                                      |
| `device.gsmSignal`      | `gsm_signal`          | 0-100                                      |
| (toan bo payload)       | `raw_payload` (JSONB) | luu nguyen JSON nay                        |

---

## 3. Topic con lai sau quyet dinh o Muc 1

Sau khi ap dung Cach A (xem Muc 1), chi con **DUY NHAT 1 topic MQTT** can
implement:

```
vehicles/{vehicleId}/telemetry      <- simulator publish, backend subscribe
```

Cac su kien vong doi trip ("bat dau", "ket thuc") di qua REST API
(`/api/trips/start`, `/api/trips/{id}/end`), khong di qua MQTT nua.
Day la diem khac biet so voi ban nhap dau tien (luc do co them topic
`vehicles/{vehicleId}/status` va cac topic alert/risk-score qua MQTT) -
da duoc don gian hoa de kien truc ro rang, de implement va de giai thich.
