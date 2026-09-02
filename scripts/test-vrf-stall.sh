#!/usr/bin/env bash
# Prove that a market whose randomness never arrives can be re-opened.
#
# The only way to test that honestly is with an oracle that stays silent, so this
# stops the rollup's VRF oracle, runs tests/vrf-stall.ts, and starts it again —
# whatever the test does. It takes just over two minutes: VRF_GRACE_SECS is 120,
# and the grace period being real is the thing under test.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
LOGDIR="$ROOT/.logs"
mkdir -p "$LOGDIR"

# Both oracles run the same binary and are told apart only by environment, which
# pkill cannot see — so stopping one stops both, and the trap has to put both back
# exactly as local-stack.sh started them.
restart_oracles() {
  echo "==> restarting both VRF oracles"
  VRF_ORACLE_SKIP_PREFLIGHT=true RPC_URL=http://localhost:8899 WEBSOCKET_URL=ws://localhost:8900 \
    RUST_LOG=info vrf-oracle > "$LOGDIR/vrf-base.log" 2>&1 < /dev/null &
  disown
  VRF_ORACLE_SKIP_PREFLIGHT=true RPC_URL=http://localhost:7799 WEBSOCKET_URL=ws://localhost:7800 \
    RUST_LOG=info vrf-oracle > "$LOGDIR/vrf-er.log" 2>&1 < /dev/null &
  disown
  sleep 3
  echo "==> oracles back up"
}
trap restart_oracles EXIT INT TERM

echo "==> stopping the VRF oracles so the rollup's randomness never arrives"
pkill -f "vrf-oracle" 2>/dev/null || true
sleep 2

# shellcheck disable=SC1091
. ./scripts/local-env.sh
npx ts-mocha -p ./tsconfig.json -t 600000 tests/vrf-stall.ts
