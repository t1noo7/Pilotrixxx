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
from psycopg2 import pool as pg_pool
import socketio

from config import BACKEND_URL, DATABASE_URL, FLEET_CONTROL_SECRET
from simulator import run_simulation, start_trip, end_trip, abort_trip

SCENARIOS = ["safe", "moderate", "dangerous"]

running = {}  # device_ident -> {"thread": Thread, "stop_event": Event}
# vehicle_id -> Event - RIENG cho nhanh "xe dang dung yen, di don ngay"
# (immediate_target=True trong relocate_then_release). Nhanh nay TRUOC DAY
# khong tao stop_event nao ca (goi run_simulation() truc tiep, khong dang
# ky vao dau) - nen khong co cach nao huy giua chung. Dict nay la noi
# DUY NHAT giu tham chieu toi stop_event cua no, de on_returned() co the
# tim va set() khi driver huy chuyen.
active_repositions = {}
lock = threading.Lock()

sio = socketio.Client(request_timeout=30)

# Pool connection nho, dung chung cho ca chuong trinh - thay vi
# psycopg2.connect() moi lan goi get_fleet_mapping()/get_vehicle_position()
# (moi truoc day mo-dong lien tuc, cong don voi connection backend Render +
# cac nguon khac de cham nguong Connection pool size cua Supavisor).
# Dung ThreadedConnectionPool (khong phai 1 connection don) vi
# get_vehicle_position() duoc goi tu ben trong relocate_then_release(),
# ham nay chay tren thread rieng cho MOI lan co xe duoc yeu cau - neu 2 xe
# duoc yeu cau gan nhu cung luc, 2 thread se can 2 connection khac nhau
# (1 connection tho dung chung giua nhieu thread khong an toan khi query
# dong thoi ma khong co lock).
_db_pool: "pg_pool.ThreadedConnectionPool | None" = None


def init_db_pool():
    global _db_pool
    _db_pool = pg_pool.ThreadedConnectionPool(2, 8, DATABASE_URL)
    print("[fleet] Da khoi tao DB connection pool (2-8 connections, dung chung).")


def close_db_pool():
    global _db_pool
    if _db_pool is not None:
        _db_pool.closeall()
        _db_pool = None
        print("[fleet] Da dong DB connection pool.")


def _get_pool() -> pg_pool.ThreadedConnectionPool:
    """Getter co check ro rang thay vi dung thang bien _db_pool - vua de
    type checker (Pylance) khong con canh bao "co the la None", vua bao
    loi de hieu ngay neu lo goi get_fleet_mapping()/get_vehicle_position()
    truoc khi init_db_pool() chay (thay vi AttributeError kho doan)."""
    if _db_pool is None:
        raise RuntimeError(
            "DB pool chua duoc khoi tao - phai goi init_db_pool() truoc "
            "(binh thuong da goi dau main(), kiem tra lai neu thay loi nay)."
        )
    return _db_pool


def cleanup_orphaned_trips():
    """Luc run_fleet.py vua khoi dong (hoac restart sau khi bi Ctrl+C/crash
    giua chung) - BAT KY trip nao dang 'ongoing' voi scenario KHAC 'manual'
    chac chan la rac tu lan chay truoc, vi CHI co run_fleet.py tao trip
    scenario=safe/moderate/dangerous/reposition (xem tripsRouter.post(
    '/start') ben backend) - khong co nguon nao khac. An toan tuyet doi de
    tu dong abort het, KHONG dung toi trip 'manual' cua driver that.

    Neu khong dọn, POST /trips/start cho xe do se bi 409 Conflict (server
    thay van con 1 trip 'ongoing' cu) - start_trip() raise ngay (loi 4xx
    khong retry), lam CHET HAN thread simulation ngay tu dau, xe khong
    con bao gio patrol lai duoc nua tu lan restart do tro di."""
    pool = _get_pool()
    conn = pool.getconn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "select trip_id from trips where status = 'ongoing' and scenario != 'manual'"
            )
            orphaned_ids = [row[0] for row in cur.fetchall()]
    finally:
        pool.putconn(conn)

    if not orphaned_ids:
        return

    print(
        f"[fleet] Phat hien {len(orphaned_ids)} trip 'ongoing' mo coi tu lan "
        f"chay truoc (scenario != 'manual') - tu dong abort truoc khi patrol lai."
    )
    for trip_id in orphaned_ids:
        abort_trip(trip_id)  # tu co try/except rieng, khong bao gio raise


def get_fleet_mapping() -> list[dict]:
    """Tu dong lay danh sach xe + gan scenario xoay vong - khong hardcode,
    them xe moi vao DB la tu dong duoc gia lap, khong can sua code."""
    pool = _get_pool()
    conn = pool.getconn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "select vehicle_id, device_ident from vehicles order by vehicle_id"
            )
            rows = cur.fetchall()
    finally:
        pool.putconn(conn)
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
    pool = _get_pool()
    conn = pool.getconn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "select last_latitude, last_longitude from vehicles where vehicle_id = %s",
                (vehicle_id,),
            )
            row = cur.fetchone()
    finally:
        pool.putconn(conn)
    return row if row else (None, None)


