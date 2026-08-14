"""
TRAIN.PY - Huấn luyện mô hình ML cho Pilotrix Risk Scoring

Input : ml/data/synthetic_trips.csv (900 trip tổng hợp, 3 scenario)
Output: ml/models/lr_model.pkl    - Logistic Regression (+ scaler)
        ml/models/rf_model.pkl    - Random Forest
        ml/models/label_encoder.pkl

Cả 2 model đều predict 3 class: safe / moderate / dangerous
Random Forest là model CHÍNH (final_*) theo đề cương.

Chạy: python ml/train.py
      (từ root thư mục project, hoặc cd ml && python train.py - nhưng
       đường dẫn data/models sẽ cần điều chỉnh - xem NOTE bên dưới)

NOTE về đường dẫn: Script đọc path tương đối so với vị trí CỦA FILE này,
không phải cwd. Dùng __file__ để tính, chạy từ đâu cũng được.
"""

import json
import os
import pickle
import sys

import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    ConfusionMatrixDisplay,
    classification_report,
    confusion_matrix,
)
from sklearn.model_selection import StratifiedKFold, cross_validate, train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import LabelEncoder, StandardScaler

# ---------------------------------------------------------------------------
# 0. Đường dẫn
# ---------------------------------------------------------------------------
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_PATH = os.path.join(SCRIPT_DIR, "data", "synthetic_trips.csv")
MODELS_DIR = os.path.join(SCRIPT_DIR, "models")
os.makedirs(MODELS_DIR, exist_ok=True)

# ---------------------------------------------------------------------------
# 1. Feature list - khớp CHÍNH XÁC với trip_summary schema và predict.py
#    KHÔNG bao gồm 'scenario' (label) và các cột count tuyệt đối
#    (hard_brake_count, rapid_accel_count, ...) - vì đã có phiên bản
#    per_min chuẩn hoá theo thời gian, tránh bias trip dài.
#    Giữ lại overspeed_count vì nó bổ sung thông tin khác với overspeed_ratio.
# ---------------------------------------------------------------------------
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
LABEL_COL = "scenario"
# Thứ tự class cố định - quan trọng để risk_score mapping nhất quán
CLASS_ORDER = ["safe", "moderate", "dangerous"]

# ---------------------------------------------------------------------------
# 2. Load data
# ---------------------------------------------------------------------------
print("=" * 60)
print("PILOTRIX ML TRAINING")
print("=" * 60)

df = pd.read_csv(DATA_PATH)
print(f"\n[1] Dataset: {len(df)} trips | {df[LABEL_COL].value_counts().to_dict()}")

X = df[FEATURES]
y = df[LABEL_COL]

# LabelEncoder với thứ tự cố định: safe=0, moderate=1, dangerous=2
le = LabelEncoder()
le.fit(CLASS_ORDER)
y_enc = le.transform(y)

# ---------------------------------------------------------------------------
# 2.5. 5-fold Stratified Cross-Validation
#
#      Mục đích: ước lượng ĐỘ ỔN ĐỊNH của model qua nhiều cách chia dữ liệu
#      khác nhau (giảm rủi ro "may mắn" hay "xui" với đúng 1 lần split như
#      bước 3 bên dưới) - dùng để BÁO CÁO trước hội đồng, KHÔNG phải để
#      chọn/lưu model cuối. Model thật sự lưu ra .pkl vẫn train ở bước 5-7
#      bằng đúng 1 lần split 80/20 như từ trước, giữ nguyên hành vi
#      predict.py, không đổi gì hệ thống đang chạy.
#
#      Chạy trên TOÀN BỘ X, y_enc (900 trip) chứ không chỉ X_train, vì mục
#      tiêu là đo phương sai của model nói chung trên phân phối dữ liệu,
#      không phải đánh giá riêng 1 tập train cụ thể.
#
#      LR dùng Pipeline(StandardScaler, LogisticRegression) thay vì scaler
#      global fit 1 lần trên toàn bộ X - nếu fit_transform trước rồi mới
#      CV thì mean/std của scaler đã "nhìn thấy" luôn cả phần dữ liệu sẽ
#      làm test ở từng fold (data leakage nhẹ nhưng vẫn sai methodology).
#      Pipeline đảm bảo scaler chỉ fit trên phần train của MỖI fold.
# ---------------------------------------------------------------------------
print("\n" + "=" * 60)
print("5-FOLD STRATIFIED CROSS-VALIDATION")
print("=" * 60)

