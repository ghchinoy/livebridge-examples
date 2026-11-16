#!/usr/bin/env bash
# Copyright 2026 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

# Single-command interactive launcher for livebridge-examples.
#
# Usage:
#   ./run.sh --list
#   ./run.sh <sample-name>

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
NC='\033[0m'

info() { echo -e "${BLUE}[run.sh]${NC} $*"; }
ok()   { echo -e "${GREEN}[run.sh]${NC} $*"; }
warn() { echo -e "${YELLOW}[run.sh]${NC} $*"; }
err()  { echo -e "${RED}[run.sh]${NC} $*" >&2; }

list_samples() {
  cat <<'EOF'
Available livebridge external samples:

  1. visual-concierge        [Lit 3 + /lit]      http://localhost:5181 (Go :8091)
     Talking video avatar (preset or uploaded portrait) + 1 FPS camera/screen
     vision + live troubleshooting checklist drawer.

  2. whiteboard-architect    [Vanilla TS]        http://localhost:5182 (Go :8092)
     Co-drawn HTML5 canvas whiteboard (mouse + WebMCP tools + SeeVisualResults)
     with 60 FPS PcmPlayer.analyser frequency visualizer.

  3. bilingual-coach         [React 19]          http://localhost:5183 (Go :8093)
     Multilingual & interview roleplay partner with tunable VAD pause patience
     (SilenceDurationMs), adaptation phrases, and live rubric cards.

  4. pocket-briefing         [Zero-Node Go]      http://localhost:8094
     Single-binary Go voice briefing desk (livebridge/browser) watching ./inbox
     files and POST /api/memo webhooks via AlertBus + ChimeSynth.

  5. antigravity-voice-desk  [Managed Agents]    http://localhost:5185 (Go :8096)
     Stateless voice/avatar edge delegating code execution & chart plotting to
     an isolated Gemini Managed Agents (Antigravity) Linux sandbox via AlertBus.

Usage:
  ./run.sh <sample-name>
EOF
}

if [[ $# -eq 0 || "$1" == "-h" || "$1" == "--help" || "$1" == "--list" ]]; then
  list_samples
  exit 0
fi

SAMPLE="$1"
SAMPLE_DIR="${REPO_ROOT}/samples/${SAMPLE}"

if [[ ! -d "${SAMPLE_DIR}" ]]; then
  err "Unknown sample '${SAMPLE}'."
  echo ""
  list_samples
  exit 1
fi

default_go_port() {
  case "$1" in
    visual-concierge)       echo "8091" ;;
    whiteboard-architect)   echo "8092" ;;
    bilingual-coach)        echo "8093" ;;
    pocket-briefing)        echo "8094" ;;
    antigravity-voice-desk) echo "8096" ;;
    *)                      echo "" ;;
  esac
}

GO_PORT="${PORT:-$(default_go_port "${SAMPLE}")}"
if [[ -n "${GO_PORT}" ]] && command -v lsof >/dev/null 2>&1; then
  OCCUPIED="$(lsof -nP -iTCP:"${GO_PORT}" -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -n "${OCCUPIED}" ]]; then
    err "Port :${GO_PORT} is already in use (cannot start ${SAMPLE} Go backend):"
    echo "${OCCUPIED}" >&2
    err "Stop that process or override PORT=<free-port> (and update vite.config.ts proxy if using Vite)."
    exit 1
  fi
fi

if [[ -z "${GOOGLE_CLOUD_PROJECT:-}" && -z "${GEMINI_API_KEY:-}" ]]; then
  if command -v gcloud >/dev/null 2>&1; then
    DETECTED_PROJ="$(gcloud config get project 2>/dev/null || true)"
    if [[ -n "${DETECTED_PROJ}" ]]; then
      export GOOGLE_CLOUD_PROJECT="${DETECTED_PROJ}"
      info "Auto-detected GOOGLE_CLOUD_PROJECT=${GOOGLE_CLOUD_PROJECT} from gcloud"
    fi
  fi
fi

if [[ -z "${GOOGLE_CLOUD_PROJECT:-}" && -z "${GEMINI_API_KEY:-}" ]]; then
  err "Set GOOGLE_CLOUD_PROJECT (required for video avatars) or GEMINI_API_KEY before running."
  exit 1
fi

PIDS=()
cleanup() {
  for pid in "${PIDS[@]:-}"; do
    if [[ -n "${pid}" ]] && kill -0 "${pid}" 2>/dev/null; then
      pkill -P "${pid}" 2>/dev/null || true
      kill "${pid}" 2>/dev/null || true
    fi
  done
}
trap cleanup EXIT INT TERM

if [[ -d "${SAMPLE_DIR}/frontend" ]]; then
  if [[ ! -d "${SAMPLE_DIR}/frontend/node_modules" ]]; then
    info "Installing frontend dependencies for ${SAMPLE}..."
    (cd "${SAMPLE_DIR}/frontend" && npm install --no-audit --no-fund)
  fi

  info "Starting Go backend in samples/${SAMPLE} (:${GO_PORT})..."
  (cd "${SAMPLE_DIR}" && go run .) &
  GO_PID="$!"
  PIDS+=("${GO_PID}")

  # Wait up to 15s for `go run .` to compile and bind :GO_PORT, failing fast if
  # the Go process exits early.
  for _ in {1..30}; do
    if ! kill -0 "${GO_PID}" 2>/dev/null; then
      err "Go backend for ${SAMPLE} exited during startup."
      wait "${GO_PID}" || exit 1
    fi
    if [[ -n "${GO_PORT}" ]] && command -v lsof >/dev/null 2>&1; then
      if lsof -nP -iTCP:"${GO_PORT}" -sTCP:LISTEN >/dev/null 2>&1; then
        break
      fi
    fi
    sleep 0.5
  done

  ok "Starting Vite frontend for ${SAMPLE} (press Ctrl+C to stop both)..."
  (cd "${SAMPLE_DIR}/frontend" && npm run dev) &
  PIDS+=("$!")
  wait
else
  ok "Starting zero-Node Go sample ${SAMPLE} (press Ctrl+C to stop)..."
  cd "${SAMPLE_DIR}"
  exec go run .
fi
