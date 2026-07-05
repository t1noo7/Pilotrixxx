"""
Chay nhieu Simulator dong thoi - mo phong 1 doi xe (fleet).

Moi xe chay trong 1 thread rieng, doc lap hoan toan (tripId, MQTT
client, route rieng) - the hien dung kien truc "nhieu xe dong thoi"
da neu trong mqtt_payload_schema.md.

Cach chay:
    python run_fleet.py
(can co toi thieu 3 vehicle voi device_ident tuong ung da seed trong DB
- xem backend/seed.sql)
"""

import threading

from simulator import run_simulation

# Danh sach xe + kich ban - khop voi seed.sql (3 vehicle mau)
FLEET = [
    {"device": "865413056621001", "scenario": "safe"},
    {"device": "865413056621002", "scenario": "moderate"},
    {"device": "865413056621003", "scenario": "dangerous"},
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
