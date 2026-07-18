"""
IoT Simulator - mo phong 1 xe chay 1 trip.

Luong (theo mqtt_payload_schema.md, Cach A):
1. POST /api/trips/start  -> nhan tripId, vehicleId
2. Loop: publish MQTT vehicles/{vehicleId}/telemetry moi 5s
3. POST /api/trips/{tripId}/end
"""

import argparse
import json
import random
import ssl
import time
from datetime import datetime, timezone

import requests
import paho.mqtt.client as mqtt

from config import (
    BACKEND_URL,
    MQTT_HOST,
    MQTT_PORT,
    MQTT_USERNAME,
    MQTT_PASSWORD,
    TELEMETRY_INTERVAL_SECONDS,
    TRIP_DURATION_MIN_SECONDS,
    TRIP_DURATION_MAX_SECONDS,
)
from route_generator import RouteState
from scenario import generate_telemetry_point, pick_speed_limit


def start_trip(device_ident: str, scenario: str) -> dict:
    """Goi POST /api/trips/start, tra ve {tripId, vehicleId, driverId}."""
    url = f"{BACKEND_URL}/api/trips/start"
    resp = requests.post(url, json={"deviceIdent": device_ident, "scenario": scenario})
    resp.raise_for_status()
    return resp.json()


def end_trip(trip_id: int):
    """Goi POST /api/trips/{tripId}/end."""
    url = f"{BACKEND_URL}/api/trips/{trip_id}/end"
    resp = requests.post(url)
    resp.raise_for_status()
    return resp.json()


def abort_trip(trip_id: int):
    """Danh dau trip la 'aborted' khi simulation loi giua chung (vd MQTT
    khong ket noi duoc) - tranh trip bi ket mai o status='ongoing', chan
    lan chay sau cua chinh xe do (409 Conflict)."""
    try:
        url = f"{BACKEND_URL}/api/trips/{trip_id}/abort"
        resp = requests.post(url)
        resp.raise_for_status()
    except Exception as e:
        print(f"[abort_trip] Khong abort duoc trip {trip_id}: {e}")


def build_mqtt_client(client_id_suffix: str) -> mqtt.Client:
    """Tao MQTT client da connect den HiveMQ Cloud (TLS)."""
    client = mqtt.Client(
        client_id=f"sim-{client_id_suffix}-{random.randint(1000, 9999)}",
        protocol=mqtt.MQTTv5,
    )
    client.username_pw_set(MQTT_USERNAME, MQTT_PASSWORD)
    client.tls_set(tls_version=ssl.PROTOCOL_TLS)
    client.connect(MQTT_HOST, MQTT_PORT)
    client.loop_start()
    return client


