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
from datetime import datetime, timezone

SCENARIOS = ["safe", "moderate", "dangerous"]

# PHAI KHOP CHINH XAC voi PICKUP_WAIT_TIMEOUT_MINUTES trong
# backend/src/routes/driverTrips.js - dung chung 1 nguong, KHONG tu dat
# nguong rieng ben Python. Dong bo tay - doi 1 ben nho doi ca 2.
PICKUP_WAIT_TIMEOUT_MINUTES = 10

# Luu ban sao 'fleet' de reconcile_aborted_repositions() truy cap duoc -
# connect()/connect_error() la @sio.event dinh nghia O NGOAI register_handlers()
# nen khong "thay" duoc bien fleet local trong main() qua closure.
fleet_cache: list[dict] = []
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


def get_active_manual_trips() -> list[dict]:
    """Trip 'manual' dang pending/ongoing tu TRUOC khi run_fleet.py restart -
    lay DU THONG TIN (khac ham cu chi tra vehicle_id) de main() phan biet
    dung 3 truong hop: (1) da qua han - KHONG tu abort o day, de backend tu
    lam o lan GET /trips/current tiep theo tu mobile (giu dung 1 nguon su
    that duy nhat cho quyet dinh "qua han"), (2) da toi diem don, dang cho
    driver bam 'Bat dau chuyen' - khong can lam gi, (3) dang tren duong,
    chua qua han - resume bang cach goi lai relocate_then_release() y het
    luc nhan 'vehicle:requested' binh thuong (tai dung toan bo logic tinh
    ETA/budget da co san, khong viet lai gi moi)."""
    pool = _get_pool()
    conn = pool.getconn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """select trip_id, vehicle_id, created_at, vehicle_ready_at,
                          pickup_latitude, pickup_longitude, pickup_deadline_at
                   from trips
                   where status in ('pending', 'ongoing') and scenario = 'manual'"""
            )
            cols = [
                "trip_id",
                "vehicle_id",
                "created_at",
                "vehicle_ready_at",
                "pickup_latitude",
                "pickup_longitude",
                "pickup_deadline_at",
            ]
            return [dict(zip(cols, row)) for row in cur.fetchall()]
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
    device_ident: str,
    vehicle_id: int,
    target_lat: float,
    target_lng: float,
    manual_trip_id: int | None = None,
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
            manual_trip_id=manual_trip_id,
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
            kwargs={"manual_trip_id": int(data["tripId"])},
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


def reconcile_aborted_repositions():
    """Chay DUNG 1 LAN moi khi (re)ket noi toi /fleet-control - va lo hong
    cua pattern 'fire-and-forget'. CHI xet trip vua bi abort GAN DAY (trong
    RECONCILE_WINDOW_MINUTES phut) - KHONG duoc bo qua dieu kien nay, neu
    khong se khop nham voi trip reposition cu tu rat lau, gay stop_event bi
    set() SAI cho 1 thread patrol moi hoan toan khong lien quan (bug thuc te
    da gap: xe dang patrol binh thuong bi tuong nham la "vua bi huy giua
    chung", goi head_to_location(None, None) -> crash).

    Ngoai gioi han thoi gian, con check them target_box["lat"] khac None -
    day la tin hieu DUY NHAT phan biet "thread dang thuc su reposition" voi
    "thread patrol binh thuong": target_box chi duoc gan toa do that trong
    relocate_then_release() khi CO redirect that xay ra."""
    time.sleep(1)

    with lock:
        candidate_vehicle_ids = set(active_repositions.keys())
        candidate_vehicle_ids |= {
            entry["car"]["vehicle_id"]
            for entry in running.values()
            if entry["target_box"].get("lat") is not None
        }

    if not candidate_vehicle_ids:
        return

    pool = _get_pool()
    conn = pool.getconn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """select vehicle_id from trips
                   where scenario = 'reposition' and status = 'aborted'
                   and ended_at > now() - interval '15 minutes'
                   and vehicle_id = any(%s)""",
                (list(candidate_vehicle_ids),),
            )
            aborted_vehicle_ids = {row[0] for row in cur.fetchall()}
    finally:
        pool.putconn(conn)

    if not aborted_vehicle_ids:
        return

    print(
        f"[fleet] Reconcile sau reconnect: phat hien {len(aborted_vehicle_ids)} "
        f"xe co reposition da bi abort trong DB nhung van dang chay (nghi ngo lo "
        f"su kien 'vehicle:returned' luc mat mang) - tu dung: {aborted_vehicle_ids}"
    )
    for vehicle_id in aborted_vehicle_ids:
        with lock:
            immediate_stop_event = active_repositions.get(vehicle_id)
        if immediate_stop_event is not None:
            immediate_stop_event.set()

        device_ident = device_for_vehicle(vehicle_id, fleet_cache)
        if device_ident is not None:
            with lock:
                entry = running.get(device_ident)
            if entry is not None and entry["target_box"].get("lat") is not None:
                entry["stop_event"].set()