skf = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)

lr_cv_pipeline = Pipeline(
    [
        ("scaler", StandardScaler()),
        (
            "clf",
            LogisticRegression(
                max_iter=1000,
                random_state=42,
                class_weight="balanced",
                solver="lbfgs",
            ),
        ),
    ]
)

# Cấu hình giống hệt RF ở bước 6 bên dưới, để số CV so sánh được với
# accuracy của model cuối cùng thật sự lưu ra .pkl
rf_cv_estimator = RandomForestClassifier(
    n_estimators=200,
    max_depth=None,
    min_samples_split=4,
    min_samples_leaf=2,
    class_weight="balanced",
    random_state=42,
    n_jobs=-1,
)

CV_SCORING = ["accuracy", "f1_macro"]
cv_results_summary = {}

for cv_name, cv_estimator in [
    ("Logistic Regression", lr_cv_pipeline),
    ("Random Forest", rf_cv_estimator),
]:
    cv_res = cross_validate(
        cv_estimator, X, y_enc, cv=skf, scoring=CV_SCORING, return_train_score=False
    )
    acc_folds = cv_res["test_accuracy"]
    f1_folds = cv_res["test_f1_macro"]

    print(f"\n[{cv_name}]")
    print(f"  {'Fold':<6}{'Accuracy':<12}{'F1-macro':<12}")
    for i, (a, f1) in enumerate(zip(acc_folds, f1_folds), start=1):
        print(f"  {i:<6}{a:<12.4f}{f1:<12.4f}")
    print(f"  {'Mean':<6}{acc_folds.mean():<12.4f}{f1_folds.mean():<12.4f}")
    print(f"  {'Std':<6}{acc_folds.std():<12.4f}{f1_folds.std():<12.4f}")

    cv_results_summary[cv_name] = {
        "accuracy_per_fold": [round(float(a), 4) for a in acc_folds],
        "accuracy_mean": round(float(acc_folds.mean()), 4),
        "accuracy_std": round(float(acc_folds.std()), 4),
        "f1_macro_per_fold": [round(float(f), 4) for f in f1_folds],
        "f1_macro_mean": round(float(f1_folds.mean()), 4),
        "f1_macro_std": round(float(f1_folds.std()), 4),
    }

# Lưu ra JSON riêng - để dán bảng vào báo cáo Word mà không phải chép tay
# số từ console (dễ gõ nhầm), và có thể mở lại xem sau mà không cần
# chạy lại toàn bộ script train.
CV_RESULTS_PATH = os.path.join(MODELS_DIR, "cv_results.json")
with open(CV_RESULTS_PATH, "w") as f:
    json.dump(cv_results_summary, f, indent=2, ensure_ascii=False)
print(f"\n[Saved] {CV_RESULTS_PATH}")

# ---------------------------------------------------------------------------
# 3. Train / Test split (80/20, stratified)
# ---------------------------------------------------------------------------
X_train, X_test, y_train, y_test = train_test_split(
    X, y_enc, test_size=0.2, random_state=42, stratify=y_enc
)
print(f"[2] Split: train={len(X_train)} | test={len(X_test)} (80/20 stratified)")

# ---------------------------------------------------------------------------
# 4. Logistic Regression (cần StandardScaler)
# ---------------------------------------------------------------------------
print("\n" + "=" * 60)
print("LOGISTIC REGRESSION")
print("=" * 60)

scaler = StandardScaler()
X_train_scaled = scaler.fit_transform(X_train)
X_test_scaled = scaler.transform(X_test)

