#!/usr/bin/env python3
"""
mlp_cv.py - MLP (PyTorch) so với Random Forest và Logistic Regression trên bộ dữ liệu Pilotrix.
Cùng Stratified K-Fold, cùng các fold, cùng quy ước chống rò rỉ dữ liệu.

Dữ liệu: ml/data/synthetic_trips.csv (sinh bởi ml/generate_synthetic_data.py, seed 42).
Chạy:
  python mlp_cv.py --data ml/data/synthetic_trips.csv
  python mlp_cv.py --data ml/data/synthetic_trips.csv --label <tên cột nhãn> --repeats 3

Quy ước chống rò rỉ:
  - StandardScaler luôn fit trên phần train của từng fold (kể cả với MLP), không thấy fold kiểm tra.
  - Early stopping của MLP dùng 15% tách ra từ phần train, không chạm fold kiểm tra.
Lưu ý: dữ liệu là dữ liệu tổng hợp, kết quả không suy ra được cho dữ liệu lái xe thật.
"""
import argparse, copy, json, time
from pathlib import Path

import numpy as np
import pandas as pd
import torch
from torch import nn
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, confusion_matrix, f1_score
from sklearn.model_selection import StratifiedKFold, train_test_split
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import LabelEncoder, StandardScaler

FEATURES = ["duration_seconds", "distance_km", "avg_speed", "max_speed", "max_accel",
            "max_brake_intensity", "hard_brake_per_min", "rapid_accel_per_min",
            "sharp_turn_per_min", "overspeed_ratio", "overspeed_count",
            "lane_drift_per_min", "gps_invalid_count"]
LABEL_CANDIDATES = ["label", "risk_label", "risk_level", "risk_class", "class", "scenario", "category"]


class MLP(nn.Module):
    def __init__(self, d_in, n_classes, h1=64, h2=32, p=0.1):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(d_in, h1), nn.ReLU(), nn.Dropout(p),
            nn.Linear(h1, h2), nn.ReLU(), nn.Dropout(p),
            nn.Linear(h2, n_classes))

    def forward(self, x):
        return self.net(x)


def fit_mlp(X_tr, y_tr, n_classes, a, seed):
    torch.manual_seed(seed)
    scaler = StandardScaler().fit(X_tr)                          # chỉ fit trên train của fold
    Xs = scaler.transform(X_tr).astype(np.float32)
    Xt, Xv, yt, yv = train_test_split(Xs, y_tr, test_size=0.15, stratify=y_tr, random_state=seed)
    Xt, Xv = torch.from_numpy(Xt), torch.from_numpy(Xv)
    yt, yv = torch.from_numpy(yt).long(), torch.from_numpy(yv).long()
    model = MLP(Xt.shape[1], n_classes)
    opt = torch.optim.Adam(model.parameters(), lr=a.lr, weight_decay=a.wd)
    loss_fn = nn.CrossEntropyLoss()
    gen = torch.Generator().manual_seed(seed)
    best, best_state, best_ep, bad = float("inf"), None, 0, 0
    for ep in range(1, a.epochs + 1):
        model.train()
        perm = torch.randperm(len(Xt), generator=gen)
        for i in range(0, len(Xt), a.batch):
            idx = perm[i:i + a.batch]
            opt.zero_grad()
            loss_fn(model(Xt[idx]), yt[idx]).backward()
            opt.step()
        model.eval()
        with torch.no_grad():
            val = loss_fn(model(Xv), yv).item()
        if val < best - 1e-4:
            best, best_state, best_ep, bad = val, copy.deepcopy(model.state_dict()), ep, 0
        else:
            bad += 1
            if bad >= a.patience:
                break
    model.load_state_dict(best_state)
    model.eval()
    return model, scaler, best_ep


