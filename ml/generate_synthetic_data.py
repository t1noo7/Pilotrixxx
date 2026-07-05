"""
SYNTHETIC DATASET GENERATOR (v2 - realistic overlap)

Thay đổi so với v1:
- max_speed range các scenario OVERLAP mạnh (safe 35-80, moderate 45-95,
  dangerous 60-120) - không còn bị RF tách sạch bằng 1 threshold
- Sinh bằng normal distribution thay vì uniform cho max_speed
- Thêm 15% "noisy trips": driver scenario X có vài chỉ số như scenario liền kề
- Kết quả mục tiêu: RF ~88-94%, LR ~80-88%

Output: data/synthetic_trips.csv
"""

import csv
import os
import random

import numpy as np

RANDOM_SEED = 42
N_TRIPS_PER_SCENARIO = 300
NOISE_RATIO = 0.15  # 15% trip mỗi scenario bị inject noise

random.seed(RANDOM_SEED)
np.random.seed(RANDOM_SEED)

# Dùng normal distribution cho max_speed (mean, sd) thay vì uniform
# -> đuôi phân phối chồng lên nhau tự nhiên
# safe:      mean=48,  sd=8   -> range thực ~32-64
# moderate:  mean=68,  sd=10  -> range thực ~48-88  (overlap cả 2 phía)
# dangerous: mean=92,  sd=12  -> range thực ~68-116 (overlap moderate)
SCENARIO_DISTRIBUTIONS = {
    "safe": {
        "duration_minutes": (5, 15),
        "avg_speed":         (30, 8),   # (mean, sd) normal
        "max_speed":         (48, 8),   # (mean, sd) normal
        "hard_brake_per_min":  (0.05, 0.18),
        "rapid_accel_per_min": (0.05, 0.15),
        "sharp_turn_per_min":  (0.02, 0.10),
        "overspeed_ratio":     (0.02, 0.04),
        "gps_invalid_rate_per_min": (0.0, 0.3),
    },
    "moderate": {
        "duration_minutes": (5, 15),
        "avg_speed":         (46, 9),
        "max_speed":         (68, 10),
        "hard_brake_per_min":  (0.45, 0.30),
        "rapid_accel_per_min": (0.38, 0.28),
        "sharp_turn_per_min":  (0.22, 0.18),
        "overspeed_ratio":     (0.13, 0.08),
        "gps_invalid_rate_per_min": (0.0, 0.3),
    },
    "dangerous": {
        "duration_minutes": (5, 15),
        "avg_speed":         (62, 11),
        "max_speed":         (92, 12),
        "hard_brake_per_min":  (1.10, 0.50),
        "rapid_accel_per_min": (0.90, 0.45),
        "sharp_turn_per_min":  (0.55, 0.32),
        "overspeed_ratio":     (0.33, 0.14),
        "gps_invalid_rate_per_min": (0.0, 0.3),
    },
}

# Noisy trips: blend feature từ scenario liền kề
# moderate-noisy: event rate thấp như safe nhưng tốc độ vẫn moderate
# dangerous-noisy: max_speed và overspeed trông như moderate
# safe-noisy: có vài sự kiện bất thường như moderate
NOISE_OVERRIDES = {
    "safe": {
        "hard_brake_per_min":  ("moderate", "hard_brake_per_min"),
        "sharp_turn_per_min":  ("moderate", "sharp_turn_per_min"),
    },
    "moderate": {
        "hard_brake_per_min":  ("safe", "hard_brake_per_min"),
        "rapid_accel_per_min": ("safe", "rapid_accel_per_min"),
        "overspeed_ratio":     ("safe", "overspeed_ratio"),
    },
    "dangerous": {
        "max_speed":       ("moderate", "max_speed"),
        "overspeed_ratio": ("moderate", "overspeed_ratio"),
        "hard_brake_per_min": ("moderate", "hard_brake_per_min"),
    },
}


def clip_nonneg(v):
    return max(0.0, v)


def sample_normal(params, key):
    mean, sd = params[key]
    return clip_nonneg(np.random.normal(mean, sd))


