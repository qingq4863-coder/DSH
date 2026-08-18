#!/bin/bash
# Build dsh-wf-engine: verify all lib/ modules and pack the release tgz.
# Hand-written zero-dependency ESM — no tsc step needed.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

for f in lib/*.js; do
  node --check "$f"
  echo "syntax ok: $f"
done

if [ ! -f lib/index.js ]; then
  echo "build: lib/index.js missing" >&2
  exit 1
fi

node scripts/run_eval.mjs > /dev/null
echo "=== evals: all pass ==="

npm pack --pack-destination "$ROOT" > /dev/null
echo "=== Build complete (tgz in ${ROOT}) ==="
