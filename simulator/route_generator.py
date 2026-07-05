"""
Sinh tuyen duong GPS gia lap bang "directed random walk":
- Xe di theo 1 huong (heading), huong thay doi dan moi buoc
  (khong re dot ngot 180 do)
- Khoang cach di duoc moi buoc tinh tu speed va khoang thoi gian
  (TELEMETRY_INTERVAL_SECONDS)

=> phuong phap don gian, ko goi API ban do thuc (Google Maps/OSRM)
- du de tao duong di "tu nhien" tren Leaflet ma khong can quota/API key.
"""

import math
import random

from config import (
    START_LATITUDE,
    START_LONGITUDE,
    MAX_HEADING_CHANGE_PER_STEP,
    TELEMETRY_INTERVAL_SECONDS,
)

EARTH_RADIUS_KM = 6371.0


class RouteState:
    """Luu trang thai vi tri/huong hien tai cua 1 trip."""

    def __init__(self, lat=None, lng=None, heading=None):
        self.lat = lat if lat is not None else START_LATITUDE
        self.lng = lng if lng is not None else START_LONGITUDE
        # Huong ban dau ngau nhien (0-360 do)
        self.heading = heading if heading is not None else random.uniform(0, 360)

    def step(self, speed_kmh: float):
        """
        Di chuyen 1 buoc dua tren toc do hien tai (km/h).
        Cap nhat self.lat, self.lng, self.heading.
        Tra ve (lat, lng, heading) moi.
        """
        # 1. Cap nhat huong - dao dong nho, khong re dot ngot
        delta_heading = random.uniform(
            -MAX_HEADING_CHANGE_PER_STEP, MAX_HEADING_CHANGE_PER_STEP
        )
        self.heading = (self.heading + delta_heading) % 360

        # 2. Tinh khoang cach di duoc trong khoang thoi gian nay (km)
        distance_km = speed_kmh * (TELEMETRY_INTERVAL_SECONDS / 3600.0)

        # 3. Tinh do dich chuyen lat/lng tu khoang cach + huong
        #    (xap xi phang - du chinh xac cho pham vi nho trong 1 trip)
        heading_rad = math.radians(self.heading)

        delta_lat = (distance_km / EARTH_RADIUS_KM) * math.cos(heading_rad)
        delta_lng = (
            (distance_km / EARTH_RADIUS_KM)
            * math.sin(heading_rad)
            / math.cos(math.radians(self.lat))
        )

        self.lat += math.degrees(delta_lat)
        self.lng += math.degrees(delta_lng)

        return self.lat, self.lng, self.heading