def run_simulation(
    device_ident: str,
    scenario: str,
    log_prefix: str = "",
    stop_event=None,
    target_box: dict | None = None,
    start_lat: float | None = None,
    start_lng: float | None = None,
    immediate_target: bool = False,
):
    prefix = log_prefix or device_ident
    if target_box is None:
        target_box = {"lat": None, "lng": None}
    # None = khong lien quan toi "di don driver"; True/False duoc set khi
    # ket thuc vong lap ben duoi, de goi ben ngoai biet xe co thuc su toi
    # noi hay chi la het gio ma van chua toi (fix bug bao "ready" gia).
    target_box.setdefault("reached", None)

    trip_info = start_trip(device_ident, scenario)
    trip_id = trip_info["tripId"]
    vehicle_id = trip_info["vehicleId"]
    print(
        f"[{prefix}] Trip started: tripId={trip_id}, vehicleId={vehicle_id}, scenario={scenario}"
    )

    try:
        mqtt_client = build_mqtt_client(prefix)
        topic = f"vehicles/{vehicle_id}/telemetry"

        route = RouteState(lat=start_lat, lng=start_lng)
        speed_limit = pick_speed_limit()
        prev_speed = random.uniform(20, 40)

        duration = random.randint(TRIP_DURATION_MIN_SECONDS, TRIP_DURATION_MAX_SECONDS)
        num_points = duration // TELEMETRY_INTERVAL_SECONDS
        print(f"[{prefix}] Trip duration: {duration}s (~{num_points} diem)")

        # Xe duoc goi di don driver ngay tu dau (khong can doi stop_event
        # giua chung) - dung cho truong hop xe dang dung yen, khong co
        # thread nao dang "lang thang" de ma ngat giua chung.
        heading_to_target = False
        if immediate_target and target_box is not None:
            print(
                f"[{prefix}] Duoc goi di don driver tai ({target_box['lat']}, {target_box['lng']})."
            )
            route.head_to_location(target_box["lat"], target_box["lng"])
            heading_to_target = True

        for i in range(num_points):
            if stop_event is not None and stop_event.is_set() and not heading_to_target:
                print(f"[{prefix}] Co driver dat xe - bat dau di don driver.")
                route.head_to_location(target_box["lat"], target_box["lng"])
                heading_to_target = True

            if (
                heading_to_target
                and route.distance_to_target_km(target_box["lat"], target_box["lng"])
                < 0.05
            ):
                print(f"[{prefix}] Da toi noi don driver.")
                target_box["reached"] = True
                break

            point = generate_telemetry_point(scenario, speed_limit, prev_speed)
            prev_speed = point["speed"]

            if i > 0 and i % 20 == 0:
                speed_limit = pick_speed_limit()

            lat, lng, heading = route.step(point["speed"])

            payload = {
                "vehicleId": vehicle_id,
                "tripId": trip_id,
                "ts": datetime.now(timezone.utc)
                .isoformat(timespec="milliseconds")
                .replace("+00:00", "Z"),
                "position": {
                    "latitude": round(lat, 6),
                    "longitude": round(lng, 6),
                    "valid": point["position_valid"],
                    "satellites": point["satellites"],
                    "speed": point["speed"],
                    "speedLimit": speed_limit,
                    "heading": round(heading, 1),
                },
                "acceleration": {
                    "x": point["accel_x"],
                    "y": point["accel_y"],
                    "z": point["accel_z"],
                },
                "brakeIntensity": point["brake_intensity"],
                "engine": {
                    "ignitionStatus": point["ignition_status"],
                    "rpm": point["engine_rpm"],
                },
                "device": {
                    "batteryLevel": point["battery_level"],
                    "gsmSignal": point["gsm_signal"],
                },
            }

            mqtt_client.publish(topic, json.dumps(payload), qos=1)
            event_note = f" event={point['event_type']}" if point["event_type"] else ""
            print(
                f"[{prefix}] [{i+1}/{num_points}] speed={point['speed']} limit={speed_limit}{event_note}"
            )
            time.sleep(TELEMETRY_INTERVAL_SECONDS)
        else:
            # for-else: chi chay khi vong lap het num_points MA KHONG break
            # -> neu dang "di don driver" thi nghia la het gio ma chua toi noi.
            if heading_to_target:
                remaining = route.distance_to_target_km(
                    target_box["lat"], target_box["lng"]
                )
                target_box["reached"] = False
                print(
                    f"[{prefix}] Het thoi gian chuyen nhung chua toi noi don driver "
                    f"(con cach {remaining:.2f}km)."
                )

        mqtt_client.loop_stop()
        mqtt_client.disconnect()
        end_trip(trip_id)
        print(f"[{prefix}] Trip {trip_id} completed.")
    except Exception as e:
        print(f"[{prefix}] Loi giua trip {trip_id}, dang abort: {e}")
        abort_trip(trip_id)
        raise


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="IoT Simulator - mo phong 1 xe")
    parser.add_argument(
        "--device", required=True, help="device_ident (IMEI gia lap) cua xe"
    )
    parser.add_argument(
        "--scenario",
        required=True,
        choices=["safe", "moderate", "dangerous"],
        help="Kich ban lai xe",
    )
    args = parser.parse_args()

    run_simulation(args.device, args.scenario)
