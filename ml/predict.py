"""
PREDICT.PY - Tinh risk score cho 1 trip da hoan thanh

Usage: python ml/predict.py <tripId>

Flow:
  1. Doc trip_summary tu PostgreSQL (Supabase Transaction Pooler)
  2. Load LR + RF model tu ml/models/
  3. Predict risk_level + risk_score (0.0-1.0) cho ca 2 model
  4. UPSERT vao bang risk_scores
  5. Print JSON ket qua ra stdout (Backend doc qua child_process)

Exit codes:
  0 - thanh cong
  1 - loi nghiep vu (trip khong ton tai, chua co trip_summary...)
  2 - loi ket noi DB / load model

NOTE ve risk_score:
  Dung weighted probability: 0.0*P(safe) + 0.5*P(moderate) + 1.0*P(dangerous)
  Y nghia: 0.0 = chac chan safe, ~0.5 = moderate, 1.0 = chac chan dangerous.
  Truc quan hon cho Dashboard so voi chi dung P(dangerous) don thuan.
"""

import json
import os
import pickle
import sys

import numpy as np
import pandas as pd

# ---------------------------------------------------------------------------
# 0. Duong dan
# ---------------------------------------------------------------------------
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
MODELS_DIR = os.path.join(SCRIPT_DIR, "models")

LR_PATH = os.path.join(MODELS_DIR, "lr_model.pkl")
RF_PATH = os.path.join(MODELS_DIR, "rf_model.pkl")
LE_PATH = os.path.join(MODELS_DIR, "label_encoder.pkl")

# ---------------------------------------------------------------------------
# 1. Parse args
# ---------------------------------------------------------------------------
if len(sys.argv) != 2:
    print(json.dumps({"error": "Usage: python predict.py <tripId>"}))
    sys.exit(1)

try:
    trip_id = int(sys.argv[1])
except ValueError:
    print(json.dumps({"error": "tripId phai la so nguyen"}))
    sys.exit(1)

# ---------------------------------------------------------------------------
# 2. Load model (fail fast neu chua train)
# ---------------------------------------------------------------------------
try:
    with open(LR_PATH, "rb") as f:
        lr_bundle = pickle.load(f)  # {"model": lr, "scaler": scaler}
    with open(RF_PATH, "rb") as f:
        rf = pickle.load(f)
    with open(LE_PATH, "rb") as f:
        le = pickle.load(
            f
        )  # LabelEncoder voi classes_ = ['dangerous', 'moderate', 'safe']
except FileNotFoundError as e:
    print(
        json.dumps(
            {
                "error": f"Model chua duoc train: {str(e)}. Chay python ml/train.py truoc."
            }
        )
    )
    sys.exit(2)

lr = lr_bundle["model"]
scaler = lr_bundle["scaler"]

SAFE_IDX = list(le.classes_).index("safe")
MODERATE_IDX = list(le.classes_).index("moderate")
DANGEROUS_IDX = list(le.classes_).index("dangerous")

# ---------------------------------------------------------------------------
# 3. Ket noi DB va lay trip_summary
# ---------------------------------------------------------------------------
try:
    import psycopg2
    import psycopg2.extras
    from dotenv import load_dotenv

    # Tim .env o backend/ (chi co khi chay local - production/Docker khong
    # co file nay, DATABASE_URL se duoc ke thua tu process.env cua Node
    # cha thong qua child_process.execFile, xem os.getenv ben duoi).
    env_path = os.path.join(SCRIPT_DIR, "..", "backend", ".env")
    load_dotenv(dotenv_path=env_path)

    DATABASE_URL = os.getenv("DATABASE_URL")
    if not DATABASE_URL:
        print(
            json.dumps(
                {
                    "error": "DATABASE_URL chua duoc set (khong co trong backend/.env lan os environment)"
                }
            )
        )
        sys.exit(2)

    # connect_timeout: neu ket noi bi treo (mang cham/firewall/SSL negotiation
    # loi), fail nhanh trong 10s thay vi treo vo thoi han cho den khi bi
    # Node exec timeout (30s) kill ngang, khong kip in loi ra stderr.
    conn = psycopg2.connect(DATABASE_URL, connect_timeout=10)
    conn.autocommit = True

except Exception as e:
    print(json.dumps({"error": f"Khong the ket noi DB: {str(e)}"}))
    sys.exit(2)

FEATURES = [
    "duration_seconds",
    "distance_km",
    "avg_speed",
    "max_speed",
    "max_accel",
    "max_brake_intensity",
    "hard_brake_per_min",
    "rapid_accel_per_min",
    "sharp_turn_per_min",
    "overspeed_ratio",
    "overspeed_count",
    "gps_invalid_count",
]