lr = LogisticRegression(
    max_iter=1000,
    random_state=42,
    class_weight="balanced",  # xử lý nếu data không balanced sau split
    solver="lbfgs",
)
lr.fit(X_train_scaled, y_train)
y_pred_lr = lr.predict(X_test_scaled)
y_prob_lr = lr.predict_proba(X_test_scaled)  # shape (n, 3)

print("\n[Classification Report]")
print(
    classification_report(y_test, y_pred_lr, target_names=le.classes_, zero_division=0)
)

print("[Confusion Matrix]  (rows=actual, cols=predicted)")
print("Labels:", le.classes_.tolist())
cm_lr = confusion_matrix(y_test, y_pred_lr)
print(cm_lr)

lr_accuracy = (y_pred_lr == y_test).mean()
print(f"\nLR Accuracy: {lr_accuracy:.4f} ({lr_accuracy*100:.2f}%)")

# ---------------------------------------------------------------------------
# 5. Random Forest (không cần scale)
# ---------------------------------------------------------------------------
print("\n" + "=" * 60)
print("RANDOM FOREST")
print("=" * 60)

rf = RandomForestClassifier(
    n_estimators=200,
    max_depth=None,  # để tự grow - dataset nhỏ, không cần prune
    min_samples_split=4,
    min_samples_leaf=2,
    class_weight="balanced",
    random_state=42,
    n_jobs=-1,
)
rf.fit(X_train, y_train)
y_pred_rf = rf.predict(X_test)
y_prob_rf = rf.predict_proba(X_test)

print("\n[Classification Report]")
print(
    classification_report(y_test, y_pred_rf, target_names=le.classes_, zero_division=0)
)

print("[Confusion Matrix]  (rows=actual, cols=predicted)")
print("Labels:", le.classes_.tolist())
cm_rf = confusion_matrix(y_test, y_pred_rf)
print(cm_rf)

rf_accuracy = (y_pred_rf == y_test).mean()
print(f"\nRF Accuracy: {rf_accuracy:.4f} ({rf_accuracy*100:.2f}%)")

# Feature importance
importances = rf.feature_importances_
fi_sorted = sorted(zip(FEATURES, importances), key=lambda x: -x[1])
print("\n[Feature Importances - RF]")
for feat, imp in fi_sorted:
    bar = "█" * int(imp * 40)
    print(f"  {feat:<28} {imp:.4f}  {bar}")

# ---------------------------------------------------------------------------
# 6. So sánh 2 model
# ---------------------------------------------------------------------------
print("\n" + "=" * 60)
print("SUMMARY")
print("=" * 60)
print(f"  Logistic Regression accuracy : {lr_accuracy*100:.2f}%")
print(f"  Random Forest accuracy       : {rf_accuracy*100:.2f}%")
print(f"  Model chính (final_*)        : Random Forest")
print(
    f"  {'RF tốt hơn' if rf_accuracy >= lr_accuracy else 'LR tốt hơn'} "
    f"{abs(rf_accuracy - lr_accuracy)*100:.2f}%"
)

# ---------------------------------------------------------------------------
# 7. Lưu model
# ---------------------------------------------------------------------------
LR_PATH = os.path.join(MODELS_DIR, "lr_model.pkl")
RF_PATH = os.path.join(MODELS_DIR, "rf_model.pkl")
LE_PATH = os.path.join(MODELS_DIR, "label_encoder.pkl")

# Bundle LR + scaler vào 1 dict để predict.py chỉ load 1 file
with open(LR_PATH, "wb") as f:
    pickle.dump({"model": lr, "scaler": scaler}, f)

with open(RF_PATH, "wb") as f:
    pickle.dump(rf, f)

with open(LE_PATH, "wb") as f:
    pickle.dump(le, f)

print(f"\n[Saved] {LR_PATH}")
print(f"[Saved] {RF_PATH}")
print(f"[Saved] {LE_PATH}")
print("\nDone. Chạy predict.py để test với trip thực từ DB.")
