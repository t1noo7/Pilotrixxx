# ============================================================
# Dockerfile cho Pilotrix backend — build tu goc repo (khong phai
# tu thu muc backend/), vi backend goi Python child_process den
# ../../ml/predict.py va ../../venv/bin/python (xem dashboard.js).
# Can giu dung cau truc thu muc: /app/backend, /app/ml, /app/venv
# ============================================================

FROM node:20-slim

# --- Cai Python3 + venv (Debian slim khong co san) ---
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-venv python3-pip \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# --- Cai dependency Node truoc (tan dung Docker layer cache) ---
COPY backend/package.json backend/pnpm-lock.yaml ./backend/
RUN corepack enable && cd backend && pnpm install --prod --frozen-lockfile

# --- Copy code that su ---
COPY backend ./backend
COPY ml ./ml

# --- Tao venv Python + cai dependency ML ---
RUN python3 -m venv venv && \
    ./venv/bin/pip install --no-cache-dir -r ml/requirements.txt

# --- Sinh du lieu synthetic + train model ngay luc build ---
# (seed=42 co dinh -> ket qua deterministic, khong can commit
# file .csv/.pkl vao git - xem ghi chu trong .gitignore)
RUN ./venv/bin/python ml/generate_synthetic_data.py && \
    ./venv/bin/python ml/train.py

WORKDIR /app/backend
EXPOSE 3000
CMD ["node", "src/server.js"]