try:
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("SELECT status FROM trips WHERE trip_id = %s", (trip_id,))
        trip_row = cur.fetchone()
        if not trip_row:
            print(json.dumps({"error": f"Trip {trip_id} khong ton tai"}))
            sys.exit(1)
        if trip_row["status"] != "completed":
            print(
                json.dumps(
                    {
                        "error": f"Trip {trip_id} chua completed (status={trip_row['status']})"
                    }
                )
            )
            sys.exit(1)

        cur.execute(
            f"""
            SELECT {', '.join(FEATURES)}
            FROM trip_summary
            WHERE trip_id = %s
            """,
            (trip_id,),
        )
        summary_row = cur.fetchone()
        if not summary_row:
            print(
                json.dumps(
                    {
                        "error": f"Trip {trip_id} chua co trip_summary. Kiem tra generateTripSummary."
                    }
                )
            )
            sys.exit(1)

except SystemExit:
    raise
except Exception as e:
    print(json.dumps({"error": f"DB query loi: {str(e)}"}))
    conn.close()
    sys.exit(2)

# ---------------------------------------------------------------------------
# 4. Chuan bi feature vector
# ---------------------------------------------------------------------------
feature_values = {f: float(summary_row[f]) for f in FEATURES}
X = pd.DataFrame([feature_values], columns=FEATURES)

# ---------------------------------------------------------------------------
# 5. Predict - Logistic Regression
# ---------------------------------------------------------------------------
X_scaled = scaler.transform(X)
lr_prob = lr.predict_proba(X_scaled)[0]
lr_risk_score = float(
    0.0 * lr_prob[SAFE_IDX] + 0.5 * lr_prob[MODERATE_IDX] + 1.0 * lr_prob[DANGEROUS_IDX]
)
lr_predicted_class = le.classes_[lr_prob.argmax()]
LEVEL_MAP = {"safe": "safe", "moderate": "medium", "dangerous": "dangerous"}
lr_risk_level = LEVEL_MAP[lr_predicted_class]

# ---------------------------------------------------------------------------
# 6. Predict - Random Forest
# ---------------------------------------------------------------------------
rf_prob = rf.predict_proba(X)[0]
rf_risk_score = float(
    0.0 * rf_prob[SAFE_IDX] + 0.5 * rf_prob[MODERATE_IDX] + 1.0 * rf_prob[DANGEROUS_IDX]
)
rf_predicted_class = le.classes_[rf_prob.argmax()]
rf_risk_level = LEVEL_MAP[rf_predicted_class]

final_risk_score = rf_risk_score
final_risk_level = rf_risk_level

# ---------------------------------------------------------------------------
# 7. UPSERT vao risk_scores
# ---------------------------------------------------------------------------
MODEL_VERSION = "v1.0"

try:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO risk_scores (
                trip_id,
                lr_risk_score, lr_risk_level,
                rf_risk_score, rf_risk_level,
                final_risk_score, final_risk_level,
                model_version
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (trip_id) DO UPDATE SET
                lr_risk_score   = EXCLUDED.lr_risk_score,
                lr_risk_level   = EXCLUDED.lr_risk_level,
                rf_risk_score   = EXCLUDED.rf_risk_score,
                rf_risk_level   = EXCLUDED.rf_risk_level,
                final_risk_score = EXCLUDED.final_risk_score,
                final_risk_level = EXCLUDED.final_risk_level,
                model_version   = EXCLUDED.model_version,
                computed_at     = now()
            """,
            (
                trip_id,
                round(lr_risk_score, 4),
                lr_risk_level,
                round(rf_risk_score, 4),
                rf_risk_level,
                round(final_risk_score, 4),
                final_risk_level,
                MODEL_VERSION,
            ),
        )
except Exception as e:
    print(json.dumps({"error": f"Khong the UPSERT risk_scores: {str(e)}"}))
    sys.exit(2)
finally:
    conn.close()

# ---------------------------------------------------------------------------
# 8. Output JSON ra stdout
# ---------------------------------------------------------------------------
result = {
    "tripId": trip_id,
    "lr": {
        "risk_score": round(lr_risk_score, 4),
        "risk_level": lr_risk_level,
        "class": lr_predicted_class,
    },
    "rf": {
        "risk_score": round(rf_risk_score, 4),
        "risk_level": rf_risk_level,
        "class": rf_predicted_class,
    },
    "final": {
        "risk_score": round(final_risk_score, 4),
        "risk_level": final_risk_level,
    },
    "model_version": MODEL_VERSION,
}
print(json.dumps(result))
sys.exit(0)
