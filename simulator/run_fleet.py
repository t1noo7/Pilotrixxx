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


def get_vehicle_position(vehicle_id: int) -> tuple[float | None, float | None]:
    """Query vi tri thuc te hien tai cua xe tu DB - dung khi xe dang dung
    yen (khong co thread) va can biet no o dau de bat dau reposition
    dung cho, thay vi mac dinh nham ve toa do depot."""
    conn = psycopg2.connect(DATABASE_URL)
    try:
        with conn.cursor() as cur:
            cur.execute(
                "select last_latitude, last_longitude from vehicles where vehicle_id = %s",
                (vehicle_id,),
            )
            row = cur.fetchone()
    finally:
        conn.close()
    return row if row else (None, None)


def start_vehicle(car: dict):
    stop_event = threading.Event()
    target_box = {"lat": None, "lng": None}
    t = threading.Thread(
        target=run_simulation,
        kwargs={
            "device_ident": car["device"],
            "scenario": car["scenario"],
            "log_prefix": car["device"][-3:],
            "stop_event": stop_event,
            "target_box": target_box,
        },
        daemon=True,
    )
    with lock:
        running[car["device"]] = {
            "thread": t,
            "stop_event": stop_event,
            "target_box": target_box,
            "car": car,
        }
    t.start()
    print(f"[fleet] Bat dau gia lap xe {car['device']} (scenario={car['scenario']}).")


def relocate_then_release(
    device_ident: str, vehicle_id: int, target_lat: float, target_lng: float
):
    """Dua xe ve don driver tai vi tri driver chon (target_lat/lng) -
    xu ly 2 truong hop: xe dang co thread chay (dang lang thang/chay
    chang) hoac xe dang dung yen (da het chang, khong con thread nao)."""
    with lock:
        entry = running.get(device_ident)

    # Entry con ton tai nhung thread da chet tu nhien (het duration ma
    # khong ai dat xe giua chung) - don rac, coi nhu xe dang dung yen.
    # Neu khong check cai nay, code se tuong nham xe "dang chay" roi
    # join() 1 thread da chet (return ngay lap tuc, khong lam gi ca) va
    # van bao vehicle:ready du xe khong he nhuc nhich (bug "zombie entry").
    if entry is not None and not entry["thread"].is_alive():
        with lock:
            running.pop(device_ident, None)
        print(
            f"[fleet] Xe {device_ident} co entry cu nhung thread da chet tu nhien "
            f"- don rac, xu ly nhu xe dang dung yen."
        )
        entry = None

    if entry is not None:
        # Xe dang co thread song - bom target vao truoc khi bao dung,
        # de thread doc duoc target moi ngay khi kiem tra stop_event.
        entry["target_box"]["lat"] = target_lat
        entry["target_box"]["lng"] = target_lng
        entry["stop_event"].set()
        entry["thread"].join()
        with lock:
            running.pop(device_ident, None)

        print(f"[fleet] Xe {device_ident} dang tren duong toi cho driver...")
        if entry["target_box"].get("reached"):
            print(f"[fleet] Xe {device_ident} da toi noi, san sang cho driver.")
            sio.emit(
                "vehicle:ready", {"vehicleId": vehicle_id}, namespace="/fleet-control"
            )
        else:
            print(
                f"[fleet] Xe {device_ident} khong toi kip diem don (het thoi gian chuyen)."
            )
            sio.emit(
                "vehicle:failed",
                {
                    "vehicleId": vehicle_id,
                    "reason": "timeout truoc khi toi noi don driver",
                },
                namespace="/fleet-control",
            )
        return

    # Xe dang dung yen (da het chang, khong co thread) - lay vi tri thuc
    # te tu DB, goi thang toi diem driver ngay tu dau.
    cur_lat, cur_lng = get_vehicle_position(vehicle_id)
    print(
        f"[fleet] Xe {device_ident} dang dung yen tai ({cur_lat}, {cur_lng}), bat dau di don driver..."
    )
    target_box = {"lat": target_lat, "lng": target_lng}
    try:
        run_simulation(
            device_ident=device_ident,
            scenario="reposition",
            log_prefix=device_ident[-3:],
            target_box=target_box,
            start_lat=cur_lat,
            start_lng=cur_lng,
            immediate_target=True,
        )
        if target_box.get("reached"):
            print(f"[fleet] Xe {device_ident} da toi noi, san sang cho driver.")
            sio.emit(
                "vehicle:ready", {"vehicleId": vehicle_id}, namespace="/fleet-control"
            )
        else:
            print(
                f"[fleet] Xe {device_ident} khong toi kip diem don (het thoi gian chuyen)."
            )
            sio.emit(
                "vehicle:failed",
                {
                    "vehicleId": vehicle_id,
                    "reason": "timeout truoc khi toi noi don driver",
                },
                namespace="/fleet-control",
            )
    except Exception as e:
        print(f"[fleet] Loi khi dua xe {device_ident} toi cho driver: {e}")
        sio.emit(
            "vehicle:failed",
            {"vehicleId": vehicle_id, "reason": str(e)},
            namespace="/fleet-control",
        )


def register_handlers(fleet: list[dict]):
    def on_requested(data):
        vehicle_id = data["vehicleId"]
        device_ident = device_for_vehicle(vehicle_id, fleet)
        if device_ident is None:
            return
        threading.Thread(
            target=relocate_then_release,
            args=(device_ident, vehicle_id, data["pickupLat"], data["pickupLng"]),
            daemon=True,
        ).start()

    def on_returned(data):
        # KHONG tu resume gia lap nua - xe dau nguyen tai vi tri driver
        # vua tra, cho den khi co driver khac book moi di tiep.
        print(
            f"[fleet] Xe vehicle_id={data['vehicleId']} da duoc tra, dung yen cho luot sau."
        )

    sio.on("vehicle:requested", on_requested)
    sio.on("vehicle:returned", on_returned)


@sio.event
def connect():
    print("[fleet] Da ket noi toi /fleet-control.")


@sio.event
def connect_error(data):
    print(f"[fleet] Loi ket noi /fleet-control: {data}")


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
