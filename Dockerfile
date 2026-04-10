FROM node:20-bookworm-slim

WORKDIR /app

ENV PORT=3000 \
    PYTHONUNBUFFERED=1 \
    ECP_FASTAPI_URL=http://127.0.0.1:8000 \
    PATH=/opt/venv/bin:$PATH

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-pip python3-venv build-essential \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --include=dev

COPY requirements.txt ./
RUN python3 -m venv /opt/venv \
  && /opt/venv/bin/pip install --upgrade pip \
  && /opt/venv/bin/pip install --no-cache-dir -r requirements.txt

COPY . .

RUN npm run build \
  && mkdir -p /app/.app-data

ENV NODE_ENV=production

EXPOSE 3000

CMD ["bash", "./start.sh"]
