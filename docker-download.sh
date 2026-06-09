#!/usr/bin/env sh
set -eu

IMAGE="${SCRIBD_DL_IMAGE:-scribd-dl:local}"
OUT_DIR="${SCRIBD_DL_OUTPUT:-$PWD/output}"

if [ "$#" -lt 1 ]; then
  echo "Usage: $0 <url-or-file>" >&2
  echo "Optional: SCRIBD_DL_OUTPUT=/path/to/output SCRIBD_DL_IMAGE=scribd-dl:local $0 <url-or-file>" >&2
  exit 64
fi

ARG="$1"

mkdir -p "$OUT_DIR"

docker build -t "$IMAGE" .

if [ -f "$ARG" ]; then
  HOST_FILE=$(cd "$(dirname "$ARG")" && pwd)/$(basename "$ARG")
  CONTAINER_FILE="/app/$(basename "$ARG")"
  docker run --rm \
    -v "$OUT_DIR:/app/output" \
    -v "$HOST_FILE:$CONTAINER_FILE:ro" \
    "$IMAGE" "$CONTAINER_FILE"
else
  docker run --rm \
    -v "$OUT_DIR:/app/output" \
    "$IMAGE" "$ARG"
fi
