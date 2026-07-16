"""
Chay nhieu Simulator dong thoi - mo phong 1 doi xe (fleet), chay lien tuc.

Lang nghe Socket.IO namespace /fleet-control tu backend (khong phai
poll DB dinh ky) de biet khi nao driver that "thue" 1 xe dang gia lap -
luc do dung thread hien tai, cho xe tu lai ve depot (trip rieng,
scenario='reposition'), roi nhuong hoan toan cho driver.

Khi driver tra xe (trip 'manual' ket thuc) - tu dong khoi lai gia lap
binh thuong cho xe do.

Cach chay:
    python run_fleet.py
"""

import threading
import time

import psycopg2
import socketio

from config import BACKEND_URL, DATABASE_URL, FLEET_CONTROL_SECRET
from simulator import run_simulation, start_trip, end_trip

SCENARIOS = ["safe", "moderate", "dangerous"]

running = {}  # device_ident -> {"thread": Thread, "stop_event": Event}
lock = threading.Lock()

sio = socketio.Client()


def get_fleet_mapping() -> list[dict]:
    """Tu dong lay danh sach xe + gan scenario xoay vong - khong hardcode,
    them xe moi vao DB la tu dong duoc gia lap, khong can sua code."""
    conn = psycopg2.connect(DATABASE_URL)
    try:
        with conn.cursor() as cur:
            cur.execute(
                "select vehicle_id, device_ident from vehicles order by vehicle_id"
            )
            rows = cur.fetchall()
    finally:
        conn.close()
    return [
        {"vehicle_id": vid, "device": device, "scenario": SCENARIOS[i % len(SCENARIOS)]}
        for i, (vid, device) in enumerate(rows)
    ]


def device_for_vehicle(vehicle_id: int, fleet: list[dict]) -> str | None:
    for car in fleet:
        if car["vehicle_id"] == vehicle_id:
            return car["device"]
    return None


def start_vehicle(car: dict):
    stop_event = threading.Event()
    t = threading.Thread(
        target=run_simulation,
        kwargs={
            "device_ident": car["device"],
            "scenario": car["scenario"],
            "log_prefix": car["device"][-3:],
            "stop_event": stop_event,
        },
        daemon=True,
    )
    with lock:
        running[car["device"]] = {"thread": t, "stop_event": stop_event, "car": car}
    t.start()
    print(f"[fleet] Bat dau gia lap xe {car['device']} (scenario={car['scenario']}).")


def relocate_then_release(device_ident: str, vehicle_id: int):
    """Cho thread gia lap hien tai dung han (join), roi tu lai xe ve depot
    nhu 1 trip rieng ('reposition') truoc khi thuc su nhuong quyen."""
    with lock:
        entry = running.get(device_ident)
    if entry is None:
        pass
    else:
        entry["stop_event"].set()
        entry["thread"].join()
        with lock:
            running.pop(device_ident, None)

    print(f"[fleet] Xe {device_ident} dang tu lai ve depot...")
    try:
        run_simulation(
            device_ident=device_ident,
            scenario="reposition",
            log_prefix=device_ident[-3:],
        )
        print(f"[fleet] Xe {device_ident} da ve depot, san sang cho driver.")
        sio.emit("vehicle:ready", {"vehicleId": vehicle_id}, namespace="/fleet-control")
    except Exception as e:
        print(f"[fleet] Loi khi dua xe {device_ident} ve depot: {e}")
        sio.emit(
            "vehicle:failed",
            {"vehicleId": vehicle_id, "reason": str(e)},
            namespace="/fleet-control",
        )


def resume_vehicle(vehicle_id: int, fleet: list[dict]):
    device_ident = device_for_vehicle(vehicle_id, fleet)
    if device_ident is None:
        print(
            f"[fleet] Canh bao: khong tim thay device_ident cho vehicle_id={vehicle_id}"
        )
        return
    car = next(c for c in fleet if c["device"] == device_ident)
    start_vehicle(car)


@sio.event
def connect():
    print("[fleet] Da ket noi toi /fleet-control.")


@sio.event
def connect_error(data):
    print(f"[fleet] Loi ket noi /fleet-control: {data}")


def register_handlers(fleet: list[dict]):
    def on_requested(data):
        vehicle_id = data["vehicleId"]
        device_ident = device_for_vehicle(vehicle_id, fleet)
        if device_ident is None:
            return
        threading.Thread(
            target=relocate_then_release, args=(device_ident, vehicle_id), daemon=True
        ).start()

    def on_returned(data):
        resume_vehicle(data["vehicleId"], fleet)

    sio.on("vehicle:requested", on_requested)
    sio.on("vehicle:returned", on_returned)


def main():
    fleet = get_fleet_mapping()

    socket_url = BACKEND_URL.replace("http://", "ws://").replace("https://", "wss://")
    # python-socketio tu convert lai giao thuc that su, truyen http(s) binh
    # thuong cung duoc - giu nguyen BACKEND_URL cho don gian:
    register_handlers(fleet)
    sio.connect(
        BACKEND_URL,
        namespaces=["/fleet-control"],
        auth={"secret": FLEET_CONTROL_SECRET},
    )

    for i, car in enumerate(fleet):
        if i > 0:
            time.sleep(2.5)
        start_vehicle(car)

    print("[fleet] Fleet dang chay lien tuc. Nhan Ctrl+C de dung.")
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\n[fleet] Da dung fleet (Ctrl+C).")
        sio.disconnect()


if __name__ == "__main__":
    main()
