# ============================================================
# Dockerfile cho Pilotrix backend — build tu goc repo (khong phai
# tu thu muc backend/), vi backend goi Python child_process den
# ../../ml/predict.py va ../../venv/bin/python (xem dashboard.js).
# Can giu dung cau truc thu muc: /app/backend, /app/ml, /app/venv
# ============================================================

FROM node:20-slim

# --- Cai ca-certificates (can cho HTTPS - npm/pip tai package) ---
# va Python3 + venv (Debian slim khong co san) ---
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates python3 python3-venv python3-pip \
    && rm -rf /var/lib/apt/lists/*

# --- Cai pnpm ban 10.x qua npm (pnpm 11+ yeu cau Node 22+, khong khop
# voi node:20-slim dang dung - ghim ban 10 cho dong bo voi may dev local) ---
RUN npm install -g pnpm@10

WORKDIR /app

# --- Cai dependency Node truoc (tan dung Docker layer cache) ---
COPY backend/package.json backend/pnpm-lock.yaml ./backend/
RUN cd backend && pnpm install --prod --frozen-lockfile

# --- Copy code that su ---
COPY backend ./backend
COPY ml ./ml
COPY simulator ./simulator

# --- Tao venv Python + cai dependency ML ---
RUN python3 -m venv venv && \
    ./venv/bin/pip install --no-cache-dir -r ml/requirements.txt

# --- Sinh du lieu synthetic + train model ngay luc build ---
# (seed=42 co dinh -> ket qua deterministic, khong can commit
# file .csv/.pkl vao git - xem ghi chu trong .gitignore)
RUN ./venv/bin/python ml/generate_synthetic_data.py && \
    ./venv/bin/python ml/train.py

# --- Venv THU 2, TACH BIET HOAN TOAN, chi cho GEE (earthengine-api) ---
# KHONG duoc gop chung voi venv ML o tren - earthengine-api keo theo
# google-auth/protobuf co the doi version numpy/protobuf ma sklearn
# dang phu thuoc, rui ro hong risk scoring dang chay that. Tach rieng
# = zero risk cho phan ML hien co, chi la them dong lenh, khong sua
# dong nao dang chay.
COPY simulator/requirements-gee.txt ./simulator/requirements-gee.txt
RUN python3 -m venv venv-gis && \
    ./venv-gis/bin/pip install --no-cache-dir -r simulator/requirements-gee.txt

WORKDIR /app/backend
EXPOSE 3000
CMD ["node", "src/server.js"]
