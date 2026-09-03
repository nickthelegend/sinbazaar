#!/usr/bin/env bash
# Keep the web app's IDL identical to the one anchor just built.
#
# The app cannot import from `target/` (it is outside the Next.js root and is
# not committed), so it keeps a copy. A copy that nothing checks is a copy that
# drifts, and this one did: the app ran for a whole feature against a 34-
# instruction IDL while the program had 35. Anchor does not complain about a
# field its layout does not know about. It simply returns `undefined`, which
# `toNumber` turned into 0, which the graveyard rendered as "they never came
# back for it" about readers who had.
#
#   bash scripts/sync-idl.sh          copy target -> app
#   bash scripts/sync-idl.sh --check  fail if they differ, for CI and Phase 5
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/target/idl/sinbazaar.json"
DST="$ROOT/app/src/idl/sinbazaar.json"

[ -f "$SRC" ] || { echo "ERROR: $SRC missing. Run 'anchor build' first."; exit 1; }

if [ "${1:-}" = "--check" ]; then
  if diff -q "$SRC" "$DST" >/dev/null 2>&1; then
    echo "IDL in sync: $(python3 -c "import json;print(len(json.load(open('$SRC'))['instructions']))") instructions"
  else
    echo "IDL DRIFT: app/src/idl/sinbazaar.json does not match target/idl/sinbazaar.json"
    echo "  target: $(python3 -c "import json;print(len(json.load(open('$SRC'))['instructions']))") instructions"
    echo "  app:    $(python3 -c "import json;print(len(json.load(open('$DST'))['instructions']))") instructions"
    echo "  fix:    npm run sync:idl"
    exit 1
  fi
else
  cp "$SRC" "$DST"
  echo "synced -> app/src/idl/sinbazaar.json"
fi
