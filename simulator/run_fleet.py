"""
Chay nhieu Simulator dong thoi - mo phong 1 doi xe (fleet).

Moi xe chay trong 1 thread rieng, doc lap hoan toan (tripId, MQTT
client, route rieng) - the hien dung kien truc "nhieu xe dong thoi"
da neu trong mqtt_payload_schema.md.

Cach chay:
    python run_fleet.py
(can co du 7 vehicle voi device_ident tuong ung da seed trong DB - xem
migration sql/003_add_4_more_vehicles.sql)
"""

import threading

from simulator import run_simulation

# Danh sach xe + kich ban - khop voi migration 003_add_4_more_vehicles.sql
# (7 xe: 3 xe goc + 4 xe them de hien du 7 loai icon tren FleetMap)
FLEET = [
    {"device": "865413056621001", "scenario": "safe"},       # sedan
    {"device": "865413056621002", "scenario": "moderate"},   # xe tai
    {"device": "865413056621003", "scenario": "dangerous"},  # xe dua
    {"device": "865413056621004", "scenario": "safe"},       # limousine
    {"device": "865413056621005", "scenario": "moderate"},   # xe buyt
    {"device": "865413056621006", "scenario": "dangerous"},  # xe cong nong
    {"device": "865413056621007", "scenario": "moderate"},   # xe vit vang
]


def main():
    threads = []
    for car in FLEET:
        t = threading.Thread(
            target=run_simulation,
            kwargs={
                "device_ident": car["device"],
                "scenario": car["scenario"],
                "log_prefix": car["device"][-3:],  # 3 so cuoi IMEI cho gon
            },
            daemon=True,
        )
        threads.append(t)
        t.start()

    for t in threads:
        t.join()

    print("\nTat ca xe trong fleet da hoan thanh trip.")


if __name__ == "__main__":
    main()
