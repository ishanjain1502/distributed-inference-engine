#!/usr/bin/env bash
set -euo pipefail

DEFAULT_FILENAME="tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf"
DEFAULT_URL="https://huggingface.co/TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF/resolve/main/tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

DEST="${MODEL_PATH:-$ROOT_DIR/modelFiles/$DEFAULT_FILENAME}"
URL="${MODEL_URL:-$DEFAULT_URL}"
PARTIAL="${DEST}.partial"

if [[ "${SKIP_MODEL_DOWNLOAD:-0}" == "1" ]]; then
  if [[ -f "$DEST" ]]; then
    echo "Model present at $DEST (SKIP_MODEL_DOWNLOAD=1)"
    exit 0
  fi
  echo "ERROR: Model missing at $DEST and SKIP_MODEL_DOWNLOAD=1" >&2
  exit 1
fi

if [[ -f "$DEST" ]]; then
  echo "Model already present: $DEST"
  exit 0
fi

mkdir -p "$(dirname "$DEST")"
rm -f "$PARTIAL"

echo "Downloading model"
echo "  URL:  $URL"
echo "  Dest: $DEST"

download() {
  if command -v curl >/dev/null 2>&1; then
    curl -fL --progress-bar -o "$PARTIAL" "$URL"
  elif command -v wget >/dev/null 2>&1; then
    wget -O "$PARTIAL" "$URL"
  else
    echo "ERROR: need curl or wget to download model" >&2
    exit 1
  fi
}

if ! download; then
  rm -f "$PARTIAL"
  echo "ERROR: download failed" >&2
  exit 1
fi

mv "$PARTIAL" "$DEST"
echo "Model ready: $DEST"
