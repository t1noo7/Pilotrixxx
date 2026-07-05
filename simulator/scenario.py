"""
Sinh 1 "diem telemetry" theo kich ban (safe/moderate/dangerous).

Moi lan goi generate_telemetry_point() tra ve 1 dict du lieu cam bien
(chua bao gom vehicleId/tripId/ts - se duoc simulator.py dien vao).

Logic "su kien" (hard_brake, rapid_accel, sharp_turn, overspeed):
- Moi buoc, voi xac suat = event_probability (theo kich ban), simulator
  sinh ra MOT trong 4 loai su kien, lam thay doi gia tri telemetry
  cho buoc do (vd brake_intensity tang vot, speed vuot speed_limit...)
- Cac buoc khong co su kien: du lieu "binh thuong" trong speed_range
  cua kich ban, accel/brake o muc thap.
"""

import random

from config import SCENARIO_PARAMS, GPS_INVALID_PROBABILITY, SPEED_LIMIT_CHOICES


def generate_telemetry_point(scenario: str, speed_limit: float, prev_speed: float):
    """
    scenario: 'safe' | 'moderate' | 'dangerous'
    speed_limit: gioi han toc do hien tai cua "doan duong" (km/h)
    prev_speed: toc do o buoc truoc (km/h) - dung de tinh gia toc thuc te

    Tra ve: dict {
        speed, accel_x, accel_y, accel_z, brake_intensity,
        position_valid, satellites, battery_level, gsm_signal,
        engine_rpm, ignition_status, event_type (hoac None)
    }
    """
    params = SCENARIO_PARAMS[scenario]
    speed_min, speed_max = params["speed_range"]

    event_type = None
    speed = prev_speed
    accel_x = round(random.uniform(-0.05, 0.05), 3)
    accel_y = round(random.uniform(-0.05, 0.05), 3)
    accel_z = round(random.uniform(0.95, 1.02), 3)  # ~1g khi xe nam ngang
    brake_intensity = 0.0

    # --- Quyet dinh co xay ra "su kien" o buoc nay khong ---
    if random.random() < params["event_probability"]:
        event_type = random.choice(
            ["hard_brake", "rapid_accel", "sharp_turn", "overspeed"]
        )

    if event_type == "hard_brake":
        # Phanh gap: giam toc do dot ngot, accel_y am lon, brake_intensity cao
        brake_intensity = round(random.uniform(0.6, 1.0), 2)
        accel_y = round(-brake_intensity * random.uniform(0.8, 1.0), 3)
        speed = max(speed_min * 0.5, prev_speed * random.uniform(0.4, 0.7))

    elif event_type == "rapid_accel":
        # Tang toc dot ngot: accel_y duong lon, toc do tang manh
        accel_y = round(random.uniform(0.3, 0.6), 3)
        speed = min(speed_max * 1.1, prev_speed * random.uniform(1.3, 1.6))

    elif event_type == "sharp_turn":
        # Danh lai gap: accel_x (ngang) lon
        accel_x = round(random.choice([-1, 1]) * random.uniform(0.4, 0.7), 3)
        speed = max(speed_min, prev_speed * random.uniform(0.8, 0.95))

    elif event_type == "overspeed":
        # Vuot toc do: speed > speed_limit theo ty le toi da cua kich ban
        max_ratio = params["max_overspeed_ratio"]
        speed = round(speed_limit * random.uniform(1.05, max_ratio), 1)

    else:
        # Khong co su kien dac biet: dao dong nhe quanh toc do hien tai,
        # huong ve khoang speed_range cua kich ban
        target = random.uniform(speed_min, speed_max)
        speed = prev_speed + (target - prev_speed) * 0.3
        speed = max(0, round(speed, 1))

    speed = max(0, round(speed, 1))

    # --- GPS valid/invalid (doc lap voi kich ban - loi phan cung/tin hieu) ---
    position_valid = random.random() > GPS_INVALID_PROBABILITY
    satellites = random.randint(6, 12) if position_valid else 0
    if not position_valid:
        event_type = "gps_invalid"

    # --- Cac field phu (battery, gsm, engine) ---
    battery_level = random.randint(70, 100)
    gsm_signal = random.randint(50, 100)
    # RPM ty le voi speed, them nhieu nho - mo phong rong toc khi rapid_accel
    base_rpm = 800 + speed * 25
    if event_type == "rapid_accel":
        base_rpm *= random.uniform(1.3, 1.6)
    engine_rpm = int(base_rpm + random.uniform(-100, 100))

    return {
        "speed": speed,
        "accel_x": accel_x,
        "accel_y": accel_y,
        "accel_z": accel_z,
        "brake_intensity": brake_intensity,
        "position_valid": position_valid,
        "satellites": satellites,
        "battery_level": battery_level,
        "gsm_signal": gsm_signal,
        "engine_rpm": engine_rpm,
        "ignition_status": True,
        "event_type": event_type,  # chi de log/debug, KHONG gui trong MQTT payload
    }


def pick_speed_limit():
    """Chon ngau nhien 1 gioi han toc do cho 'doan duong' hien tai."""
    return random.choice(SPEED_LIMIT_CHOICES)
