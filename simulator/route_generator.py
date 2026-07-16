"""
Sinh tuyen duong GPS bam theo duong that, dung OSRM demo server
(router.project-osrm.org - free, khong can API key, du lieu OpenStreetMap).

Cach hoat dong:
1. Tu vi tri hien tai, chon 1 "diem den" ngau nhien cach do vai km theo
   huong bat ky (chi la toa do tho - khong can nam tren duong).
2. Goi OSRM /route de lay tuyen duong THAT (polyline + tong quang duong)
   ma OSRM tinh tu vi tri hien tai den diem do (OSRM tu "snap" toa do
   tho ve duong gan nhat).
3. Xe di doc theo polyline nay, khoang cach di duoc moi buoc tinh tu
   speed va khoang thoi gian (giong logic cu).
4. Khi di het polyline (het 1 "chang") -> tu dong xin tuyen moi tiep tuc
   tu vi tri hien tai, lien tuc cho den het thoi luong trip.

Neu OSRM loi/khong ket noi duoc (mang, rate limit...) -> fallback ve
directed random walk (logic cu) de simulator khong bi crash.
"""

import math
import random

import requests

from config import (
    START_LATITUDE,
    START_LONGITUDE,
    MAX_HEADING_CHANGE_PER_STEP,
    TELEMETRY_INTERVAL_SECONDS,
)

EARTH_RADIUS_KM = 6371.0
OSRM_BASE_URL = "http://router.project-osrm.org/route/v1/driving"
OSRM_TIMEOUT_SECONDS = 5

# Quang duong moi "chang" (leg) - random trong khoang nay (km).
# Chang ngan -> xin tuyen moi thuong xuyen hon nhung linh hoat hon.
LEG_DISTANCE_MIN_KM = 2.0
LEG_DISTANCE_MAX_KM = 5.0


def _haversine_km(lat1, lng1, lat2, lng2):
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lng2 - lng1)
    a = (
        math.sin(dphi / 2) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    )
    return 2 * EARTH_RADIUS_KM * math.asin(math.sqrt(a))


def _bearing_deg(lat1, lng1, lat2, lng2):
    """Huong (0-360 do, 0 = Bac) tu diem 1 den diem 2."""
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dlambda = math.radians(lng2 - lng1)
    y = math.sin(dlambda) * math.cos(phi2)
    x = math.cos(phi1) * math.sin(phi2) - math.sin(phi1) * math.cos(phi2) * math.cos(
        dlambda
    )
    return (math.degrees(math.atan2(y, x)) + 360) % 360


def _destination_point(lat, lng, distance_km, bearing_deg):
    """Tinh toa do 1 diem cach (lat,lng) mot khoang distance_km theo bearing_deg."""
    bearing_rad = math.radians(bearing_deg)
    lat1 = math.radians(lat)
    lng1 = math.radians(lng)
    ang_dist = distance_km / EARTH_RADIUS_KM

    lat2 = math.asin(
        math.sin(lat1) * math.cos(ang_dist)
        + math.cos(lat1) * math.sin(ang_dist) * math.cos(bearing_rad)
    )
    lng2 = lng1 + math.atan2(
        math.sin(bearing_rad) * math.sin(ang_dist) * math.cos(lat1),
        math.cos(ang_dist) - math.sin(lat1) * math.sin(lat2),
    )
    return math.degrees(lat2), math.degrees(lng2)


def _fetch_osrm_route(start_lat, start_lng, end_lat, end_lng):
    """
    Goi OSRM, tra ve list [(lat, lng), ...] doc theo duong that,
    hoac None neu loi (mang, timeout, khong tim duoc duong...).
    """
    url = f"{OSRM_BASE_URL}/{start_lng},{start_lat};{end_lng},{end_lat}"
    params = {"overview": "full", "geometries": "geojson"}
    try:
        resp = requests.get(url, params=params, timeout=OSRM_TIMEOUT_SECONDS)
        resp.raise_for_status()
        data = resp.json()
        if data.get("code") != "Ok" or not data.get("routes"):
            return None
        # GeoJSON tra ve [lng, lat] - dao lai thanh (lat, lng) cho de dung
        coords = [
            (lat, lng) for lng, lat in data["routes"][0]["geometry"]["coordinates"]
        ]
        return coords
    except (requests.RequestException, ValueError, KeyError, IndexError):
        return None


