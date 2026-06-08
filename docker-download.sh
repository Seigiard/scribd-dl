#!/usr/bin/env sh
set -eu

IMAGE="${SCRIBD_DL_IMAGE:-scribd-dl:local}"
OUT_DIR="${SCRIBD_DL_OUTPUT:-$PWD/output}"

if [ "$#" -lt 1 ]; then
  echo "Usage: $0 <scribd/slideshare/everand-url>" >&2
  echo "Optional: SCRIBD_DL_OUTPUT=/path/to/output SCRIBD_DL_IMAGE=scribd-dl:local $0 <url>" >&2
  exit 64
fi

URL="$1"

mkdir -p "$OUT_DIR"

docker build -t "$IMAGE" .
docker run --rm \
  -v "$OUT_DIR:/app/output" \
  "$IMAGE" "$URL"
