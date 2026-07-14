"""
run_demo_route.py - Bom toa do THEO TUNG DIEM vao iOS Simulator dang chay,
dung xcrun simctl location booted set (khong dung "start" nua vi khong
kiem soat duoc toc do). Toc do tung doan lay tu file CSV do
generate_demo_gpx.py xuat ra (da tinh san: cham lai lu vao cua, nhanh o
duong thang). KHONG can Xcode project / ios folder (Expo managed workflow).

Yeu cau: iOS Simulator dang BOOTED, dang chay app tren do (o man hinh trip).

Cach dung:
    python3 run_demo_route.py hanoi_demo_route_speeds.csv

Ctrl+C de dung giua chung.
"""

import csv
import subprocess
import sys
import time
from math import radians, sin, cos, sqrt, atan2


def haversine_m(p1, p2):
    R = 6371000
    lat1, lon1 = radians(p1[0]), radians(p1[1])
    lat2, lon2 = radians(p2[0]), radians(p2[1])
    dlat, dlon = lat2 - lat1, lon2 - lon1
    a = sin(dlat / 2) ** 2 + cos(lat1) * cos(lat2) * sin(dlon / 2) ** 2
    return 2 * R * atan2(sqrt(a), sqrt(1 - a))


def load_points(csv_path):
    pts = []
    with open(csv_path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            pts.append((float(row["lat"]), float(row["lon"]), float(row["speed_kmh"])))
    return pts


def set_location(lat, lon):
    subprocess.run(
        ["xcrun", "simctl", "location", "booted", "set", f"{lat},{lon}"],
        check=True,
        capture_output=True,
    )


def main():
    if len(sys.argv) != 2:
        print("Usage: python3 run_demo_route.py <file_speeds.csv>")
        sys.exit(1)

    pts = load_points(sys.argv[1])
    print(f"Doc duoc {len(pts)} diem. Dang bom vao Simulator (booted)... Ctrl+C de dung.")

    try:
        set_location(pts[0][0], pts[0][1])
        for i in range(1, len(pts)):
            prev, cur = pts[i - 1], pts[i]
            dist = haversine_m(prev, cur)
            speed_mps = max(cur[2], 3.0) * 1000 / 3600
            delay = dist / speed_mps
            time.sleep(max(delay, 0.05))  # san 50ms de tranh spam simctl qua nhanh
            set_location(cur[0], cur[1])
            if i % 20 == 0:
                print(f"  ...{i}/{len(pts)} diem, toc do hien tai ~{cur[2]:.0f}km/h")
    except KeyboardInterrupt:
        print("\nDa dung. Chay 'xcrun simctl location booted clear' de reset vi tri.")
    except subprocess.CalledProcessError as e:
        print(f"Loi khi goi simctl: {e}")
        print("Kiem tra: co dung 1 Simulator dang booted khong? "
              "Chay 'xcrun simctl list devices booted' de xem.")
        sys.exit(1)

    print("Da di het route.")


if __name__ == "__main__":
    main()