def generate_trip(scenario: str, noisy: bool = False) -> dict:
    params = SCENARIO_DISTRIBUTIONS[scenario]

    duration_min = random.uniform(*params["duration_minutes"])
    duration_seconds = round(duration_min * 60)

    avg_speed = clip_nonneg(np.random.normal(*params["avg_speed"]))
    avg_speed = min(avg_speed, 110)  # hard cap

    max_speed = clip_nonneg(np.random.normal(*params["max_speed"]))
    max_speed = max(max_speed, avg_speed * 1.05)

    hard_brake_per_min  = sample_normal(params, "hard_brake_per_min")
    rapid_accel_per_min = sample_normal(params, "rapid_accel_per_min")
    sharp_turn_per_min  = sample_normal(params, "sharp_turn_per_min")
    overspeed_ratio     = min(1.0, sample_normal(params, "overspeed_ratio"))
    gps_invalid_per_min = sample_normal(params, "gps_invalid_rate_per_min")

    # Inject noise
    if noisy and scenario in NOISE_OVERRIDES:
        for feat, (src_scenario, src_key) in NOISE_OVERRIDES[scenario].items():
            val = sample_normal(SCENARIO_DISTRIBUTIONS[src_scenario], src_key)
            if feat == "hard_brake_per_min":
                hard_brake_per_min = val
            elif feat == "rapid_accel_per_min":
                rapid_accel_per_min = val
            elif feat == "sharp_turn_per_min":
                sharp_turn_per_min = val
            elif feat == "overspeed_ratio":
                overspeed_ratio = min(1.0, val)
            elif feat == "max_speed":
                max_speed = max(clip_nonneg(val), avg_speed * 1.05)

    # Counts từ rate
    hard_brake_count  = round(hard_brake_per_min  * duration_min)
    rapid_accel_count = round(rapid_accel_per_min * duration_min)
    sharp_turn_count  = round(sharp_turn_per_min  * duration_min)
    overspeed_duration_seconds = round(overspeed_ratio * duration_seconds)
    overspeed_count   = round(overspeed_duration_seconds / 5)
    gps_invalid_count = round(gps_invalid_per_min * duration_min)

    total_events = hard_brake_count + rapid_accel_count + sharp_turn_count
    max_accel = min(1.0, clip_nonneg(np.random.normal(0.10 + 0.06 * total_events, 0.06)))
    max_brake_intensity = min(1.0, clip_nonneg(np.random.normal(0.20 + 0.08 * hard_brake_count, 0.10)))

    distance_km = round(avg_speed * (duration_seconds / 3600), 3)

    return {
        "scenario": scenario,
        "duration_seconds": duration_seconds,
        "distance_km": distance_km,
        "avg_speed": round(avg_speed, 2),
        "max_speed": round(max_speed, 1),
        "max_accel": round(max_accel, 3),
        "max_brake_intensity": round(max_brake_intensity, 2),
        "hard_brake_count": hard_brake_count,
        "rapid_accel_count": rapid_accel_count,
        "sharp_turn_count": sharp_turn_count,
        "overspeed_count": overspeed_count,
        "overspeed_duration_seconds": overspeed_duration_seconds,
        "hard_brake_per_min": round(hard_brake_count / duration_min, 3),
        "rapid_accel_per_min": round(rapid_accel_count / duration_min, 3),
        "sharp_turn_per_min": round(sharp_turn_count / duration_min, 3),
        "overspeed_ratio": round(overspeed_duration_seconds / duration_seconds, 3),
        "gps_invalid_count": gps_invalid_count,
    }


def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    output_path = os.path.join(script_dir, "data", "synthetic_trips.csv")
    os.makedirs(os.path.dirname(output_path), exist_ok=True)

    rows = []
    n_noisy = round(N_TRIPS_PER_SCENARIO * NOISE_RATIO)
    n_clean = N_TRIPS_PER_SCENARIO - n_noisy

    for scenario in ["safe", "moderate", "dangerous"]:
        for _ in range(n_clean):
            rows.append(generate_trip(scenario, noisy=False))
        for _ in range(n_noisy):
            rows.append(generate_trip(scenario, noisy=True))

    random.shuffle(rows)

    fieldnames = list(rows[0].keys())
    with open(output_path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    print(f"Generated {len(rows)} trips -> {output_path}")
    print(f"  {n_clean} clean + {n_noisy} noisy per scenario")


if __name__ == "__main__":
    main()