@sio.event(namespace="/fleet-control")
def connect():
    print("[fleet] Da ket noi toi /fleet-control.")
    # Chay o thread rieng - khong chan handshake cua sio, va cung khong
    # can chan (blocking) vong lap chinh cua fleet.
    threading.Thread(target=reconcile_aborted_repositions, daemon=True).start()


@sio.event(namespace="/fleet-control")
def connect_error(data):
    print(f"[fleet] Loi ket noi /fleet-control: {data}")


def main():
    init_db_pool()
    cleanup_orphaned_trips()
    fleet = get_fleet_mapping()
    global fleet_cache
    fleet_cache = fleet

    active_manual_trips = get_active_manual_trips()
    busy_vehicle_ids = {t["vehicle_id"] for t in active_manual_trips}
    if busy_vehicle_ids:
        print(
            f"[fleet] {len(busy_vehicle_ids)} xe dang co trip manual pending/ongoing "
            f"tu truoc khi restart - KHONG patrol cho cac xe nay: {busy_vehicle_ids}"
        )

    register_handlers(fleet)

    sio.connect(
        BACKEND_URL,
        namespaces=["/fleet-control"],
        auth={"secret": FLEET_CONTROL_SECRET},
    )

    # Phan loai + resume cho tung xe dang co trip manual do - PHAI sau khi
    # sio.connect() xong, vi relocate_then_release() emit vehicle:ready/
    # vehicle:failed qua sio khi hoan tat.
    now = datetime.now(timezone.utc)
    resumed_count = 0
    for trip in active_manual_trips:
        device_ident = device_for_vehicle(trip["vehicle_id"], fleet)
        if device_ident is None:
            continue

        # Case 2: da toi diem don, dang cho driver bam nut - hoac Case 1b:
        # da toi noi nhung cho qua lau (qua PICKUP_WAIT_TIMEOUT_MINUTES).
        if trip["vehicle_ready_at"] is not None:
            wait_minutes = (now - trip["vehicle_ready_at"]).total_seconds() / 60
            if wait_minutes > PICKUP_WAIT_TIMEOUT_MINUTES:
                print(
                    f"[fleet] Xe {device_ident}: trip manual #{trip['trip_id']} da toi "
                    f"noi qua {PICKUP_WAIT_TIMEOUT_MINUTES} phut - da qua han, de backend "
                    f"tu abort o lan GET /trips/current tiep theo, khong resume."
                )
            else:
                print(
                    f"[fleet] Xe {device_ident}: da toi diem don (trip manual "
                    f"#{trip['trip_id']}), dang cho driver bam 'Bat dau chuyen' - "
                    f"khong can resume."
                )
            continue

        # Case 1a: da qua han THEO DUNG pickup_deadline_at (tinh dong theo
        # ETA that tu OSRM, luu boi report_pickup_eta() o lan tinh truoc) -
        # KHONG dung nguong co dinh nua (ly do doi sang timeout dong: xe
        # cach xa vai chuc km can ETA hop ly hon con so 10 phut cung nhac).
        # pickup_deadline_at = None nghia la LAN TRUOC chua kip bao ETA ve
        # (vd Python crash giua chung truoc khi tinh xong OSRM) - trong
        # truong hop nay KHONG the ket luan da qua han, nen cu resume binh
        # thuong (Case 3), ETA that se duoc tinh lai + bao ve ngay trong
        # lan resume nay.
        if trip["pickup_deadline_at"] is not None and now > trip["pickup_deadline_at"]:
            print(
                f"[fleet] Xe {device_ident}: trip manual #{trip['trip_id']} da qua "
                f"pickup_deadline_at ({trip['pickup_deadline_at']}) - da qua han, de "
                f"backend tu abort o lan GET /trips/current tiep theo, khong resume."
            )
            continue

        if trip["pickup_latitude"] is None or trip["pickup_longitude"] is None:
            print(
                f"[fleet] Xe {device_ident}: trip manual #{trip['trip_id']} thieu toa "
                f"do don - khong the resume, bo qua."
            )
            continue

        # Case 3: dang tren duong, chua qua han - resume that su.
        print(
            f"[fleet] Xe {device_ident}: dang resume reposition toi diem don cho trip "
            f"manual #{trip['trip_id']} (bi ngat quang do run_fleet.py vua restart)."
        )
        threading.Thread(
            target=relocate_then_release,
            args=(
                device_ident,
                trip["vehicle_id"],
                trip["pickup_latitude"],
                trip["pickup_longitude"],
            ),
            kwargs={"manual_trip_id": trip["trip_id"]},
            daemon=True,
        ).start()
        resumed_count += 1

    if resumed_count > 0:
        # Cho cac thread resume kip lay _db_pool connection truoc khi vong
        # lap patrol ben duoi bat dau tranh chap connection dot ngot.
        time.sleep(1)

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
