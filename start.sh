#!/usr/bin/env bash
set -euo pipefail

mkdir -p /app/.app-data

cleanup() {
  if [[ -n "${NODE_PID:-}" ]]; then
    kill "${NODE_PID}" 2>/dev/null || true
  fi
  if [[ -n "${PY_PID:-}" ]]; then
    kill "${PY_PID}" 2>/dev/null || true
  fi
  wait "${NODE_PID:-}" 2>/dev/null || true
  wait "${PY_PID:-}" 2>/dev/null || true
}

trap cleanup EXIT INT TERM

python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000 &
PY_PID=$!

node server/index.js &
NODE_PID=$!

wait -n "${PY_PID}" "${NODE_PID}"
