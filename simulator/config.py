import os
from dotenv import load_dotenv

load_dotenv()

# --- Backend & MQTT connection ---
BACKEND_URL = os.getenv("BACKEND_URL", "http://localhost:3000")


def _require_env(key: str) -> str:
    value = os.getenv(key)
    if not value:
        raise RuntimeError(f"Thieu bien moi truong '{key}' trong file .env")
    return value


MQTT_HOST = _require_env("MQTT_HOST")
MQTT_PORT = int(os.getenv("MQTT_PORT", "8883"))
MQTT_USERNAME = _require_env("MQTT_USERNAME")
MQTT_PASSWORD = _require_env("MQTT_PASSWORD")

# --- Telemetry timing ---
TELEMETRY_INTERVAL_SECONDS = 5  # tan suat gui, theo mqtt_payload_schema.md

# --- Trip duration: random 5-15 phut ---
TRIP_DURATION_MIN_SECONDS = 5 * 60
TRIP_DURATION_MAX_SECONDS = 15 * 60

# --- Diem bat dau tuyen duong (gan Dai hoc Mo - Dia chat, Bac Tu Liem, Ha Noi) ---
START_LATITUDE = 21.0469
START_LONGITUDE = 105.7855

# --- Cau hinh chuyen dong (route_generator) ---
# Gioi han toc do hop ly cho duong noi do (km/h) - dung de sinh speed_limit
SPEED_LIMIT_CHOICES = [40, 50, 60]

# Do lech huong toi da moi buoc (do) - xe khong re dot ngot moi 5s
MAX_HEADING_CHANGE_PER_STEP = 8

# --- Ty le mo phong GPS loi (gps_invalid event) ---
GPS_INVALID_PROBABILITY = 0.02  # ~2% so diem du lieu

# --- Tham so theo tung kich ban (scenario.py) ---
# speed: (min, max) km/h - toc do "binh thuong" cho kich ban nay
# event_probability: xac suat moi buoc xay ra 1 "su kien" dac trung
#   (phanh gap / tang toc dot ngot / vuot toc do / danh lai gap)
SCENARIO_PARAMS = {
    "safe": {
        "speed_range": (25, 45),
        "event_probability": 0.03,
        "max_overspeed_ratio": 1.05,  # vuot toc do toi da 5% so speed_limit
    },
    "moderate": {
        "speed_range": (35, 60),
        "event_probability": 0.12,
        "max_overspeed_ratio": 1.20,  # vuot toc do toi da 20%
    },
    "dangerous": {
        "speed_range": (45, 90),
        "event_probability": 0.30,
        "max_overspeed_ratio": 1.50,  # vuot toc do toi da 50%
    },
}
