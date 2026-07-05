"""
PREDICT.PY - Tính risk score cho 1 trip đã hoàn thành

Usage: python ml/predict.py <tripId>

Flow:
  1. Đọc trip_summary từ PostgreSQL (Supabase Transaction Pooler)
  2. Load LR + RF model từ ml/models/
  3. Predict risk_level + risk_score (0.0-1.0) cho cả 2 model
  4. UPSERT vào bảng risk_scores
  5. Print JSON kết quả ra stdout (Backend đọc qua child_process)

Exit codes:
  0 - thành công
  1 - lỗi nghiệp vụ (trip không tồn tại, chưa có trip_summary...)
  2 - lỗi kết nối DB / load model

NOTE về risk_score:
  Dùng weighted probability: 0.0*P(safe) + 0.5*P(moderate) + 1.0*P(dangerous)
  Ý nghĩa: 0.0 = chắc chắn safe, ~0.5 = moderate, 1.0 = chắc chắn dangerous.
  Trực quan hơn cho Dashboard so với chỉ dùng P(dangerous) đơn thuần.
"""

import json
import os
import pickle
import sys

import numpy as np
import pandas as pd

# ---------------------------------------------------------------------------
# 0. Đường dẫn
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
    print(json.dumps({"error": "tripId phải là số nguyên"}))
    sys.exit(1)

# ---------------------------------------------------------------------------
# 2. Load model (fail fast nếu chưa train)
# ---------------------------------------------------------------------------
try:
    with open(LR_PATH, "rb") as f:
        lr_bundle = pickle.load(f)  # {"model": lr, "scaler": scaler}
    with open(RF_PATH, "rb") as f:
        rf = pickle.load(f)
    with open(LE_PATH, "rb") as f:
        le = pickle.load(
            f
        )  # LabelEncoder với classes_ = ['dangerous', 'moderate', 'safe']
except FileNotFoundError as e:
    print(
        json.dumps(
            {
                "error": f"Model chưa được train: {str(e)}. Chạy python ml/train.py trước."
            }
        )
    )
    sys.exit(2)

lr = lr_bundle["model"]
scaler = lr_bundle["scaler"]

# Index các class trong le.classes_ (alphabet: dangerous=0, moderate=1, safe=2)
SAFE_IDX = list(le.classes_).index("safe")
MODERATE_IDX = list(le.classes_).index("moderate")
DANGEROUS_IDX = list(le.classes_).index("dangerous")
# Weighted score: safe->0.0, moderate->0.5, dangerous->1.0
# Ý nghĩa: 0.0 = chắc chắn safe, 1.0 = chắc chắn dangerous, ~0.5 = moderate

# ---------------------------------------------------------------------------
# 3. Kết nối DB và lấy trip_summary
# ---------------------------------------------------------------------------
try:
    import psycopg2
    import psycopg2.extras
    from dotenv import load_dotenv

    # Tìm .env ở backend/ (cùng cấp với ml/ trong project root)
    env_path = os.path.join(SCRIPT_DIR, "..", "backend", ".env")
    load_dotenv(dotenv_path=env_path)

    DATABASE_URL = os.getenv("DATABASE_URL")
    if not DATABASE_URL:
        print(json.dumps({"error": "DATABASE_URL chưa được set trong backend/.env"}))
        sys.exit(2)

    conn = psycopg2.connect(DATABASE_URL)
    conn.autocommit = True

except Exception as e:
    print(json.dumps({"error": f"Không thể kết nối DB: {str(e)}"}))
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
        # 3a. Kiểm tra trip tồn tại và đã completed
        cur.execute("SELECT status FROM trips WHERE trip_id = %s", (trip_id,))
        trip_row = cur.fetchone()
        if not trip_row:
            print(json.dumps({"error": f"Trip {trip_id} không tồn tại"}))
            sys.exit(1)
        if trip_row["status"] != "completed":
            print(
                json.dumps(
                    {
                        "error": f"Trip {trip_id} chưa completed (status={trip_row['status']})"
                    }
                )
            )
            sys.exit(1)

        # 3b. Lấy trip_summary
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
                        "error": f"Trip {trip_id} chưa có trip_summary. Kiểm tra generateTripSummary."
                    }
                )
            )
            sys.exit(1)

except Exception as e:
    print(json.dumps({"error": f"DB query lỗi: {str(e)}"}))
    conn.close()
    sys.exit(2)

# ---------------------------------------------------------------------------
# 4. Chuẩn bị feature vector (DataFrame để sklearn không warning feature names)
# ---------------------------------------------------------------------------
feature_values = {f: float(summary_row[f]) for f in FEATURES}
X = pd.DataFrame([feature_values], columns=FEATURES)

# ---------------------------------------------------------------------------
# 5. Predict - Logistic Regression
# ---------------------------------------------------------------------------
X_scaled = scaler.transform(X)
lr_prob = lr.predict_proba(X_scaled)[0]  # shape (3,)
lr_risk_score = float(
    0.0 * lr_prob[SAFE_IDX] + 0.5 * lr_prob[MODERATE_IDX] + 1.0 * lr_prob[DANGEROUS_IDX]
)
lr_predicted_class = le.classes_[lr_prob.argmax()]
# Map sang risk_level cho DB (safe/moderate/dangerous -> safe/medium/dangerous)
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

# Final = Random Forest (model chính theo đề cương)
final_risk_score = rf_risk_score
final_risk_level = rf_risk_level

# ---------------------------------------------------------------------------
# 7. UPSERT vào risk_scores
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
    print(json.dumps({"error": f"Không thể UPSERT risk_scores: {str(e)}"}))
    conn.close()
    sys.exit(2)
finally:
    conn.close()

# ---------------------------------------------------------------------------
# 8. Output JSON ra stdout (Backend đọc)
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