class RouteState:
    """Luu trang thai vi tri/huong hien tai cua 1 trip, di doc theo duong that."""

    def __init__(self, lat=None, lng=None, heading=None):
        self.lat = lat if lat is not None else START_LATITUDE
        self.lng = lng if lng is not None else START_LONGITUDE
        self.heading = heading if heading is not None else random.uniform(0, 360)

        # Danh sach diem polyline cua "chang" hien tai + khoang cach luy ke (km)
        self._coords = []
        self._cum_dist_km = []
        self._dist_into_leg_km = 0.0

        self._start_new_leg()

    def _start_new_leg(self):
        """Xin OSRM 1 tuyen duong moi tu vi tri hien tai den 1 diem ngau nhien gan do."""
        leg_distance = random.uniform(LEG_DISTANCE_MIN_KM, LEG_DISTANCE_MAX_KM)
        bearing = random.uniform(0, 360)
        dest_lat, dest_lng = _destination_point(
            self.lat, self.lng, leg_distance, bearing
        )

        coords = _fetch_osrm_route(self.lat, self.lng, dest_lat, dest_lng)

        if coords is None or len(coords) < 2:
            # OSRM loi -> fallback: dung diem dich lam 1 "duong thang" tam,
            # de xe van di tiep duoc thay vi dung hinh/crash.
            coords = [(self.lat, self.lng), (dest_lat, dest_lng)]

        # OSRM co the tra ve diem dau hoi lech so voi vi tri hien tai
        # (do snap-to-road) - chen lai diem hien tai cho lien mach, tranh
        # xe bi "nhay" 1 doan ngan luc chuyen chang.
        coords[0] = (self.lat, self.lng)

        cum_dist = [0.0]
        for i in range(1, len(coords)):
            d = _haversine_km(*coords[i - 1], *coords[i])
            cum_dist.append(cum_dist[-1] + d)

        self._coords = coords
        self._cum_dist_km = cum_dist
        self._dist_into_leg_km = 0.0

    def _position_at(self, dist_km):
        """
        Noi suy vi tri (lat, lng, heading) tai khoang cach dist_km doc theo
        polyline cua chang hien tai.
        """
        total = self._cum_dist_km[-1]
        if dist_km >= total:
            dist_km = (
                total  # het chang - dung o diem cuoi, se xin chang moi o step() sau
            )

        # Tim doan [i-1, i] chua dist_km
        i = 1
        while i < len(self._cum_dist_km) and self._cum_dist_km[i] < dist_km:
            i += 1
        i = min(i, len(self._coords) - 1)

        seg_start_dist = self._cum_dist_km[i - 1]
        seg_end_dist = self._cum_dist_km[i]
        seg_len = seg_end_dist - seg_start_dist

        lat1, lng1 = self._coords[i - 1]
        lat2, lng2 = self._coords[i]

        if seg_len <= 1e-9:
            ratio = 0.0
        else:
            ratio = (dist_km - seg_start_dist) / seg_len

        lat = lat1 + (lat2 - lat1) * ratio
        lng = lng1 + (lng2 - lng1) * ratio
        heading = _bearing_deg(lat1, lng1, lat2, lng2)

        return lat, lng, heading

    def step(self, speed_kmh: float):
        """
        Di chuyen 1 buoc dua tren toc do hien tai (km/h), bam theo duong
        that cua chang hien tai. Tu dong xin chang moi khi di het duong.
        Tra ve (lat, lng, heading) moi.
        """
        distance_km = speed_kmh * (TELEMETRY_INTERVAL_SECONDS / 3600.0)
        self._dist_into_leg_km += distance_km

        # Het chang hien tai -> xin chang moi, tiep tuc tu vi tri cuoi
        if self._dist_into_leg_km >= self._cum_dist_km[-1]:
            leftover = self._dist_into_leg_km - self._cum_dist_km[-1]
            self.lat, self.lng, self.heading = self._position_at(self._cum_dist_km[-1])
            self._start_new_leg()
            self._dist_into_leg_km = leftover  # giu lai phan quang duong du ra

        self.lat, self.lng, self.heading = self._position_at(self._dist_into_leg_km)
        return self.lat, self.lng, self.heading

    def head_to_depot(self):
        """Ep chang tiep theo di thang ve depot (START_LATITUDE/LONGITUDE)
        thay vi chon huong ngau nhien - dung khi xe can 've gara' truoc
        khi nhuong quyen cho driver that thue xe."""
        coords = _fetch_osrm_route(self.lat, self.lng, START_LATITUDE, START_LONGITUDE)
        if coords is None or len(coords) < 2:
            coords = [(self.lat, self.lng), (START_LATITUDE, START_LONGITUDE)]
        coords[0] = (self.lat, self.lng)

        cum_dist = [0.0]
        for i in range(1, len(coords)):
            d = _haversine_km(*coords[i - 1], *coords[i])
            cum_dist.append(cum_dist[-1] + d)

        self._coords = coords
        self._cum_dist_km = cum_dist
        self._dist_into_leg_km = 0.0

    def distance_to_depot_km(self) -> float:
        """Khoang cach con lai (km) toi depot - dung de biet khi nao xe
        da 've gara' xong."""
        return _haversine_km(self.lat, self.lng, START_LATITUDE, START_LONGITUDE)
