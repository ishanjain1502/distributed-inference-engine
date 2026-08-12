#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENSURE="$ROOT/scripts/ensure_model.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

# --- exists: no download ---
DEST="$TMP/already.gguf"
echo tiny > "$DEST"
MODEL_PATH="$DEST" SKIP_MODEL_DOWNLOAD=0 bash "$ENSURE" || fail "exists should exit 0"
[[ -f "$DEST" ]] || fail "dest missing after exists path"
pass "exists skips download"

# --- SKIP with missing file ---
MISSING="$TMP/missing.gguf"
rm -f "$MISSING"
if MODEL_PATH="$MISSING" SKIP_MODEL_DOWNLOAD=1 bash "$ENSURE"; then
  fail "SKIP + missing should exit non-zero"
fi
pass "SKIP + missing exits non-zero"

# --- SKIP with present file ---
MODEL_PATH="$DEST" SKIP_MODEL_DOWNLOAD=1 bash "$ENSURE" || fail "SKIP + present should exit 0"
pass "SKIP + present exits 0"

# --- download via local HTTP + atomic rename ---
PAYLOAD="$TMP/payload.bin"
echo 'fake-gguf-bytes' > "$PAYLOAD"
PORT=8765
python -m http.server "$PORT" --directory "$TMP" >/dev/null 2>&1 &
HTTP_PID=$!
trap 'kill $HTTP_PID 2>/dev/null; rm -rf "$TMP"' EXIT
sleep 0.5

OUT="$TMP/downloaded.gguf"
rm -f "$OUT" "$OUT.partial"
MODEL_PATH="$OUT" MODEL_URL="http://127.0.0.1:${PORT}/payload.bin" \
  bash "$ENSURE" || fail "download should succeed"
[[ -f "$OUT" ]] || fail "downloaded file missing"
[[ ! -f "$OUT.partial" ]] || fail "partial left behind"
grep -q 'fake-gguf-bytes' "$OUT" || fail "content mismatch"
pass "download + atomic rename"

# --- failed download leaves no final file ---
BAD="$TMP/bad.gguf"
rm -f "$BAD" "$BAD.partial"
if MODEL_PATH="$BAD" MODEL_URL="http://127.0.0.1:${PORT}/no-such-file.bin" \
  bash "$ENSURE"; then
  fail "bad URL should fail"
fi
[[ ! -f "$BAD" ]] || fail "corrupt final file after failed download"
[[ ! -f "$BAD.partial" ]] || fail "partial left after failed download"
pass "failed download cleans partial"

echo "All ensure_model tests passed."