def get_vehicles_with_active_manual_trip() -> set[int]:
    """Vehicle_id nao dang co trip 'manual' o trang thai pending/ongoing tu
    TRUOC khi run_fleet.py restart - TUYET DOI khong duoc spawn patrol cho
    xe nay luc khoi dong. Neu khong se tao ra 2 "chuyen" song song cho cung
    1 xe vat ly: 1 ben la trip manual dang cho driver (dung yen/hoac driver
    dang tu lai), 1 ben la patrol moi tu sinh chay lung tung - patrol nay
    de telemetry len lam sai lech vi tri hien thi cho driver (bug da gap:
    xe "tu di" tren map cho waiting.tsx)."""
    pool = _get_pool()
    conn = pool.getconn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "select vehicle_id from trips where status in ('pending','ongoing') and scenario = 'manual'"
            )
            return {row[0] for row in cur.fetchall()}
    finally:
        pool.putconn(conn)


def start_vehicle(car: dict):
    cur_lat, cur_lng = get_vehicle_position(car["vehicle_id"])
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
            "start_lat": cur_lat,
            "start_lng": cur_lng,
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

    # Tao stop_event RIENG cho lan reposition nay - truoc day khong co gi
    # ca nen khong the huy giua chung (xem comment o dinh file). Dang ky
    # vao active_repositions de on_returned() tim duoc khi driver huy.
    reposition_stop_event = threading.Event()
    with lock:
        active_repositions[vehicle_id] = reposition_stop_event

    try:
        run_simulation(
            device_ident=device_ident,
            scenario="reposition",
            log_prefix=device_ident[-3:],
            stop_event=reposition_stop_event,
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
        elif reposition_stop_event.is_set():
            # Bi huy giua chung (khac voi truong hop het gio tu nhien) -
            # khong emit vehicle:ready/vehicle:failed gi ca, vi day la ket
            # qua CHU DICH tu driver, khong phai loi can bao.
            print(f"[fleet] Xe {device_ident} da dung reposition vi driver huy chuyen.")
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
    finally:
        # Don dep bat ke thanh cong/loi/bi huy - tranh entry cu treo lai
        # tro toi stop_event da "xai xong", gay nham lan cho lan sau.
        with lock:
            if active_repositions.get(vehicle_id) is reposition_stop_event:
                active_repositions.pop(vehicle_id, None)


def register_handlers(fleet: list[dict]):
    def on_requested(data):
        vehicle_id = int(data["vehicleId"])
        device_ident = device_for_vehicle(vehicle_id, fleet)
        if device_ident is None:
            return
        threading.Thread(
            target=relocate_then_release,
            args=(device_ident, vehicle_id, data["pickupLat"], data["pickupLng"]),
            daemon=True,
        ).start()

    def on_returned(data):
        vehicle_id = int(data["vehicleId"])
        device_ident = device_for_vehicle(vehicle_id, fleet)

        stopped_something = False

        # Truong hop 1: xe dang o giua chung "dung yen -> di don ngay"
        # (immediate_target=True, dang ky trong active_repositions).
        with lock:
            immediate_stop_event = active_repositions.get(vehicle_id)
        if immediate_stop_event is not None:
            immediate_stop_event.set()
            stopped_something = True

        # Truong hop 2: xe dang patrol thi bi dieu huong di don - entry
        # VAN CON trong running (relocate_then_release dang block o
        # .join(), chua kip pop) trong SUOT thoi gian xe dang di - nen
        # tra cuu duoc binh thuong qua running[device_ident].
        if device_ident is not None:
            with lock:
                entry = running.get(device_ident)
            if entry is not None:
                entry["stop_event"].set()
                stopped_something = True

        if stopped_something:
            print(
                f"[fleet] Da gui tin hieu HUY reposition cho vehicle_id={vehicle_id}."
            )
        else:
            print(
                f"[fleet] vehicle_id={vehicle_id} da duoc tra, dung yen cho luot sau "
                f"(khong co reposition nao dang chay de huy)."
            )

    sio.on("vehicle:requested", on_requested, namespace="/fleet-control")
    sio.on("vehicle:returned", on_returned, namespace="/fleet-control")


@sio.event(namespace="/fleet-control")
def connect():
    print("[fleet] Da ket noi toi /fleet-control.")


@sio.event(namespace="/fleet-control")
def connect_error(data):
    print(f"[fleet] Loi ket noi /fleet-control: {data}")


def main():
    init_db_pool()
    cleanup_orphaned_trips()
    fleet = get_fleet_mapping()

    busy_vehicle_ids = get_vehicles_with_active_manual_trip()
    if busy_vehicle_ids:
        print(
            f"[fleet] {len(busy_vehicle_ids)} xe dang co trip manual pending/ongoing "
            f"tu truoc khi restart - KHONG patrol cho cac xe nay: {busy_vehicle_ids}"
        )

    socket_url = BACKEND_URL.replace("http://", "ws://").replace("https://", "wss://")
    register_handlers(fleet)

    sio.connect(
        BACKEND_URL,
        namespaces=["/fleet-control"],
        auth={"secret": FLEET_CONTROL_SECRET},
    )

    started_count = 0
    for car in fleet:
        if car["vehicle_id"] in busy_vehicle_ids:
            continue
        if started_count > 0:
            time.sleep(2.5)
        start_vehicle(car)
        started_count += 1

    print("[fleet] Fleet dang chay lien tuc. Nhan Ctrl+C de dung.")
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\n[fleet] Da dung fleet (Ctrl+C).")
        sio.disconnect()
        close_db_pool()


if __name__ == "__main__":
    main()