def predict_mlp(model, scaler, X):
    with torch.no_grad():
        return model(torch.from_numpy(scaler.transform(X).astype(np.float32))).argmax(1).numpy()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--label", default=None)
    ap.add_argument("--folds", type=int, default=5)
    ap.add_argument("--repeats", type=int, default=3)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--epochs", type=int, default=300)
    ap.add_argument("--patience", type=int, default=25)
    ap.add_argument("--batch", type=int, default=32)
    ap.add_argument("--lr", type=float, default=1e-3)
    ap.add_argument("--wd", type=float, default=1e-4)
    ap.add_argument("--out", default="results_mlp")
    a = ap.parse_args()

    df = pd.read_csv(a.data)
    label = a.label or next((c for c in LABEL_CANDIDATES if c in df.columns), None)
    missing = [c for c in FEATURES if c not in df.columns]
    if label is None or missing:
        raise SystemExit(f"Thiếu cột. Nhãn tìm thấy: {label}; đặc trưng thiếu: {missing}\n"
                         f"Các cột trong file: {list(df.columns)}\nDùng --label <tên cột nhãn>.")
    X = df[FEATURES].to_numpy(dtype=float)
    le = LabelEncoder().fit(df[label])
    y = le.transform(df[label])
    classes = list(le.classes_)
    print(f"{len(df)} mẫu, {len(FEATURES)} đặc trưng, lớp: {classes}, phân bố: {np.bincount(y).tolist()}")

    names = ["Random Forest", "Logistic Regression", "MLP (PyTorch)"]
    acc = {n: [] for n in names}; f1 = {n: [] for n in names}
    cm = {n: np.zeros((len(classes), len(classes)), dtype=int) for n in names}
    mlp_epochs, mlp_secs = [], []

    for r in range(a.repeats):
        skf = StratifiedKFold(n_splits=a.folds, shuffle=True, random_state=a.seed + r)
        oof = {n: np.zeros(len(y), dtype=int) for n in names}
        for k, (tr, te) in enumerate(skf.split(X, y)):
            rf = RandomForestClassifier(n_estimators=200, class_weight="balanced", random_state=42).fit(X[tr], y[tr])
            lr = make_pipeline(StandardScaler(), LogisticRegression(C=1.0, max_iter=1000)).fit(X[tr], y[tr])
            t0 = time.perf_counter()
            mlp, sc, ep = fit_mlp(X[tr], y[tr], len(classes), a, seed=a.seed + 100 * r + k)
            mlp_secs.append(time.perf_counter() - t0); mlp_epochs.append(ep)
            preds = {"Random Forest": rf.predict(X[te]), "Logistic Regression": lr.predict(X[te]),
                     "MLP (PyTorch)": predict_mlp(mlp, sc, X[te])}
            for n in names:
                oof[n][te] = preds[n]
                acc[n].append(accuracy_score(y[te], preds[n]))
                f1[n].append(f1_score(y[te], preds[n], average="macro"))
        for n in names:
            cm[n] += confusion_matrix(y, oof[n], labels=range(len(classes)))
        print(f"lượt {r + 1}/{a.repeats} xong")

    n_params = sum(p.numel() for p in MLP(len(FEATURES), len(classes)).parameters())
    di, sa = classes.index("dangerous") if "dangerous" in classes else 0, classes.index("safe") if "safe" in classes else -1
    summary = {"meta": {"data": a.data, "n": len(df), "features": FEATURES, "classes": classes,
                        "folds": a.folds, "repeats": a.repeats, "seed": a.seed, "torch": torch.__version__,
                        "mlp": {"layers": "13-64-32-3", "params": n_params, "lr": a.lr, "weight_decay": a.wd,
                                "batch": a.batch, "max_epochs": a.epochs, "patience": a.patience,
                                "mean_best_epoch": float(np.mean(mlp_epochs)),
                                "mean_train_seconds_per_fold": float(np.mean(mlp_secs))}},
               "models": {}}
    for n in names:
        summary["models"][n] = {
            "accuracy_mean": float(np.mean(acc[n])), "accuracy_std": float(np.std(acc[n], ddof=1)),
            "f1_macro_mean": float(np.mean(f1[n])), "f1_macro_std": float(np.std(f1[n], ddof=1)),
            "accuracy_per_fold": acc[n], "f1_macro_per_fold": f1[n],
            "confusion_oof_summed_over_repeats": cm[n].tolist(),
            "dangerous_safe_confusions": int(cm[n][di, sa] + cm[n][sa, di])}
    out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
    json.dump(summary, open(out / "mlp_cv.json", "w", encoding="utf-8"), ensure_ascii=False, indent=2)

    print(f"\n| Model | Accuracy % (mean ± std) | Macro-F1 % (mean ± std) | Dangerous↔Safe nhầm |\n|---|---|---|---|")
    for n in names:
        s = summary["models"][n]
        print(f"| {n} | {100*s['accuracy_mean']:.1f} ± {100*s['accuracy_std']:.1f} | "
              f"{100*s['f1_macro_mean']:.1f} ± {100*s['f1_macro_std']:.1f} | {s['dangerous_safe_confusions']} |")
    m = summary["meta"]["mlp"]
    print(f"\nMLP {m['layers']} ({m['params']} tham số), dừng sớm trung bình ở epoch {m['mean_best_epoch']:.0f}, "
          f"~{m['mean_train_seconds_per_fold']:.1f} giây/fold. {a.folds} fold x {a.repeats} lượt = {a.folds*a.repeats} điểm.")
    print(f"Chi tiết: {out}/mlp_cv.json")


if __name__ == "__main__":
    main()
